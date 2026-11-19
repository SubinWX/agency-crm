import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelInvoiceAction, recordPaymentAction, voidPaymentAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { InvoiceStatusBadge } from "@/components/billing-ui";
import { Card, DefinitionList } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { businessToday, formatDateLabel, formatDateTime, fromDbDate } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { getInvoice, METHOD_LABELS } from "@/server/modules/billing/invoices";
import { can } from "@/server/rbac/actor";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; updated?: string }> }) {
  const actor = await requirePortal("ADMIN");
  const { id } = await params;
  const sp = await searchParams;
  const inv = await getInvoice(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const m = (v: { toString(): string }) => formatINR(toPaise(v.toString()));
  const customer = inv.customerSnapshot as { name: string; phone?: string; address?: string; gstNumber?: string };
  const activePayments = inv.payments.filter((p) => !p.voidedAt);
  const userIds = [...new Set(inv.payments.flatMap((p) => [p.receivedById, p.voidedById ?? ""]).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const who = (uid?: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const open = inv.status !== "CANCELLED";
  const editable = open && activePayments.length === 0 && can(actor, "invoices.create");

  return (
    <div className="space-y-5">
      {sp.created && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Invoice created.</div>}
      {sp.updated && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Invoice updated.</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/admin/invoices" className="text-sm text-blue-700">← Invoices</Link>
          <div className="mt-2 flex items-center gap-3"><h1 className="text-2xl font-semibold">{inv.number}</h1><InvoiceStatusBadge status={inv.status} /></div>
          <p className="mt-1 text-sm text-slate-500">{formatDateLabel(fromDbDate(inv.invoiceDate))} · <Link className="text-blue-700" href={`/admin/works/${inv.work.id}`}>{inv.work.reference}</Link> · {inv.branch.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener">Open PDF / Print</a>
          <a className="btn-secondary" href={`/api/invoices/${inv.id}/pdf?download=1`}>Download</a>
          {editable && <Link className="btn-secondary" href={`/admin/invoices/${inv.id}/edit`}>Edit</Link>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Bill to">
            <DefinitionList items={[["Customer", customer.name], ["Phone", customer.phone ?? null], ["Address", customer.address ?? null], ["Customer GSTIN", customer.gstNumber ?? null]]} />
          </Card>
          <Card title="Items">
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="table-th">Item</th><th className="table-th text-right">Qty</th><th className="table-th text-right">Rate</th><th className="table-th text-right">Disc.</th><th className="table-th text-right">GST</th><th className="table-th text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {inv.items.map((i) => (
                    <tr key={i.id}>
                      <td className="table-td">{i.description}{i.hsnSac && <div className="text-xs text-slate-500">HSN/SAC {i.hsnSac}</div>}</td>
                      <td className="table-td text-right">{Number(i.quantity)} {i.unit}</td>
                      <td className="table-td text-right">{m(i.rate)}</td>
                      <td className="table-td text-right">{Number(i.discount) ? m(i.discount) : "—"}</td>
                      <td className="table-td text-right">{inv.taxType === "NONE" ? "—" : `${Number(i.taxRate)}%`}</td>
                      <td className="table-td text-right">{m(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              {([
                ["Taxable value", inv.taxableTotal],
                ...(inv.taxType === "INTRA_STATE" ? [["CGST", inv.cgstTotal], ["SGST", inv.sgstTotal]] : []),
                ...(inv.taxType === "INTER_STATE" ? [["IGST", inv.igstTotal]] : []),
                ...(Number(inv.roundOff) ? [["Round off", inv.roundOff]] : []),
              ] as [string, { toString(): string }][]).map(([k, v]) => (
                <div key={k} className="flex justify-between text-slate-600"><dt>{k}</dt><dd className="text-slate-900">{m(v)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Grand total</dt><dd>{m(inv.grandTotal)}</dd></div>
              <div className="flex justify-between text-emerald-700"><dt>Paid</dt><dd>{m(inv.amountPaid)}</dd></div>
              <div className="flex justify-between font-semibold text-orange-700"><dt>Balance due</dt><dd>{m(inv.balanceDue)}</dd></div>
            </dl>
            {inv.notes && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-600">{inv.notes}</p>}
            {inv.cancelReason && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Cancelled: {inv.cancelReason}</p>}
          </Card>

          <Card title={`Payments (${activePayments.length})`}>
            {inv.payments.length === 0 ? (
              <p className="text-sm text-slate-500">No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {inv.payments.map((p) => (
                  <li key={p.id} className={`py-3 text-sm ${p.voidedAt ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{m(p.amount)} · {METHOD_LABELS[p.method]} {p.voidedAt && <span className="ml-1 rounded bg-red-100 px-1.5 text-xs text-red-700">VOID</span>}</p>
                        <p className="text-xs text-slate-500">{p.number} · {formatDateLabel(fromDbDate(p.paidOn))}{p.reference ? ` · Ref ${p.reference}` : ""} · received by {who(p.receivedById)}</p>
                        {p.notes && <p className="text-xs text-slate-500">{p.notes}</p>}
                        {p.voidedAt && <p className="text-xs text-red-700">Voided by {who(p.voidedById)} · {formatDateTime(p.voidedAt)} · {p.voidReason}</p>}
                      </div>
                      {!p.voidedAt && can(actor, "payments.void") && (
                        <details>
                          <summary className="cursor-pointer text-xs text-red-700">Void</summary>
                          <ActionForm action={voidPaymentAction.bind(null, p.id)} confirm="Void this payment? It stays in history." className="mt-2 flex gap-2">
                            <input name="reason" required className="input" placeholder="Reason *" />
                            <SubmitButton className="btn-danger">Void</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {open && toPaise(inv.balanceDue.toString()) > 0 && can(actor, "payments.record") && (
            <Card title="Record payment">
              <ActionForm action={recordPaymentAction.bind(null, inv.id)} resetOnSuccess>
                <div><label className="label">Amount (₹) *</label><input name="amount" required inputMode="decimal" defaultValue={inv.balanceDue.toString()} className="input" /></div>
                <div><label className="label">Date *</label><input type="date" name="paidOn" required max={businessToday()} defaultValue={businessToday()} className="input" /></div>
                <div>
                  <label className="label">Method *</label>
                  <select name="method" required className="input">{Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </div>
                <div><label className="label">Reference / UTR</label><input name="reference" className="input" placeholder="Required for UPI and bank transfer" /></div>
                <div><label className="label">Notes</label><input name="notes" className="input" /></div>
                <SubmitButton className="btn-success w-full">Save payment</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {inv.status === "PAID" && (
            <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-5 text-center">
              <p className="text-3xl font-black tracking-widest text-emerald-600">PAID</p>
              {inv.paidAt && <p className="mt-1 text-xs text-emerald-700">{formatDateTime(inv.paidAt)}</p>}
              <p className="mt-2 text-xs text-emerald-800">The PDF shows a PAID stamp.</p>
            </div>
          )}
          {open && can(actor, "invoices.cancel") && (
            <Card title="Cancel invoice">
              {activePayments.length ? (
                <p className="text-sm text-slate-500">Void all payments before cancelling.</p>
              ) : (
                <ActionForm action={cancelInvoiceAction.bind(null, inv.id)} confirm="Cancel this invoice? It stays on record as cancelled.">
                  <input name="reason" required className="input" placeholder="Reason *" />
                  <SubmitButton className="btn-danger w-full">Cancel invoice</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
