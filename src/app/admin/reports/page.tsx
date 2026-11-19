import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { addDaysIso, businessToday } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { canRunReport, getReport, reportsFor, totalsOf, type Filters } from "@/server/modules/reports/definitions";
import { formatCell } from "@/server/modules/reports/export";
import { STATUS_LABELS } from "@/server/modules/works/access";

export const metadata = { title: "Reports" };

const FILTER_KEYS = ["from", "to", "branchId", "agentId", "workerId", "customerId", "workStatus", "paymentStatus", "itemId", "categoryId"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePortal("ADMIN");
  const available = reportsFor(actor);
  if (available.length === 0) redirect("/admin?denied=1");
  const sp = await searchParams;
  const def = getReport(sp.report ?? "") ?? available[0];
  if (!canRunReport(actor, def)) redirect("/admin/reports");
  const today = businessToday();
  const f: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp[k] || undefined]));
  if (def.filters.includes("date")) {
    f.from ??= addDaysIso(today, -30);
    f.to ??= today;
  }
  let rows: Awaited<ReturnType<typeof def.run>> = [];
  let error: string | null = null;
  try {
    rows = await def.run(actor, f);
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }
  const totals = totalsOf(def, rows);
  const [branches, agents, workers, customers, items, categories] = await Promise.all([
    listAccessibleBranches(actor),
    def.filters.includes("agent") ? prisma.user.findMany({ where: { deletedAt: null, role: { portal: "AGENT" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    def.filters.includes("worker") ? prisma.user.findMany({ where: { deletedAt: null, role: { portal: "WORKER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    def.filters.includes("customer") ? prisma.customer.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : [],
    def.filters.includes("item") ? prisma.item.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : [],
    def.filters.includes("expenseCategory") ? prisma.expenseCategory.findMany({ orderBy: { name: "asc" } }) : [],
  ]);
  const exportQs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const groups = [...new Set(available.map((r) => r.group))];
  const sel = (name: string, label: string, opts: { id: string; name: string }[]) => (
    <div>
      <label className="label">{label}</label>
      <select name={name} defaultValue={(f as Record<string, string | undefined>)[name] ?? ""} className="input">
        <option value="">All</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <PageHeader title="Reports" subtitle="Filter, view and export to Excel (CSV) or PDF." actions={<Link href="/admin/analytics" className="btn-secondary">Graphs</Link>} />
      <div className="grid gap-5 lg:grid-cols-4">
        <nav className="card h-fit p-2">
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              {available.filter((r) => r.group === g).map((r) => (
                <Link key={r.key} href={`?report=${r.key}`} className={`block rounded-lg px-3 py-1.5 text-sm ${r.key === def.key ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>{r.title}</Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-4 lg:col-span-3">
          <div>
            <h2 className="text-lg font-semibold">{def.title}</h2>
            <p className="text-sm text-slate-500">{def.description}</p>
          </div>
          <form className="card grid gap-2 p-3 sm:grid-cols-4">
            <input type="hidden" name="report" value={def.key} />
            {def.filters.includes("date") && (
              <>
                <div><label className="label">{def.dateLabel ?? "Date"} from</label><input type="date" name="from" defaultValue={f.from} className="input" /></div>
                <div><label className="label">to</label><input type="date" name="to" defaultValue={f.to} className="input" /></div>
              </>
            )}
            {def.filters.includes("branch") && sel("branchId", "Branch", branches)}
            {def.filters.includes("agent") && sel("agentId", "Agent", agents)}
            {def.filters.includes("worker") && sel("workerId", "Worker", workers)}
            {def.filters.includes("customer") && sel("customerId", "Customer", customers)}
            {def.filters.includes("item") && sel("itemId", "Product / material", items)}
            {def.filters.includes("expenseCategory") && sel("categoryId", "Expense category", categories)}
            {def.filters.includes("workStatus") && sel("workStatus", "Work status", Object.entries(STATUS_LABELS).map(([id, name]) => ({ id, name })))}
            {def.filters.includes("paymentStatus") && sel("paymentStatus", "Payment status", [{ id: "ISSUED", name: "Unpaid" }, { id: "PARTIALLY_PAID", name: "Partially paid" }, { id: "PAID", name: "Paid" }, { id: "CANCELLED", name: "Cancelled" }])}
            <div className="flex items-end gap-2 sm:col-span-4">
              <button className="btn-primary">Run report</button>
              <a className="btn-secondary" href={`/api/reports/${def.key}?${exportQs}&format=csv`}>Excel (CSV)</a>
              <a className="btn-secondary" href={`/api/reports/${def.key}?${exportQs}&format=pdf`}>PDF</a>
              <span className="ml-auto self-center text-xs text-slate-500">{rows.length} row{rows.length === 1 ? "" : "s"}{rows.length >= 5000 ? " (limit reached — narrow the filters)" : ""}</span>
            </div>
          </form>
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : rows.length === 0 ? (
            <EmptyState title="No data for these filters." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>{def.columns.map((c) => <th key={c.key} className={`table-th ${c.type === "text" || c.type === "date" ? "" : "text-right"}`}>{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i}>
                      {def.columns.map((c) => <td key={c.key} className={`table-td ${c.type === "text" || c.type === "date" ? "" : "text-right tabular-nums"} ${c.type === "money" && Number(r[c.key]) < 0 ? "text-red-600" : ""}`}>{formatCell(c, r[c.key] ?? null)}</td>)}
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-slate-50 font-semibold">
                    <tr>{def.columns.map((c) => <td key={c.key} className={`table-td ${c.type === "text" || c.type === "date" ? "" : "text-right tabular-nums"}`}>{formatCell(c, totals[c.key] ?? null)}</td>)}</tr>
                  </tfoot>
                )}
              </table>
              {rows.length > 500 && <p className="p-3 text-xs text-slate-500">Showing the first 500 rows on screen — exports include all {rows.length}.</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
