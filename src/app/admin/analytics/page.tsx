import Link from "next/link";
import { BarsChart, RankedBars, TrendChart } from "@/components/charts";
import { Card, PageHeader, Stat } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { addDaysIso, businessToday, isIsoDate } from "@/server/lib/dates";
import { agentPerformance, branchPerformance, inventoryMovementByMonth, monthlyFinance, workerPerformance, worksByStatus, worksPerDay } from "@/server/modules/analytics/service";
import { formatINR } from "@/server/modules/billing/calc";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { STATUS_LABELS } from "@/server/modules/works/access";

export const metadata = { title: "Analytics" };

const TIER_STYLE: Record<string, string> = { Gold: "bg-amber-100 text-amber-900", Silver: "bg-slate-200 text-slate-800", Bronze: "bg-orange-100 text-orange-900", "Needs attention": "bg-red-100 text-red-800", New: "bg-sky-100 text-sky-800" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; branchId?: string; range?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "reports.view");
  const sp = await searchParams;
  const today = businessToday();
  const presets: Record<string, number> = { "30d": 30, "90d": 90, "12m": 365 };
  const preset = sp.range && presets[sp.range] ? sp.range : !sp.from ? "12m" : null;
  const to = preset ? today : sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = preset ? addDaysIso(today, -presets[preset]) : sp.from && isIsoDate(sp.from) ? sp.from : addDaysIso(today, -365);
  const r = { from, to, branchId: sp.branchId || undefined };
  // Works-per-day looks forward too (bookings), capped at 60 days from today.
  const [branches, finance, perDay, byStatus, branchesPerf, agents, workers, stock] = await Promise.all([
    listAccessibleBranches(actor),
    monthlyFinance(actor, r),
    worksPerDay(actor, { ...r, from: addDaysIso(today, -30), to: addDaysIso(today, 30) }),
    // Include works already booked ahead when the period ends today.
    worksByStatus(actor, { ...r, to: to === today ? addDaysIso(today, 60) : to }),
    branchPerformance(actor, r),
    agentPerformance(actor, r),
    workerPerformance(actor, r),
    inventoryMovementByMonth(actor, r),
  ]);
  const sum = (k: "revenue" | "received" | "net" | "expenses" | "salaries" | "commissions" | "materials") => finance.reduce((a, m) => a + m[k], 0);
  const costs = sum("expenses") + sum("salaries") + sum("commissions") + sum("materials");
  const q = (extra: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ branchId: sp.branchId, ...extra }).filter(([, v]) => v) as [string, string][])}`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Revenue excludes GST. Profit = revenue − expenses − salaries − approved commission − materials used." actions={<Link href="/admin/reports" className="btn-secondary">Reports & exports</Link>} />

      <form className="card mb-5 flex flex-wrap items-end gap-2 p-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
          {Object.keys(presets).map((p) => (
            <Link key={p} href={q({ range: p })} className={`rounded-md px-3 py-1.5 ${preset === p ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{p === "12m" ? "12 months" : p === "90d" ? "90 days" : "30 days"}</Link>
          ))}
        </div>
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <div>
          <label className="label">Branch</label>
          <select name="branchId" defaultValue={sp.branchId ?? ""} className="input">
            <option value="">All my branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue (excl. GST)" value={formatINR(sum("revenue"))} tone="blue" />
        <Stat label="Cash received" value={formatINR(sum("received"))} tone="emerald" />
        <Stat label="All costs" value={formatINR(costs)} />
        <Stat label="Net profit" value={formatINR(sum("net"))} tone={sum("net") < 0 ? "orange" : "emerald"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Monthly revenue, costs and profit">
          <BarsChart
            rows={finance.map((m) => ({ month: m.month, revenue: m.revenue, costs: m.expenses + m.salaries + m.commissions + m.materials, net: m.net }))}
            xKey="month"
            xLabel="Month"
            xFormat="month"
            series={[{ key: "revenue", label: "Revenue" }, { key: "costs", label: "Costs" }, { key: "net", label: "Profit / loss", kind: "line" }]}
          />
        </Card>
        <Card title="Works per day (last 30 days → next 30 days)">
          <TrendChart rows={perDay} xKey="date" yKey="works" label="Works" xFormat="day" />
        </Card>
        <Card title={`Works by status${to === today ? " (incl. next 60 days)" : ""}`}>
          <RankedBars label="Works" rows={byStatus.sort((a, b) => b.count - a.count).map((s) => ({ name: STATUS_LABELS[s.status], value: s.count }))} />
        </Card>
        <Card title="Branch performance">
          <BarsChart rows={branchesPerf.map((b) => ({ name: b.name, revenue: b.revenue, costs: b.expenses }))} xKey="name" xLabel="Branch" series={[{ key: "revenue", label: "Revenue" }, { key: "costs", label: "Costs" }]} />
        </Card>
        <Card title="Inventory movement (value)">
          <BarsChart rows={stock} xKey="month" xLabel="Month" xFormat="month" series={[{ key: "stockIn", label: "Stock in" }, { key: "stockOut", label: "Used / damaged" }]} />
        </Card>
        <Card title="Agent performance">
          {agents.length === 0 ? <p className="text-sm text-slate-500">No agent works in this period.</p> : (
            <>
              <BarsChart rows={agents.slice(0, 8).map((a) => ({ name: a.name.split(" ")[0], revenue: a.revenue }))} xKey="name" xLabel="Agent" series={[{ key: "revenue", label: "Revenue" }]} height={180} />
              <div className="-mx-4 mt-2 overflow-x-auto sm:-mx-5">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50"><tr><th className="table-th">Agent</th><th className="table-th text-right">Works</th><th className="table-th text-right">Done</th><th className="table-th text-right">On time</th><th className="table-th text-right">Score</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {agents.map((a) => (
                      <tr key={a.agentId}>
                        <td className="table-td">{a.name}</td>
                        <td className="table-td text-right">{a.works}</td>
                        <td className="table-td text-right">{a.completed}</td>
                        <td className="table-td text-right">{a.completed ? pct(a.onTimeRate) : "—"}</td>
                        <td className="table-td text-right"><span className="mr-2 font-semibold">{a.score ?? "—"}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TIER_STYLE[a.tier]}`}>{a.tier}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
        <Card title="Worker performance" className="xl:col-span-2">
          {workers.length === 0 ? <p className="text-sm text-slate-500">No assignments in this period.</p> : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="table-th">Worker</th><th className="table-th text-right">Assigned</th><th className="table-th text-right">Completed</th><th className="table-th text-right">Rework requests</th><th className="table-th text-right">First-time right</th><th className="table-th text-right">Avg hours to complete</th><th className="table-th text-right">Commission</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {workers.map((w) => (
                    <tr key={w.workerId}>
                      <td className="table-td">{w.name}</td>
                      <td className="table-td text-right">{w.assigned}</td>
                      <td className="table-td text-right">{w.completed}</td>
                      <td className={`table-td text-right ${w.rejections ? "text-orange-700" : ""}`}>{w.rejections}</td>
                      <td className="table-td text-right">{w.completed ? pct(w.firstTimeRight) : "—"}</td>
                      <td className="table-td text-right">{w.avgCompletionHours ?? "—"}</td>
                      <td className="table-td text-right">{formatINR(w.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
