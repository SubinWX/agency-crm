import Link from "next/link";
import { createCustomerAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CustomerFields } from "@/components/customer-fields";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listAccessibleBranches } from "@/server/modules/branches/service";

export const metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const actor = await requirePagePermission("ADMIN", "customers.create");
  const branches = await listAccessibleBranches(actor);
  return (
    <>
      <PageHeader title="Add customer" actions={<Link href="/admin/customers" className="btn-secondary">Cancel</Link>} />
      <Card title="Customer details">
        <ActionForm action={createCustomerAction} className="space-y-5">
          <CustomerFields branches={branches} />
          <SubmitButton>Save customer</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
