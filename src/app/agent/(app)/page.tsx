import Link from "next/link";
import { EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { STATUS_LABELS } from "@/server/modules/works/access";
import { listWorks } from "@/server/modules/works/queries";

export const metadata = { title: "My works" };

export default async function AgentHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePortal("AGENT");
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const data = await listWorks(actor, { q: sp.q, status: sp.status, page });
  return (
    <>
      <PageHeader title="My works" subtitle={`${data.total} work(s)`} actions={<Link className="btn-primary" href="/agent/works/new">+ New work</Link>} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search customer, phone, WRK-…" className="input" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-40">
          <option value="">All</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-secondary">Go</button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No works yet." hint="Add your first work — pick a customer, enter details and choose an available date." action={<Link className="btn-primary" href="/agent/works/new">Add work</Link>} />
      ) : (
        <ul className="space-y-2">
          {data.items.map((w) => (
            <li key={w.id}>
              <Link href={`/agent/works/${w.id}`} className="card block p-4 hover:border-blue-300">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{w.customer.name}</p>
                    <p className="truncate text-sm text-slate-500">{w.reference} · {w.title || w.locationAddress || "—"}</p>
                  </div>
                  <StatusBadge status={w.status} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{formatDateLabel(fromDbDate(w.workDate))} · {w.branch.name}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pages={data.pages} makeHref={(p) => `/agent?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${sp.status ? `&status=${sp.status}` : ""}`} />
    </>
  );
}
