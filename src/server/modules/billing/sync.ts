/**
 * Keeps derived billing state consistent. Called inside the same transaction
 * as any invoice / payment / approval change.
 */
import type { WorkStatus } from "@prisma/client";
import type { Tx } from "../../db";
import type { Actor } from "../../rbac/actor";
import { commissionAmount, fromPaise, toPaise } from "./calc";
import { getSetting } from "../settings/service";

const BILLING_STAGE: WorkStatus[] = ["APPROVED", "INVOICED", "PAYMENT_PENDING", "PAID"];

/** Recompute amountPaid / balance / status of an invoice from its active payments. */
export async function recalcInvoice(tx: Tx, invoiceId: string): Promise<void> {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const agg = await tx.payment.aggregate({ where: { invoiceId, voidedAt: null }, _sum: { amount: true } });
  const paid = toPaise(agg._sum.amount ?? 0);
  const total = toPaise(inv.grandTotal);
  const status = inv.status === "CANCELLED" ? "CANCELLED" : paid >= total && total > 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED";
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: fromPaise(paid),
      balanceDue: fromPaise(Math.max(total - paid, 0)),
      status,
      paidAt: status === "PAID" ? (inv.paidAt ?? new Date()) : null,
    },
  });
}

/**
 * Move an approved work through Invoiced → Payment Pending → Paid based on its
 * invoices. Works not yet approved keep their operational status.
 */
export async function syncWorkBillingStatus(tx: Tx, actor: Actor, workId: string): Promise<void> {
  const work = await tx.work.findUniqueOrThrow({ where: { id: workId } });
  if (!BILLING_STAGE.includes(work.status)) return;
  const invoices = await tx.invoice.findMany({ where: { workId, status: { not: "CANCELLED" } } });
  let next: WorkStatus = "APPROVED";
  if (invoices.length) {
    const allPaid = invoices.every((i) => i.status === "PAID");
    const anyPaid = invoices.some((i) => toPaise(i.amountPaid) > 0);
    next = allPaid ? "PAID" : anyPaid ? "PAYMENT_PENDING" : "INVOICED";
  }
  if (next !== work.status) {
    await tx.work.update({ where: { id: workId }, data: { status: next } });
    await tx.workStatusHistory.create({ data: { workId, fromStatus: work.status, toStatus: next, changedById: actor.id, reason: "Billing update" } });
  }
}

/** Commission base = taxable value (excl. GST) of the work's non-cancelled invoices. */
async function commissionBase(tx: Tx, workId: string): Promise<number> {
  const agg = await tx.invoice.aggregate({ where: { workId, status: { not: "CANCELLED" } }, _sum: { taxableTotal: true } });
  return toPaise(agg._sum.taxableTotal ?? 0);
}

/** Effective commission % for a user: personal override, else company default for the type. */
export async function effectivePercent(tx: Tx, userId: string, type: "AGENT" | "WORKER"): Promise<number> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { commissionPercent: true } });
  if (u?.commissionPercent !== null && u?.commissionPercent !== undefined) return Number(u.commissionPercent);
  const s = await getSetting("commission", tx);
  return type === "AGENT" ? s.agentPercent : s.workerPercent;
}

/**
 * Create commission lines when a work is approved: one for the agent and one
 * per active worker. Percent is snapshotted now; amount follows invoices
 * until the commission is approved for payout.
 */
export async function accrueCommissions(tx: Tx, actor: Actor, workId: string): Promise<void> {
  const work = await tx.work.findUniqueOrThrow({ where: { id: workId } });
  const workers = await tx.workAssignment.findMany({ where: { workId, removedAt: null }, select: { workerId: true } });
  const settings = await getSetting("commission", tx);
  const share = settings.workerMode === "SPLIT" && workers.length > 0 ? 1 / workers.length : 1;

  const lines: { userId: string; type: "AGENT" | "WORKER"; shareFactor: number }[] = [
    ...(work.agentId ? [{ userId: work.agentId, type: "AGENT" as const, shareFactor: 1 }] : []),
    ...workers.map((w) => ({ userId: w.workerId, type: "WORKER" as const, shareFactor: share })),
  ];
  const base = await commissionBase(tx, workId);
  for (const l of lines) {
    const existing = await tx.commission.findUnique({ where: { workId_userId_type: { workId, userId: l.userId, type: l.type } } });
    if (existing) continue; // re-approval after correction keeps the original line
    const percent = await effectivePercent(tx, l.userId, l.type);
    const amount = commissionAmount(base, percent, l.shareFactor);
    await tx.commission.create({
      data: {
        workId,
        userId: l.userId,
        type: l.type,
        percent: percent.toFixed(2),
        shareFactor: l.shareFactor.toFixed(4),
        baseAmount: fromPaise(base),
        amount: fromPaise(amount),
        history: { create: { action: "created", newPercent: percent.toFixed(2), newAmount: fromPaise(amount), changedById: actor.id } },
      },
    });
  }
}

/** Recalculate ACCRUED (non-manual) commissions after invoice totals change. */
export async function syncCommissions(tx: Tx, actor: Actor, workId: string): Promise<void> {
  const base = await commissionBase(tx, workId);
  const rows = await tx.commission.findMany({ where: { workId, status: "ACCRUED", isManual: false } });
  for (const c of rows) {
    const amount = commissionAmount(base, c.percent.toString(), Number(c.shareFactor));
    if (amount === toPaise(c.amount) && base === toPaise(c.baseAmount)) continue;
    await tx.commission.update({ where: { id: c.id }, data: { baseAmount: fromPaise(base), amount: fromPaise(amount) } });
    await tx.commissionHistory.create({
      data: { commissionId: c.id, action: "recalculated", oldAmount: c.amount, newAmount: fromPaise(amount), reason: "Invoice total changed", changedById: actor.id },
    });
  }
}
