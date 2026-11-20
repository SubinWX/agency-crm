import Link from "next/link";
import { PersonForm } from "@/components/people";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Add agent" };

export default async function Page() {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const branches = await listAccessibleBranches(actor);
  return (
    <>
      <PageHeader title="Add agent" actions={<Link href="/admin/agents" className="btn-secondary">Cancel</Link>} />
      <Card><PersonForm kind="AGENT" id={null} branches={branches} showCommission={can(actor, "commissions.manage")} /></Card>
    </>
  );
}
