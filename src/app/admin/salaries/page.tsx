import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { salaryOverview } from "@/server/modules/billing/salary";

export const metadata = { title: "Salaries" };

export default async function SalariesPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "staff.manage");
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : businessToday().slice(0, 7);
  const rows = await salaryOverview(actor, period);

  return (
    <>
      <PageHeader title="Salaries" subtitle="Staff and worker salary. Other cash payments go under Expenses." />
      <form className="mb-4 flex items-end gap-2">
        <div><label className="label">Month</label><input type="month" name="period" defaultValue={period} className="input" /></div>
        <button className="btn-secondary">Show</button>
      </form>
      <div>
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50"><tr><th className="table-th">Employee</th><th className="table-th">Salary</th><th className="table-th text-right">Paid in {period}</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const salary = r.staffProfile?.salaryAmount ? toPaise(r.staffProfile.salaryAmount.toString()) : null;
                const full = r.staffProfile?.salaryType === "MONTHLY" && salary !== null && r.paidThisPeriod >= salary;
                return (
                  <tr key={r.id}>
                    <td className="table-td"><span className="font-medium">{r.name}</span><div className="text-xs text-slate-500">{r.role.name}{r.status === "INACTIVE" ? " · inactive" : ""}</div></td>
                    <td className="table-td">{salary !== null ? `${formatINR(salary)} / ${(r.staffProfile?.salaryType ?? "").toLowerCase()}` : <span className="text-slate-400">Not set</span>}</td>
                    <td className="table-td text-right">{formatINR(r.paidThisPeriod)}{full && <span className="ml-1 text-xs text-emerald-700">✓</span>}</td>
                    <td className="table-td text-right"><Link className="text-blue-700" href={`/admin/salaries/${r.id}?period=${period}`}>Manage</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
