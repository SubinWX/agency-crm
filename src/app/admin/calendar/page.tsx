import Link from "next/link";
import { blockDateAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { addDaysIso, businessToday, formatDateLabel, fromDbDate, isIsoDate, toDbDate } from "@/server/lib/dates";
import { getAvailability } from "@/server/modules/capacity/service";
import { workAccessWhere } from "@/server/modules/works/access";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Calendar" };

type View = "month" | "week" | "day";

function monthBounds(iso: string) {
  const start = iso.slice(0, 8) + "01";
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return [start, d.toISOString().slice(0, 10)] as const;
}
function weekStart(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDaysIso(iso, -((d.getUTCDay() + 6) % 7));
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "calendar.view");
  const sp = await searchParams;
  const view: View = sp.view === "week" || sp.view === "day" ? sp.view : "month";
  const today = businessToday();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : today;

  const [from, to] = view === "month" ? monthBounds(date) : view === "week" ? [weekStart(date), addDaysIso(weekStart(date), 6)] : [date, date];
  // Availability counts are company-wide; the work list below respects branch access.
  const [days, works] = await Promise.all([
    getAvailability(from, to),
    prisma.work.findMany({
      where: { AND: [workAccessWhere(actor), { workDate: { gte: toDbDate(from), lte: toDbDate(to) }, status: { not: "CANCELLED" } }] },
      select: { id: true, reference: true, workDate: true, status: true, title: true, customer: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: [{ workDate: "asc" }, { reference: "asc" }],
      take: 500,
    }),
  ]);
  const holidays = await prisma.workDay.findMany({ where: { isBlocked: true, date: { gte: toDbDate(today) } }, orderBy: { date: "asc" }, take: 30 });
  const worksByDate = new Map<string, typeof works>();
  for (const w of works) {
    const k = fromDbDate(w.workDate);
    worksByDate.set(k, [...(worksByDate.get(k) ?? []), w]);
  }
  const step = view === "month" ? 30 : view === "week" ? 7 : 1;
  const prev = view === "month" ? monthBounds(addDaysIso(from, -1))[0] : addDaysIso(from, -step);
  const next = view === "month" ? addDaysIso(to, 1) : addDaysIso(from, step);
  const href = (v: View, d: string) => `/admin/calendar?view=${v}&date=${d}`;
  const title =
    view === "month"
      ? new Date(`${from}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
      : view === "week"
        ? `${formatDateLabel(from)} – ${formatDateLabel(to)}`
        : formatDateLabel(from);

  return (
    <>
      <PageHeader title="Calendar" subtitle="Capacity is shared by all branches." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link className="btn-secondary px-3" href={href(view, prev)}>‹</Link>
          <Link className="btn-secondary" href={href(view, today)}>Today</Link>
          <Link className="btn-secondary px-3" href={href(view, next)}>›</Link>
          <span className="ml-2 font-semibold">{title}</span>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {(["month", "week", "day"] as View[]).map((v) => (
            <Link key={v} href={href(v, date)} className={`rounded-md px-3 py-1 capitalize ${v === view ? "bg-blue-600 text-white" : "text-slate-600"}`}>{v}</Link>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-xs font-medium text-slate-500">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7 }).map((_, i) => <div key={i} className="min-h-20 border-b border-r border-slate-100 bg-slate-50/50" />)}
            {days.map((d) => (
              <Link key={d.date} href={href("day", d.date)} className={`min-h-20 border-b border-r border-slate-100 p-1.5 text-xs hover:bg-blue-50 sm:min-h-24 ${d.date === today ? "bg-blue-50/60" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${d.status === "past" ? "text-slate-400" : ""}`}>{Number(d.date.slice(8))}</span>
                  <span className={`rounded px-1 ${d.status === "full" ? "bg-red-100 text-red-700" : d.status === "blocked" ? "bg-slate-200 text-slate-600" : "text-slate-500"}`}>
                    {d.status === "blocked" ? "Closed" : d.status === "full" ? "Full" : `${d.booked}/${d.capacity}`}
                  </span>
                </div>
                <div className="mt-1 hidden space-y-0.5 sm:block">
                  {(worksByDate.get(d.date) ?? []).slice(0, 3).map((w) => <p key={w.id} className="truncate text-slate-600">{w.reference}</p>)}
                  {(worksByDate.get(d.date)?.length ?? 0) > 3 && <p className="text-slate-400">+{worksByDate.get(d.date)!.length - 3} more</p>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <Card
              key={d.date}
              title={`${formatDateLabel(d.date)}`}
              actions={
                <span className={`text-xs font-medium ${d.status === "full" ? "text-red-600" : "text-slate-500"}`}>
                  {d.status === "blocked" ? `Closed — ${d.blockReason}` : `${d.booked} booked · ${d.remaining} of ${d.capacity} left`}
                </span>
              }
            >
              {(worksByDate.get(d.date) ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No works scheduled.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {worksByDate.get(d.date)!.map((w) => (
                    <li key={w.id}>
                      <Link href={`/admin/works/${w.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-blue-700">
                        <span className="truncate">{w.reference} · {w.customer.name} · <span className="text-slate-500">{w.branch.name}</span></span>
                        <StatusBadge status={w.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card title="Holidays & closed dates" className="mt-6 max-w-xl">
        {holidays.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming closed dates.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {holidays.map((h) => (
              <li key={fromDbDate(h.date)} className="flex justify-between py-1.5"><Link className="text-blue-700" href={href("day", fromDbDate(h.date))}>{formatDateLabel(fromDbDate(h.date))}</Link><span className="text-slate-600">{h.blockReason}</span></li>
            ))}
          </ul>
        )}
      </Card>

      {can(actor, "capacity.manage") && (
        <Card title="Block / unblock a date (holidays)" className="mt-6 max-w-xl">
          <ActionForm action={blockDateAction} className="grid gap-2 sm:grid-cols-2">
            <input type="date" name="date" required min={today} defaultValue={view === "day" ? date : undefined} className="input" />
            <select name="mode" className="input">
              <option value="block">Block date</option>
              <option value="unblock">Unblock date</option>
            </select>
            <input name="reason" className="input sm:col-span-2" placeholder="Reason (required to block), e.g. Onam holiday" />
            <SubmitButton className="btn-secondary sm:col-span-2">Update calendar</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
