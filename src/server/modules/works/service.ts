/**
 * Work lifecycle. Every mutating function:
 *   1. checks permissions (server-side),
 *   2. runs in one transaction,
 *   3. records status/field history + audit log,
 *   4. emits in-app notifications.
 */
import type { Prisma, WorkStatus } from "@prisma/client";
import { z } from "zod";
import { transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { formatDateLabel, fromDbDate, toDbDate } from "../../lib/dates";
import { AppError, forbidden, invalid, notFound, parseInput } from "../../lib/errors";
import { nextReference } from "../../lib/numbering";
import { can, requireBranch, requirePermission, type Actor } from "../../rbac/actor";
import { storeImage, type StoredFile, type UploadInput } from "../../storage";
import { getCapacity, lockDateForBooking } from "../capacity/service";
import { listActiveFields, parseCustomValues, type CustomValue } from "../custom-fields/service";
import { createCustomer, customerInput, type CustomerInput } from "../customers/service";
import { approverIds, notify } from "../notifications/service";
import { accrueCommissions, syncWorkBillingStatus } from "../billing/sync";
import { AGENT_EDITABLE_STATUSES, RESCHEDULABLE_STATUSES, isOwnWork, loadWorkForUpdate } from "./access";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const coord = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: "Invalid GPS coordinate" });
        return z.NEVER;
      }
      return n;
    });

const workDetailsSchema = z.object({
  title: optionalText(150),
  description: optionalText(4000),
  locationAddress: optionalText(500),
  locationNotes: optionalText(1000),
  latitude: coord(-90, 90),
  longitude: coord(-180, 180),
});
type WorkDetailsInput = z.input<typeof workDetailsSchema>;

export interface CreateWorkInput extends WorkDetailsInput {
  branchId: string;
  workDate: string;
  customerId?: string;
  newCustomer?: CustomerInput;
  agentId?: string;
  customValues?: Record<string, string | undefined>;
  images?: UploadInput[];
}

async function recordStatus(tx: Tx, actor: Actor, workId: string, from: WorkStatus | null, to: WorkStatus, reason?: string | null) {
  await tx.workStatusHistory.create({ data: { workId, fromStatus: from, toStatus: to, reason: reason ?? null, changedById: actor.id } });
}

async function saveImages(tx: Tx, actor: Actor, workId: string, files: StoredFile[], kind: "AGENT" | "COMPLETION", completionId?: string) {
  for (const f of files) {
    await tx.workImage.create({
      data: {
        workId,
        kind,
        completionId,
        versions: { create: { version: 1, isCurrent: true, uploadedById: actor.id, ...f } },
      },
    });
  }
}

function validFiles(files?: UploadInput[]) {
  return (files ?? []).filter((f) => f && f.size > 0).slice(0, 10);
}

/** Tell approvers when a booking just used the last slot of a date (§40 full-slot warning). */
async function notifyIfDateFull(tx: Tx, iso: string, branchId: string) {
  const capacity = await getCapacity(tx);
  const booked = await tx.work.count({ where: { workDate: toDbDate(iso), deletedAt: null, status: { not: "CANCELLED" } } });
  if (booked < capacity) return;
  await notify(tx, {
    userIds: await approverIds(tx, branchId),
    type: "slot.full",
    title: `${formatDateLabel(iso)} is fully booked`,
    body: `All ${capacity} slots are taken.`,
    link: `/admin/calendar?view=day&date=${iso}`,
    vars: { date: formatDateLabel(iso), capacity },
  });
}

// ───────────────────────────── Create ─────────────────────────────

export async function createWork(actor: Actor, input: CreateWorkInput) {
  requirePermission(actor, "works.create");
  requireBranch(actor, input.branchId);
  const details = parseInput(workDetailsSchema, input);

  if (!input.customerId && !input.newCustomer) throw invalid("Please select or add a customer.");
  if (input.newCustomer) parseInput(customerInput, input.newCustomer); // fail fast before uploads

  const fields = await listActiveFields();
  const customValues = parseCustomValues(fields, input.customValues ?? {});

  // Agents always own the works they create; office users may set the agent.
  const agentId = actor.portal === "AGENT" ? actor.id : input.agentId || null;

  // Upload files before the transaction so the date lock is held briefly.
  const files = await Promise.all(validFiles(input.images).map((f) => storeImage(f, "works")));

  return transaction(async (tx) => {
    // ⬇ Capacity: serialise on the date and verify a free slot. No override exists.
    await lockDateForBooking(tx, input.workDate);

    let customerId = input.customerId;
    if (input.newCustomer) {
      const c = await createCustomer(actor, { ...input.newCustomer, branchId: input.branchId }, tx);
      customerId = c.id;
    } else {
      const c = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!c) throw notFound("Customer");
      if (actor.portal === "AGENT" && c.createdById !== actor.id) {
        const hasOwnWork = await tx.work.count({ where: { customerId, agentId: actor.id } });
        if (!hasOwnWork) throw forbidden("You can only use your own customers.");
      } else if (c.branchId && actor.portal !== "AGENT") {
        requireBranch(actor, c.branchId);
      }
    }

    if (agentId && agentId !== actor.id) {
      const agent = await tx.user.findFirst({ where: { id: agentId, deletedAt: null, role: { portal: "AGENT" } } });
      if (!agent) throw invalid("Selected agent was not found.");
    }

    const status: WorkStatus = actor.portal === "AGENT" ? "SUBMITTED" : "SCHEDULED";
    const reference = await nextReference(tx, "WRK");
    const work = await tx.work.create({
      data: {
        reference,
        customerId: customerId!,
        agentId,
        branchId: input.branchId,
        workDate: toDbDate(input.workDate),
        status,
        ...details,
        createdById: actor.id,
      },
    });

    for (const [fieldId, value] of customValues) {
      await tx.customFieldValue.create({ data: { workId: work.id, fieldId, value } });
    }
    await saveImages(tx, actor, work.id, files, "AGENT");
    await recordStatus(tx, actor, work.id, null, status);
    await audit(tx, actor, { action: "work.create", entityType: "Work", entityId: work.id, after: { ...work, customValues: Object.fromEntries(customValues) } });

    const admins = (await approverIds(tx, input.branchId)).filter((id) => id !== actor.id);
    await notify(tx, {
      userIds: admins,
      type: "work.created",
      title: `New work ${reference}`,
      body: `${actor.name} added a work for ${formatDateLabel(input.workDate)}.`,
      link: `/admin/works/${work.id}`,
      vars: { work_id: reference, date: formatDateLabel(input.workDate), customer_name: (await tx.customer.findUnique({ where: { id: customerId! }, select: { name: true } }))?.name, agent_name: actor.name, branch: (await tx.branch.findUnique({ where: { id: input.branchId }, select: { name: true } }))?.name },
    });
    await notifyIfDateFull(tx, input.workDate, input.branchId);
    return work;
  });
}

// ───────────────────────────── Date change / reschedule ─────────────────────────────

export async function changeWorkDate(actor: Actor, workId: string, newDate: string, reason: string) {
  requirePermission(actor, "works.change_date");
  if (!reason?.trim()) throw invalid("Please give a reason for changing the date.");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    requireBranch(actor, work.branchId);
    if (!RESCHEDULABLE_STATUSES.includes(work.status)) {
      throw new AppError("INVALID_STATE", "This work can no longer be rescheduled.");
    }
    const oldDate = fromDbDate(work.workDate);
    if (oldDate === newDate) throw invalid("The new date is the same as the current date.");

    await lockDateForBooking(tx, newDate);

    await tx.work.update({ where: { id: workId }, data: { workDate: toDbDate(newDate) } });
    await tx.workFieldChange.create({ data: { workId, field: "workDate", oldValue: oldDate, newValue: newDate, reason, changedById: actor.id } });
    await audit(tx, actor, { action: "work.change_date", entityType: "Work", entityId: workId, before: { workDate: oldDate }, after: { workDate: newDate }, reason });

    const workers = await tx.workAssignment.findMany({ where: { workId, removedAt: null }, select: { workerId: true } });
    await notify(tx, {
      userIds: [...workers.map((w) => w.workerId), work.agentId ?? ""].filter((id) => id && id !== actor.id),
      type: "work.date_changed",
      title: `Date changed for ${work.reference}`,
      body: `Moved from ${formatDateLabel(oldDate)} to ${formatDateLabel(newDate)}. Reason: ${reason}`,
      link: `/work/${workId}`,
      vars: { work_id: work.reference, old_date: formatDateLabel(oldDate), new_date: formatDateLabel(newDate), reason },
      customerId: work.customerId,
    });
    await notifyIfDateFull(tx, newDate, work.branchId);
  });
}

// ───────────────────────────── Edit details ─────────────────────────────

export interface EditWorkInput extends WorkDetailsInput {
  customValues?: Record<string, string | undefined>;
  reason: string;
}

/**
 * Edit work details with field-level history. Agents may only edit their own
 * works' permitted fields (location, description, custom fields) while the
 * work is open. Customer data is never edited here (protected).
 */
export async function editWork(actor: Actor, workId: string, input: EditWorkInput) {
  if (!input.reason?.trim()) throw invalid("Please give a reason for this change.");
  const details = parseInput(workDetailsSchema, input);
  const fields = await listActiveFields();
  const customValues = input.customValues ? parseCustomValues(fields, input.customValues) : null;

  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    const fullEdit = can(actor, "works.edit");
    if (fullEdit) requireBranch(actor, work.branchId);
    else if (!(can(actor, "works.edit_own") && isOwnWork(actor, work))) throw forbidden();
    if (!fullEdit && !AGENT_EDITABLE_STATUSES.includes(work.status)) {
      throw new AppError("INVALID_STATE", "This work can no longer be edited.");
    }

    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
    const data: Prisma.WorkUpdateInput = {};
    const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
    const compare = {
      title: [work.title, details.title],
      description: [work.description, details.description],
      locationAddress: [work.locationAddress, details.locationAddress],
      locationNotes: [work.locationNotes, details.locationNotes],
      latitude: [num(work.latitude), details.latitude],
      longitude: [num(work.longitude), details.longitude],
    } as const;
    for (const [field, [oldV, newV]] of Object.entries(compare)) {
      if ((oldV ?? null) !== (newV ?? null)) {
        changes.push({ field, oldValue: oldV, newValue: newV });
        (data as Record<string, unknown>)[field] = newV;
      }
    }

    if (customValues) {
      const existing = await tx.customFieldValue.findMany({ where: { workId } });
      const byField = new Map(existing.map((e) => [e.fieldId, e]));
      for (const f of fields) {
        const oldV = byField.get(f.id)?.value ?? null;
        const newV: CustomValue | null = customValues.get(f.id) ?? null;
        if (JSON.stringify(oldV) === JSON.stringify(newV)) continue;
        changes.push({ field: `custom:${f.key}`, oldValue: oldV, newValue: newV });
        if (newV === null) await tx.customFieldValue.deleteMany({ where: { workId, fieldId: f.id } });
        else
          await tx.customFieldValue.upsert({
            where: { workId_fieldId: { workId, fieldId: f.id } },
            create: { workId, fieldId: f.id, value: newV },
            update: { value: newV },
          });
      }
    }

    if (changes.length === 0) throw invalid("No changes to save.");
    if (Object.keys(data).length) await tx.work.update({ where: { id: workId }, data });
    for (const c of changes) {
      await tx.workFieldChange.create({
        data: {
          workId,
          field: c.field,
          oldValue: (c.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (c.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
          reason: input.reason,
          changedById: actor.id,
        },
      });
    }
    await audit(tx, actor, { action: "work.edit", entityType: "Work", entityId: workId, before: changes.map((c) => ({ [c.field]: c.oldValue })), after: changes.map((c) => ({ [c.field]: c.newValue })), reason: input.reason });
    const workers = await tx.workAssignment.findMany({ where: { workId, removedAt: null }, select: { workerId: true } });
    const changed = changes.map((c) => c.field.replace(/^custom:/, "").replace(/([A-Z])/g, " $1").toLowerCase()).join(", ");
    await notify(tx, {
      userIds: [...workers.map((w) => w.workerId), work.agentId ?? ""].filter((id) => id && id !== actor.id),
      type: "work.updated",
      title: `${work.reference} updated`,
      body: `${actor.name} changed ${changed}. Reason: ${input.reason}`,
      link: `/work/${workId}`,
      vars: { work_id: work.reference, changes: changed, reason: input.reason, editor_name: actor.name },
    });
    return changes.length;
  });
}

// ───────────────────────────── Assignment ─────────────────────────────

export async function assignWorkers(actor: Actor, workId: string, workerIds: string[]) {
  requirePermission(actor, "works.assign_workers");
  const ids = [...new Set(workerIds.filter(Boolean))];
  if (ids.length === 0) throw invalid("Select at least one worker.");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    requireBranch(actor, work.branchId);
    if (!RESCHEDULABLE_STATUSES.includes(work.status)) throw new AppError("INVALID_STATE", "Workers can't be assigned at this stage.");

    const workers = await tx.user.findMany({
      where: { id: { in: ids }, deletedAt: null, status: "ACTIVE", role: { portal: "WORKER" }, branches: { some: { branchId: work.branchId } } },
    });
    if (workers.length !== ids.length) throw invalid("One or more selected workers are not available for this branch.");

    const active = await tx.workAssignment.findMany({ where: { workId, removedAt: null } });
    const already = new Set(active.map((a) => a.workerId));
    const added = workers.filter((w) => !already.has(w.id));
    if (added.length === 0) throw invalid("These workers are already assigned.");

    for (const w of added) await tx.workAssignment.create({ data: { workId, workerId: w.id, assignedById: actor.id } });
    if (work.status === "SUBMITTED" || work.status === "SCHEDULED" || work.status === "DRAFT") {
      await tx.work.update({ where: { id: workId }, data: { status: "ASSIGNED" } });
      await recordStatus(tx, actor, workId, work.status, "ASSIGNED");
    }
    await audit(tx, actor, { action: "work.assign_workers", entityType: "Work", entityId: workId, after: { added: added.map((w) => ({ id: w.id, name: w.name })) } });
    await notify(tx, {
      userIds: added.map((w) => w.id),
      type: "work.assigned",
      title: `Work ${work.reference} assigned to you`,
      body: `Work ${work.reference} has been assigned to you for ${formatDateLabel(fromDbDate(work.workDate))}.`,
      link: `/worker/works/${workId}`,
      vars: { work_id: work.reference, date: formatDateLabel(fromDbDate(work.workDate)), location: work.locationAddress ?? "see app" },
    });
    return added.length;
  });
}

export async function removeWorker(actor: Actor, workId: string, workerId: string, reason: string) {
  requirePermission(actor, "works.assign_workers");
  if (!reason?.trim()) throw invalid("Please give a reason for removing this worker.");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    requireBranch(actor, work.branchId);
    const a = await tx.workAssignment.findFirst({ where: { workId, workerId, removedAt: null } });
    if (!a) throw notFound("Assignment");
    await tx.workAssignment.update({ where: { id: a.id }, data: { removedAt: new Date(), removedById: actor.id, removeReason: reason } });
    const remaining = await tx.workAssignment.count({ where: { workId, removedAt: null } });
    if (remaining === 0 && work.status === "ASSIGNED") {
      await tx.work.update({ where: { id: workId }, data: { status: "SCHEDULED" } });
      await recordStatus(tx, actor, workId, "ASSIGNED", "SCHEDULED", "All workers removed");
    }
    await audit(tx, actor, { action: "work.remove_worker", entityType: "Work", entityId: workId, before: { workerId }, reason });
    await notify(tx, { userIds: [workerId], type: "work.unassigned", title: `Removed from ${work.reference}`, body: `Reason: ${reason}`, vars: { work_id: work.reference, reason } });
  });
}

// ───────────────────────────── Worker: start & complete ─────────────────────────────

async function requireActiveAssignment(tx: Tx, actor: Actor, workId: string) {
  const a = await tx.workAssignment.findFirst({ where: { workId, workerId: actor.id, removedAt: null } });
  if (!a) throw forbidden("This work is not assigned to you.");
}

export async function startWork(actor: Actor, workId: string) {
  requirePermission(actor, "works.complete");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    await requireActiveAssignment(tx, actor, workId);
    if (work.status !== "ASSIGNED") throw new AppError("INVALID_STATE", "Work can only be started once assigned.");
    await tx.work.update({ where: { id: workId }, data: { status: "IN_PROGRESS" } });
    await recordStatus(tx, actor, workId, work.status, "IN_PROGRESS");
    await audit(tx, actor, { action: "work.start", entityType: "Work", entityId: workId });
  });
}

export interface CompletionInput {
  message?: string;
  description?: string;
  images: UploadInput[];
}

/** Worker marks work completed → status becomes Pending Approval. */
export async function submitCompletion(actor: Actor, workId: string, input: CompletionInput) {
  requirePermission(actor, "works.complete");
  const images = validFiles(input.images);
  if (images.length === 0) throw invalid("Please upload at least one completion photo.");
  const message = input.message?.trim().slice(0, 2000) || null;
  const description = input.description?.trim().slice(0, 4000) || null;
  const files = await Promise.all(images.map((f) => storeImage(f, "completions")));

  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    await requireActiveAssignment(tx, actor, workId);
    if (!(work.status === "ASSIGNED" || work.status === "IN_PROGRESS")) {
      throw new AppError("INVALID_STATE", "This work is not open for completion.");
    }
    const completion = await tx.workCompletion.create({ data: { workId, submittedById: actor.id, message, description } });
    await saveImages(tx, actor, workId, files, "COMPLETION", completion.id);
    await tx.work.update({ where: { id: workId }, data: { status: "PENDING_APPROVAL" } });
    await recordStatus(tx, actor, workId, work.status, "WORKER_COMPLETED");
    await recordStatus(tx, actor, workId, "WORKER_COMPLETED", "PENDING_APPROVAL");
    await audit(tx, actor, { action: "work.complete", entityType: "Work", entityId: workId, after: { completionId: completion.id, images: files.length } });
    await notify(tx, {
      userIds: await approverIds(tx, work.branchId),
      type: "work.completed",
      title: `${work.reference} is waiting for approval`,
      body: `${actor.name} marked the work completed.`,
      link: `/admin/works/${workId}`,
      vars: { work_id: work.reference, worker_name: actor.name },
    });
    return completion;
  });
}

// ───────────────────────────── Approval ─────────────────────────────

export async function approveWork(actor: Actor, workId: string, comment?: string) {
  requirePermission(actor, "works.approve");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    requireBranch(actor, work.branchId);
    if (work.status !== "PENDING_APPROVAL") throw new AppError("INVALID_STATE", "Only works pending approval can be approved.");
    await tx.workReview.create({ data: { workId, decision: "APPROVED", comment: comment?.trim() || null, reviewedById: actor.id } });
    await tx.work.update({ where: { id: workId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: actor.id } });
    await recordStatus(tx, actor, workId, work.status, "APPROVED", comment);
    await audit(tx, actor, { action: "work.approve", entityType: "Work", entityId: workId, reason: comment });
    // Phase 2: commissions accrue on approval; an existing invoice moves the work on to Invoiced/Paid.
    await accrueCommissions(tx, actor, workId);
    await syncWorkBillingStatus(tx, actor, workId);
    const workers = await tx.workAssignment.findMany({ where: { workId, removedAt: null }, select: { workerId: true } });
    await notify(tx, {
      userIds: [...workers.map((w) => w.workerId), work.agentId ?? ""],
      type: "work.approved",
      title: `${work.reference} approved`,
      body: comment ? `Approved: ${comment}` : "Completion approved.",
      link: `/work/${workId}`,
      vars: { work_id: work.reference, comment: comment ?? "" },
      customerId: work.customerId,
    });
  });
}

/** Reject / request correction. Reason is mandatory and retained; workers are notified. */
export async function rejectWork(actor: Actor, workId: string, reason: string) {
  requirePermission(actor, "works.approve");
  if (!reason?.trim()) throw invalid("Please explain what needs to be corrected.");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    requireBranch(actor, work.branchId);
    if (work.status !== "PENDING_APPROVAL") throw new AppError("INVALID_STATE", "Only works pending approval can be rejected.");
    await tx.workReview.create({ data: { workId, decision: "REJECTED", comment: reason.trim(), reviewedById: actor.id } });
    await tx.work.update({ where: { id: workId }, data: { status: "IN_PROGRESS" } });
    await recordStatus(tx, actor, workId, work.status, "IN_PROGRESS", `Correction requested: ${reason}`);
    await audit(tx, actor, { action: "work.reject", entityType: "Work", entityId: workId, reason });
    const workers = await tx.workAssignment.findMany({ where: { workId, removedAt: null }, select: { workerId: true } });
    await notify(tx, {
      userIds: workers.map((w) => w.workerId),
      type: "work.rejected",
      title: `Correction needed on ${work.reference}`,
      body: reason,
      link: `/worker/works/${workId}`,
      vars: { work_id: work.reference, reason },
    });
  });
}

// ───────────────────────────── Cancel / comment ─────────────────────────────

export async function cancelWork(actor: Actor, workId: string, reason: string) {
  requirePermission(actor, "works.cancel");
  if (!reason?.trim()) throw invalid("Please give a reason for cancelling.");
  return transaction(async (tx) => {
    const work = await loadWorkForUpdate(tx, actor, workId);
    requireBranch(actor, work.branchId);
    if (!RESCHEDULABLE_STATUSES.includes(work.status) && work.status !== "PENDING_APPROVAL") {
      throw new AppError("INVALID_STATE", "This work can no longer be cancelled.");
    }
    await tx.work.update({ where: { id: workId }, data: { status: "CANCELLED", cancelReason: reason } });
    await recordStatus(tx, actor, workId, work.status, "CANCELLED", reason);
    await audit(tx, actor, { action: "work.cancel", entityType: "Work", entityId: workId, before: { status: work.status }, reason });
    const workers = await tx.workAssignment.findMany({ where: { workId, removedAt: null }, select: { workerId: true } });
    await notify(tx, {
      userIds: [...workers.map((w) => w.workerId), work.agentId ?? ""].filter((id) => id && id !== actor.id),
      type: "work.cancelled",
      title: `${work.reference} cancelled`,
      body: `Reason: ${reason}`,
      vars: { work_id: work.reference, reason },
    });
  });
}

export async function addComment(actor: Actor, workId: string, body: string) {
  requirePermission(actor, "works.comment");
  const text = body?.trim();
  if (!text) throw invalid("Comment cannot be empty.");
  if (text.length > 2000) throw invalid("Comment is too long (max 2000 characters).");
  return transaction(async (tx) => {
    await loadWorkForUpdate(tx, actor, workId);
    const c = await tx.workComment.create({ data: { workId, authorId: actor.id, body: text } });
    await audit(tx, actor, { action: "work.comment", entityType: "Work", entityId: workId, after: { commentId: c.id } });
    return c;
  });
}
