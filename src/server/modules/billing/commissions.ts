/**
 * Agent & Worker commission (spec §20–22).
 * - Lines are created when a work is approved (see works/service approveWork).
 * - % is snapshotted at creation; amount follows invoices while ACCRUED.
 * - Every change is kept in CommissionHistory; rate changes in CommissionRateHistory.
 * - Users without `commissions.manage` only ever see their OWN lines, so a
 *   worker can never see an agent's commission.
 */
import type { CommissionStatus, Prisma } from "@prisma/client";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalid, notFound } from "../../lib/errors";
import { can, requirePermission, type Actor } from "../../rbac/actor";
import { getSetting, updateSetting } from "../settings/service";
import { commissionAmount, formatINR, fromPaise, toPaise } from "./calc";
import { notify } from "../notifications/service";

function scope(actor: Actor): Prisma.CommissionWhereInput {
  if (can(actor, "commissions.manage")) return actor.isSuperAdmin ? {} : { work: { branchId: { in: [...actor.branchIds] } } };
  if (can(actor, "commissions.view_own")) return { userId: actor.id };
  return { id: "__no_access__" };
}

export async function listCommissions(actor: Actor, f: { status?: string; type?: string; userId?: string; page?: number } = {}) {
  if (!can(actor, "commissions.manage") && !can(actor, "commissions.view_own")) throw forbidden();
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 30;
  const and: Prisma.CommissionWhereInput[] = [scope(actor)];
  if (f.status && ["ACCRUED", "APPROVED", "PAID", "CANCELLED"].includes(f.status)) and.push({ status: f.status as CommissionStatus });
  if (f.type === "AGENT" || f.type === "WORKER") and.push({ type: f.type });
  if (f.userId && can(actor, "commissions.manage")) and.push({ userId: f.userId });
  const where = { AND: and };
  const [items, total, byStatus] = await Promise.all([
    prisma.commission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true } }, work: { select: { id: true, reference: true, customer: { select: { name: true } } } } },
    }),
    prisma.commission.count({ where }),
    prisma.commission.groupBy({ by: ["status"], where: { AND: and.slice(0, 1).concat(f.type ? [{ type: f.type as "AGENT" }] : []) }, _sum: { amount: true } }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), byStatus };
}

export async function getCommission(actor: Actor, id: string) {
  const c = await prisma.commission.findFirst({
    where: { id, AND: [scope(actor)] },
    include: { history: { orderBy: { createdAt: "desc" } }, user: { select: { name: true } }, work: { select: { id: true, reference: true } } },
  });
  if (!c) throw notFound("Commission");
  return c;
}

/** Manual adjustment (percent and/or fixed amount) with a mandatory reason. */
export async function adjustCommission(actor: Actor, id: string, input: { percent?: string; amount?: string; reason: string }) {
  requirePermission(actor, "commissions.manage");
  if (!input.reason?.trim()) throw invalid("Please give a reason for this adjustment.");
  return transaction(async (tx) => {
    const c = await tx.commission.findFirst({ where: { id, AND: [scope(actor)] } });
    if (!c) throw notFound("Commission");
    if (c.status !== "ACCRUED") throw new AppError("INVALID_STATE", "Only accrued (not yet approved) commissions can be adjusted.");
    let percent = Number(c.percent);
    let amount = toPaise(c.amount);
    let isManual = c.isManual;
    if (input.percent?.trim()) {
      percent = Number(input.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw invalid("Percent must be between 0 and 100.");
      amount = commissionAmount(toPaise(c.baseAmount), percent.toFixed(2), Number(c.shareFactor));
      isManual = false;
    }
    if (input.amount?.trim()) {
      amount = toPaise(input.amount, "Commission amount");
      if (amount < 0) throw invalid("Commission cannot be negative.");
      isManual = true;
    }
    await tx.commission.update({ where: { id }, data: { percent: percent.toFixed(2), amount: fromPaise(amount), isManual } });
    await tx.commissionHistory.create({
      data: { commissionId: id, action: "adjusted", oldPercent: c.percent, newPercent: percent.toFixed(2), oldAmount: c.amount, newAmount: fromPaise(amount), reason: input.reason, changedById: actor.id },
    });
    await audit(tx, actor, { action: "commission.adjust", entityType: "Commission", entityId: id, before: { percent: c.percent, amount: c.amount }, after: { percent, amount: fromPaise(amount) }, reason: input.reason });
  });
}

async function transition(actor: Actor, ids: string[], from: CommissionStatus[], to: CommissionStatus, extra: { reference?: string; reason?: string } = {}) {
  requirePermission(actor, "commissions.manage");
  if (ids.length === 0) throw invalid("Select at least one commission.");
  return transaction(async (tx) => {
    const rows = await tx.commission.findMany({ where: { id: { in: ids }, AND: [scope(actor)] } });
    if (rows.length !== ids.length) throw notFound("Commission");
    const bad = rows.find((r) => !from.includes(r.status));
    if (bad) throw new AppError("INVALID_STATE", `Commission for ${bad.type.toLowerCase()} is ${bad.status.toLowerCase()} and can't be moved to ${to.toLowerCase()}.`);
    for (const r of rows) {
      await tx.commission.update({
        where: { id: r.id },
        data: {
          status: to,
          ...(to === "APPROVED" ? { approvedAt: new Date(), approvedById: actor.id } : {}),
          ...(to === "PAID" ? { paidAt: new Date(), paidById: actor.id, payoutReference: extra.reference || null } : {}),
        },
      });
      await tx.commissionHistory.create({
        data: { commissionId: r.id, action: to.toLowerCase(), oldAmount: r.amount, newAmount: r.amount, reason: extra.reason ?? extra.reference ?? null, changedById: actor.id },
      });
    }
    await audit(tx, actor, { action: `commission.${to.toLowerCase()}`, entityType: "Commission", entityId: ids.join(","), reason: extra.reason ?? extra.reference });
    if (to === "APPROVED" || to === "PAID") {
      // Only people allowed to see their own commission are told about it.
      for (const r of rows) {
        const allowed = await tx.rolePermission.count({ where: { role: { users: { some: { id: r.userId } } }, permission: { key: "commissions.view_own" } } });
        if (!allowed) continue;
        const work = await tx.work.findUnique({ where: { id: r.workId }, select: { reference: true } });
        const amount = formatINR(toPaise(r.amount));
        await notify(tx, {
          userIds: [r.userId],
          type: "commission.updated",
          title: `Commission ${to.toLowerCase()} for ${work?.reference}`,
          body: `Your commission of ${amount} is now ${to.toLowerCase()}.`,
          link: "/work/" + r.workId,
          vars: { work_id: work?.reference, amount, status: to.toLowerCase() },
        });
      }
    }
    return rows.length;
  });
}

export const approveCommissions = (actor: Actor, ids: string[]) => transition(actor, ids, ["ACCRUED"], "APPROVED");
export const markCommissionsPaid = (actor: Actor, ids: string[], reference?: string) => transition(actor, ids, ["APPROVED"], "PAID", { reference });
export function cancelCommission(actor: Actor, id: string, reason: string) {
  if (!reason?.trim()) throw invalid("Please give a reason.");
  return transition(actor, [id], ["ACCRUED", "APPROVED"], "CANCELLED", { reason });
}

// ───────────────────────────── Rates ─────────────────────────────

export async function setDefaultRates(actor: Actor, input: { agentPercent: number; workerPercent: number; workerMode: "SPLIT" | "EACH"; reason?: string }) {
  requirePermission(actor, "commissions.manage");
  for (const v of [input.agentPercent, input.workerPercent]) {
    if (!Number.isFinite(v) || v < 0 || v > 100) throw invalid("Percent must be between 0 and 100.");
  }
  await transaction(async (tx) => {
    const before = await getSetting("commission", tx);
    await updateSetting(actor, "commission", input, tx, "commissions.manage");
    for (const [type, oldV, newV] of [["AGENT", before.agentPercent, input.agentPercent], ["WORKER", before.workerPercent, input.workerPercent]] as const) {
      if (oldV !== newV) {
        await tx.commissionRateHistory.create({ data: { scope: `default:${type}`, oldPercent: oldV.toFixed(2), newPercent: newV.toFixed(2), reason: input.reason || null, changedById: actor.id } });
      }
    }
  });
}

/** Personal override; empty value removes it (falls back to the default). */
export async function setUserRate(actor: Actor, userId: string, percent: string, reason?: string) {
  requirePermission(actor, "commissions.manage");
  const value = percent.trim() === "" ? null : Number(percent);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw invalid("Percent must be between 0 and 100.");
  await transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, deletedAt: null, role: { portal: { in: ["AGENT", "WORKER"] } } } });
    if (!u) throw notFound("User");
    await tx.user.update({ where: { id: userId }, data: { commissionPercent: value === null ? null : value.toFixed(2) } });
    await tx.commissionRateHistory.create({ data: { scope: `user:${userId}`, oldPercent: u.commissionPercent, newPercent: value === null ? null : value.toFixed(2), reason: reason || null, changedById: actor.id } });
    await audit(tx, actor, { action: "commission.rate_change", entityType: "User", entityId: userId, before: { percent: u.commissionPercent }, after: { percent: value }, reason });
  });
}

export async function listRatePeople() {
  return prisma.user.findMany({
    where: { deletedAt: null, role: { portal: { in: ["AGENT", "WORKER"] } } },
    select: { id: true, name: true, commissionPercent: true, role: { select: { portal: true } } },
    orderBy: [{ role: { portal: "asc" } }, { name: "asc" }],
  });
}

export async function rateHistory(limit = 20) {
  const rows = await prisma.commissionRateHistory.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const ids = [...new Set(rows.flatMap((r) => [r.changedById, r.scope.startsWith("user:") ? r.scope.slice(5) : ""]).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  return rows.map((r) => ({ ...r, who: name(r.changedById), target: r.scope.startsWith("user:") ? name(r.scope.slice(5)) : r.scope === "default:AGENT" ? "Default agent %" : "Default worker %" }));
}
