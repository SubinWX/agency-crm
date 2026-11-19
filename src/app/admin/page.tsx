import Link from "next/link";
import { EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { addDaysIso, formatDateLabel } from "@/server/lib/dates";
import { getAvailability } from "@/server/modules/capacity/service";
import { STATUS_LABELS } from "@/server/modules/works/access";
import { dashboardStats, listWorks } from "@/server/modules/works/queries";
import { can, canAny } from "@/server/rbac/actor";
import { prisma } from "@/server/db";
import { toDbDate } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { canViewBilling, invoiceAccessWhere } from "@/server/modules/billing/invoices";
import { lowStock } from "@/server/modules/inventory/stock";
import { openTicketCount, isManager } from "@/server/modules/support/service";
import { formatQty } from "@/server/modules/inventory/qty";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requirePortal("ADMIN");
  const { denied } = await searchParams;
  const stats = await dashboardStats(actor);
  const [todayWorks, week] = await Promise.all([
    listWorks(actor, { date: stats.today, pageSize: 10 }),
    getAvailability(stats.today, addDaysIso(stats.today, 6)),
  ]);
  const monthStart = toDbDate(stats.today.slice(0, 8) + "01");
  const showMoney = canViewBilling(actor);
  const showExpenses = canAny(actor, "expenses.view", "expenses.manage");
  const [invoiced, received, outstanding, spent] = await Promise.all([
    showMoney ? prisma.invoice.aggregate({ where: { AND: [invoiceAccessWhere(actor), { status: { not: "CANCELLED" }, invoiceDate: { gte: monthStart } }] }, _sum: { grandTotal: true } }) : null,
    showMoney ? prisma.payment.aggregate({ where: { voidedAt: null, paidOn: { gte: monthStart }, invoice: invoiceAccessWhere(actor) }, _sum: { amount: true } }) : null,
    showMoney ? prisma.invoice.aggregate({ where: { AND: [invoiceAccessWhere(actor), { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }] }, _sum: { balanceDue: true } }) : null,
    showExpenses
      ? prisma.expense.aggregate({ where: { status: "ACTIVE", spentOn: { gte: monthStart }, ...(actor.isSuperAdmin ? {} : { OR: [{ branchId: null }, { branchId: { in: [...actor.branchIds] } }] }) }, _sum: { amount: true } })
      : null,
  ]);
  const low = await lowStock(actor, 8);
  const openTickets = await openTicketCount(actor);
  const inr = (v: { toString(): string } | null | undefined) => formatINR(toPaise(v?.toString() ?? "0"));
  const receivedP = toPaise(received?._sum.amount?.toString() ?? "0");
  const spentP = toPaise(spent?._sum.amount?.toString() ?? "0");

  return (
    <>
      {denied && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">You don&apos;t have permission to open that page.</div>}
      <PageHeader
        title={`Hello, ${actor.name.split(" ")[0]}`}
        subtitle={formatDateLabel(stats.today)}
        actions={can(actor, "works.create") ? <Link href="/admin/works/new" className="btn-primary">+ New work</Link> : null}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's works" value={stats.todayCount} href={`/admin/works?date=${stats.today}`} tone="blue" />
        <Stat label="Next 7 days" value={stats.upcoming} href="/admin/calendar" />
        <Stat label="Pending approval" value={stats.pending} href="/admin/approvals" tone="orange" />
        <Stat label="Approved this month" value={stats.completedMonth} tone="emerald" />
      </div>

      {(showMoney || showExpenses) && (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {showMoney && <Stat label="Invoiced this month" value={inr(invoiced?._sum.grandTotal)} href="/admin/invoices" />}
          {showMoney && <Stat label="Received this month" value={inr(received?._sum.amount)} href="/admin/payments" tone="emerald" />}
          {showMoney && <Stat label="Outstanding" value={inr(outstanding?._sum.balanceDue)} href="/admin/invoices?status=PARTIALLY_PAID" tone="orange" />}
          {isManager(actor) && <Stat label="Open support requests" value={openTickets} href="/support" tone={openTickets ? "orange" : "slate"} />}
          {showExpenses && <Stat label={showMoney ? "Cash in − expenses (month)" : "Expenses this month"} value={showMoney ? formatINR(receivedP - spentP) : inr(spent?._sum.amount)} href="/admin/expenses" tone={receivedP - spentP < 0 ? "orange" : "blue"} />}
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold">Today</h2>
            <Link href={`/admin/works?date=${stats.today}`} className="text-sm text-blue-700">View all</Link>
          </div>
          {todayWorks.items.length === 0 ? (
            <div className="p-5"><EmptyState title="No works scheduled for today." /></div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todayWorks.items.map((w) => (
                <li key={w.id}>
                  <Link href={`/admin/works/${w.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{w.reference} · {w.customer.name}</p>
                      <p className="truncate text-xs text-slate-500">{w.assignments.map((a) => a.worker.name).join(", ") || "No workers assigned"} · {w.branch.name}</p>
                    </div>
                    <StatusBadge status={w.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold">Capacity — next 7 days</h2></div>
          <ul className="divide-y divide-slate-100">
            {week.map((d) => (
              <li key={d.date} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span>{formatDateLabel(d.date)}</span>
                <span className={d.status === "full" ? "font-semibold text-red-600" : d.status === "blocked" ? "text-slate-400" : "text-slate-700"}>
                  {d.status === "blocked" ? "Closed" : `${d.booked}/${d.capacity}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {low.length > 0 && (
        <section className="card mt-5 border-orange-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-orange-700">Low stock</h2>
            <Link href="/admin/inventory?low=1" className="text-sm text-blue-700">View inventory</Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {low.map((r) => (
              <li key={`${r.itemId}-${r.branch}`}>
                <Link href={`/admin/inventory/items/${r.itemId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
                  <span className="truncate">{r.name} <span className="text-xs text-slate-400">{r.code} · {r.branch}</span></span>
                  <span className="whitespace-nowrap font-medium text-orange-700">{formatQty(r.quantity, r.unit)} <span className="text-xs font-normal text-slate-400">/ {formatQty(r.threshold)}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card mt-5 p-5">
        <h2 className="mb-3 text-sm font-semibold">Works by status</h2>
        <div className="flex flex-wrap gap-2">
          {stats.byStatus.length === 0 && <p className="text-sm text-slate-500">No works yet.</p>}
          {stats.byStatus.map((s) => (
            <Link key={s.status} href={`/admin/works?status=${s.status}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              {STATUS_LABELS[s.status]} <strong className="ml-1">{s._count._all}</strong>
            </Link>
          ))}
        </div>
      </section>
      <p className="mt-6 text-xs text-slate-400">Reports and graphs arrive with Phase 6.</p>
    </>
  );
}
