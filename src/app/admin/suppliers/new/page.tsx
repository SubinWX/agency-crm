import Link from "next/link";
import { saveSupplierAction } from "@/app/actions/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SupplierFields } from "@/components/branch-supplier-fields";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";

export const metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requirePagePermission("ADMIN", "inventory.manage");
  return (
    <>
      <PageHeader title="Add supplier" actions={<Link href="/admin/suppliers" className="btn-secondary">Cancel</Link>} />
      <Card title="Supplier details">
        <ActionForm action={saveSupplierAction.bind(null, null)} className="space-y-5">
          <SupplierFields />
          <SubmitButton>Save supplier</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
