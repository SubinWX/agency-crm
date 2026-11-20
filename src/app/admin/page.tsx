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
import { openTicketCount, isManager, listTickets } from "@/server/modules/support/service";
import { PriorityLabel } from "@/components/support-ui";
import { AlertTriangle, ClipboardCheck, LifeBuoy, PackageMinus, ReceiptText } from "lucide-react";
import { formatQty } from "@/server/modules/inventory/qty";
import { canViewInventory } from "@/server/modules/inventory/catalog";

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
  const manager = isManager(actor);
  const canApprove = can(actor, "works.approve");
  const [low, openTickets, pendingList, overdue, tickets] = await Promise.all([
    lowStock(actor, 6),
    openTicketCount(actor),
    canApprove ? listWorks(actor, { status: "PENDING_APPROVAL", pageSize: 5, sort: "updated" }) : null,
    showMoney
      ? prisma.invoice.findMany({
          where: { AND: [invoiceAccessWhere(actor), { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: toDbDate(stats.today) } }] },
          orderBy: { dueDate: "asc" },
          take: 6,
          select: { id: true, number: true, dueDate: true, balanceDue: true, customer: { select: { name: true } } },
        })
      : [],
    manager ? listTickets(actor, { view: "all", status: "ACTIVE" }) : null,
  ]);
  const overdueCount = showMoney ? await prisma.invoice.count({ where: { AND: [invoiceAccessWhere(actor), { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: toDbDate(stats.today) } }] } }) : 0;
  const daysLate = (d: Date) => Math.round((toDbDate(stats.today).getTime() - d.getTime()) / 86_400_000);
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
              <li key={d.date} className="px-5 py-2.5 text-sm">
                <Link href={`/admin/works?view=day&date=${d.date}`} className="block">
                  <div className="flex items-center justify-between">
                    <span className={d.date === stats.today ? "font-semibold text-blue-700" : ""}>{formatDateLabel(d.date)}{d.date === stats.today ? " · Today" : ""}</span>
                    <span className={d.status === "full" ? "font-semibold text-red-600" : d.status === "blocked" ? "text-slate-400" : "text-slate-700"}>
                      {d.status === "blocked" ? "Closed" : `${d.booked}/${d.capacity}`}
                    </span>
                  </div>
                  {d.status !== "blocked" && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${d.status === "full" ? "bg-red-500" : d.booked / Math.max(1, d.capacity) >= 0.7 ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${Math.min(100, Math.round((d.booked / Math.max(1, d.capacity)) * 100))}%` }} />
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <h2 className="mb-3 mt-8 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><AlertTriangle className="h-4 w-4" /> Needs attention</h2>
      <div className="grid gap-5 md:grid-cols-2">
        {pendingList && (
          <AttentionCard icon={<ClipboardCheck className="h-4 w-4" />} title="Waiting for approval" count={stats.pending} href="/admin/approvals" empty="No completed works waiting.">
            {pendingList.items.map((w) => (
              <Row key={w.id} href={`/admin/works/${w.id}`} left={<>{w.reference} · {w.customer.name}</>} sub={w.assignments.map((a) => a.worker.name).join(", ") || w.branch.name} right={<StatusBadge status={w.status} />} />
            ))}
          </AttentionCard>
        )}
        {showMoney && (
          <AttentionCard icon={<ReceiptText className="h-4 w-4" />} title="Overdue invoices" count={overdueCount} href="/admin/invoices?status=OVERDUE" empty="No overdue invoices." tone="red">
            {overdue.map((i) => (
              <Row key={i.id} href={`/admin/invoices/${i.id}`} left={<>{i.number} · {i.customer.name}</>} sub={i.dueDate ? `Due ${formatDateLabel(i.dueDate.toISOString().slice(0, 10))} · ${daysLate(i.dueDate)} day${daysLate(i.dueDate) === 1 ? "" : "s"} late` : ""} right={<span className="font-semibold text-red-600">{inr(i.balanceDue)}</span>} />
            ))}
          </AttentionCard>
        )}
        {tickets && (
          <AttentionCard icon={<LifeBuoy className="h-4 w-4" />} title="Open support requests" count={openTickets} href="/support" empty="No open requests.">
            {tickets.items.slice(0, 5).map((t) => (
              <Row key={t.id} href={`/support/${t.id}`} left={t.title} sub={`${t.number} · ${t.submittedByName}`} right={<PriorityLabel priority={t.priority} />} />
            ))}
          </AttentionCard>
        )}
        {canViewInventory(actor) && (
          <AttentionCard icon={<PackageMinus className="h-4 w-4" />} title="Low stock" count={low.length} href="/admin/inventory?low=1" empty="Stock levels are fine." tone="orange">
            {low.map((r) => (
              <Row key={`${r.itemId}-${r.branch}`} href={`/admin/inventory/items/${r.itemId}`} left={r.name} sub={`${r.code} · ${r.branch}`} right={<span className="whitespace-nowrap font-medium text-orange-700">{formatQty(r.quantity, r.unit)} <span className="text-xs font-normal text-slate-400">/ {formatQty(r.threshold)}</span></span>} />
            ))}
          </AttentionCard>
        )}
      </div>

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
      {can(actor, "reports.view") && <p className="mt-6 text-sm text-slate-500">More numbers and graphs: <Link href="/admin/analytics" className="text-blue-700">Insights →</Link></p>}
    </>
  );
}

function AttentionCard({ icon, title, count, href, empty, tone = "blue", children }: { icon: React.ReactNode; title: string; count: number; href: string; empty: string; tone?: "blue" | "red" | "orange"; children: React.ReactNode }) {
  const badge = { blue: "bg-blue-100 text-blue-800", red: "bg-red-100 text-red-700", orange: "bg-orange-100 text-orange-800" }[tone];
  return (
    <section className="card flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">{icon} {title} {count > 0 && <span className={`rounded-full px-2 py-0.5 text-xs ${badge}`}>{count}</span>}</h3>
        <Link href={href} className="text-sm text-blue-700">View all</Link>
      </div>
      {count === 0 ? <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {empty}</p> : <ul className="divide-y divide-slate-100">{children}</ul>}
    </section>
  );
}

function Row({ href, left, sub, right }: { href: string; left: React.ReactNode; sub?: string; right: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
        <div className="min-w-0"><p className="truncate font-medium">{left}</p>{sub && <p className="truncate text-xs text-slate-500">{sub}</p>}</div>
        <div className="shrink-0">{right}</div>
      </Link>
    </li>
  );
}
