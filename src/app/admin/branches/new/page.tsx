import Link from "next/link";
import { redirect } from "next/navigation";
import { saveBranchAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BranchFields } from "@/components/branch-supplier-fields";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";

export const metadata = { title: "Add branch" };

export default async function NewBranchPage() {
  const actor = await requirePagePermission("ADMIN", "branches.manage");
  if (!actor.isSuperAdmin) redirect("/admin/branches");
  return (
    <>
      <PageHeader title="Add branch" actions={<Link href="/admin/branches" className="btn-secondary">Cancel</Link>} />
      <Card title="Branch details">
        <ActionForm action={saveBranchAction.bind(null, null)} className="space-y-5">
          <BranchFields />
          <SubmitButton>Save branch</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
