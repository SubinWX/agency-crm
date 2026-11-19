import { createWorkAction } from "@/app/actions/works";
import { PageHeader } from "@/components/ui";
import { WorkForm } from "@/components/work-form";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listActiveFields } from "@/server/modules/custom-fields/service";
import { searchCustomers } from "@/server/modules/customers/service";

export const metadata = { title: "New work" };

export default async function NewWorkPage() {
  const actor = await requirePagePermission("AGENT", "works.create");
  const [branches, fields, customers] = await Promise.all([
    listAccessibleBranches(actor),
    listActiveFields(),
    searchCustomers(actor, "", 1, 200),
  ]);
  return (
    <>
      <PageHeader title="New work" subtitle="Customer → details → date → submit" />
      <WorkForm
        action={createWorkAction}
        today={businessToday()}
        branches={branches}
        customers={customers.items.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
        fields={fields.map((f) => ({ id: f.id, key: f.key, label: f.label, type: f.type, required: f.required, helpText: f.helpText, options: Array.isArray(f.options) ? (f.options as string[]) : [] }))}
      />
    </>
  );
}
