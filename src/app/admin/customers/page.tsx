import Link from "next/link";
import { PersonAvatar } from "@/components/person-avatar";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { searchCustomers } from "@/server/modules/customers/service";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; archived?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "customers.view");
  const sp = await searchParams;
  const data = await searchCustomers(actor, sp.q ?? "", Number(sp.page) || 1);
  return (
    <>
      {sp.archived && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Customer archived.</div>}
      <PageHeader title="Customers" subtitle={`${data.total} customer(s)`} actions={can(actor, "customers.create") ? <Link href="/admin/customers/new" className="btn-primary">+ Add customer</Link> : null} />
      <form className="mb-4 flex max-w-xl gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name or phone" className="input" />
        <button className="btn-secondary">Search</button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No customers found." action={can(actor, "customers.create") ? <Link href="/admin/customers/new" className="btn-primary">Add customer</Link> : null} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Name</th><th className="table-th">Phone</th><th className="table-th">Email</th><th className="table-th">Branch</th><th className="table-th text-right">Works</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="table-td"><div className="flex items-center gap-3"><PersonAvatar src={c.photoKey ? `/api/customers/${c.id}/photo?v=${c.updatedAt.getTime()}` : null} gender={c.gender} name={c.name} size={36} /><div className="min-w-0"><Link href={`/admin/customers/${c.id}`} className="font-medium text-blue-700">{c.name}</Link><div className="max-w-[18rem] truncate text-xs text-slate-500">{c.address}</div></div></div></td>
                  <td className="table-td">{c.phone}</td>
                  <td className="table-td text-xs">{c.email ?? "—"}</td>
                  <td className="table-td">{c.branch?.name ?? "—"}</td>
                  <td className="table-td text-right">{c._count.works}</td>
                  <td className="table-td text-right"><Link className="text-blue-700" href={`/admin/customers/${c.id}`}>{can(actor, "customers.edit") ? "Edit" : "View"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pages={Math.ceil(data.total / data.pageSize)} makeHref={(p) => `?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} />
    </>
  );
}
