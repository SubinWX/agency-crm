import Link from "next/link";
import { addCategoryAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listCategories } from "@/server/modules/billing/expenses";

export const metadata = { title: "Expense categories" };

export default async function ExpenseCategoriesPage() {
  await requirePagePermission("ADMIN", "expenses.manage");
  const categories = await listCategories();
  return (
    <>
      <PageHeader title="Expense categories" actions={<Link href="/admin/expenses" className="btn-secondary">← Expenses</Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Categories (${categories.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">{categories.map((c) => <li key={c.id} className="py-2">{c.name}</li>)}</ul>
        </Card>
        <Card title="Add category">
          <ActionForm action={addCategoryAction} resetOnSuccess className="flex gap-2">
            <input name="name" required className="input" placeholder="New category" />
            <SubmitButton className="btn-primary">Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
