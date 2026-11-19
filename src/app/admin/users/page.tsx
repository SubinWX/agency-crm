import { saveUserAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listRoles, listUsers } from "@/server/modules/users/service";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const sp = await searchParams;
  const [users, roles, branches] = await Promise.all([listUsers(actor, sp.q ?? ""), listRoles(), listAccessibleBranches(actor)]);
  const editing = sp.edit ? users.find((u) => u.id === sp.edit) : undefined;
  const assignableRoles = roles.filter((r) => r.portal !== "CUSTOMER" && (actor.isSuperAdmin || !r.isSuperAdmin));

  return (
    <>
      <PageHeader title="Users" subtitle="Super Admin, Admin, Staff, Agents and Workers" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form className="mb-3 flex gap-2">
            <input name="q" defaultValue={sp.q} placeholder="Search name, email or phone" className="input" />
            <button className="btn-secondary">Search</button>
          </form>
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50"><tr><th className="table-th">Name</th><th className="table-th">Role</th><th className="table-th">Branches</th><th className="table-th">Last login</th><th className="table-th" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className={u.status === "INACTIVE" ? "opacity-60" : ""}>
                    <td className="table-td"><span className="font-medium">{u.name}</span><div className="text-xs text-slate-500">{u.email}</div></td>
                    <td className="table-td">{u.role.name}{u.status === "INACTIVE" && <span className="ml-1 text-xs text-red-600">(inactive)</span>}</td>
                    <td className="table-td text-xs">{u.branches.map((b) => b.branch.name).join(", ") || "—"}</td>
                    <td className="table-td text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                    <td className="table-td text-right">{(!u.role.isSuperAdmin || actor.isSuperAdmin) && <a className="text-blue-700" href={`?edit=${u.id}`}>Edit</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Card title={editing ? `Edit ${editing.name}` : "Add user"} actions={editing ? <a href="/admin/users" className="text-xs text-slate-500">Close</a> : null}>
          <ActionForm key={editing?.id ?? "new"} action={saveUserAction.bind(null, editing?.id ?? null)} resetOnSuccess={!editing}>
            <div><label className="label">Name *</label><input name="name" required defaultValue={editing?.name} className="input" /></div>
            <div><label className="label">Email *</label><input name="email" type="email" required defaultValue={editing?.email} className="input" /></div>
            <div><label className="label">Phone</label><input name="phone" defaultValue={editing?.phone ?? ""} className="input" /></div>
            <div>
              <label className="label">Role *</label>
              <select name="roleId" required defaultValue={editing?.roleId ?? ""} className="input">
                <option value="" disabled>Select role…</option>
                {assignableRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <fieldset>
              <legend className="label">Branches</legend>
              <div className="space-y-1">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="branchIds" value={b.id} defaultChecked={editing?.branches.some((x) => x.branchId === b.id)} className="h-4 w-4 rounded border-slate-300" /> {b.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="label">Status</label>
              <select name="status" defaultValue={editing?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
            </div>
            <div>
              <label className="label">{editing ? "New password (leave blank to keep)" : "Password *"}</label>
              <input name="password" type="password" autoComplete="new-password" required={!editing} className="input" />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters with a letter and a number.</p>
            </div>
            <SubmitButton>{editing ? "Save user" : "Create user"}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
