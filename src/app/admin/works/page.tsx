import Link from "next/link";
import { EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { STATUS_LABELS } from "@/server/modules/works/access";
import { listWorks } from "@/server/modules/works/queries";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Works" };

export default async function WorksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("ADMIN", "works.view_all");
  const sp = await searchParams;
  const [data, branches] = await Promise.all([
    listWorks(actor, { q: sp.q, status: sp.status, date: sp.date, from: sp.from, to: sp.to, branchId: sp.branchId, page: Number(sp.page) || 1 }),
    listAccessibleBranches(actor),
  ]);
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/admin/works?${u}`;
  };
  return (
    <>
      <PageHeader title="Works" subtitle={`${data.total} result(s)`} actions={can(actor, "works.create") ? <Link href="/admin/works/new" className="btn-primary">+ New work</Link> : null} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-6">
        <input name="q" defaultValue={sp.q} placeholder="WRK, customer, phone, address" className="input sm:col-span-2" />
        <select name="status" defaultValue={sp.status ?? ""} className="input">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="branchId" defaultValue={sp.branchId ?? ""} className="input">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" name="date" defaultValue={sp.date} className="input" aria-label="Work date" />
        <div className="flex gap-2">
          <button className="btn-primary flex-1">Filter</button>
          <Link href="/admin/works" className="btn-secondary">Clear</Link>
        </div>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No works found." hint="Try changing the filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Work</th><th className="table-th">Date</th><th className="table-th">Customer</th>
                <th className="table-th">Branch</th><th className="table-th">Agent</th><th className="table-th">Workers</th><th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="table-td"><Link href={`/admin/works/${w.id}`} className="font-medium text-blue-700">{w.reference}</Link><div className="max-w-[16rem] truncate text-xs text-slate-500">{w.title || w.locationAddress}</div></td>
                  <td className="table-td whitespace-nowrap">{formatDateLabel(fromDbDate(w.workDate))}</td>
                  <td className="table-td">{w.customer.name}<div className="text-xs text-slate-500">{w.customer.phone}</div></td>
                  <td className="table-td">{w.branch.name}</td>
                  <td className="table-td">{w.agent?.name ?? "—"}</td>
                  <td className="table-td">{w.assignments.map((a) => a.worker.name).join(", ") || <span className="text-slate-400">None</span>}</td>
                  <td className="table-td"><StatusBadge status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pages={data.pages} makeHref={qs} />
    </>
  );
}
