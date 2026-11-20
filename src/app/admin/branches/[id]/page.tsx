import Link from "next/link";
import { notFound } from "next/navigation";
import { saveBranchAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BranchFields } from "@/components/branch-supplier-fields";
import { Card, PageHeader, Stat } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listBranchesAdmin } from "@/server/modules/branches/service";

export const metadata = { title: "Branch" };

export default async function BranchPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("ADMIN", "branches.manage");
  const { id } = await params;
  const b = (await listBranchesAdmin(actor)).find((x) => x.id === id);
  if (!b) notFound();
  return (
    <>
      <PageHeader title={b.name} subtitle={b.code} actions={<Link href="/admin/branches" className="btn-secondary">← All branches</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Works" value={b._count.works} />
        <Stat label="Users" value={b._count.users} />
        <Stat label="In charge" value={b.inCharge?.name ?? "—"} />
        <Stat label="Status" value={b.status === "ACTIVE" ? "Active" : "Inactive"} />
      </div>
      <Card title="Edit branch">
        <ActionForm action={saveBranchAction.bind(null, b.id)} className="space-y-5">
          <BranchFields b={b} />
          <SubmitButton>Save branch</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
