import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { addDaysIso, businessToday, formatDateLabel, isIsoDate } from "@/server/lib/dates";
import { listWorks } from "@/server/modules/works/queries";

export const metadata = { title: "My works" };

export default async function WorkerHome({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const actor = await requirePortal("WORKER");
  const sp = await searchParams;
  const today = businessToday();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : today;
  const [day, open] = await Promise.all([
    listWorks(actor, { date, pageSize: 50 }),
    listWorks(actor, { status: "IN_PROGRESS", pageSize: 20 }),
  ]);
  const corrections = open.items.filter((w) => w.workDate.toISOString().slice(0, 10) !== date);
  const label = date === today ? "Today" : date === addDaysIso(today, 1) ? "Tomorrow" : formatDateLabel(date);

  return (
    <>
      <PageHeader title={`${label}'s works`} subtitle={formatDateLabel(date)} />
      <div className="mb-4 flex items-center gap-2">
        <Link className="btn-secondary px-3" href={`/worker?date=${addDaysIso(date, -1)}`} aria-label="Previous day">‹</Link>
        <form className="flex flex-1 gap-2">
          <input type="date" name="date" defaultValue={date} className="input" />
          <button className="btn-secondary">Go</button>
        </form>
        <Link className="btn-secondary px-3" href={`/worker?date=${addDaysIso(date, 1)}`} aria-label="Next day">›</Link>
      </div>
      {date !== today && <Link href="/worker" className="mb-4 inline-block text-sm text-blue-700">Back to today</Link>}

      {day.items.length === 0 ? (
        <EmptyState title={date === today ? "No works scheduled for today." : "No works on this day."} />
      ) : (
        <WorkCards items={day.items} />
      )}

      {corrections.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">In progress on other days</h2>
          <WorkCards items={corrections} />
        </div>
      )}
    </>
  );
}

function WorkCards({ items }: { items: Awaited<ReturnType<typeof listWorks>>["items"] }) {
  return (
    <ul className="space-y-2">
      {items.map((w) => (
        <li key={w.id}>
          <Link href={`/worker/works/${w.id}`} className="card block p-4 hover:border-blue-300">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{w.title || w.customer.name}</p>
                <p className="truncate text-sm text-slate-500">{w.locationAddress || "No address"}</p>
              </div>
              <StatusBadge status={w.status} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{w.reference} · {w.customer.name} · {w.branch.name}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
