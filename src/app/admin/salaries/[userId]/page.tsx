import Link from "next/link";
import { notFound } from "next/navigation";
import { paySalaryAction, setSalaryAction, voidSalaryAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday, formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { METHOD_LABELS } from "@/server/modules/billing/invoices";
import { salaryHistory, salaryOverview } from "@/server/modules/billing/salary";

export const metadata = { title: "Salary" };

export default async function SalaryPersonPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ period?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "staff.manage");
  const { userId } = await params;
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : businessToday().slice(0, 7);
  const history = await salaryHistory(actor, userId).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const row = (await salaryOverview(actor, period)).find((r) => r.id === userId)!;
  return (
    <>
      <PageHeader title={`${history.user.name} — salary`} subtitle={row.role.name} actions={<Link href={`/admin/salaries?period=${period}`} className="btn-secondary">← Salaries</Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Salary">
          <ActionForm action={setSalaryAction.bind(null, userId)}>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Amount (₹)</label><input name="amount" required inputMode="decimal" defaultValue={row.staffProfile?.salaryAmount?.toString() ?? ""} className="input" /></div>
              <div><label className="label">Type</label><select name="type" defaultValue={row.staffProfile?.salaryType ?? "MONTHLY"} className="input"><option value="MONTHLY">Monthly</option><option value="DAILY">Daily</option><option value="HOURLY">Hourly</option></select></div>
            </div>
            <input name="reason" className="input" placeholder="Reason for change" />
            <SubmitButton className="btn-secondary">Save salary</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Record payment">
          <ActionForm action={paySalaryAction.bind(null, userId)} resetOnSuccess>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Month</label><input type="month" name="period" required defaultValue={period} className="input" /></div>
              <div><label className="label">Amount (₹)</label><input name="amount" required inputMode="decimal" defaultValue={row.staffProfile?.salaryAmount?.toString() ?? ""} className="input" /></div>
              <div><label className="label">Paid on</label><input type="date" name="paidOn" required max={businessToday()} defaultValue={businessToday()} className="input" /></div>
              <div><label className="label">Method</label><select name="method" className="input">{Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            </div>
            <input name="reference" className="input" placeholder="Reference" />
            <input name="notes" className="input" placeholder="Notes (e.g. advance, bonus)" />
            <SubmitButton className="btn-success">Save payment</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Payment history" className="lg:col-span-2">
          {history.payments.length === 0 ? <p className="text-sm text-slate-500">No salary payments yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {history.payments.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${p.voidedAt ? "opacity-50" : ""}`}>
                  <span>{p.period} · {METHOD_LABELS[p.method]} <span className="text-xs text-slate-500">{formatDateLabel(fromDbDate(p.paidOn))}{p.reference ? ` · ${p.reference}` : ""}{p.notes ? ` · ${p.notes}` : ""}{p.voidedAt ? ` · VOID: ${p.voidReason}` : ""}</span></span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{formatINR(toPaise(p.amount.toString()))}</span>
                    {!p.voidedAt && (
                      <details><summary className="cursor-pointer text-xs text-red-700">Void</summary>
                        <ActionForm action={voidSalaryAction.bind(null, p.id)} confirm="Void this salary payment?" className="mt-1 flex gap-2">
                          <input name="reason" required className="input" placeholder="Reason *" /><SubmitButton className="btn-danger">Void</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
