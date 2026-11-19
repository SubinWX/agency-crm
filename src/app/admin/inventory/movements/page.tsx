import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { canViewInventory } from "@/server/modules/inventory/catalog";
import { formatQty } from "@/server/modules/inventory/qty";
import { listMovements, MOVEMENT_LABELS } from "@/server/modules/inventory/stock";

export const metadata = { title: "Stock history" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePortal("ADMIN");
  if (!canViewInventory(actor)) redirect("/admin?denied=1");
  const sp = await searchParams;
  const [data, branches] = await Promise.all([
    listMovements(actor, { branchId: sp.branchId || undefined, type: sp.type, from: sp.from, to: sp.to, page: Number(sp.page) || 1 }),
    listAccessibleBranches(actor),
  ]);
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Stock history" subtitle="Every stock change, by branch. Records are never edited or deleted." actions={<Link href="/admin/inventory" className="btn-secondary">← Inventory</Link>} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-5">
        <select name="branchId" defaultValue={sp.branchId ?? ""} className="input"><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className="input"><option value="">All types</option>{Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="From" />
        <input type="date" name="to" defaultValue={sp.to} className="input" aria-label="To" />
        <button className="btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No stock changes found." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50"><tr><th className="table-th">When</th><th className="table-th">Item</th><th className="table-th">Branch</th><th className="table-th">Type</th><th className="table-th text-right">Before → After</th><th className="table-th text-right">Change</th><th className="table-th">Reason / by</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((m) => {
                const ch = Number(m.change);
                return (
                  <tr key={m.id}>
                    <td className="table-td whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}<div className="text-slate-400">{m.number}</div></td>
                    <td className="table-td"><Link className="text-blue-700" href={`/admin/inventory/items/${m.item.id}`}>{m.item.name}</Link><div className="text-xs text-slate-500">{m.item.code}</div></td>
                    <td className="table-td text-xs">{m.branch.name}</td>
                    <td className="table-td text-xs">{MOVEMENT_LABELS[m.type]}</td>
                    <td className="table-td text-right text-xs">{formatQty(m.quantityBefore)} → {formatQty(m.quantityAfter)}</td>
                    <td className={`table-td text-right font-medium ${ch < 0 ? "text-red-600" : "text-emerald-700"}`}>{ch > 0 ? "+" : ""}{formatQty(m.change, m.item.unit)}</td>
                    <td className="table-td text-xs">{m.reason}<div className="text-slate-400">{m.userName}{m.reference ? ` · ${m.reference}` : ""}{m.work ? ` · ${m.work.reference}` : ""}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pages={data.pages} makeHref={qs} />
    </>
  );
}
