/**
 * Reports (spec §37). Each report declares its filters, columns and a run()
 * that returns plain rows; the same rows feed the screen table, CSV (Excel)
 * and PDF export. All reports respect branch access and permissions.
 */
import type { InvoiceStatus, Prisma, WorkStatus } from "@prisma/client";
import { prisma } from "../../db";
import { fromDbDate, toDbDate } from "../../lib/dates";
import { canAny, type Actor } from "../../rbac/actor";
import type { PermissionKey } from "../../rbac/permissions";
import { agentPerformance, branchPerformance, costingForWorks, monthlyFinance, resolveScope, workerPerformance } from "../analytics/service";
import { toPaise } from "../billing/calc";
import { METHOD_LABELS } from "../billing/invoices";
import { toMilli } from "../inventory/qty";
import { STATUS_LABELS } from "../works/access";

export type FilterKey = "date" | "branch" | "agent" | "worker" | "customer" | "workStatus" | "paymentStatus" | "item" | "expenseCategory";
export type ColType = "text" | "money" | "number" | "qty" | "date" | "percent";
export interface Column {
  key: string;
  label: string;
  type: ColType;
  total?: boolean;
}
export type Row = Record<string, string | number | null>;
export interface Filters {
  from?: string;
  to?: string;
  branchId?: string;
  agentId?: string;
  workerId?: string;
  customerId?: string;
  workStatus?: string;
  paymentStatus?: string;
  itemId?: string;
  categoryId?: string;
}
export interface ReportDef {
  key: string;
  title: string;
  description: string;
  group: "Operations" | "Finance" | "People" | "Inventory";
  perms: PermissionKey[]; // any of
  filters: FilterKey[];
  columns: Column[];
  /** "date" filter applies to … (shown in UI) */
  dateLabel?: string;
  run(actor: Actor, f: Filters): Promise<Row[]>;
}

const money = (v: { toString(): string } | null | undefined) => toPaise(v?.toString() ?? "0");
const WORK_STATUSES = Object.keys(STATUS_LABELS) as WorkStatus[];
const INVOICE_STATUSES: InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"];
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { ISSUED: "Unpaid", PARTIALLY_PAID: "Partially paid", PAID: "Paid", CANCELLED: "Cancelled" };

function workWhere(actor: Actor, f: Filters): Prisma.WorkWhereInput {
  const { from, to, branchIds } = resolveScope(actor, f);
  return {
    deletedAt: null,
    workDate: { gte: toDbDate(from), lte: toDbDate(to) },
    ...(branchIds ? { branchId: { in: branchIds } } : {}),
    ...(f.agentId ? { agentId: f.agentId } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.workStatus && WORK_STATUSES.includes(f.workStatus as WorkStatus) ? { status: f.workStatus as WorkStatus } : {}),
    ...(f.workerId ? { assignments: { some: { workerId: f.workerId, removedAt: null } } } : {}),
  };
}

function invoiceWhere(actor: Actor, f: Filters): Prisma.InvoiceWhereInput {
  const { from, to, branchIds } = resolveScope(actor, f);
  return {
    invoiceDate: { gte: toDbDate(from), lte: toDbDate(to) },
    ...(branchIds ? { branchId: { in: branchIds } } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.agentId ? { work: { agentId: f.agentId } } : {}),
    ...(f.paymentStatus && INVOICE_STATUSES.includes(f.paymentStatus as InvoiceStatus) ? { status: f.paymentStatus as InvoiceStatus } : {}),
  };
}

const LIMIT = 5000;

export const REPORTS: ReportDef[] = [
  {
    key: "works",
    title: "Work report",
    description: "Works with customer, agent, workers, status and billing.",
    group: "Operations",
    perms: ["reports.view"],
    filters: ["date", "branch", "agent", "worker", "customer", "workStatus"],
    dateLabel: "Work date",
    columns: [
      { key: "reference", label: "Work", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
      { key: "agent", label: "Agent", type: "text" },
      { key: "workers", label: "Workers", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "invoiced", label: "Invoiced", type: "money", total: true },
      { key: "paid", label: "Paid", type: "money", total: true },
    ],
    async run(actor, f) {
      const works = await prisma.work.findMany({
        where: workWhere(actor, f),
        orderBy: [{ workDate: "asc" }, { reference: "asc" }],
        take: LIMIT,
        include: {
          customer: { select: { name: true } },
          branch: { select: { name: true } },
          agent: { select: { name: true } },
          assignments: { where: { removedAt: null }, select: { worker: { select: { name: true } } } },
          invoices: { where: { status: { not: "CANCELLED" } }, select: { grandTotal: true, amountPaid: true } },
        },
      });
      return works.map((w) => ({
        reference: w.reference,
        date: fromDbDate(w.workDate),
        customer: w.customer.name,
        branch: w.branch.name,
        agent: w.agent?.name ?? "",
        workers: w.assignments.map((a) => a.worker.name).join(", "),
        status: STATUS_LABELS[w.status],
        invoiced: w.invoices.reduce((a, i) => a + money(i.grandTotal), 0),
        paid: w.invoices.reduce((a, i) => a + money(i.amountPaid), 0),
      }));
    },
  },
  {
    key: "revenue",
    title: "Revenue report",
    description: "Invoices with taxable value, GST and totals.",
    group: "Finance",
    perms: ["invoices.view", "reports.view"],
    filters: ["date", "branch", "agent", "customer", "paymentStatus"],
    dateLabel: "Invoice date",
    columns: [
      { key: "number", label: "Invoice", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "work", label: "Work", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
      { key: "taxable", label: "Taxable", type: "money", total: true },
      { key: "gst", label: "GST", type: "money", total: true },
      { key: "total", label: "Total", type: "money", total: true },
      { key: "status", label: "Status", type: "text" },
    ],
    async run(actor, f) {
      const rows = await prisma.invoice.findMany({
        where: { ...invoiceWhere(actor, f), ...(f.paymentStatus ? {} : { status: { not: "CANCELLED" } }) },
        orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
        take: LIMIT,
        include: { customer: { select: { name: true } }, work: { select: { reference: true } }, branch: { select: { name: true } } },
      });
      return rows.map((i) => ({
        number: i.number,
        date: fromDbDate(i.invoiceDate),
        customer: i.customer.name,
        work: i.work.reference,
        branch: i.branch.name,
        taxable: money(i.taxableTotal),
        gst: money(i.taxTotal),
        total: money(i.grandTotal),
        status: INVOICE_STATUS_LABEL[i.status],
      }));
    },
  },
  {
    key: "payments",
    title: "Payment report",
    description: "Payments received (void payments excluded).",
    group: "Finance",
    perms: ["payments.view"],
    filters: ["date", "branch", "customer"],
    dateLabel: "Payment date",
    columns: [
      { key: "number", label: "Payment", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "invoice", label: "Invoice", type: "text" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "method", label: "Method", type: "text" },
      { key: "reference", label: "Reference", type: "text" },
      { key: "amount", label: "Amount", type: "money", total: true },
    ],
    async run(actor, f) {
      const { from, to, branchIds } = resolveScope(actor, f);
      const rows = await prisma.payment.findMany({
        where: {
          voidedAt: null,
          paidOn: { gte: toDbDate(from), lte: toDbDate(to) },
          invoice: { ...(branchIds ? { branchId: { in: branchIds } } : {}), ...(f.customerId ? { customerId: f.customerId } : {}) },
        },
        orderBy: [{ paidOn: "asc" }, { number: "asc" }],
        take: LIMIT,
        include: { invoice: { select: { number: true, customer: { select: { name: true } } } } },
      });
      return rows.map((p) => ({ number: p.number, date: fromDbDate(p.paidOn), invoice: p.invoice.number, customer: p.invoice.customer.name, method: METHOD_LABELS[p.method], reference: p.reference ?? "", amount: money(p.amount) }));
    },
  },
  {
    key: "outstanding",
    title: "Outstanding report",
    description: "Unpaid and partly paid invoices with days overdue.",
    group: "Finance",
    perms: ["invoices.view", "payments.view"],
    filters: ["date", "branch", "customer"],
    dateLabel: "Invoice date",
    columns: [
      { key: "number", label: "Invoice", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "due", label: "Due", type: "date" },
      { key: "overdue", label: "Days overdue", type: "number" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "total", label: "Total", type: "money", total: true },
      { key: "paid", label: "Paid", type: "money", total: true },
      { key: "balance", label: "Balance", type: "money", total: true },
    ],
    async run(actor, f) {
      const rows = await prisma.invoice.findMany({
        where: { ...invoiceWhere(actor, { ...f, paymentStatus: undefined }), status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
        orderBy: [{ dueDate: "asc" }],
        take: LIMIT,
        include: { customer: { select: { name: true } } },
      });
      const today = Date.now();
      return rows.map((i) => ({
        number: i.number,
        date: fromDbDate(i.invoiceDate),
        due: i.dueDate ? fromDbDate(i.dueDate) : "",
        overdue: i.dueDate ? Math.max(0, Math.floor((today - i.dueDate.getTime()) / 86_400_000)) : 0,
        customer: i.customer.name,
        total: money(i.grandTotal),
        paid: money(i.amountPaid),
        balance: money(i.balanceDue),
      }));
    },
  },
  {
    key: "expenses",
    title: "Expense report",
    description: "Active expenses by category and branch.",
    group: "Finance",
    perms: ["expenses.view", "expenses.manage"],
    filters: ["date", "branch", "expenseCategory"],
    dateLabel: "Expense date",
    columns: [
      { key: "number", label: "Expense", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "title", label: "Title", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
      { key: "work", label: "Work", type: "text" },
      { key: "amount", label: "Amount", type: "money", total: true },
    ],
    async run(actor, f) {
      const { from, to, branchIds } = resolveScope(actor, f);
      const rows = await prisma.expense.findMany({
        where: {
          status: "ACTIVE",
          spentOn: { gte: toDbDate(from), lte: toDbDate(to) },
          ...(f.categoryId ? { categoryId: f.categoryId } : {}),
          ...(f.branchId ? { branchId: f.branchId } : branchIds ? { OR: [{ branchId: null }, { branchId: { in: branchIds } }] } : {}),
        },
        orderBy: [{ spentOn: "asc" }],
        take: LIMIT,
        include: { category: { select: { name: true } }, branch: { select: { name: true } }, work: { select: { reference: true } } },
      });
      return rows.map((e) => ({ number: e.number, date: fromDbDate(e.spentOn), title: e.title, category: e.category.name, branch: e.branch?.name ?? "Company", work: e.work?.reference ?? "", amount: money(e.amount) }));
    },
  },
  {
    key: "profit-loss",
    title: "Profit & loss",
    description: "Monthly revenue (excl. GST) minus expenses, salaries, commission and materials.",
    group: "Finance",
    perms: ["reports.view"],
    filters: ["date", "branch"],
    dateLabel: "Period",
    columns: [
      { key: "month", label: "Month", type: "text" },
      { key: "revenue", label: "Revenue", type: "money", total: true },
      { key: "expenses", label: "Expenses", type: "money", total: true },
      { key: "salaries", label: "Salaries", type: "money", total: true },
      { key: "commissions", label: "Commission", type: "money", total: true },
      { key: "materials", label: "Materials", type: "money", total: true },
      { key: "net", label: "Net profit", type: "money", total: true },
      { key: "received", label: "Cash received", type: "money", total: true },
    ],
    async run(actor, f) {
      return (await monthlyFinance(actor, f)).map((m) => ({ ...m }));
    },
  },
  ...(["AGENT", "WORKER"] as const).map(
    (type): ReportDef => ({
      key: type === "AGENT" ? "agent-commission" : "worker-commission",
      title: type === "AGENT" ? "Agent commission report" : "Worker commission report",
      description: `${type === "AGENT" ? "Agent" : "Worker"} commission per work with status.`,
      group: "People",
      perms: ["commissions.manage"],
      filters: ["date", "branch", type === "AGENT" ? "agent" : "worker"],
      dateLabel: "Work date",
      columns: [
        { key: "person", label: type === "AGENT" ? "Agent" : "Worker", type: "text" },
        { key: "work", label: "Work", type: "text" },
        { key: "date", label: "Work date", type: "date" },
        { key: "base", label: "Base (excl. GST)", type: "money", total: true },
        { key: "percent", label: "%", type: "number" },
        { key: "amount", label: "Commission", type: "money", total: true },
        { key: "status", label: "Status", type: "text" },
      ],
      async run(actor, f) {
        const { from, to, branchIds } = resolveScope(actor, f);
        const person = type === "AGENT" ? f.agentId : f.workerId;
        const rows = await prisma.commission.findMany({
          where: {
            type,
            ...(person ? { userId: person } : {}),
            work: { workDate: { gte: toDbDate(from), lte: toDbDate(to) }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
          },
          orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }],
          take: LIMIT,
          include: { user: { select: { name: true } }, work: { select: { reference: true, workDate: true } } },
        });
        return rows.map((c) => ({
          person: c.user.name,
          work: c.work.reference,
          date: fromDbDate(c.work.workDate),
          base: money(c.baseAmount),
          percent: Number(c.percent),
          amount: c.status === "CANCELLED" ? 0 : money(c.amount),
          status: c.status.charAt(0) + c.status.slice(1).toLowerCase(),
        }));
      },
    }),
  ),
  {
    key: "inventory",
    title: "Inventory report",
    description: "Stock on hand per branch with value at purchase price.",
    group: "Inventory",
    perms: ["inventory.view", "inventory.manage", "inventory.edit_stock"],
    filters: ["branch", "item"],
    columns: [
      { key: "item", label: "Item", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "kind", label: "Type", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
      { key: "qty", label: "Quantity", type: "qty" },
      { key: "unit", label: "Unit", type: "text" },
      { key: "value", label: "Value", type: "money", total: true },
      { key: "low", label: "Low stock", type: "text" },
    ],
    async run(actor, f) {
      const { branchIds } = resolveScope(actor, f);
      const rows = await prisma.stockLevel.findMany({
        where: { ...(branchIds ? { branchId: { in: branchIds } } : {}), ...(f.itemId ? { itemId: f.itemId } : {}), item: { deletedAt: null } },
        include: { item: true, branch: { select: { name: true } } },
        orderBy: [{ item: { name: "asc" } }],
        take: LIMIT,
      });
      return rows.map((l) => {
        const qty = toMilli(l.quantity.toString());
        const threshold = toMilli((l.reorderLevel ?? l.item.reorderLevel).toString());
        return {
          item: l.item.name,
          code: l.item.code,
          kind: l.item.kind === "PRODUCT" ? "Product" : "Raw material",
          branch: l.branch.name,
          qty,
          unit: l.item.unit,
          value: Math.round((qty * money(l.item.purchasePrice)) / 1000),
          low: threshold > 0 && qty <= threshold ? "Yes" : "",
        };
      });
    },
  },
  {
    key: "salary",
    title: "Staff salary report",
    description: "Salary payments made (void excluded).",
    group: "People",
    perms: ["staff.manage"],
    filters: ["date", "branch"],
    dateLabel: "Paid on",
    columns: [
      { key: "employee", label: "Employee", type: "text" },
      { key: "role", label: "Role", type: "text" },
      { key: "period", label: "Month", type: "text" },
      { key: "date", label: "Paid on", type: "date" },
      { key: "method", label: "Method", type: "text" },
      { key: "amount", label: "Amount", type: "money", total: true },
    ],
    async run(actor, f) {
      const { from, to, branchIds } = resolveScope(actor, f);
      const rows = await prisma.salaryPayment.findMany({
        where: { voidedAt: null, paidOn: { gte: toDbDate(from), lte: toDbDate(to) }, ...(branchIds ? { user: { branches: { some: { branchId: { in: branchIds } } } } } : {}) },
        orderBy: [{ paidOn: "asc" }],
        take: LIMIT,
        include: { user: { select: { name: true, role: { select: { name: true } } } } },
      });
      return rows.map((p) => ({ employee: p.user.name, role: p.user.role.name, period: p.period, date: fromDbDate(p.paidOn), method: METHOD_LABELS[p.method], amount: money(p.amount) }));
    },
  },
  {
    key: "branch-performance",
    title: "Branch performance",
    description: "Works, revenue, costs and net profit per branch.",
    group: "Operations",
    perms: ["reports.view"],
    filters: ["date"],
    dateLabel: "Period",
    columns: [
      { key: "name", label: "Branch", type: "text" },
      { key: "works", label: "Works", type: "number", total: true },
      { key: "completed", label: "Completed", type: "number", total: true },
      { key: "revenue", label: "Revenue", type: "money", total: true },
      { key: "received", label: "Received", type: "money", total: true },
      { key: "expenses", label: "All costs", type: "money", total: true },
      { key: "net", label: "Net", type: "money", total: true },
    ],
    async run(actor, f) {
      return (await branchPerformance(actor, f)).map((b) => ({ name: b.name, works: b.works, completed: b.completed, revenue: b.revenue, received: b.received, expenses: b.expenses, net: b.net }));
    },
  },
  {
    key: "work-profitability",
    title: "Work profitability (costing)",
    description: "Revenue vs materials, commission and linked expenses per work.",
    group: "Finance",
    perms: ["reports.view"],
    filters: ["date", "branch", "agent", "customer", "workStatus"],
    dateLabel: "Work date",
    columns: [
      { key: "reference", label: "Work", type: "text" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "revenue", label: "Revenue", type: "money", total: true },
      { key: "materials", label: "Materials", type: "money", total: true },
      { key: "commission", label: "Commission", type: "money", total: true },
      { key: "expenses", label: "Expenses", type: "money", total: true },
      { key: "profit", label: "Profit", type: "money", total: true },
      { key: "margin", label: "Margin", type: "percent" },
    ],
    async run(actor, f) {
      const works = await prisma.work.findMany({ where: { ...workWhere(actor, f), status: f.workStatus ? undefined : { not: "CANCELLED" } }, select: { id: true, reference: true, customer: { select: { name: true } } }, orderBy: { workDate: "asc" }, take: LIMIT });
      const costing = await costingForWorks(works.map((w) => w.id));
      return works.map((w) => {
        const c = costing.get(w.id)!;
        return { reference: w.reference, customer: w.customer.name, revenue: c.revenue, materials: c.materials, commission: c.agentCommission + c.workerCommission, expenses: c.expenses, profit: c.profit, margin: c.margin };
      });
    },
  },
  {
    key: "agent-performance",
    title: "Agent performance & score",
    description: "Works, completion, on-time rate, revenue and score per agent.",
    group: "People",
    perms: ["reports.view"],
    filters: ["date", "branch", "agent"],
    dateLabel: "Work date",
    columns: [
      { key: "name", label: "Agent", type: "text" },
      { key: "works", label: "Works", type: "number", total: true },
      { key: "completed", label: "Completed", type: "number", total: true },
      { key: "cancelled", label: "Cancelled", type: "number", total: true },
      { key: "onTimeRate", label: "On time", type: "percent" },
      { key: "revenue", label: "Revenue", type: "money", total: true },
      { key: "commission", label: "Commission", type: "money", total: true },
      { key: "score", label: "Score", type: "number" },
      { key: "tier", label: "Status", type: "text" },
    ],
    async run(actor, f) {
      return (await agentPerformance(actor, f)).map((a) => ({ name: a.name, works: a.works, completed: a.completed, cancelled: a.cancelled, onTimeRate: Math.round(a.onTimeRate * 1000) / 10, revenue: a.revenue, commission: a.commission, score: a.score, tier: a.tier }));
    },
  },
  {
    key: "worker-performance",
    title: "Worker performance",
    description: "Assigned and completed works, rework and completion time per worker.",
    group: "People",
    perms: ["reports.view"],
    filters: ["date", "branch", "worker"],
    dateLabel: "Work date",
    columns: [
      { key: "name", label: "Worker", type: "text" },
      { key: "assigned", label: "Assigned", type: "number", total: true },
      { key: "completed", label: "Completed", type: "number", total: true },
      { key: "rejections", label: "Rework requests", type: "number", total: true },
      { key: "firstTimeRight", label: "First-time right", type: "percent" },
      { key: "avgCompletionHours", label: "Avg hours to complete", type: "number" },
      { key: "commission", label: "Commission", type: "money", total: true },
    ],
    async run(actor, f) {
      return (await workerPerformance(actor, f)).map((w) => ({ name: w.name, assigned: w.assigned, completed: w.completed, rejections: w.rejections, firstTimeRight: Math.round(w.firstTimeRight * 1000) / 10, avgCompletionHours: w.avgCompletionHours, commission: w.commission }));
    },
  },
];

export const getReport = (key: string) => REPORTS.find((r) => r.key === key);
export const canRunReport = (actor: Actor, r: ReportDef) => canAny(actor, ...r.perms);
export const reportsFor = (actor: Actor) => REPORTS.filter((r) => canRunReport(actor, r));

export function totalsOf(def: ReportDef, rows: Row[]): Row | null {
  const cols = def.columns.filter((c) => c.total);
  if (!cols.length || !rows.length) return null;
  const t: Row = { [def.columns[0].key]: "Total" };
  for (const c of cols) t[c.key] = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
  return t;
}
