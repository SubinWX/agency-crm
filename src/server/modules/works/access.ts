import type { Prisma, Work, WorkStatus } from "@prisma/client";
import type { Tx } from "../../db";
import { notFound } from "../../lib/errors";
import { can, branchScope, type Actor } from "../../rbac/actor";

/** Prisma `where` restricting works to what this actor may see. */
export function workAccessWhere(actor: Actor): Prisma.WorkWhereInput {
  // Super Admin with view_all sees every work. (An empty `{}` inside OR does not match all rows in Prisma.)
  if (actor.isSuperAdmin) return { deletedAt: null };
  const ors: Prisma.WorkWhereInput[] = [];
  if (can(actor, "works.view_all")) ors.push(branchScope(actor));
  if (can(actor, "works.view_own")) ors.push({ agentId: actor.id }, { createdById: actor.id });
  if (can(actor, "works.view_assigned")) ors.push({ assignments: { some: { workerId: actor.id, removedAt: null } } });
  if (ors.length === 0) return { id: "__no_access__" };
  return { deletedAt: null, OR: ors };
}

/** Load a work the actor can access, optionally locking the row (FOR UPDATE). */
export async function loadWorkForUpdate(tx: Tx, actor: Actor, workId: string): Promise<Work> {
  await tx.$queryRaw`SELECT id FROM "Work" WHERE id = ${workId} FOR UPDATE`;
  const work = await tx.work.findFirst({ where: { id: workId, AND: [workAccessWhere(actor)] } });
  if (!work) throw notFound("Work");
  return work;
}

export function isOwnWork(actor: Actor, work: Pick<Work, "agentId" | "createdById">): boolean {
  return work.agentId === actor.id || work.createdById === actor.id;
}

/** Statuses during which the agent may still edit location/images/details. */
export const AGENT_EDITABLE_STATUSES: WorkStatus[] = ["DRAFT", "SUBMITTED", "SCHEDULED", "ASSIGNED", "IN_PROGRESS"];

/** Statuses during which a work is still open for scheduling changes. */
export const RESCHEDULABLE_STATUSES: WorkStatus[] = ["DRAFT", "SUBMITTED", "SCHEDULED", "ASSIGNED", "IN_PROGRESS"];

export const STATUS_LABELS: Record<WorkStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  WORKER_COMPLETED: "Worker Completed",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  INVOICED: "Invoiced",
  PAYMENT_PENDING: "Payment Pending",
  PAID: "Paid",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};
