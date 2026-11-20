import Link from "next/link";
import { ImageInput } from "@/components/image-input";
import { createExpenseAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday } from "@/server/lib/dates";
import { listCategories } from "@/server/modules/billing/expenses";
import { listAccessibleBranches } from "@/server/modules/branches/service";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage() {
  const actor = await requirePagePermission("ADMIN", "expenses.manage");
  const [categories, branches] = await Promise.all([listCategories(), listAccessibleBranches(actor)]);
  return (
    <>
      <PageHeader title="Add expense" actions={<Link href="/admin/expenses" className="btn-secondary">Cancel</Link>} />
      <Card title="Expense details">
        <ActionForm action={createExpenseAction} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2"><label className="label">Title *</label><input name="title" required className="input" placeholder="e.g. Diesel for van" /></div>
            <div><label className="label">Amount (₹) *</label><input name="amount" required inputMode="decimal" className="input" /></div>
            <div><label className="label">Date *</label><input type="date" name="spentOn" required max={businessToday()} defaultValue={businessToday()} className="input" /></div>
            <div>
              <label className="label">Category *</label>
              <select name="categoryId" required className="input" defaultValue=""><option value="" disabled>Select…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <div>
              <label className="label">Branch</label>
              <select name="branchId" className="input" defaultValue={branches.length === 1 ? branches[0].id : ""}>
                {actor.isSuperAdmin && <option value="">Company-wide</option>}
                {!actor.isSuperAdmin && branches.length > 1 && <option value="" disabled>Select…</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div><label className="label">Work reference (optional)</label><input name="workReference" className="input" placeholder="WRK-000001" /></div>
            <div className="sm:col-span-2"><label className="label">Receipt / bill</label><ImageInput name="receipt" accept="image/*,application/pdf" label="Add receipt" hint="Photo or PDF" /></div>
            <div className="sm:col-span-2 lg:col-span-3"><label className="label">Description</label><textarea name="description" rows={2} className="input" /></div>
          </div>
          <SubmitButton>Save expense</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
