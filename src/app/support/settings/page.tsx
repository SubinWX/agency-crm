import { redirect } from "next/navigation";
import { saveCategoryAction } from "@/app/actions/support";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { isManager, listCategories, PRIORITY_LABELS, STATUS_LABELS } from "@/server/modules/support/service";

export const metadata = { title: "Categories" };

export default async function SupportSettings() {
  const actor = await requireUser();
  if (!isManager(actor)) redirect("/support");
  const cats = await listCategories(true);
  return (
    <>
      <PageHeader title="Support settings" subtitle="Categories people choose when raising a request." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Categories" className="lg:col-span-2">
          <ul className="space-y-2">
            {cats.map((c) => (
              <li key={c.id}>
                <ActionForm action={saveCategoryAction.bind(null, c.id)} className="flex flex-wrap items-center gap-2">
                  <input name="name" required defaultValue={c.name} className="input min-w-40 flex-1" />
                  <input name="sortOrder" type="number" min={0} defaultValue={c.sortOrder} className="input w-20" aria-label="Order" />
                  <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                  <SubmitButton className="btn-secondary" pendingText="…">Save</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-5">
          <Card title="Add category">
            <ActionForm action={saveCategoryAction.bind(null, null)} resetOnSuccess>
              <input name="name" required className="input" placeholder="e.g. Vehicle" />
              <input name="sortOrder" type="number" min={0} defaultValue={cats.length} className="input" />
              <input type="hidden" name="active" value="on" />
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Statuses & priorities">
            <p className="text-sm text-slate-600">Statuses: {Object.values(STATUS_LABELS).join(" → ")}.</p>
            <p className="mt-2 text-sm text-slate-600">Priorities: {Object.values(PRIORITY_LABELS).join(", ")}.</p>
            <p className="mt-2 text-xs text-slate-500">Message wording for ticket updates is under Notifications → Templates.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
