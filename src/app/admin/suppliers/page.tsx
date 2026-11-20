import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { canViewInventory, listSuppliers } from "@/server/modules/inventory/catalog";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; created?: string }> }) {
  const actor = await requirePortal("ADMIN");
  if (!canViewInventory(actor)) redirect("/admin?denied=1");
  const sp = await searchParams;
  const suppliers = await listSuppliers(actor, sp.q ?? "");
  const manage = can(actor, "inventory.manage");
  return (
    <>
      {sp.created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Supplier added.</div>}
      <PageHeader title="Suppliers" subtitle="Who supplies your products and raw materials." actions={manage ? <Link href="/admin/suppliers/new" className="btn-primary">+ Add supplier</Link> : null} />
      <form className="mb-4 flex max-w-xl gap-2"><input name="q" defaultValue={sp.q} placeholder="Name, company or phone" className="input" /><button className="btn-secondary">Search</button></form>
      {suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet." action={manage ? <Link href="/admin/suppliers/new" className="btn-primary">Add supplier</Link> : null} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Supplier</th><th className="table-th">Contact</th><th className="table-th">GSTIN</th><th className="table-th">Items</th><th className="table-th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((s) => (
                <tr key={s.id} className={s.status === "INACTIVE" ? "opacity-60" : ""}>
                  <td className="table-td"><span className="font-medium">{s.name}</span>{s.company && <div className="text-xs text-slate-500">{s.company}</div>}</td>
                  <td className="table-td text-sm">{[s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="table-td text-xs">{s.gstNumber ?? "—"}</td>
                  <td className="table-td text-xs">{s._count.items ? s.items.map((i, idx) => <span key={i.id}>{idx ? ", " : ""}<Link className="text-blue-700" href={`/admin/inventory/items/${i.id}`}>{i.name}</Link></span>) : "—"}</td>
                  <td className="table-td text-right">{manage && <Link href={`/admin/suppliers/${s.id}`} className="text-blue-700">Edit</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
