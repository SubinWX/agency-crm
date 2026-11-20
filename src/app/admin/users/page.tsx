import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { listUsers } from "@/server/modules/users/service";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const sp = await searchParams;
  const users = await listUsers(actor, sp.q ?? "");
  return (
    <>
      <PageHeader title="Users" subtitle="Super Admin, Admin, Staff, Agents, Workers and customer logins" actions={<Link href="/admin/users/new" className="btn-primary">+ Add user</Link>} />
      <form className="mb-4 flex max-w-xl gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, email or phone" className="input" />
        <button className="btn-secondary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50"><tr><th className="table-th">Name</th><th className="table-th">Role</th><th className="table-th">Branches</th><th className="table-th">Last sign-in</th><th className="table-th">Status</th><th className="table-th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="table-td"><span className="font-medium">{u.name}</span><div className="text-xs text-slate-500">{u.email}</div></td>
                <td className="table-td">{u.role.name}</td>
                <td className="table-td text-xs">{u.branches.map((b) => b.branch.name).join(", ") || "—"}</td>
                <td className="table-td text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                <td className="table-td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{u.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
                <td className="table-td text-right">{(!u.role.isSuperAdmin || actor.isSuperAdmin) && <Link className="text-blue-700" href={`/admin/users/${u.id}`}>Edit</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
