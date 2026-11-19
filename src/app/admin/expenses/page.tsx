import Link from "next/link";
import { redirect } from "next/navigation";
import { addCategoryAction, createExpenseAction, voidExpenseAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyState, PageHeader, Pagination, Stat } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { businessToday, formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { listCategories, listExpenses } from "@/server/modules/billing/expenses";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { can, canAny } from "@/server/rbac/actor";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePortal("ADMIN");
  if (!canAny(actor, "expenses.view", "expenses.manage")) redirect("/admin?denied=1");
  const sp = await searchParams;
  const [data, categories, branches] = await Promise.all([
    listExpenses(actor, { q: sp.q, categoryId: sp.categoryId, branchId: sp.branchId, from: sp.from, to: sp.to, page: Number(sp.page) || 1 }),
    listCategories(),
    listAccessibleBranches(actor),
  ]);
  const manage = can(actor, "expenses.manage");
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Expenses" subtitle="Transport, materials, maintenance, salary-related cash and other cash expenses." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Stat label="Total (filtered, excluding void)" value={formatINR(toPaise(data.sum?.toString() ?? "0"))} tone="orange" />
          <form className="card grid gap-2 p-3 sm:grid-cols-6">
            <input name="q" defaultValue={sp.q} placeholder="Title or EXP-…" className="input sm:col-span-2" />
            <select name="categoryId" defaultValue={sp.categoryId ?? ""} className="input"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select name="branchId" defaultValue={sp.branchId ?? ""} className="input"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="From" />
            <button className="btn-primary">Filter</button>
          </form>
          {data.items.length === 0 ? (
            <EmptyState title="No expenses found." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50"><tr><th className="table-th">Expense</th><th className="table-th">Date</th><th className="table-th">Category</th><th className="table-th">Branch</th><th className="table-th text-right">Amount</th><th className="table-th" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((e) => (
                    <tr key={e.id} className={e.status === "VOID" ? "opacity-50" : ""}>
                      <td className="table-td">
                        <span className="font-medium">{e.title}</span>{e.status === "VOID" && <span className="ml-1 text-xs text-red-600">VOID</span>}
                        <div className="text-xs text-slate-500">{e.number}{e.work && <> · <Link className="text-blue-700" href={`/admin/works/${e.work.id}`}>{e.work.reference}</Link></>}{e.receiptKey && <> · <a className="text-blue-700" href={`/api/expenses/${e.id}/receipt`} target="_blank" rel="noopener">Receipt</a></>}</div>
                        {e.voidReason && <div className="text-xs text-red-600">Void: {e.voidReason}</div>}
                      </td>
                      <td className="table-td whitespace-nowrap">{formatDateLabel(fromDbDate(e.spentOn))}</td>
                      <td className="table-td">{e.category.name}</td>
                      <td className="table-td">{e.branch?.name ?? "Company"}</td>
                      <td className="table-td text-right">{formatINR(toPaise(e.amount.toString()))}</td>
                      <td className="table-td">
                        {manage && e.status === "ACTIVE" && (
                          <details>
                            <summary className="cursor-pointer text-xs text-red-700">Void</summary>
                            <ActionForm action={voidExpenseAction.bind(null, e.id)} confirm="Void this expense? It stays on record." className="mt-2 space-y-2">
                              <input name="reason" required className="input" placeholder="Reason *" />
                              <SubmitButton className="btn-danger">Void</SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pages={data.pages} makeHref={qs} />
        </div>
        {manage && (
          <div className="space-y-5">
            <Card title="Add expense">
              <ActionForm action={createExpenseAction} resetOnSuccess>
                <div><label className="label">Title *</label><input name="title" required className="input" placeholder="e.g. Diesel for van" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Amount (₹) *</label><input name="amount" required inputMode="decimal" className="input" /></div>
                  <div><label className="label">Date *</label><input type="date" name="spentOn" required max={businessToday()} defaultValue={businessToday()} className="input" /></div>
                </div>
                <div><label className="label">Category *</label><select name="categoryId" required className="input" defaultValue=""><option value="" disabled>Select…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div>
                  <label className="label">Branch</label>
                  <select name="branchId" className="input" defaultValue={branches.length === 1 ? branches[0].id : ""}>
                    {actor.isSuperAdmin && <option value="">Company-wide</option>}
                    {!actor.isSuperAdmin && branches.length > 1 && <option value="" disabled>Select…</option>}
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Work reference (optional)</label><input name="workReference" className="input" placeholder="WRK-000001" /></div>
                <div><label className="label">Description</label><textarea name="description" rows={2} className="input" /></div>
                <div><label className="label">Receipt / bill</label><input name="receipt" type="file" accept="image/*,application/pdf" className="block w-full text-sm" /></div>
                <SubmitButton className="w-full btn-primary">Save expense</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Categories">
              <p className="mb-2 text-sm text-slate-600">{categories.map((c) => c.name).join(", ")}</p>
              <ActionForm action={addCategoryAction} resetOnSuccess className="flex gap-2">
                <input name="name" required className="input" placeholder="New category" />
                <SubmitButton className="btn-secondary">Add</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
