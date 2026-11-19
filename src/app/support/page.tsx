import Link from "next/link";
import { PriorityLabel, TicketStatusBadge } from "@/components/support-ui";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { isManager, listCategories, listTickets, PRIORITY_LABELS, STATUS_LABELS } from "@/server/modules/support/service";

export const metadata = { title: "Tickets" };

export default async function SupportHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser();
  const sp = await searchParams;
  const manager = isManager(actor);
  const [data, categories] = await Promise.all([
    listTickets(actor, { view: (sp.view as "mine") ?? (manager ? "all" : "mine"), status: sp.status === "ALL" ? undefined : (sp.status ?? (manager ? "ACTIVE" : undefined)), priority: sp.priority, categoryId: sp.categoryId, q: sp.q, page: Number(sp.page) || 1 }),
    listCategories(),
  ]);
  const link = (extra: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ view: data.view, status: sp.status, priority: sp.priority, categoryId: sp.categoryId, q: sp.q, ...extra }).filter(([, v]) => v) as [string, string][])}`;
  const active = (["OPEN", "IN_REVIEW", "IN_PROGRESS", "WAITING_FOR_USER"] as const).reduce((a, s) => a + (data.counts[s] ?? 0), 0);

  return (
    <>
      <PageHeader
        title={manager ? "Support tickets" : "My requests"}
        subtitle={manager ? "Complaints and requests from your team." : "Raise a complaint or request and follow its progress here."}
        actions={<Link href="/support/new" className="btn-primary">+ New request</Link>}
      />
      {manager && (
        <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {([["all", "All tickets"], ["assigned", "Assigned to me"], ["mine", "Raised by me"]] as const).map(([v, l]) => (
            <Link key={v} href={link({ view: v, page: undefined })} className={`rounded-md px-3 py-1.5 ${data.view === v ? "bg-blue-600 text-white" : "text-slate-600"}`}>{l}</Link>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Link href={link({ status: "ACTIVE", page: undefined })} className={`rounded-full px-3 py-1 font-medium ${(sp.status ?? (manager ? "ACTIVE" : "")) === "ACTIVE" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Active · {active}</Link>
        {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => (
          <Link key={s} href={link({ status: s, page: undefined })} className={`rounded-full px-3 py-1 ${sp.status === s ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>{STATUS_LABELS[s]} · {data.counts[s] ?? 0}</Link>
        ))}
        <Link href={link({ status: "ALL", page: undefined })} className={`rounded-full px-3 py-1 ${sp.status === "ALL" ? "bg-slate-900 text-white" : "text-slate-500 underline"}`}>All</Link>
      </div>
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-4">
        <input type="hidden" name="view" value={data.view} />
        <input type="hidden" name="status" value={sp.status ?? (manager ? "ACTIVE" : "ALL")} />
        <input name="q" defaultValue={sp.q} placeholder="SUP-… or title" className="input" />
        <select name="priority" defaultValue={sp.priority ?? ""} className="input"><option value="">Any priority</option>{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="categoryId" defaultValue={sp.categoryId ?? ""} className="input"><option value="">Any category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No support requests found." hint={manager ? "Nothing matches these filters." : "Need help with a job, payment or the app? Raise a request."} action={<Link href="/support/new" className="btn-primary">New request</Link>} />
      ) : (
        <ul className="space-y-2">
          {data.items.map((t) => (
            <li key={t.id}>
              <Link href={`/support/${t.id}`} className="card flex flex-col gap-2 p-4 hover:border-blue-300 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.number} · {t.category.name}
                    {manager && ` · by ${t.submittedByName}`}
                    {t.assignedToName && ` · assigned to ${t.assignedToName}`}
                    {` · ${t._count.comments} repl${t._count.comments === 1 ? "y" : "ies"}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <PriorityLabel priority={t.priority} />
                  <TicketStatusBadge status={t.status} />
                  <span className="hidden text-xs text-slate-400 sm:inline">{formatDateTime(t.lastActivityAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pages={data.pages} makeHref={(p) => link({ page: String(p) })} />
    </>
  );
}
