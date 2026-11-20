import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { METHOD_LABELS } from "@/server/modules/billing/invoices";
import { CUSTOMER_STATUS, portalOverview } from "@/server/modules/portal/service";

export const metadata = { title: "My account" };

export default async function PortalHome() {
  const actor = await requirePortal("CUSTOMER");
  const o = await portalOverview(actor);
  const m = (v: { toString(): string }) => formatINR(toPaise(v.toString()));
  return (
    <>
      <PageHeader title={`Hello, ${o.customer.name.split(" ")[0]}`} subtitle="Your works, invoices and payments." actions={<Link href="/support/new" className="btn-secondary">Need help?</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Works" value={o.works.length} />
        <Stat label="Outstanding balance" value={formatINR(o.outstanding)} tone={o.outstanding ? "orange" : "emerald"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div data-tour="portal-works"><Card title="My works">
          {o.works.length === 0 ? <EmptyState title="No works yet." /> : (
            <ul className="divide-y divide-slate-100">
              {o.works.map((w) => (
                <li key={w.id}>
                  <Link href={`/portal/works/${w.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-blue-700">
                    <span className="min-w-0"><span className="block truncate font-medium">{w.title || w.reference}</span><span className="text-xs text-slate-500">{w.reference} · {formatDateLabel(fromDbDate(w.workDate))}</span></span>
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${w.status === "CANCELLED" ? "bg-red-100 text-red-700" : CUSTOMER_STATUS[w.status] === "Completed" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>{CUSTOMER_STATUS[w.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card></div>
        <div data-tour="portal-invoices"><Card title="Invoices">
          {o.invoices.length === 0 ? <EmptyState title="No invoices yet." /> : (
            <ul className="divide-y divide-slate-100">
              {o.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>
                    <span className="font-medium">{i.number}</span> <span className="text-xs text-slate-500">· {i.work.reference} · {formatDateLabel(fromDbDate(i.invoiceDate))}</span>
                    <span className="block text-xs text-slate-500">Total {m(i.grandTotal)} · {i.status === "PAID" ? <span className="text-emerald-700">Paid</span> : <>Balance <strong className="text-orange-700">{m(i.balanceDue)}</strong>{i.dueDate ? ` · due ${formatDateLabel(fromDbDate(i.dueDate))}` : ""}</>}</span>
                  </span>
                  <a href={`/api/portal/invoices/${i.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary px-3 py-1 text-xs">PDF</a>
                </li>
              ))}
            </ul>
          )}
        </Card></div>
        {o.settings.showPayments && (
          <Card title="Payments">
            {o.payments.length === 0 ? <p className="text-sm text-slate-500">No payments recorded.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex justify-between py-2"><span>{formatDateLabel(fromDbDate(p.paidOn))} · {METHOD_LABELS[p.method]} <span className="text-xs text-slate-500">({p.invoice.number})</span></span><span className="font-medium">{m(p.amount)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Your details">
          <p className="text-sm">{o.customer.name}<br />{o.customer.phone}{o.customer.email ? <><br />{o.customer.email}</> : null}{o.customer.address ? <><br />{o.customer.address}</> : null}</p>
          <p className="mt-2 text-xs text-slate-500">Something wrong? Raise a request under Help &amp; support.</p>
        </Card>
      </div>
    </>
  );
}
