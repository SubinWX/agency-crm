/**
 * Staff & worker salary (spec §29). Salary terms live on StaffProfile;
 * payments are recorded per period and voided (never deleted).
 */
import type { PaymentMethod } from "@prisma/client";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { businessToday, isIsoDate, toDbDate } from "../../lib/dates";
import { AppError, invalid, notFound } from "../../lib/errors";
import { requirePermission, type Actor } from "../../rbac/actor";
import { fromPaise, toPaise } from "./calc";

const SALARY_TYPES = ["MONTHLY", "DAILY", "HOURLY"] as const;
const METHODS: PaymentMethod[] = ["UPI", "CASH", "BANK_TRANSFER", "CARD", "OTHER"];

/** Employees = users in the office or worker portals, limited to the actor's branches. */
function employeeWhere(actor: Actor) {
  return {
    deletedAt: null,
    role: { portal: { in: ["ADMIN" as const, "WORKER" as const] }, isSuperAdmin: false },
    ...(actor.isSuperAdmin ? {} : { branches: { some: { branchId: { in: [...actor.branchIds] } } } }),
  };
}

export async function salaryOverview(actor: Actor, period: string) {
  requirePermission(actor, "staff.manage");
  const users = await prisma.user.findMany({
    where: employeeWhere(actor),
    select: {
      id: true,
      name: true,
      status: true,
      role: { select: { name: true } },
      staffProfile: { select: { salaryAmount: true, salaryType: true, joiningDate: true } },
      salaryPayments: { where: { period, voidedAt: null }, select: { amount: true } },
    },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({
    ...u,
    paidThisPeriod: u.salaryPayments.reduce((a, p) => a + toPaise(p.amount), 0),
  }));
}

export async function setSalary(actor: Actor, userId: string, input: { amount: string; type: string; reason?: string }) {
  requirePermission(actor, "staff.manage");
  const amount = toPaise(input.amount, "Salary");
  if (amount < 0) throw invalid("Salary cannot be negative.");
  if (!SALARY_TYPES.includes(input.type as (typeof SALARY_TYPES)[number])) throw invalid("Choose a salary type.");
  await transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, ...employeeWhere(actor) }, include: { staffProfile: true } });
    if (!u) throw notFound("Employee");
    await tx.staffProfile.upsert({
      where: { userId },
      create: { userId, salaryAmount: fromPaise(amount), salaryType: input.type },
      update: { salaryAmount: fromPaise(amount), salaryType: input.type },
    });
    await audit(tx, actor, {
      action: "salary.change",
      entityType: "User",
      entityId: userId,
      before: { amount: u.staffProfile?.salaryAmount ?? null, type: u.staffProfile?.salaryType ?? null },
      after: { amount: fromPaise(amount), type: input.type },
      reason: input.reason,
    });
  });
}

export async function recordSalaryPayment(actor: Actor, userId: string, input: { period: string; amount: string; paidOn: string; method: string; reference?: string; notes?: string }) {
  requirePermission(actor, "staff.manage");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw invalid("Choose a valid salary month.");
  const amount = toPaise(input.amount, "Amount");
  if (amount <= 0) throw invalid("Amount must be more than zero.");
  if (!isIsoDate(input.paidOn) || input.paidOn > businessToday()) throw invalid("Please enter a valid payment date (not in the future).");
  if (!METHODS.includes(input.method as PaymentMethod)) throw invalid("Choose a payment method.");
  return transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, ...employeeWhere(actor) } });
    if (!u) throw notFound("Employee");
    const p = await tx.salaryPayment.create({
      data: { userId, period: input.period, amount: fromPaise(amount), paidOn: toDbDate(input.paidOn), method: input.method as PaymentMethod, reference: input.reference?.trim() || null, notes: input.notes?.trim() || null, paidById: actor.id },
    });
    await audit(tx, actor, { action: "salary.pay", entityType: "SalaryPayment", entityId: p.id, after: { userId, period: input.period, amount: fromPaise(amount) } });
    return p;
  });
}

export async function voidSalaryPayment(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "staff.manage");
  if (!reason?.trim()) throw invalid("Please give a reason.");
  await transaction(async (tx) => {
    const p = await tx.salaryPayment.findFirst({ where: { id, user: employeeWhere(actor) } });
    if (!p) throw notFound("Salary payment");
    if (p.voidedAt) throw new AppError("INVALID_STATE", "Already void.");
    await tx.salaryPayment.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await audit(tx, actor, { action: "salary.void", entityType: "SalaryPayment", entityId: id, before: { amount: p.amount }, reason });
  });
}

export async function salaryHistory(actor: Actor, userId: string) {
  requirePermission(actor, "staff.manage");
  const u = await prisma.user.findFirst({ where: { id: userId, ...employeeWhere(actor) }, select: { id: true, name: true } });
  if (!u) throw notFound("Employee");
  const payments = await prisma.salaryPayment.findMany({ where: { userId }, orderBy: [{ period: "desc" }, { createdAt: "desc" }], take: 50 });
  return { user: u, payments };
}
