/**
 * Agents / brokers and workers as their own lists (separate from office users).
 * Uses the same user accounts, roles and branch rules; adds location and
 * work statistics for the listing tables.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { fromDbDate } from "../../lib/dates";
import { invalid, notFound } from "../../lib/errors";
import { can, requirePermission, type Actor } from "../../rbac/actor";
import { setUserRate } from "../billing/commissions";
import { saveUser } from "../users/service";

export type PersonKind = "AGENT" | "WORKER";
export const KIND_LABEL: Record<PersonKind, { one: string; many: string; base: string }> = {
  AGENT: { one: "Agent / broker", many: "Agents / brokers", base: "/admin/agents" },
  WORKER: { one: "Worker", many: "Workers", base: "/admin/workers" },
};
const ROLE_KEY: Record<PersonKind, string> = { AGENT: "agent", WORKER: "worker" };
const DONE = ["APPROVED", "INVOICED", "PAYMENT_PENDING", "PAID", "CLOSED"] as const;

function scope(actor: Actor, kind: PersonKind): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    role: { portal: kind },
    ...(actor.isSuperAdmin ? {} : { OR: [{ branches: { some: { branchId: { in: [...actor.branchIds] } } } }, { branches: { none: {} } }] }),
  };
}

export async function listPeople(actor: Actor, kind: PersonKind, f: { q?: string; branchId?: string; status?: string } = {}) {
  requirePermission(actor, "users.manage");
  const q = f.q?.trim();
  const users = await prisma.user.findMany({
    where: {
      AND: [
        scope(actor, kind),
        q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { staffProfile: { address: { contains: q, mode: "insensitive" } } }] } : {},
        f.branchId ? { branches: { some: { branchId: f.branchId } } } : {},
        f.status === "ACTIVE" || f.status === "INACTIVE" ? { status: f.status } : {},
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      lastLoginAt: true,
      commissionPercent: true,
      staffProfile: { select: { address: true, joiningDate: true } },
      branches: { select: { branch: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  const ids = users.map((u) => u.id);
  const stats = new Map<string, { total: number; active: number; done: number }>();
  if (kind === "AGENT") {
    const rows = await prisma.work.groupBy({ by: ["agentId", "status"], where: { agentId: { in: ids }, deletedAt: null }, _count: { _all: true } });
    for (const r of rows) {
      const s = stats.get(r.agentId!) ?? { total: 0, active: 0, done: 0 };
      s.total += r._count._all;
      if ((DONE as readonly string[]).includes(r.status)) s.done += r._count._all;
      else if (r.status !== "CANCELLED") s.active += r._count._all;
      stats.set(r.agentId!, s);
    }
  } else {
    const rows = await prisma.workAssignment.findMany({ where: { workerId: { in: ids }, removedAt: null, work: { deletedAt: null } }, select: { workerId: true, work: { select: { status: true } } } });
    for (const r of rows) {
      const s = stats.get(r.workerId) ?? { total: 0, active: 0, done: 0 };
      s.total++;
      if ((DONE as readonly string[]).includes(r.work.status)) s.done++;
      else if (r.work.status !== "CANCELLED") s.active++;
      stats.set(r.workerId, s);
    }
  }
  return users.map((u) => ({ ...u, stats: stats.get(u.id) ?? { total: 0, active: 0, done: 0 } }));
}

export async function getPerson(actor: Actor, kind: PersonKind, id: string) {
  requirePermission(actor, "users.manage");
  const u = await prisma.user.findFirst({
    where: { id, AND: [scope(actor, kind)] },
    include: { staffProfile: true, branches: true, role: { select: { name: true } } },
  });
  if (!u) throw notFound(KIND_LABEL[kind].one);
  const works =
    kind === "AGENT"
      ? await prisma.work.findMany({ where: { agentId: id, deletedAt: null }, orderBy: { workDate: "desc" }, take: 15, select: { id: true, reference: true, title: true, workDate: true, status: true, customer: { select: { name: true } } } })
      : (await prisma.workAssignment.findMany({ where: { workerId: id, removedAt: null, work: { deletedAt: null } }, orderBy: { work: { workDate: "desc" } }, take: 15, select: { work: { select: { id: true, reference: true, title: true, workDate: true, status: true, customer: { select: { name: true } } } } } })).map((a) => a.work);
  return { user: u, works, joiningDate: u.staffProfile?.joiningDate ? fromDbDate(u.staffProfile.joiningDate) : "" };
}

export interface PersonInput {
  name: string;
  email: string;
  phone?: string;
  branchIds: string[];
  status: "ACTIVE" | "INACTIVE";
  password?: string;
  address?: string;
  joiningDate?: string;
  emergencyContact?: string;
  commissionPercent?: string;
}

export async function savePerson(actor: Actor, kind: PersonKind, input: PersonInput, id?: string) {
  requirePermission(actor, "users.manage");
  if (!input.branchIds.length) throw invalid("Choose at least one branch.");
  if (!input.phone?.trim()) throw invalid(`Phone is required for ${kind === "AGENT" ? "agents" : "workers"} (used for WhatsApp / SMS updates).`);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEY[kind] } });
  if (id) {
    const existing = await prisma.user.findFirst({ where: { id, AND: [scope(actor, kind)] }, select: { id: true } });
    if (!existing) throw notFound(KIND_LABEL[kind].one);
  }
  const user = await saveUser(
    actor,
    {
      name: input.name,
      email: input.email,
      phone: input.phone,
      roleId: role.id,
      branchIds: input.branchIds,
      status: input.status,
      password: input.password || undefined,
      profile: { address: input.address, joiningDate: input.joiningDate, emergencyContact: input.emergencyContact },
    },
    id,
  );
  // Personal commission rate (kept with rate history) — only for users allowed to manage commission.
  if (input.commissionPercent !== undefined && can(actor, "commissions.manage")) {
    const current = await prisma.user.findUnique({ where: { id: user.id }, select: { commissionPercent: true } });
    const now = current?.commissionPercent === null || current?.commissionPercent === undefined ? "" : String(Number(current.commissionPercent));
    if (input.commissionPercent.trim() !== now) await setUserRate(actor, user.id, input.commissionPercent, id ? "Updated on profile" : "Set when added");
  }
  return user;
}
