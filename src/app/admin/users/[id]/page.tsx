import Link from "next/link";
import { notFound } from "next/navigation";
import { saveUserAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { UserFields } from "@/components/user-fields";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateTime } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listRoles, listUsers } from "@/server/modules/users/service";

export const metadata = { title: "Edit user" };

export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const { id } = await params;
  const { created } = await searchParams;
  // listUsers applies the same branch visibility rules as the list page.
  const visible = (await listUsers(actor)).find((u) => u.id === id);
  if (!visible || (visible.role.isSuperAdmin && !actor.isSuperAdmin)) notFound();
  const [roles, branches, recent] = await Promise.all([
    listRoles(),
    listAccessibleBranches(actor),
    prisma.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, createdAt: true } }),
  ]);
  const assignable = roles.filter((r) => (r.portal !== "CUSTOMER" || r.id === visible.roleId) && (actor.isSuperAdmin || !r.isSuperAdmin));
  return (
    <>
      {created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">User created.</div>}
      <PageHeader title={visible.name} subtitle={`${visible.role.name} · ${visible.email}`} actions={<Link href="/admin/users" className="btn-secondary">← All users</Link>} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Edit user" className="xl:col-span-2">
          <ActionForm action={saveUserAction.bind(null, visible.id)} className="space-y-5">
            <UserFields u={visible} roles={assignable.map((r) => ({ id: r.id, name: r.name, isSuperAdmin: r.isSuperAdmin }))} branches={branches} />
            <SubmitButton>Save user</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Recent activity">
          {recent.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
            <ul className="space-y-1 text-xs">{recent.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="font-mono">{r.action}</span><span className="text-slate-400">{formatDateTime(r.createdAt)}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
