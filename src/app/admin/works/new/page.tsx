import { createWorkAction } from "@/app/actions/works";
import { PageHeader } from "@/components/ui";
import { WorkForm } from "@/components/work-form";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listActiveFields } from "@/server/modules/custom-fields/service";
import { searchCustomers } from "@/server/modules/customers/service";
import { listAgents } from "@/server/modules/users/service";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "New work" };

export default async function AdminNewWork() {
  const actor = await requirePagePermission("ADMIN", "works.create");
  const [branches, fields, customers, agents] = await Promise.all([
    listAccessibleBranches(actor),
    listActiveFields(),
    can(actor, "customers.view") ? searchCustomers(actor, "", 1, 500) : Promise.resolve({ items: [] }),
    listAgents(),
  ]);
  return (
    <>
      <PageHeader title="New work" subtitle="Capacity is company-wide and cannot be exceeded." />
      <div className="max-w-3xl">
        <WorkForm
          action={createWorkAction}
          today={businessToday()}
          offerInvoice={can(actor, "invoices.create")}
          branches={branches}
          agents={agents}
          customers={customers.items.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
          fields={fields.map((f) => ({ id: f.id, key: f.key, label: f.label, type: f.type, required: f.required, helpText: f.helpText, options: Array.isArray(f.options) ? (f.options as string[]) : [] }))}
        />
      </div>
    </>
  );
}
