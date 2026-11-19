import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { businessToday } from "@/server/lib/dates";
import { loadActor } from "@/server/rbac/load-actor";
import { agentPerformance, monthlyFinance, scoreAgent, tierFor, workCosting, workerPerformance } from "@/server/modules/analytics/service";
import { createExpense } from "@/server/modules/billing/expenses";
import { createInvoice } from "@/server/modules/billing/invoices";
import { saveItem } from "@/server/modules/inventory/catalog";
import { moveStock } from "@/server/modules/inventory/stock";
import { grantPortalAccess, portalOverview, portalPhoto, portalWork, revokePortalAccess } from "@/server/modules/portal/service";
import { canRunReport, getReport, totalsOf } from "@/server/modules/reports/definitions";
import { csvEscape, toCsv, toPdf } from "@/server/modules/reports/export";
import { createTicket, listCategories } from "@/server/modules/support/service";
import { saveUser } from "@/server/modules/users/service";
import { approveWork, assignWorkers, createWork, rejectWork, submitCompletion } from "@/server/modules/works/service";
import { actor, branch, freshDate, png, requiredCustom } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}
const today = businessToday();

/** Agent work on a fresh date → worker → (optional rework) → approved → invoiced ₹10,000 taxable. */
async function finishedWork(opts: { rework?: boolean; customerName?: string } = {}) {
  const agent = await actor("agent2@crm.test");
  const admin = await actor("admin@crm.test");
  const w2 = await actor("worker2@crm.test");
  const date = freshDate();
  const work = await createWork(agent, { branchId: (await branch("MAIN")).id, workDate: date, newCustomer: { name: opts.customerName ?? "P6 Customer", phone: "+91 90000 77777" }, customValues: requiredCustom });
  await assignWorkers(admin, work.id, [w2.id]);
  await submitCompletion(w2, work.id, { images: [png()] });
  if (opts.rework) {
    await rejectWork(admin, work.id, "Polish edges");
    await submitCompletion(w2, work.id, { images: [png()] });
  }
  await approveWork(admin, work.id);
  await createInvoice(admin, work.id, { invoiceDate: today, items: [{ description: "Fitting", quantity: "1", rate: "10000", taxRate: 18 }] });
  return { work, date, agent, admin, w2 };
}

describe("analytics", () => {
  it("scores agents with configurable weights and tiers", () => {
    const w = { completionWeight: 40, onTimeWeight: 25, cancellationWeight: 15, revenueWeight: 20, minWorks: 3 };
    expect(scoreAgent({ works: 2, completed: 2, cancelled: 0, onTime: 2, revenue: 100 }, 100, w)).toBeNull(); // not enough data
    expect(scoreAgent({ works: 10, completed: 10, cancelled: 0, onTime: 10, revenue: 100 }, 100, w)).toBe(100);
    expect(scoreAgent({ works: 10, completed: 5, cancelled: 2, onTime: 5, revenue: 50 }, 100, w)).toBe(Math.round(((5 / 8) * 40 + 1 * 25 + 0.8 * 15 + 0.5 * 20)));
    expect([tierFor(85), tierFor(65), tierFor(45), tierFor(10), tierFor(null)]).toEqual(["Gold", "Silver", "Bronze", "Needs attention", "New"]);
  });

  it("computes job costing: revenue − materials − commission − linked expenses", async () => {
    const { work, admin } = await finishedWork();
    const sa = await actor("superadmin@crm.test");
    const main = await branch("MAIN");
    const item = await saveItem(sa, { kind: "RAW_MATERIAL", name: "P6 slab", code: `P6-${Date.now().toString(36)}`.toUpperCase(), unit: "sq ft", purchasePrice: "120" });
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "10" });
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "OUT", quantity: "4", reason: "Fitting", workReference: work.reference });
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: "Transport" } });
    await createExpense(admin, { title: "Van", amount: "500", spentOn: today, categoryId: cat.id, branchId: main.id, workReference: work.reference });
    const c = await workCosting(work.id);
    // revenue 10000; materials 480; agent 5% 500; worker 3% 300; expense 500
    expect(c).toMatchObject({ revenue: 1_000_000, materials: 48_000, agentCommission: 50_000, workerCommission: 30_000, expenses: 50_000, profit: 822_000, margin: 82.2 });
  });

  it("measures agent and worker performance for a period", async () => {
    const { date, agent, w2 } = await finishedWork({ rework: true });
    const sa = await actor("superadmin@crm.test");
    const [a] = await agentPerformance(sa, { from: date, to: date, agentId: agent.id });
    expect(a).toMatchObject({ works: 1, completed: 1, cancelled: 0, revenue: 1_000_000, commission: 50_000, score: null, tier: "New" });
    const [w] = await workerPerformance(sa, { from: date, to: date, workerId: w2.id });
    expect(w).toMatchObject({ assigned: 1, completed: 1, rejections: 1, firstTimeRight: 0 });
    expect(w.avgCompletionHours).not.toBeNull();
  });

  it("adds new revenue to this month's P&L", async () => {
    const sa = await actor("superadmin@crm.test");
    const month = today.slice(0, 7);
    const before = (await monthlyFinance(sa, { from: `${month}-01`, to: today })).find((m) => m.month === month)!;
    await finishedWork();
    const after = (await monthlyFinance(sa, { from: `${month}-01`, to: today })).find((m) => m.month === month)!;
    expect(after.revenue - before.revenue).toBe(1_000_000);
    expect(after.net - before.net).toBe(1_000_000); // commission not yet approved, no material/expense
  });
});

describe("reports", () => {
  it("runs reports within permissions and branch access, with totals", async () => {
    const { work, date } = await finishedWork();
    const admin = await actor("admin@crm.test");
    const staff = await actor("staff@crm.test");
    const def = getReport("works")!;
    expect(canRunReport(staff, def)).toBe(false);
    expect(canRunReport(admin, def)).toBe(true);
    const rows = await def.run(admin, { from: date, to: date });
    expect(rows.map((r) => r.reference)).toEqual([work.reference]);
    expect(totalsOf(def, rows)).toMatchObject({ invoiced: 1_180_000 });

    const sa = await actor("superadmin@crm.test");
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
    const email = `north-admin-${Date.now()}@crm.test`;
    await saveUser(sa, { name: "North Admin", email, roleId: adminRole.id, branchIds: [(await branch("NORTH")).id], password: "Password123" });
    const north = await actor(email);
    expect(await def.run(north, { from: date, to: date })).toEqual([]);
    expect(await code(def.run(north, { from: date, to: date, branchId: (await branch("MAIN")).id }))).toBe("FORBIDDEN");
  });

  it("exports safe CSV and a PDF", async () => {
    expect(csvEscape("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape("-5", true)).toBe("-5");
    expect(csvEscape("@cmd")).toBe("'@cmd");
    const def = getReport("payments")!;
    const rows = [{ number: "PAY-1", date: "2026-11-01", invoice: "INV-1", customer: "=evil()", method: "Cash", reference: "", amount: 123456 }];
    const csv = toCsv(def, rows, totalsOf(def, rows));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=evil()");
    expect(csv).toContain("1234.56");
    const pdf = await toPdf(def, rows, totalsOf(def, rows), { company: "X", filters: "All", generatedBy: "T" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("customer portal", () => {
  it("shows a customer only their own works, invoices and approved photos", async () => {
    const { work } = await finishedWork({ customerName: `Portal Cust ${Date.now()}` });
    const other = await finishedWork({ customerName: `Other Cust ${Date.now()}` });
    const admin = await actor("admin@crm.test");
    const email = `cust-${Date.now()}@example.com`;
    await grantPortalAccess(admin, work.customerId, { email, password: "Password123" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const cust = (await loadActor(user.id))!;
    expect(cust.portal).toBe("CUSTOMER");

    const o = await portalOverview(cust);
    expect(o.works.map((w) => w.id)).toEqual([work.id]);
    expect(o.invoices).toHaveLength(1);
    expect(o.outstanding).toBe(1_180_000);
    expect(await code(portalWork(cust, other.work.id))).toBe("NOT_FOUND");

    const detail = await portalWork(cust, work.id);
    expect(detail.photos.length).toBe(1);
    expect(Object.keys(detail.work)).not.toContain("agentId");
    await expect(portalPhoto(cust, detail.photos[0].id)).resolves.toBeTruthy();
    const otherPhoto = await prisma.workImageVersion.findFirstOrThrow({ where: { image: { workId: other.work.id, kind: "COMPLETION" }, isCurrent: true } });
    expect(await code(portalPhoto(cust, otherPhoto.id))).toBe("NOT_FOUND");

    // Staff-side services refuse a customer.
    const { getWorkDetail } = await import("@/server/modules/works/queries");
    expect(await code(getWorkDetail(cust, work.id))).toBe("NOT_FOUND");

    // Support from the portal is linked to the customer; other customers' works can't be referenced.
    const cat = (await listCategories())[0];
    const t = await createTicket(cust, { title: "Stain on counter", description: "Small stain after fitting", categoryId: cat.id, workReference: work.reference });
    expect(t.customerId).toBe(work.customerId);
    expect(await code(createTicket(cust, { title: "Other work", description: "Not mine at all", categoryId: cat.id, workReference: other.work.reference }))).toBe("VALIDATION");

    await revokePortalAccess(admin, work.customerId);
    expect(await loadActor(user.id)).toBeNull();
  });

  it("only office users with customer + user rights can grant access", async () => {
    const staff = await actor("staff@crm.test");
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } });
    expect(await code(grantPortalAccess(staff, c.id, { email: "x@example.com", password: "Password123" }))).toBe("FORBIDDEN");
  });
});
