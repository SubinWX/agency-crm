import Link from "next/link";
import { EmptyState, PageHeader, Pagination, Stat } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { listPayments, METHOD_LABELS } from "@/server/modules/billing/invoices";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("ADMIN", "payments.view");
  const sp = await searchParams;
  const data = await listPayments(actor, { q: sp.q, method: sp.method, from: sp.from, to: sp.to, page: Number(sp.page) || 1 });
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Payments" subtitle="Record payments from an invoice." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Received (filtered)" value={formatINR(toPaise(data.sum?.toString() ?? "0"))} tone="emerald" /></div>
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-5">
        <input name="q" defaultValue={sp.q} placeholder="PAY, INV, reference, customer" className="input sm:col-span-2" />
        <select name="method" defaultValue={sp.method ?? ""} className="input"><option value="">All methods</option>{Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="From" />
        <div className="flex gap-2"><input type="date" name="to" defaultValue={sp.to} className="input" aria-label="To" /><button className="btn-primary">Go</button></div>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No payments recorded." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Payment</th><th className="table-th">Date</th><th className="table-th">Invoice</th><th className="table-th">Method</th><th className="table-th">Reference</th><th className="table-th text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((p) => (
                <tr key={p.id} className={p.voidedAt ? "opacity-50" : ""}>
                  <td className="table-td font-medium">{p.number}{p.voidedAt && <span className="ml-1 text-xs text-red-600">VOID</span>}</td>
                  <td className="table-td whitespace-nowrap">{formatDateLabel(fromDbDate(p.paidOn))}</td>
                  <td className="table-td"><Link className="text-blue-700" href={`/admin/invoices/${p.invoice.id}`}>{p.invoice.number}</Link><div className="text-xs text-slate-500">{p.invoice.customer.name}</div></td>
                  <td className="table-td">{METHOD_LABELS[p.method]}</td>
                  <td className="table-td text-xs">{p.reference ?? "—"}</td>
                  <td className="table-td text-right">{formatINR(toPaise(p.amount.toString()))}</td>
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
