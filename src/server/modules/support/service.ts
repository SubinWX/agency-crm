/**
 * Support Portal (spec §42). Complaints / requests from staff, agents, workers
 * (and, later, customers).
 *
 * Visibility
 *  - Requesters see only their own tickets, and never internal notes.
 *  - Support managers (`support.manage`) see tickets of their branches plus
 *    company-wide tickets; Super Admin sees everything.
 *  - An assignee always sees the tickets assigned to them.
 *
 * Every status / priority / assignment / category change is recorded in
 * SupportTicketEvent; tickets are never deleted.
 */
import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { z } from "zod";
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalid, notFound, parseInput } from "../../lib/errors";
import { nextReference } from "../../lib/numbering";
import { can, canAccessBranch, type Actor } from "../../rbac/actor";
import { storeFile, type UploadInput } from "../../storage";
import { notify } from "../notifications/service";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_REVIEW: "In Review",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_USER: "Waiting for User",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
export const PRIORITY_LABELS: Record<TicketPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
const STATUSES = Object.keys(STATUS_LABELS) as TicketStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as TicketPriority[];
const ACTIVE_STATUSES: TicketStatus[] = ["OPEN", "IN_REVIEW", "IN_PROGRESS", "WAITING_FOR_USER"];

export const isManager = (actor: Actor) => can(actor, "support.manage");

function managerScope(actor: Actor): Prisma.SupportTicketWhereInput {
  if (actor.isSuperAdmin) return {};
  return { OR: [{ branchId: null }, { branchId: { in: [...actor.branchIds] } }] };
}

/** Tickets the actor may see. */
export function ticketScope(actor: Actor): Prisma.SupportTicketWhereInput {
  // Explicit: an empty `{}` inside OR does not mean "everything" in Prisma.
  if (actor.isSuperAdmin) return {};
  const ors: Prisma.SupportTicketWhereInput[] = [{ submittedById: actor.id }, { assignedToId: actor.id }];
  if (isManager(actor)) ors.push(managerScope(actor));
  return { OR: ors };
}

async function loadForUpdate(tx: Tx, actor: Actor, id: string) {
  await tx.$queryRaw`SELECT id FROM "SupportTicket" WHERE id = ${id} FOR UPDATE`;
  const t = await tx.supportTicket.findFirst({ where: { id, AND: [ticketScope(actor)] } });
  if (!t) throw notFound("Ticket");
  return t;
}

function requireManage(actor: Actor, t: { branchId: string | null; assignedToId: string | null }) {
  if (!isManager(actor)) throw forbidden("Only support managers can do this.");
  if (t.branchId && !canAccessBranch(actor, t.branchId) && t.assignedToId !== actor.id) throw forbidden("This ticket belongs to another branch.");
}

async function storeAttachments(files: UploadInput[]) {
  const list = files.filter((f) => f && f.size > 0);
  if (list.length > 5) throw invalid("You can attach up to 5 files at a time.");
  return Promise.all(list.map((f) => storeFile(f, "support", { allowPdf: true })));
}

async function logEvent(tx: Tx, ticketId: string, userId: string, action: string, fromValue?: string | null, toValue?: string | null, note?: string | null) {
  await tx.supportTicketEvent.create({ data: { ticketId, userId, action, fromValue: fromValue ?? null, toValue: toValue ?? null, note: note ?? null } });
}

/** Managers who should hear about a ticket (branch managers + Super Admins). */
async function managerIds(tx: Tx, branchId: string | null, exclude?: string) {
  const users = await tx.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      id: exclude ? { not: exclude } : undefined,
      OR: [
        { role: { isSuperAdmin: true } },
        {
          role: { permissions: { some: { permission: { key: "support.manage" } } } },
          ...(branchId ? { branches: { some: { branchId } } } : {}),
        },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function tellRequester(tx: Tx, actor: Actor, t: { id: string; number: string; title: string; submittedById: string }, status: TicketStatus, update: string) {
  if (t.submittedById === actor.id) return;
  await notify(tx, {
    userIds: [t.submittedById],
    type: "support.ticket_update",
    title: `${t.number}: ${STATUS_LABELS[status]}`,
    body: update,
    link: `/support/${t.id}`,
    vars: { ticket_id: t.number, status: STATUS_LABELS[status], update },
  });
}

// ───────────────────────────── Create ─────────────────────────────

const createSchema = z.object({
  title: z.string().trim().min(3, "Title is required (min 3 characters)").max(150),
  description: z.string().trim().min(5, "Please describe the problem or request").max(5000),
  categoryId: z.string().min(1, "Choose a category"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  branchId: z.string().optional(),
  workReference: z.string().trim().optional(),
});
export type CreateTicketInput = z.input<typeof createSchema> & { attachments?: UploadInput[] };

export async function createTicket(actor: Actor, input: CreateTicketInput) {
  if (!can(actor, "support.create") && !isManager(actor)) throw forbidden("You can't raise support tickets.");
  const d = parseInput(createSchema, input);
  if (d.branchId && !canAccessBranch(actor, d.branchId)) throw forbidden("You do not have access to this branch.");
  const files = await storeAttachments(input.attachments ?? []);

  return transaction(async (tx) => {
    const cat = await tx.supportCategory.findFirst({ where: { id: d.categoryId, active: true } });
    if (!cat) throw invalid("Choose a valid category.");
    // Customers (portal) raise tickets for themselves; link their record and branch.
    const customer = actor.portal === "CUSTOMER" ? await tx.customer.findFirst({ where: { userId: actor.id, deletedAt: null } }) : null;
    if (actor.portal === "CUSTOMER" && !customer) throw forbidden();
    let workId: string | null = null;
    if (d.workReference) {
      const w = await tx.work.findFirst({ where: { reference: d.workReference.toUpperCase(), deletedAt: null, ...(customer ? { customerId: customer.id } : {}) } });
      if (!w) throw invalid("Work reference not found.");
      workId = w.id;
    }
    // Default the branch to the user's only branch, so the right managers see it.
    const branchId = customer ? customer.branchId : d.branchId || (actor.branchIds.length === 1 ? actor.branchIds[0] : null);
    const number = await nextReference(tx, "SUP");
    const t = await tx.supportTicket.create({
      data: {
        number,
        title: d.title,
        description: d.description,
        categoryId: cat.id,
        priority: d.priority,
        submittedById: actor.id,
        customerId: customer?.id ?? null,
        branchId,
        workId,
        attachments: { create: files.map((f) => ({ ...f, uploadedById: actor.id })) },
      },
    });
    await logEvent(tx, t.id, actor.id, "created", null, "OPEN");
    await audit(tx, actor, { action: "support.create", entityType: "SupportTicket", entityId: t.id, after: { number, title: d.title, priority: d.priority, category: cat.name } });
    await notify(tx, {
      userIds: await managerIds(tx, branchId, actor.id),
      type: "support.ticket_created",
      title: `New ticket ${number}`,
      body: `${actor.name}: ${d.title}`,
      link: `/support/${t.id}`,
      vars: { ticket_id: number, title: d.title, priority: PRIORITY_LABELS[d.priority], submitter_name: actor.name, category: cat.name },
    });
    return t;
  });
}

// ───────────────────────────── Replies ─────────────────────────────

/** Reply (public) or internal note (managers only). A requester's reply re-opens a waiting ticket. */
export async function addReply(actor: Actor, ticketId: string, input: { body: string; internal?: boolean; attachments?: UploadInput[] }) {
  const body = input.body?.trim();
  if (!body) throw invalid("Write a message.");
  if (body.length > 5000) throw invalid("Message is too long (max 5000 characters).");
  const internal = !!input.internal;
  const files = await storeAttachments(input.attachments ?? []);
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, actor, ticketId);
    if (internal) requireManage(actor, t);
    if (t.status === "CLOSED") throw new AppError("INVALID_STATE", "This ticket is closed. Ask a support manager to reopen it.");
    const c = await tx.supportComment.create({
      data: { ticketId, authorId: actor.id, body, isInternal: internal, attachments: { create: files.map((f) => ({ ...f, ticketId, uploadedById: actor.id, isInternal: internal })) } },
    });
    let status = t.status;
    const isRequester = t.submittedById === actor.id;
    if (!internal && isRequester && (t.status === "WAITING_FOR_USER" || t.status === "RESOLVED")) {
      status = "IN_REVIEW";
      await logEvent(tx, ticketId, actor.id, t.status === "RESOLVED" ? "reopened" : "status", t.status, status, "Requester replied");
    } else if (!internal && !isRequester && t.status === "OPEN" && isManager(actor)) {
      status = "IN_REVIEW"; // first manager response
      await logEvent(tx, ticketId, actor.id, "status", t.status, status);
    }
    await tx.supportTicket.update({ where: { id: ticketId }, data: { status, lastActivityAt: new Date(), ...(status === "IN_REVIEW" && t.status === "RESOLVED" ? { resolvedAt: null } : {}) } });
    await audit(tx, actor, { action: internal ? "support.note" : "support.reply", entityType: "SupportTicket", entityId: ticketId, after: { commentId: c.id, attachments: files.length } });

    if (!internal) {
      if (isRequester) {
        const ids = t.assignedToId ? [t.assignedToId] : await managerIds(tx, t.branchId, actor.id);
        await notify(tx, { userIds: ids.filter((i) => i !== actor.id), type: "support.ticket_update", title: `${t.number}: new reply`, body: body.slice(0, 200), link: `/support/${t.id}`, vars: { ticket_id: t.number, status: STATUS_LABELS[status], update: body.slice(0, 200) } });
      } else {
        await tellRequester(tx, actor, t, status, `New reply: ${body.slice(0, 200)}`);
      }
    }
    return c;
  });
}

// ───────────────────────────── Manager actions ─────────────────────────────

export async function updateTicket(
  actor: Actor,
  ticketId: string,
  input: { status?: string; priority?: string; categoryId?: string; assignedToId?: string | null; resolution?: string; reason?: string },
) {
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, actor, ticketId);
    requireManage(actor, t);
    const data: Prisma.SupportTicketUpdateInput = { lastActivityAt: new Date() };
    const changes: string[] = [];

    if (input.priority && input.priority !== t.priority) {
      if (!PRIORITIES.includes(input.priority as TicketPriority)) throw invalid("Invalid priority.");
      data.priority = input.priority as TicketPriority;
      await logEvent(tx, ticketId, actor.id, "priority", t.priority, input.priority);
      changes.push(`priority → ${PRIORITY_LABELS[input.priority as TicketPriority]}`);
    }
    if (input.categoryId && input.categoryId !== t.categoryId) {
      const cat = await tx.supportCategory.findFirst({ where: { id: input.categoryId, active: true } });
      if (!cat) throw invalid("Invalid category.");
      data.category = { connect: { id: cat.id } };
      await logEvent(tx, ticketId, actor.id, "category", t.categoryId, cat.name);
    }
    if (input.assignedToId !== undefined && (input.assignedToId || null) !== t.assignedToId) {
      const to = input.assignedToId || null;
      let name: string | null = null;
      if (to) {
        const u = await tx.user.findFirst({
          where: { id: to, deletedAt: null, status: "ACTIVE", OR: [{ role: { isSuperAdmin: true } }, { role: { permissions: { some: { permission: { key: "support.manage" } } } } }] },
          include: { branches: true, role: true },
        });
        if (!u) throw invalid("Tickets can only be assigned to support managers.");
        if (t.branchId && !u.role.isSuperAdmin && !u.branches.some((b) => b.branchId === t.branchId)) throw invalid(`${u.name} does not work in this ticket's branch.`);
        name = u.name;
      }
      data.assignedToId = to;
      await logEvent(tx, ticketId, actor.id, "assigned", t.assignedToId, name ?? "Unassigned");
      if (to && to !== actor.id) {
        await notify(tx, { userIds: [to], type: "support.ticket_assigned", title: `${t.number} assigned to you`, body: t.title, link: `/support/${t.id}`, vars: { ticket_id: t.number, title: t.title, priority: PRIORITY_LABELS[(input.priority as TicketPriority) ?? t.priority] } });
      }
      changes.push(name ? `assigned to ${name}` : "unassigned");
    }

    let newStatus = t.status;
    if (input.status && input.status !== t.status) {
      if (!STATUSES.includes(input.status as TicketStatus)) throw invalid("Invalid status.");
      newStatus = input.status as TicketStatus;
      if (t.status === "CLOSED") {
        if (!input.reason?.trim()) throw invalid("Please give a reason for reopening a closed ticket.");
        data.closedAt = null;
        data.closedById = null;
      }
      if (newStatus === "RESOLVED") {
        const resolution = input.resolution?.trim();
        if (!resolution) throw invalid("Please describe the resolution.");
        data.resolution = resolution.slice(0, 5000);
        data.resolvedAt = new Date();
      }
      if (newStatus === "CLOSED") {
        data.closedAt = new Date();
        data.closedById = actor.id;
        if (!t.resolution && input.resolution?.trim()) data.resolution = input.resolution.trim().slice(0, 5000);
      }
      if (ACTIVE_STATUSES.includes(newStatus)) data.resolvedAt = null;
      data.status = newStatus;
      const action = newStatus === "RESOLVED" ? "resolved" : newStatus === "CLOSED" ? "closed" : t.status === "CLOSED" || t.status === "RESOLVED" ? "reopened" : "status";
      await logEvent(tx, ticketId, actor.id, action, t.status, newStatus, input.reason || (newStatus === "RESOLVED" ? input.resolution : null));
      changes.push(`status → ${STATUS_LABELS[newStatus]}`);
    }

    if (changes.length === 0 && !data.category) throw invalid("Nothing changed.");
    await tx.supportTicket.update({ where: { id: ticketId }, data });
    await audit(tx, actor, { action: "support.update", entityType: "SupportTicket", entityId: ticketId, before: { status: t.status, priority: t.priority, assignedToId: t.assignedToId }, after: { ...input }, reason: input.reason });
    if (newStatus !== t.status) {
      const update = newStatus === "RESOLVED" ? `Resolution: ${input.resolution}` : newStatus === "WAITING_FOR_USER" ? "We need more information from you — please reply in the Support Portal." : "";
      await tellRequester(tx, actor, t, newStatus, update);
    }
  });
}

/** Requester confirms a resolved ticket is done, or asks to reopen it. */
export async function requesterAction(actor: Actor, ticketId: string, action: "close" | "reopen", note?: string) {
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, actor, ticketId);
    if (t.submittedById !== actor.id) throw forbidden();
    if (t.status !== "RESOLVED") throw new AppError("INVALID_STATE", action === "close" ? "Only resolved tickets can be closed by you." : "Only resolved tickets can be reopened. Closed tickets need a support manager.");
    if (action === "reopen" && !note?.trim()) throw invalid("Tell us what is still wrong.");
    const to: TicketStatus = action === "close" ? "CLOSED" : "IN_REVIEW";
    await tx.supportTicket.update({
      where: { id: ticketId },
      data: { status: to, lastActivityAt: new Date(), ...(to === "CLOSED" ? { closedAt: new Date(), closedById: actor.id } : { resolvedAt: null }) },
    });
    if (note?.trim()) await tx.supportComment.create({ data: { ticketId, authorId: actor.id, body: note.trim().slice(0, 5000) } });
    await logEvent(tx, ticketId, actor.id, action === "close" ? "closed" : "reopened", t.status, to, note);
    await audit(tx, actor, { action: `support.requester_${action}`, entityType: "SupportTicket", entityId: ticketId, reason: note });
    if (action === "reopen") {
      const ids = t.assignedToId ? [t.assignedToId] : await managerIds(tx, t.branchId, actor.id);
      await notify(tx, { userIds: ids, type: "support.ticket_update", title: `${t.number} reopened`, body: note ?? "", link: `/support/${t.id}`, vars: { ticket_id: t.number, status: STATUS_LABELS[to], update: note ?? "" } });
    }
  });
}

// ───────────────────────────── Requester review ─────────────────────────────

/** The person who raised the ticket rates the support (1–5 stars) once it's resolved or closed. Can be updated. */
export async function rateTicket(actor: Actor, ticketId: string, input: { rating: number; comment?: string }) {
  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) throw invalid("Choose 1 to 5 stars.");
  const comment = input.comment?.trim().slice(0, 1000) || null;
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, actor, ticketId);
    if (t.submittedById !== actor.id) throw forbidden("Only the person who raised this request can review it.");
    if (t.status !== "RESOLVED" && t.status !== "CLOSED") throw new AppError("INVALID_STATE", "You can review once the request is resolved.");
    await tx.supportTicket.update({ where: { id: ticketId }, data: { rating, ratingComment: comment, ratedAt: new Date() } });
    await logEvent(tx, ticketId, actor.id, "reviewed", t.rating ? String(t.rating) : null, String(rating), comment);
    await audit(tx, actor, { action: "support.review", entityType: "SupportTicket", entityId: ticketId, before: { rating: t.rating }, after: { rating, comment } });
    const tell = t.assignedToId ? [t.assignedToId] : await managerIds(tx, t.branchId, actor.id);
    await notify(tx, { userIds: tell, type: "support.ticket_reviewed", title: `${t.number} rated ${rating}★`, body: comment ?? "No comment", link: `/support/${t.id}` });
  });
}

/** Average rating and count over the last `days` (managers). */
export async function ratingSummary(actor: Actor, days = 90) {
  if (!isManager(actor)) return null;
  const since = new Date(Date.now() - days * 86_400_000);
  const r = await prisma.supportTicket.aggregate({ where: { AND: [managerScope(actor), { rating: { not: null }, ratedAt: { gte: since } }] }, _avg: { rating: true }, _count: { rating: true } });
  return { average: r._avg.rating ? Math.round(r._avg.rating * 10) / 10 : null, count: r._count.rating };
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listTickets(
  actor: Actor,
  f: { view?: "mine" | "all" | "assigned"; status?: string; priority?: string; categoryId?: string; q?: string; page?: number } = {},
) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 25;
  const view = f.view === "all" && isManager(actor) ? "all" : f.view === "assigned" ? "assigned" : f.view === "mine" || !isManager(actor) ? "mine" : "all";
  const and: Prisma.SupportTicketWhereInput[] = [ticketScope(actor)];
  if (view === "mine") and.push({ submittedById: actor.id });
  if (view === "assigned") and.push({ assignedToId: actor.id });
  if (f.status === "ACTIVE") and.push({ status: { in: ACTIVE_STATUSES } });
  else if (f.status && STATUSES.includes(f.status as TicketStatus)) and.push({ status: f.status as TicketStatus });
  if (f.priority && PRIORITIES.includes(f.priority as TicketPriority)) and.push({ priority: f.priority as TicketPriority });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.q?.trim()) and.push({ OR: [{ number: { contains: f.q.trim(), mode: "insensitive" } }, { title: { contains: f.q.trim(), mode: "insensitive" } }] });
  const where = { AND: and };
  const [items, total, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: [{ lastActivityAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: { select: { name: true } }, _count: { select: { comments: { where: { isInternal: false } } } } },
    }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.groupBy({ by: ["status"], where: { AND: and.slice(0, view === "all" ? 1 : 2) }, _count: { _all: true } }),
  ]);
  const ids = [...new Set(items.flatMap((t) => [t.submittedById, t.assignedToId ?? ""]).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  return {
    view,
    items: items.map((t) => ({ ...t, submittedByName: name(t.submittedById), assignedToName: name(t.assignedToId) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<TicketStatus, number>>,
  };
}

/** Ticket with conversation. Internal notes / attachments are removed for non-managers. */
export async function getTicket(actor: Actor, id: string) {
  const t = await prisma.supportTicket.findFirst({
    where: { id, AND: [ticketScope(actor)] },
    include: {
      category: true,
      comments: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
      attachments: { where: { commentId: null } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!t) throw notFound("Ticket");
  const manager = isManager(actor) && (!t.branchId || canAccessBranch(actor, t.branchId) || t.assignedToId === actor.id);
  const comments = manager ? t.comments : t.comments.filter((c) => !c.isInternal);
  const ids = [...new Set([t.submittedById, t.assignedToId ?? "", t.closedById ?? "", ...t.comments.map((c) => c.authorId), ...t.events.map((e) => e.userId)].filter(Boolean))];
  const [users, branch, work] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: { select: { name: true } } } }),
    t.branchId ? prisma.branch.findUnique({ where: { id: t.branchId }, select: { name: true } }) : null,
    t.workId ? prisma.work.findUnique({ where: { id: t.workId }, select: { id: true, reference: true } }) : null,
  ]);
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  return {
    ticket: { ...t, comments, events: manager ? t.events : t.events.filter((e) => e.action !== "assigned") },
    manager,
    name,
    roleOf: (uid: string) => users.find((u) => u.id === uid)?.role.name ?? "",
    branch,
    work,
  };
}

export async function listAssignees(branchId: string | null) {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        { role: { isSuperAdmin: true } },
        { role: { permissions: { some: { permission: { key: "support.manage" } } } }, ...(branchId ? { branches: { some: { branchId } } } : {}) },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Attachment download: same visibility as the ticket; internal files only for managers. */
export async function getAttachment(actor: Actor, id: string) {
  const a = await prisma.supportAttachment.findUnique({ where: { id } });
  if (!a) throw notFound("File");
  const { manager } = await getTicket(actor, a.ticketId);
  if (a.isInternal && !manager) throw notFound("File");
  return a;
}

// ───────────────────────────── Categories ─────────────────────────────

export async function listCategories(includeInactive = false) {
  return prisma.supportCategory.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function saveCategory(actor: Actor, input: { name: string; active: boolean; sortOrder: number }, id?: string) {
  if (!isManager(actor)) throw forbidden();
  const name = input.name.trim();
  if (!name || name.length > 60) throw invalid("Category name is required (max 60 characters).");
  return transaction(async (tx) => {
    const dupe = await tx.supportCategory.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: id ? { id } : undefined } });
    if (dupe) throw invalid("That category already exists.");
    const data = { name, active: input.active, sortOrder: Math.max(0, Math.min(999, input.sortOrder || 0)) };
    const c = id ? await tx.supportCategory.update({ where: { id }, data }) : await tx.supportCategory.create({ data });
    await audit(tx, actor, { action: id ? "support.category_update" : "support.category_create", entityType: "SupportCategory", entityId: c.id, after: data });
    return c;
  });
}

/** Open (not resolved/closed) tickets visible to a manager — for dashboards. */
export async function openTicketCount(actor: Actor) {
  if (!isManager(actor)) return 0;
  return prisma.supportTicket.count({ where: { AND: [managerScope(actor), { status: { in: ACTIVE_STATUSES } }] } });
}
