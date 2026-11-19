import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatINR } from "@/server/modules/billing/calc";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { canViewInventory } from "@/server/modules/inventory/catalog";
import { formatQty } from "@/server/modules/inventory/qty";
import { branchStock } from "@/server/modules/inventory/stock";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ branch?: string; q?: string; kind?: string; low?: string }> }) {
  const actor = await requirePortal("ADMIN");
  if (!canViewInventory(actor)) redirect("/admin?denied=1");
  const sp = await searchParams;
  const branches = await listAccessibleBranches(actor);
  if (branches.length === 0) return <EmptyState title="You are not assigned to any branch." />;
  const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
  const rows = await branchStock(actor, branch.id, { q: sp.q, kind: sp.kind, lowOnly: sp.low === "1" });
  const value = rows.reduce((a, r) => a + r.value, 0);
  const lowCount = rows.filter((r) => r.low).length;
  const link = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ branch: branch.id, q: sp.q, kind: sp.kind, low: sp.low, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/admin/inventory?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock is kept separately for each branch."
        actions={
          <>
            <Link href="/admin/inventory/movements" className="btn-secondary">Stock history</Link>
            {can(actor, "inventory.manage") && <Link href="/admin/inventory/items/new" className="btn-primary">+ Add item</Link>}
          </>
        }
      />
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 text-sm" aria-label="Branch">
        {branches.map((b) => (
          <Link key={b.id} href={link({ branch: b.id })} className={`whitespace-nowrap rounded-lg px-4 py-2 ${b.id === branch.id ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{b.name}</Link>
        ))}
      </nav>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Items" value={rows.length} />
        <Stat label="Low stock" value={lowCount} tone={lowCount ? "orange" : "slate"} href={link({ low: "1" })} />
        <Stat label="Stock value (purchase)" value={formatINR(value)} tone="blue" />
      </div>
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <input type="hidden" name="branch" value={branch.id} />
        <input name="q" defaultValue={sp.q} placeholder="Name or code" className="input min-w-40 flex-1" />
        <select name="kind" defaultValue={sp.kind ?? ""} className="input w-44"><option value="">Products & materials</option><option value="PRODUCT">Products</option><option value="RAW_MATERIAL">Raw materials</option></select>
        <label className="flex items-center gap-2 px-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={sp.low === "1"} /> Low stock only</label>
        <button className="btn-primary">Filter</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No inventory items found." hint="Add products and raw materials, then record stock in." action={can(actor, "inventory.manage") ? <Link href="/admin/inventory/items/new" className="btn-primary">Add item</Link> : null} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Item</th><th className="table-th">Type</th><th className="table-th">Category</th><th className="table-th text-right">In stock at {branch.name}</th><th className="table-th text-right">Low at</th><th className="table-th text-right">Value</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.item.id} className={r.low ? "bg-orange-50/50" : ""}>
                  <td className="table-td"><Link href={`/admin/inventory/items/${r.item.id}?branch=${branch.id}`} className="font-medium text-blue-700">{r.item.name}</Link><div className="text-xs text-slate-500">{r.item.code}</div></td>
                  <td className="table-td text-xs">{r.item.kind === "PRODUCT" ? "Product" : "Raw material"}</td>
                  <td className="table-td text-xs">{r.item.category ?? "—"}</td>
                  <td className={`table-td text-right font-medium ${r.low ? "text-orange-700" : ""}`}>{formatQty(r.qty, r.item.unit)}{r.low && <span className="ml-1 rounded bg-orange-100 px-1.5 text-[10px] font-semibold uppercase">Low</span>}</td>
                  <td className="table-td text-right text-xs text-slate-500">{r.reorder ? formatQty(r.reorder) : "—"}</td>
                  <td className="table-td text-right text-sm">{formatINR(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
