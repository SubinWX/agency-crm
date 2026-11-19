import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { businessToday } from "@/server/lib/dates";
import { adjustCommission, approveCommissions, listCommissions, markCommissionsPaid, setUserRate } from "@/server/modules/billing/commissions";
import { createExpense, listExpenses, voidExpense } from "@/server/modules/billing/expenses";
import { cancelInvoice, createInvoice, getInvoice, recordPayment, updateInvoice, voidPayment } from "@/server/modules/billing/invoices";
import { recordSalaryPayment, setSalary } from "@/server/modules/billing/salary";
import { approveWork, assignWorkers, createWork, submitCompletion } from "@/server/modules/works/service";
import { actor, branch, freshDate, png, requiredCustom } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

const today = businessToday();
const item = (rate: string, qty = "1") => ({ description: "Counter top fitting", quantity: qty, rate, taxRate: 18 });

/** Agent work → 2 workers → completed → approved. */
async function approvedWork(branchCode: "MAIN" | "NORTH" = "MAIN") {
  const agent = await actor("agent@crm.test");
  const admin = await actor("admin@crm.test");
  const w1 = await actor("worker1@crm.test");
  const w2 = await actor("worker2@crm.test");
  const b = await branch(branchCode);
  const work = await createWork(agent, { branchId: b.id, workDate: freshDate(), newCustomer: { name: "Bill Test", phone: "+91 90000 99999" }, customValues: requiredCustom });
  await assignWorkers(admin, work.id, branchCode === "MAIN" ? [w1.id, w2.id] : [w1.id]);
  await submitCompletion(w1, work.id, { images: [png()] });
  await approveWork(admin, work.id);
  return { work, admin, agent, w1, w2 };
}

const status = async (id: string) => (await prisma.work.findUniqueOrThrow({ where: { id } })).status;

describe("invoices & payments", () => {
  it("runs invoice → partial payment → full payment, updating invoice and work status", async () => {
    const { work, admin } = await approvedWork();
    const inv = await createInvoice(admin, work.id, { invoiceDate: today, items: [item("10000")] }); // 10000 + 18% = 11800
    expect(inv.number).toMatch(/^INV-\d{6}$/);
    expect(inv.grandTotal.toString()).toBe("11800");
    expect(await status(work.id)).toBe("INVOICED");

    expect(await code(recordPayment(admin, inv.id, { amount: "0", paidOn: today, method: "CASH" }))).toBe("VALIDATION");
    expect(await code(recordPayment(admin, inv.id, { amount: "-5", paidOn: today, method: "CASH" }))).toBe("VALIDATION");
    expect(await code(recordPayment(admin, inv.id, { amount: "11800.01", paidOn: today, method: "CASH" }))).toBe("VALIDATION");
    expect(await code(recordPayment(admin, inv.id, { amount: "100", paidOn: today, method: "UPI" }))).toBe("VALIDATION"); // UPI needs reference

    const p1 = await recordPayment(admin, inv.id, { amount: "5000", paidOn: today, method: "UPI", reference: "UTR123" });
    expect(p1.number).toMatch(/^PAY-\d{6}$/);
    let fresh = await getInvoice(admin, inv.id);
    expect([fresh.status, fresh.amountPaid.toString(), fresh.balanceDue.toString()]).toEqual(["PARTIALLY_PAID", "5000", "6800"]);
    expect(await status(work.id)).toBe("PAYMENT_PENDING");

    await recordPayment(admin, inv.id, { amount: "6800", paidOn: today, method: "CASH" });
    fresh = await getInvoice(admin, inv.id);
    expect(fresh.status).toBe("PAID");
    expect(fresh.paidAt).not.toBeNull();
    expect(await status(work.id)).toBe("PAID");

    // Voiding a payment re-opens the balance, keeps the record.
    await voidPayment(admin, p1.id, "Bounced UPI");
    fresh = await getInvoice(admin, inv.id);
    expect([fresh.status, fresh.balanceDue.toString()]).toEqual(["PARTIALLY_PAID", "5000"]);
    expect(await prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(2);
    expect(await status(work.id)).toBe("PAYMENT_PENDING");
  });

  it("never lets concurrent payments exceed the invoice total", async () => {
    const { work, admin } = await approvedWork();
    const inv = await createInvoice(admin, work.id, { invoiceDate: today, taxType: "NONE", items: [item("1000")] });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => recordPayment(admin, inv.id, { amount: "400", paidOn: today, method: "CASH" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await getInvoice(admin, inv.id)).amountPaid.toString()).toBe("800");
  });

  it("blocks editing or cancelling an invoice that has payments, and audits edits", async () => {
    const { work, admin } = await approvedWork();
    const inv = await createInvoice(admin, work.id, { invoiceDate: today, items: [item("1000")] });
    await updateInvoice(admin, inv.id, { invoiceDate: today, items: [item("2000")] }, "Customer added second slab");
    expect((await getInvoice(admin, inv.id)).grandTotal.toString()).toBe("2360");
    expect(await prisma.auditLog.count({ where: { entityId: inv.id, action: "invoice.update" } })).toBe(1);

    const pay = await recordPayment(admin, inv.id, { amount: "100", paidOn: today, method: "CASH" });
    expect(await code(updateInvoice(admin, inv.id, { invoiceDate: today, items: [item("1")] }, "x"))).toBe("INVALID_STATE");
    expect(await code(cancelInvoice(admin, inv.id, "x"))).toBe("INVALID_STATE");
    await voidPayment(admin, pay.id, "Mistake");
    await cancelInvoice(admin, inv.id, "Wrong customer");
    expect(await status(work.id)).toBe("APPROVED");
  });

  it("can invoice before approval without changing the operational status", async () => {
    const admin = await actor("admin@crm.test");
    const b = await branch("MAIN");
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } });
    const w = await createWork(admin, { branchId: b.id, workDate: freshDate(), customerId: c.id, customValues: requiredCustom });
    await createInvoice(admin, w.id, { invoiceDate: today, items: [item("500")] });
    expect(await status(w.id)).toBe("SCHEDULED");
  });

  it("hides invoices from agents, workers and other branches", async () => {
    const { work, admin } = await approvedWork("NORTH");
    const inv = await createInvoice(admin, work.id, { invoiceDate: today, items: [item("100")] });
    for (const who of ["agent@crm.test", "worker1@crm.test", "staff@crm.test"]) {
      expect(await code(getInvoice(await actor(who), inv.id))).toBe("NOT_FOUND");
    }
    expect(await code(recordPayment(await actor("staff@crm.test"), inv.id, { amount: "1", paidOn: today, method: "CASH" }))).toBe("FORBIDDEN");
  });
});

describe("commissions", () => {
  it("accrues agent + split worker commission on approval and follows the invoice", async () => {
    const { work, admin, agent, w1, w2 } = await approvedWork();
    const lines = await prisma.commission.findMany({ where: { workId: work.id } });
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.amount.toString() === "0")).toBe(true); // no invoice yet

    await createInvoice(admin, work.id, { invoiceDate: today, items: [item("10000")] }); // taxable 10000
    const get = async (userId: string) => prisma.commission.findFirstOrThrow({ where: { workId: work.id, userId } });
    expect((await get(agent.id)).amount.toString()).toBe("500"); // 5%
    expect((await get(w1.id)).amount.toString()).toBe("150"); // 3% split between 2
    expect((await get(w2.id)).amount.toString()).toBe("150");
    const hist = await prisma.commissionHistory.findMany({ where: { commissionId: (await get(agent.id)).id } });
    expect(hist.map((h) => h.action)).toEqual(expect.arrayContaining(["created", "recalculated"]));
  });

  it("snapshots personal rates and keeps rate history", async () => {
    const sa = await actor("superadmin@crm.test");
    const agent = await actor("agent@crm.test");
    await setUserRate(sa, agent.id, "7", "Top performer");
    try {
      const { work, admin } = await approvedWork();
      await createInvoice(admin, work.id, { invoiceDate: today, items: [item("10000")] });
      const c = await prisma.commission.findFirstOrThrow({ where: { workId: work.id, userId: agent.id } });
      expect([c.percent.toString(), c.amount.toString()]).toEqual(["7", "700"]);
      expect(await prisma.commissionRateHistory.count({ where: { scope: `user:${agent.id}`, reason: "Top performer" } })).toBeGreaterThan(0);
    } finally {
      await setUserRate(sa, agent.id, "", "reset");
    }
  });

  it("adjusts with reason, then approve → paid freezes the amount", async () => {
    const { work, admin, agent } = await approvedWork();
    await createInvoice(admin, work.id, { invoiceDate: today, items: [item("10000")] });
    const c = await prisma.commission.findFirstOrThrow({ where: { workId: work.id, userId: agent.id } });
    expect(await code(adjustCommission(admin, c.id, { amount: "600", reason: "" }))).toBe("VALIDATION");
    await adjustCommission(admin, c.id, { amount: "600", reason: "Bonus agreed" });
    await approveCommissions(admin, [c.id]);
    expect(await code(adjustCommission(admin, c.id, { amount: "1", reason: "x" }))).toBe("INVALID_STATE");
    await markCommissionsPaid(admin, [c.id], "UPI-998");
    const done = await prisma.commission.findUniqueOrThrow({ where: { id: c.id } });
    expect([done.status, done.amount.toString(), done.payoutReference]).toEqual(["PAID", "600", "UPI-998"]);
  });

  it("never shows agent commission to workers; agents only see their own", async () => {
    await approvedWork();
    const worker = await actor("worker1@crm.test");
    expect(await code(listCommissions(worker))).toBe("FORBIDDEN"); // no permission by default
    const agent2 = await actor("agent2@crm.test");
    const own = await listCommissions(agent2);
    expect(own.items.every((c) => c.userId === agent2.id)).toBe(true);
    const agent = await actor("agent@crm.test");
    const mine = await listCommissions(agent);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((c) => c.userId === agent.id && c.type === "AGENT")).toBe(true);
  });
});

describe("expenses & salary", () => {
  it("records expenses with history, voids instead of deleting", async () => {
    const admin = await actor("admin@crm.test");
    const b = await branch("MAIN");
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: "Transport" } });
    expect(await code(createExpense(admin, { title: "Fuel", amount: "0", spentOn: today, categoryId: cat.id, branchId: b.id }))).toBe("VALIDATION");
    const e = await createExpense(admin, { title: "Fuel", amount: "450.50", spentOn: today, categoryId: cat.id, branchId: b.id });
    expect(e.number).toMatch(/^EXP-\d{6}$/);
    await voidExpense(admin, e.id, "Duplicate");
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect([row.status, row.voidReason]).toEqual(["VOID", "Duplicate"]);
    expect(await code(listExpenses(await actor("agent@crm.test")))).toBe("FORBIDDEN");
  });

  it("sets salary and records salary payments", async () => {
    const admin = await actor("admin@crm.test");
    const staff = await actor("staff@crm.test");
    await setSalary(admin, staff.id, { amount: "18000", type: "MONTHLY", reason: "Joining" });
    const p = await recordSalaryPayment(admin, staff.id, { period: today.slice(0, 7), amount: "18000", paidOn: today, method: "BANK_TRANSFER", reference: "NEFT1" });
    expect(p.amount.toString()).toBe("18000");
    expect(await code(recordSalaryPayment(await actor("staff@crm.test"), staff.id, { period: "2026-01", amount: "1", paidOn: today, method: "CASH" }))).toBe("FORBIDDEN");
  });
});
