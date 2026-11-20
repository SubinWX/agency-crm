import Link from "next/link";
import { adjustCommissionAction, cancelCommissionAction, commissionBulkAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CommissionStatusBadge } from "@/components/billing-ui";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { listCommissions } from "@/server/modules/billing/commissions";

export const metadata = { title: "Commissions" };

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("ADMIN", "commissions.manage");
  const sp = await searchParams;
  const data = await listCommissions(actor, { status: sp.status, type: sp.type, page: Number(sp.page) || 1 });
  const m = (v: { toString(): string }) => formatINR(toPaise(v.toString()));
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  const totals = Object.fromEntries(data.byStatus.map((b) => [b.status, b._sum.amount]));

  return (
    <>
      <PageHeader title="Commissions" subtitle="Created when a work is approved. Amounts follow the invoice (excl. GST) until approved for payout." actions={<Link href="/admin/commissions/rates" className="btn-secondary">Commission rates</Link>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["ACCRUED", "APPROVED", "PAID", "CANCELLED"] as const).map((s) => (
          <Link key={s} href={`?status=${s}${sp.type ? `&type=${sp.type}` : ""}`} className="card p-4 hover:border-slate-300">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.toLowerCase()}</p>
            <p className="mt-1 text-2xl font-semibold">{m(totals[s] ?? 0)}</p>
          </Link>
        ))}
      </div>

      <div>
        <div className="space-y-3">
          <form className="flex flex-wrap gap-2">
            <select name="type" defaultValue={sp.type ?? ""} className="input w-40"><option value="">Agents & workers</option><option value="AGENT">Agents</option><option value="WORKER">Workers</option></select>
            <select name="status" defaultValue={sp.status ?? ""} className="input w-40"><option value="">All statuses</option><option value="ACCRUED">Accrued</option><option value="APPROVED">Approved</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option></select>
            <button className="btn-secondary">Filter</button>
          </form>
          {data.items.length === 0 ? (
            <EmptyState title="No commissions yet." hint="They appear when a work is approved." />
          ) : (
            <div className="space-y-3">
              <div className="card overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50"><tr><th className="table-th w-8" /><th className="table-th">Person</th><th className="table-th">Work</th><th className="table-th text-right">Base</th><th className="table-th text-right">%</th><th className="table-th text-right">Amount</th><th className="table-th">Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((c) => (
                      <tr key={c.id}>
                        <td className="table-td">{(c.status === "ACCRUED" || c.status === "APPROVED") && <input type="checkbox" name="ids" value={c.id} form="commission-bulk" className="h-4 w-4" aria-label={`Select ${c.user.name}`} />}</td>
                        <td className="table-td"><span className="font-medium">{c.user.name}</span><div className="text-xs text-slate-500">{c.type === "AGENT" ? "Agent" : `Worker${Number(c.shareFactor) < 1 ? ` · ${Math.round(Number(c.shareFactor) * 100)}% share` : ""}`}</div></td>
                        <td className="table-td"><Link className="text-blue-700" href={`/admin/works/${c.work.id}`}>{c.work.reference}</Link><div className="text-xs text-slate-500">{c.work.customer.name}</div></td>
                        <td className="table-td text-right">{m(c.baseAmount)}</td>
                        <td className="table-td text-right">{Number(c.percent)}%</td>
                        <td className="table-td text-right font-medium">{m(c.amount)}{c.isManual && <div className="text-[10px] text-amber-700">manual</div>}</td>
                        <td className="table-td">
                          <CommissionStatusBadge status={c.status} />
                          {c.status === "ACCRUED" && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-blue-700">Adjust</summary>
                              <AdjustForm id={c.id} />
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ActionForm id="commission-bulk" action={commissionBulkAction} className="card flex flex-wrap items-end gap-2 p-3">
                <div><label className="label">With selected</label>
                  <select name="op" className="input w-48"><option value="approve">Approve for payout</option><option value="pay">Mark as paid</option></select>
                </div>
                <div className="flex-1"><label className="label">Payout reference (for paid)</label><input name="reference" className="input" placeholder="UPI / cash voucher no." /></div>
                <SubmitButton>Apply</SubmitButton>
              </ActionForm>
            </div>
          )}
          <Pagination page={data.page} pages={data.pages} makeHref={qs} />
        </div>

      </div>
    </>
  );
}

function AdjustForm({ id }: { id: string }) {
  return (
    <div className="mt-2 w-56 space-y-2">
      <ActionForm action={adjustCommissionAction.bind(null, id)} className="space-y-2">
        <input name="percent" type="number" step="0.01" className="input" placeholder="New % (or)" />
        <input name="amount" inputMode="decimal" className="input" placeholder="Fixed amount ₹" />
        <input name="reason" required className="input" placeholder="Reason *" />
        <SubmitButton className="btn-secondary w-full">Adjust</SubmitButton>
      </ActionForm>
      <ActionForm action={cancelCommissionAction.bind(null, id)} confirm="Cancel this commission?" className="space-y-2">
        <input name="reason" required className="input" placeholder="Cancel reason *" />
        <SubmitButton className="btn-danger w-full">Cancel commission</SubmitButton>
      </ActionForm>
    </div>
  );
}
