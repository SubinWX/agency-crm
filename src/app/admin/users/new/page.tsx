import Link from "next/link";
import { saveUserAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { UserFields } from "@/components/user-fields";
import { requirePagePermission } from "@/server/auth/session";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listRoles } from "@/server/modules/users/service";

export const metadata = { title: "Add user" };

export default async function NewUserPage() {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const [roles, branches] = await Promise.all([listRoles(), listAccessibleBranches(actor)]);
  const assignable = roles.filter((r) => r.portal !== "CUSTOMER" && (actor.isSuperAdmin || !r.isSuperAdmin));
  return (
    <>
      <PageHeader title="Add user" subtitle="Customer logins are created from the customer's page." actions={<Link href="/admin/users" className="btn-secondary">Cancel</Link>} />
      <Card title="User details">
        <ActionForm action={saveUserAction.bind(null, null)} className="space-y-5">
          <UserFields roles={assignable.map((r) => ({ id: r.id, name: r.name, isSuperAdmin: r.isSuperAdmin }))} branches={branches} />
          <SubmitButton>Create user</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
