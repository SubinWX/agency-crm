import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { businessToday, isIsoDate, toDbDate } from "../../lib/dates";
import { AppError, forbidden, invalid, notFound, parseInput } from "../../lib/errors";
import { nextReference } from "../../lib/numbering";
import { canAccessBranch, canAny, requirePermission, type Actor } from "../../rbac/actor";
import { storeFile, type UploadInput } from "../../storage";
import { fromPaise, toPaise } from "./calc";

function scope(actor: Actor): Prisma.ExpenseWhereInput {
  if (actor.isSuperAdmin) return {};
  // Company-level expenses (no branch) are visible to anyone with expense access.
  return { OR: [{ branchId: null }, { branchId: { in: [...actor.branchIds] } }] };
}

const input = z.object({
  title: z.string().trim().min(1, "Title is required").max(150),
  amount: z.string(),
  spentOn: z.string(),
  categoryId: z.string().min(1, "Choose a category"),
  branchId: z.string().optional(),
  workReference: z.string().trim().optional(),
  description: z.string().trim().max(2000).optional(),
});
export type ExpenseInput = z.input<typeof input> & { receipt?: UploadInput | null };

export async function createExpense(actor: Actor, raw: ExpenseInput) {
  requirePermission(actor, "expenses.manage");
  const d = parseInput(input, raw);
  const amount = toPaise(d.amount, "Amount");
  if (amount <= 0) throw invalid("Amount must be more than zero.");
  if (!isIsoDate(d.spentOn) || d.spentOn > businessToday()) throw invalid("Please enter a valid date (not in the future).");
  if (d.branchId && !canAccessBranch(actor, d.branchId)) throw forbidden("You do not have access to this branch.");
  if (!d.branchId && !actor.isSuperAdmin && actor.branchIds.length !== 0) {
    // Non-super users must tag a branch so data stays isolated.
    throw invalid("Please choose a branch.");
  }
  const receipt = raw.receipt && raw.receipt.size > 0 ? await storeFile(raw.receipt, "receipts", { allowPdf: true }) : null;

  return transaction(async (tx) => {
    const cat = await tx.expenseCategory.findFirst({ where: { id: d.categoryId, active: true } });
    if (!cat) throw invalid("Choose a valid category.");
    let workId: string | null = null;
    if (d.workReference) {
      const w = await tx.work.findFirst({ where: { reference: d.workReference.toUpperCase(), deletedAt: null } });
      if (!w) throw invalid("Work reference not found.");
      workId = w.id;
    }
    const number = await nextReference(tx, "EXP");
    const e = await tx.expense.create({
      data: {
        number,
        title: d.title,
        amount: fromPaise(amount),
        spentOn: toDbDate(d.spentOn),
        categoryId: cat.id,
        branchId: d.branchId || null,
        workId,
        description: d.description || null,
        receiptKey: receipt?.storageKey ?? null,
        receiptMime: receipt?.mimeType ?? null,
        addedById: actor.id,
      },
    });
    await audit(tx, actor, { action: "expense.create", entityType: "Expense", entityId: e.id, after: { number, title: d.title, amount: fromPaise(amount), category: cat.name } });
    return e;
  });
}

export async function voidExpense(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "expenses.manage");
  if (!reason?.trim()) throw invalid("Please give a reason.");
  await transaction(async (tx) => {
    const e = await tx.expense.findFirst({ where: { id, AND: [scope(actor)] } });
    if (!e) throw notFound("Expense");
    if (e.status === "VOID") throw new AppError("INVALID_STATE", "Expense is already void.");
    await tx.expense.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await audit(tx, actor, { action: "expense.void", entityType: "Expense", entityId: id, before: { amount: e.amount, title: e.title }, reason });
  });
}

export async function listExpenses(actor: Actor, f: { q?: string; categoryId?: string; branchId?: string; from?: string; to?: string; page?: number } = {}) {
  if (!canAny(actor, "expenses.view", "expenses.manage")) throw forbidden();
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 30;
  const and: Prisma.ExpenseWhereInput[] = [scope(actor)];
  if (f.q?.trim()) and.push({ OR: [{ title: { contains: f.q.trim(), mode: "insensitive" } }, { number: { contains: f.q.trim(), mode: "insensitive" } }] });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.from && isIsoDate(f.from)) and.push({ spentOn: { gte: toDbDate(f.from) } });
  if (f.to && isIsoDate(f.to)) and.push({ spentOn: { lte: toDbDate(f.to) } });
  const where = { AND: and };
  const [items, total, sum] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: { select: { name: true } }, branch: { select: { name: true } }, work: { select: { id: true, reference: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: { AND: [...and, { status: "ACTIVE" }] }, _sum: { amount: true } }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), sum: sum._sum.amount };
}

export async function listCategories() {
  return prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}

export async function addCategory(actor: Actor, name: string) {
  requirePermission(actor, "expenses.manage");
  const n = name.trim();
  if (!n || n.length > 60) throw invalid("Category name is required (max 60 characters).");
  return prisma.expenseCategory.upsert({ where: { name: n }, create: { name: n }, update: { active: true } });
}

/** Receipt download: same visibility as the expense. */
export async function getExpenseReceipt(actor: Actor, id: string) {
  if (!canAny(actor, "expenses.view", "expenses.manage")) throw notFound("Receipt");
  const e = await prisma.expense.findFirst({ where: { id, AND: [scope(actor)] } });
  if (!e?.receiptKey) throw notFound("Receipt");
  return e;
}
