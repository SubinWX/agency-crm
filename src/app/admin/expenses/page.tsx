import Link from "next/link";
import { redirect } from "next/navigation";
import { voidExpenseAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EmptyState, PageHeader, Pagination, Stat } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
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
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p), created: undefined }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      {sp.created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Expense recorded.</div>}
      <PageHeader
        title="Expenses"
        subtitle="Transport, materials, maintenance, salary-related cash and other cash expenses."
        actions={manage ? (<><Link href="/admin/expenses/categories" className="btn-secondary">Categories</Link><Link href="/admin/expenses/new" className="btn-primary">+ Add expense</Link></>) : null}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Total (filtered, excluding void)" value={formatINR(toPaise(data.sum?.toString() ?? "0"))} tone="orange" /></div>
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-6">
        <input name="q" defaultValue={sp.q} placeholder="Title or EXP-…" className="input sm:col-span-2" />
        <select name="categoryId" defaultValue={sp.categoryId ?? ""} className="input"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="branchId" defaultValue={sp.branchId ?? ""} className="input"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="From" />
        <button className="btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No expenses found." action={manage ? <Link href="/admin/expenses/new" className="btn-primary">Add expense</Link> : null} />
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
    </>
  );
}
