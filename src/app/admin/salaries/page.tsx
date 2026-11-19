import { paySalaryAction, setSalaryAction, voidSalaryAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday, formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { METHOD_LABELS } from "@/server/modules/billing/invoices";
import { salaryHistory, salaryOverview } from "@/server/modules/billing/salary";

export const metadata = { title: "Salaries" };

export default async function SalariesPage({ searchParams }: { searchParams: Promise<{ period?: string; user?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "staff.manage");
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : businessToday().slice(0, 7);
  const rows = await salaryOverview(actor, period);
  const selected = sp.user ? await salaryHistory(actor, sp.user).catch(() => null) : null;
  const selRow = rows.find((r) => r.id === sp.user);

  return (
    <>
      <PageHeader title="Salaries" subtitle="Staff and worker salary. Other cash payments go under Expenses." />
      <form className="mb-4 flex items-end gap-2">
        <div><label className="label">Month</label><input type="month" name="period" defaultValue={period} className="input" /></div>
        <button className="btn-secondary">Show</button>
      </form>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50"><tr><th className="table-th">Employee</th><th className="table-th">Salary</th><th className="table-th text-right">Paid in {period}</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const salary = r.staffProfile?.salaryAmount ? toPaise(r.staffProfile.salaryAmount.toString()) : null;
                const full = r.staffProfile?.salaryType === "MONTHLY" && salary !== null && r.paidThisPeriod >= salary;
                return (
                  <tr key={r.id} className={sp.user === r.id ? "bg-blue-50/50" : ""}>
                    <td className="table-td"><span className="font-medium">{r.name}</span><div className="text-xs text-slate-500">{r.role.name}{r.status === "INACTIVE" ? " · inactive" : ""}</div></td>
                    <td className="table-td">{salary !== null ? `${formatINR(salary)} / ${(r.staffProfile?.salaryType ?? "").toLowerCase()}` : <span className="text-slate-400">Not set</span>}</td>
                    <td className="table-td text-right">{formatINR(r.paidThisPeriod)}{full && <span className="ml-1 text-xs text-emerald-700">✓</span>}</td>
                    <td className="table-td text-right"><a className="text-blue-700" href={`?period=${period}&user=${r.id}`}>Manage</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selected && selRow && (
          <div className="space-y-5">
            <Card title={`${selected.user.name} — salary`}>
              <ActionForm key={`s-${selRow.id}`} action={setSalaryAction.bind(null, selRow.id)}>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Amount (₹)</label><input name="amount" required inputMode="decimal" defaultValue={selRow.staffProfile?.salaryAmount?.toString() ?? ""} className="input" /></div>
                  <div><label className="label">Type</label><select name="type" defaultValue={selRow.staffProfile?.salaryType ?? "MONTHLY"} className="input"><option value="MONTHLY">Monthly</option><option value="DAILY">Daily</option><option value="HOURLY">Hourly</option></select></div>
                </div>
                <input name="reason" className="input" placeholder="Reason for change" />
                <SubmitButton className="btn-secondary">Save salary</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Record payment">
              <ActionForm key={`p-${selRow.id}`} action={paySalaryAction.bind(null, selRow.id)} resetOnSuccess>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Month</label><input type="month" name="period" required defaultValue={period} className="input" /></div>
                  <div><label className="label">Amount (₹)</label><input name="amount" required inputMode="decimal" defaultValue={selRow.staffProfile?.salaryAmount?.toString() ?? ""} className="input" /></div>
                  <div><label className="label">Paid on</label><input type="date" name="paidOn" required max={businessToday()} defaultValue={businessToday()} className="input" /></div>
                  <div><label className="label">Method</label><select name="method" className="input">{Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>
                <input name="reference" className="input" placeholder="Reference" />
                <input name="notes" className="input" placeholder="Notes (e.g. advance, bonus)" />
                <SubmitButton className="btn-success w-full">Save payment</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Payment history">
              <ul className="divide-y divide-slate-100 text-sm">
                {selected.payments.length === 0 && <li className="py-2 text-slate-500">No salary payments yet.</li>}
                {selected.payments.map((p) => (
                  <li key={p.id} className={`py-2 ${p.voidedAt ? "opacity-50" : ""}`}>
                    <div className="flex justify-between"><span>{p.period} · {METHOD_LABELS[p.method]}</span><span className="font-medium">{formatINR(toPaise(p.amount.toString()))}</span></div>
                    <p className="text-xs text-slate-500">{formatDateLabel(fromDbDate(p.paidOn))}{p.reference ? ` · ${p.reference}` : ""}{p.notes ? ` · ${p.notes}` : ""}{p.voidedAt ? ` · VOID: ${p.voidReason}` : ""}</p>
                    {!p.voidedAt && (
                      <details><summary className="cursor-pointer text-xs text-red-700">Void</summary>
                        <ActionForm action={voidSalaryAction.bind(null, p.id)} confirm="Void this salary payment?" className="mt-1 flex gap-2">
                          <input name="reason" required className="input" placeholder="Reason *" /><SubmitButton className="btn-danger">Void</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
