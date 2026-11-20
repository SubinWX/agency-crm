import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { addDaysIso, businessToday, formatDateLabel, fromDbDate, isIsoDate } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { STATUS_LABELS } from "@/server/modules/works/access";
import { listWorks, WORK_SORTS } from "@/server/modules/works/queries";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Works" };

type View = "day" | "month" | "all";

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function WorksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("ADMIN", "works.view_all");
  const sp = await searchParams;
  const today = businessToday();
  const view: View = sp.view === "day" || sp.view === "all" ? sp.view : "month";
  const day = sp.date && isIsoDate(sp.date) ? sp.date : today;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const range = view === "day" ? { from: day, to: day } : view === "month" ? monthBounds(month) : { from: undefined, to: undefined };
  const sort = sp.sort && WORK_SORTS[sp.sort] ? sp.sort : view === "all" ? "date_desc" : "date_asc";

  const [data, branches, agents, workers] = await Promise.all([
    listWorks(actor, {
      q: sp.q,
      status: sp.status,
      branchId: sp.branchId,
      agentId: sp.agentId,
      workerId: sp.workerId,
      from: range.from,
      to: range.to,
      sort,
      page: Number(sp.page) || 1,
      pageSize: view === "all" ? 25 : 50,
    }),
    listAccessibleBranches(actor),
    prisma.user.findMany({ where: { deletedAt: null, role: { portal: "AGENT" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { deletedAt: null, role: { portal: "WORKER" }, ...(actor.isSuperAdmin ? {} : { branches: { some: { branchId: { in: [...actor.branchIds] } } } }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Keep filters when switching view / period / page.
  const filters = { q: sp.q, status: sp.status, branchId: sp.branchId, agentId: sp.agentId, workerId: sp.workerId, sort: sp.sort };
  const href = (extra: Record<string, string | undefined>) =>
    `/admin/works?${new URLSearchParams(Object.entries({ view, date: view === "day" ? day : undefined, month: view === "month" ? month : undefined, ...filters, ...extra }).filter(([, v]) => v) as [string, string][])}`;

  const prev = view === "day" ? href({ date: addDaysIso(day, -1), page: undefined }) : href({ month: shiftMonth(month, -1), page: undefined });
  const next = view === "day" ? href({ date: addDaysIso(day, 1), page: undefined }) : href({ month: shiftMonth(month, 1), page: undefined });
  const isCurrent = view === "day" ? day === today : month === today.slice(0, 7);

  // Month view: group rows by date.
  const groups = new Map<string, typeof data.items>();
  for (const w of data.items) {
    const k = fromDbDate(w.workDate);
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  const anyFilter = Object.values(filters).some(Boolean);

  const table = (rows: typeof data.items, showDate: boolean) => (
    <table className="min-w-full divide-y divide-slate-100">
      <thead className="bg-slate-50">
        <tr>
          <th className="table-th">Work</th>
          {showDate && <th className="table-th">Date</th>}
          <th className="table-th">Customer</th>
          <th className="table-th">Branch</th>
          <th className="table-th">Agent</th>
          <th className="table-th">Workers</th>
          <th className="table-th">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((w) => (
          <tr key={w.id} className="hover:bg-slate-50">
            <td className="table-td"><Link href={`/admin/works/${w.id}`} className="font-medium text-blue-700">{w.reference}</Link><div className="max-w-[16rem] truncate text-xs text-slate-500">{w.title || w.locationAddress}</div></td>
            {showDate && <td className="table-td whitespace-nowrap">{formatDateLabel(fromDbDate(w.workDate))}</td>}
            <td className="table-td">{w.customer.name}<div className="text-xs text-slate-500">{w.customer.phone}</div></td>
            <td className="table-td">{w.branch.name}</td>
            <td className="table-td">{w.agent?.name ?? "—"}</td>
            <td className="table-td">{w.assignments.map((a) => a.worker.name).join(", ") || <span className="text-slate-400">None</span>}</td>
            <td className="table-td"><StatusBadge status={w.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <PageHeader title="Works" subtitle={`${data.total} work${data.total === 1 ? "" : "s"}${view === "day" ? ` on ${formatDateLabel(day)}` : view === "month" ? ` in ${monthLabel(month)}` : ""}`} actions={can(actor, "works.create") ? <Link href="/admin/works/new" className="btn-primary">+ New work</Link> : null} />

      {/* View + period navigation */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {(["day", "month", "all"] as View[]).map((v) => (
            <Link key={v} href={`/admin/works?${new URLSearchParams(Object.entries({ view: v, ...filters }).filter(([, x]) => x) as [string, string][])}`} className={`rounded-md px-4 py-1.5 ${view === v ? "bg-blue-600 font-medium text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {v === "day" ? "Day" : v === "month" ? "Month" : "All"}
            </Link>
          ))}
        </div>
        {view !== "all" && (
          <div className="flex items-center gap-2">
            <Link href={prev} className="btn-secondary px-2.5" aria-label={view === "day" ? "Previous day" : "Previous month"}><ChevronLeft className="h-4 w-4" /></Link>
            <span className="min-w-48 text-center text-sm font-semibold">{view === "day" ? dayLabel(day) : monthLabel(month)}</span>
            <Link href={next} className="btn-secondary px-2.5" aria-label={view === "day" ? "Next day" : "Next month"}><ChevronRight className="h-4 w-4" /></Link>
            {!isCurrent && <Link href={view === "day" ? href({ date: today, page: undefined }) : href({ month: today.slice(0, 7), page: undefined })} className="btn-secondary">{view === "day" ? "Today" : "This month"}</Link>}
            {view === "day" ? (
              <form className="flex gap-1" action="/admin/works">
                <input type="hidden" name="view" value="day" />
                {Object.entries(filters).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
                <input type="date" name="date" defaultValue={day} className="input w-40" aria-label="Go to date" />
                <button className="btn-secondary">Go</button>
              </form>
            ) : (
              <form className="flex gap-1" action="/admin/works">
                <input type="hidden" name="view" value="month" />
                {Object.entries(filters).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
                <input type="month" name="month" defaultValue={month} className="input w-40" aria-label="Go to month" />
                <button className="btn-secondary">Go</button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <input type="hidden" name="view" value={view} />
        {view === "day" && <input type="hidden" name="date" value={day} />}
        {view === "month" && <input type="hidden" name="month" value={month} />}
        <input name="q" defaultValue={sp.q} placeholder="WRK, customer, phone, address" className="input xl:col-span-2" />
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="branchId" defaultValue={sp.branchId ?? ""} className="input" aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select name="agentId" defaultValue={sp.agentId ?? ""} className="input" aria-label="Agent">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select name="workerId" defaultValue={sp.workerId ?? ""} className="input" aria-label="Worker">
          <option value="">All workers</option>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select name="sort" defaultValue={sort} className="input" aria-label="Sort by">
          {Object.entries(WORK_SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}
        </select>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-7 xl:justify-end">
          <button className="btn-primary">Apply filters</button>
          {anyFilter && <Link href={`/admin/works?view=${view}${view === "day" ? `&date=${day}` : view === "month" ? `&month=${month}` : ""}`} className="btn-secondary">Clear filters</Link>}
        </div>
      </form>

      {data.items.length === 0 ? (
        <EmptyState
          title={view === "day" ? "No works scheduled for this day." : view === "month" ? "No works in this month." : "No works found."}
          hint={anyFilter ? "Try clearing the filters." : view !== "all" ? "Use ‹ › to look at other dates." : undefined}
        />
      ) : view === "month" && sort.startsWith("date") ? (
        <div className="space-y-4">
          {[...groups.entries()].map(([d, rows]) => (
            <section key={d} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
                <Link href={href({ view: "day", date: d, month: undefined, page: undefined })} className={`text-sm font-semibold hover:text-blue-700 ${d === today ? "text-blue-700" : "text-slate-800"}`}>
                  {dayLabel(d)}{d === today ? " · Today" : ""}
                </Link>
                <span className="text-xs text-slate-500">{rows.length} work{rows.length === 1 ? "" : "s"}</span>
              </div>
              <div className="overflow-x-auto">{table(rows, false)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">{table(data.items, view !== "day")}</div>
      )}
      <Pagination page={data.page} pages={data.pages} makeHref={(p) => href({ page: String(p) })} />
    </>
  );
}
