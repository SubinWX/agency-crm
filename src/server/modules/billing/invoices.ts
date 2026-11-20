import type { Prisma, PaymentMethod } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { addDaysIso, businessToday, formatDateLabel, isIsoDate, toDbDate } from "../../lib/dates";
import { AppError, forbidden, invalid, notFound } from "../../lib/errors";
import { nextReference } from "../../lib/numbering";
import { branchScope, canAny, requireBranch, requirePermission, type Actor } from "../../rbac/actor";
import { getSetting } from "../settings/service";
import { notify } from "../notifications/service";
import { computeInvoice, formatINR, fromPaise, quantityFromMilli, toPaise, type ItemInput, type TaxType } from "./calc";
import { recalcInvoice, syncCommissions, syncWorkBillingStatus } from "./sync";

export function canViewBilling(actor: Actor) {
  return canAny(actor, "invoices.view", "invoices.create", "payments.record", "payments.view");
}

export function invoiceAccessWhere(actor: Actor): Prisma.InvoiceWhereInput {
  if (!canViewBilling(actor)) return { id: "__no_access__" };
  return branchScope(actor);
}

export interface InvoiceInput {
  invoiceDate: string;
  dueDate?: string;
  taxType?: TaxType;
  notes?: string;
  items: ItemInput[];
}

async function totalsFor(input: InvoiceInput, tx: Tx) {
  const tax = await getSetting("tax", tx);
  const taxType: TaxType = !tax.gstEnabled ? "NONE" : (input.taxType ?? tax.defaultTaxType);
  if (!isIsoDate(input.invoiceDate)) throw invalid("Please enter a valid invoice date.");
  if (input.dueDate && (!isIsoDate(input.dueDate) || input.dueDate < input.invoiceDate)) throw invalid("Due date must be on or after the invoice date.");
  return { taxType, totals: computeInvoice(input.items, taxType, tax.roundToRupee) };
}

function itemRows(totals: ReturnType<typeof computeInvoice>) {
  return totals.items.map((i, idx) => ({
    sortOrder: idx,
    description: i.description,
    hsnSac: i.hsnSac,
    unit: i.unit,
    quantity: quantityFromMilli(i.quantityMilli),
    rate: fromPaise(i.rate),
    discount: fromPaise(i.discount),
    taxRate: (i.taxBp / 100).toFixed(2),
    taxable: fromPaise(i.taxable),
    taxAmount: fromPaise(i.tax),
    lineTotal: fromPaise(i.lineTotal),
  }));
}

function totalColumns(t: ReturnType<typeof computeInvoice>) {
  return {
    subtotal: fromPaise(t.subtotal),
    discountTotal: fromPaise(t.discountTotal),
    taxableTotal: fromPaise(t.taxableTotal),
    cgstTotal: fromPaise(t.cgstTotal),
    sgstTotal: fromPaise(t.sgstTotal),
    igstTotal: fromPaise(t.igstTotal),
    taxTotal: fromPaise(t.taxTotal),
    roundOff: fromPaise(t.roundOff),
    grandTotal: fromPaise(t.grandTotal),
  };
}

/** Create an invoice for a work (allowed at any work stage except cancelled). */
export async function createInvoice(actor: Actor, workId: string, input: InvoiceInput) {
  requirePermission(actor, "invoices.create");
  return transaction(async (tx) => {
    const work = await tx.work.findFirst({ where: { id: workId, deletedAt: null }, include: { customer: true } });
    if (!work) throw notFound("Work");
    requireBranch(actor, work.branchId);
    if (work.status === "CANCELLED") throw new AppError("INVALID_STATE", "Cannot invoice a cancelled work.");

    const { taxType, totals } = await totalsFor(input, tx);
    const [company, invoiceSettings] = await Promise.all([getSetting("company", tx), getSetting("invoice", tx)]);
    const number = await nextReference(tx, "INV");
    const c = work.customer;
    const invoice = await tx.invoice.create({
      data: {
        number,
        workId,
        customerId: c.id,
        branchId: work.branchId,
        invoiceDate: toDbDate(input.invoiceDate),
        dueDate: toDbDate(input.dueDate || addDaysIso(input.invoiceDate, invoiceSettings.dueDays)),
        taxType,
        customerSnapshot: { name: c.name, phone: c.phone, email: c.email, address: c.address, gstNumber: c.gstNumber },
        companySnapshot: { ...company, terms: invoiceSettings.terms, bankDetails: invoiceSettings.bankDetails },
        ...totalColumns(totals),
        amountPaid: "0",
        balanceDue: fromPaise(totals.grandTotal),
        notes: input.notes?.trim().slice(0, 2000) || null,
        createdById: actor.id,
        items: { create: itemRows(totals) },
      },
    });
    await audit(tx, actor, { action: "invoice.create", entityType: "Invoice", entityId: invoice.id, after: { number, workId, ...totalColumns(totals) } });
    await notify(tx, {
      userIds: [],
      type: "invoice.generated",
      title: `Invoice ${number}`,
      body: `Invoice ${number} for ${formatINR(totals.grandTotal)} generated for ${work.reference}.`,
      vars: { invoice_number: number, amount: formatINR(totals.grandTotal), work_id: work.reference, due_date: formatDateLabel(input.dueDate || addDaysIso(input.invoiceDate, invoiceSettings.dueDays)), customer_name: c.name },
      customerId: c.id,
    });
    await syncWorkBillingStatus(tx, actor, workId);
    await syncCommissions(tx, actor, workId);
    return invoice;
  });
}

/** Edit items/dates. Blocked once any payment exists (void payments first) or if cancelled. */
export async function updateInvoice(actor: Actor, invoiceId: string, input: InvoiceInput, reason: string) {
  requirePermission(actor, "invoices.create");
  if (!reason?.trim()) throw invalid("Please give a reason for changing this invoice.");
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const before = await tx.invoice.findFirst({ where: { id: invoiceId, AND: [invoiceAccessWhere(actor)] }, include: { items: true } });
    if (!before) throw notFound("Invoice");
    if (before.status === "CANCELLED") throw new AppError("INVALID_STATE", "Cancelled invoices cannot be edited.");
    const activePayments = await tx.payment.count({ where: { invoiceId, voidedAt: null } });
    if (activePayments) throw new AppError("INVALID_STATE", "This invoice has payments. Void the payments before changing amounts.");

    const { taxType, totals } = await totalsFor(input, tx);
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceDate: toDbDate(input.invoiceDate),
        dueDate: input.dueDate ? toDbDate(input.dueDate) : before.dueDate,
        taxType,
        ...totalColumns(totals),
        balanceDue: fromPaise(totals.grandTotal),
        notes: input.notes?.trim().slice(0, 2000) || null,
        items: { create: itemRows(totals) },
      },
    });
    await recalcInvoice(tx, invoiceId);
    await audit(tx, actor, {
      action: "invoice.update",
      entityType: "Invoice",
      entityId: invoiceId,
      before: { grandTotal: before.grandTotal, items: before.items },
      after: { ...totalColumns(totals), items: itemRows(totals) },
      reason,
    });
    await syncWorkBillingStatus(tx, actor, before.workId);
    await syncCommissions(tx, actor, before.workId);
  });
}

export async function cancelInvoice(actor: Actor, invoiceId: string, reason: string) {
  requirePermission(actor, "invoices.cancel");
  if (!reason?.trim()) throw invalid("Please give a reason for cancelling this invoice.");
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, AND: [invoiceAccessWhere(actor)] } });
    if (!inv) throw notFound("Invoice");
    if (inv.status === "CANCELLED") throw new AppError("INVALID_STATE", "Invoice is already cancelled.");
    if (await tx.payment.count({ where: { invoiceId, voidedAt: null } })) {
      throw new AppError("INVALID_STATE", "This invoice has payments. Void them before cancelling.");
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason, balanceDue: "0" } });
    await audit(tx, actor, { action: "invoice.cancel", entityType: "Invoice", entityId: invoiceId, before: { status: inv.status }, reason });
    await syncWorkBillingStatus(tx, actor, inv.workId);
    await syncCommissions(tx, actor, inv.workId);
  });
}

// ───────────────────────────── Payments ─────────────────────────────

const METHODS: PaymentMethod[] = ["UPI", "CASH", "BANK_TRANSFER", "CARD", "OTHER"];
export const METHOD_LABELS: Record<PaymentMethod, string> = { UPI: "GPay / UPI", CASH: "Cash", BANK_TRANSFER: "Bank transfer", CARD: "Card", OTHER: "Other" };

export interface PaymentInput {
  amount: string;
  paidOn: string;
  method: string;
  reference?: string;
  notes?: string;
}

/** Record a payment. The invoice row is locked so concurrent payments can't overpay. */
export async function recordPayment(actor: Actor, invoiceId: string, input: PaymentInput) {
  requirePermission(actor, "payments.record");
  const amount = toPaise(input.amount, "Payment amount");
  if (amount <= 0) throw invalid("Payment amount must be more than zero.");
  if (!isIsoDate(input.paidOn)) throw invalid("Please enter a valid payment date.");
  if (input.paidOn > businessToday()) throw invalid("Payment date cannot be in the future.");
  if (!METHODS.includes(input.method as PaymentMethod)) throw invalid("Please choose a payment method.");
  const reference = input.reference?.trim().slice(0, 100) || null;
  if ((input.method === "UPI" || input.method === "BANK_TRANSFER") && !reference) {
    throw invalid("Please enter the transaction / UTR reference for this payment.");
  }

  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, AND: [invoiceAccessWhere(actor)] } });
    if (!inv) throw notFound("Invoice");
    if (inv.status === "CANCELLED") throw new AppError("INVALID_STATE", "Cannot record a payment on a cancelled invoice.");
    const balance = toPaise(inv.balanceDue);
    if (amount > balance) {
      throw invalid(`Amount is more than the balance due (${formatINR(balance)}).`);
    }
    const number = await nextReference(tx, "PAY");
    const payment = await tx.payment.create({
      data: {
        number,
        invoiceId,
        workId: inv.workId,
        amount: fromPaise(amount),
        paidOn: toDbDate(input.paidOn),
        method: input.method as PaymentMethod,
        reference,
        notes: input.notes?.trim().slice(0, 1000) || null,
        receivedById: actor.id,
      },
    });
    await recalcInvoice(tx, invoiceId);
    await audit(tx, actor, { action: "payment.record", entityType: "Payment", entityId: payment.id, after: { number, invoice: inv.number, amount: fromPaise(amount), method: input.method, reference } });
    await syncWorkBillingStatus(tx, actor, inv.workId);

    const admins = await tx.user.findMany({
      where: { deletedAt: null, status: "ACTIVE", id: { not: actor.id }, OR: [{ role: { isSuperAdmin: true } }, { role: { permissions: { some: { permission: { key: "payments.view" } } } }, branches: { some: { branchId: inv.branchId } } }] },
      select: { id: true },
    });
    await notify(tx, {
      userIds: admins.map((a) => a.id),
      type: "payment.received",
      title: `Payment ${number} received`,
      body: `Payment of ${formatINR(amount)} received for invoice ${inv.number}.`,
      link: `/admin/invoices/${invoiceId}`,
      vars: { amount: formatINR(amount), invoice_number: inv.number, work_id: (await tx.work.findUnique({ where: { id: inv.workId }, select: { reference: true } }))?.reference, method: METHOD_LABELS[input.method as PaymentMethod], balance: formatINR(Math.max(toPaise(inv.balanceDue) - amount, 0)), customer_name: (inv.customerSnapshot as { name?: string }).name },
      customerId: inv.customerId,
    });
    return payment;
  });
}

/** Payments are never deleted — voiding keeps the record with a reason. */
export async function voidPayment(actor: Actor, paymentId: string, reason: string) {
  requirePermission(actor, "payments.void");
  if (!reason?.trim()) throw invalid("Please give a reason for voiding this payment.");
  return transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound("Payment");
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${p.invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: p.invoiceId, AND: [invoiceAccessWhere(actor)] } });
    if (!inv) throw notFound("Payment");
    if (p.voidedAt) throw new AppError("INVALID_STATE", "This payment is already void.");
    await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recalcInvoice(tx, p.invoiceId);
    await audit(tx, actor, { action: "payment.void", entityType: "Payment", entityId: paymentId, before: { amount: p.amount, method: p.method }, reason });
    await syncWorkBillingStatus(tx, actor, p.workId);
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listInvoices(actor: Actor, f: { q?: string; status?: string; page?: number } = {}) {
  if (!canViewBilling(actor)) throw forbidden();
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 25;
  const and: Prisma.InvoiceWhereInput[] = [invoiceAccessWhere(actor)];
  if (f.q?.trim()) {
    const q = f.q.trim();
    and.push({ OR: [{ number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { customer: { phone: { contains: q } } }, { work: { reference: { contains: q, mode: "insensitive" } } }] });
  }
  if (f.status && ["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"].includes(f.status)) and.push({ status: f.status as "PAID" });
  // Overdue: unpaid (fully or partly) and past the due date.
  if (f.status === "OVERDUE") and.push({ status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: toDbDate(businessToday()) } });
  const where = { AND: and };
  const [items, total, sums] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true } }, work: { select: { reference: true } }, branch: { select: { name: true } } },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { AND: [...and, { status: { not: "CANCELLED" } }] }, _sum: { grandTotal: true, amountPaid: true, balanceDue: true } }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), sums };
}

export async function getInvoice(actor: Actor, id: string) {
  if (!canViewBilling(actor)) throw notFound("Invoice");
  const inv = await prisma.invoice.findFirst({
    where: { id, AND: [invoiceAccessWhere(actor)] },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      work: { select: { id: true, reference: true, status: true, title: true } },
      branch: { select: { name: true } },
    },
  });
  if (!inv) throw notFound("Invoice");
  return inv;
}

export async function listPayments(actor: Actor, f: { q?: string; method?: string; from?: string; to?: string; page?: number } = {}) {
  requirePermission(actor, "payments.view");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 30;
  const and: Prisma.PaymentWhereInput[] = [{ invoice: invoiceAccessWhere(actor) }];
  if (f.q?.trim()) {
    const q = f.q.trim();
    and.push({ OR: [{ number: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { invoice: { number: { contains: q, mode: "insensitive" } } }, { invoice: { customer: { name: { contains: q, mode: "insensitive" } } } }] });
  }
  if (f.method && METHODS.includes(f.method as PaymentMethod)) and.push({ method: f.method as PaymentMethod });
  if (f.from && isIsoDate(f.from)) and.push({ paidOn: { gte: toDbDate(f.from) } });
  if (f.to && isIsoDate(f.to)) and.push({ paidOn: { lte: toDbDate(f.to) } });
  const where = { AND: and };
  const [items, total, sum] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { invoice: { select: { id: true, number: true, customer: { select: { name: true } } } } },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { AND: [...and, { voidedAt: null }] }, _sum: { amount: true } }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), sum: sum._sum.amount };
}
