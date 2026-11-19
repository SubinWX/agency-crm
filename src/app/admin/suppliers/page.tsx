import Link from "next/link";
import { redirect } from "next/navigation";
import { saveSupplierAction } from "@/app/actions/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { canViewInventory, listSuppliers } from "@/server/modules/inventory/catalog";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string }> }) {
  const actor = await requirePortal("ADMIN");
  if (!canViewInventory(actor)) redirect("/admin?denied=1");
  const sp = await searchParams;
  const suppliers = await listSuppliers(actor, sp.q ?? "");
  const editing = sp.edit ? suppliers.find((s) => s.id === sp.edit) : undefined;
  const manage = can(actor, "inventory.manage");
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Who supplies your products and raw materials." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <form className="flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Name, company or phone" className="input" /><button className="btn-secondary">Search</button></form>
          {suppliers.length === 0 ? (
            <EmptyState title="No suppliers yet." />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {suppliers.map((s) => (
                <li key={s.id} className={`card p-4 ${s.status === "INACTIVE" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.name}</p>
                      {s.company && <p className="text-sm text-slate-500">{s.company}</p>}
                    </div>
                    {manage && <a href={`?edit=${s.id}`} className="text-sm text-blue-700">Edit</a>}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{[s.phone, s.email].filter(Boolean).join(" · ") || "—"}</p>
                  {s.gstNumber && <p className="text-xs text-slate-500">GSTIN {s.gstNumber}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {s._count.items} item(s){s.items.length ? ": " : ""}
                    {s.items.map((i, idx) => <span key={i.id}>{idx ? ", " : ""}<Link className="text-blue-700" href={`/admin/inventory/items/${i.id}`}>{i.name}</Link></span>)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        {manage && (
          <Card title={editing ? `Edit ${editing.name}` : "Add supplier"} actions={editing ? <a href="/admin/suppliers" className="text-xs text-slate-500">Close</a> : null}>
            <ActionForm key={editing?.id ?? "new"} action={saveSupplierAction.bind(null, editing?.id ?? null)} resetOnSuccess={!editing}>
              <div><label className="label">Name *</label><input name="name" required defaultValue={editing?.name} className="input" /></div>
              <div><label className="label">Company</label><input name="company" defaultValue={editing?.company ?? ""} className="input" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Phone</label><input name="phone" defaultValue={editing?.phone ?? ""} className="input" /></div>
                <div><label className="label">Email</label><input name="email" type="email" defaultValue={editing?.email ?? ""} className="input" /></div>
              </div>
              <div><label className="label">Address</label><input name="address" defaultValue={editing?.address ?? ""} className="input" /></div>
              <div><label className="label">GST number</label><input name="gstNumber" defaultValue={editing?.gstNumber ?? ""} className="input uppercase" maxLength={15} /></div>
              <div><label className="label">Notes</label><textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} className="input" /></div>
              <div><label className="label">Status</label><select name="status" defaultValue={editing?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
              <SubmitButton>{editing ? "Save supplier" : "Add supplier"}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
