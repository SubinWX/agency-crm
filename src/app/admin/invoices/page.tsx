import Link from "next/link";
import { EmptyState, PageHeader, Pagination, Stat } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/billing-ui";
import { requirePortal } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { canViewBilling, listInvoices } from "@/server/modules/billing/invoices";
import { redirect } from "next/navigation";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const actor = await requirePortal("ADMIN");
  if (!canViewBilling(actor)) redirect("/admin?denied=1");
  const sp = await searchParams;
  const data = await listInvoices(actor, { q: sp.q, status: sp.status, page: Number(sp.page) || 1 });
  const sum = (v: { toString(): string } | null) => formatINR(toPaise(v?.toString() ?? "0"));
  return (
    <>
      <PageHeader title="Invoices" subtitle="Create invoices from a work's page." actions={<Link href="/admin/works" className="btn-secondary">Go to works</Link>} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Invoiced" value={sum(data.sums._sum.grandTotal)} />
        <Stat label="Received" value={sum(data.sums._sum.amountPaid)} tone="emerald" />
        <Stat label="Outstanding" value={sum(data.sums._sum.balanceDue)} tone="orange" />
      </div>
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <input name="q" defaultValue={sp.q} placeholder="INV, WRK, customer or phone" className="input min-w-48 flex-1" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-44">
          <option value="">All statuses</option>
          <option value="ISSUED">Unpaid</option>
          <option value="PARTIALLY_PAID">Partially paid</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button className="btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No invoices found." hint="Open a work and choose “Create invoice”." action={<Link href="/admin/works" className="btn-primary">Open works</Link>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Invoice</th><th className="table-th">Date</th><th className="table-th">Customer</th><th className="table-th">Work</th><th className="table-th text-right">Total</th><th className="table-th text-right">Balance</th><th className="table-th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="table-td"><Link className="font-medium text-blue-700" href={`/admin/invoices/${i.id}`}>{i.number}</Link><div className="text-xs text-slate-500">{i.branch.name}</div></td>
                  <td className="table-td whitespace-nowrap">{formatDateLabel(fromDbDate(i.invoiceDate))}</td>
                  <td className="table-td">{i.customer.name}</td>
                  <td className="table-td">{i.work.reference}</td>
                  <td className="table-td text-right">{formatINR(toPaise(i.grandTotal.toString()))}</td>
                  <td className="table-td text-right">{formatINR(toPaise(i.balanceDue.toString()))}</td>
                  <td className="table-td"><InvoiceStatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pages={data.pages} makeHref={(p) => `?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${sp.status ? `&status=${sp.status}` : ""}`} />
    </>
  );
}
