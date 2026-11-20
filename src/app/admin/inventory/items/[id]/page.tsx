import Link from "next/link";
import { notFound } from "next/navigation";
import { moveStockAction, removeItemImageAction, reorderLevelAction, updateItemAction } from "@/app/actions/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ImageGallery } from "@/components/image-gallery";
import { ItemForm } from "@/components/item-form";
import { StockMoveForm } from "@/components/stock-move-form";
import { Card, DefinitionList, Pagination } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateTime } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { getItem, listCategories, listSuppliers } from "@/server/modules/inventory/catalog";
import { formatQty } from "@/server/modules/inventory/qty";
import { itemStockByBranch, listMovements, MOVEMENT_LABELS } from "@/server/modules/inventory/stock";
import { getSetting } from "@/server/modules/settings/service";
import { can } from "@/server/rbac/actor";

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ branch?: string; page?: string; created?: string; edit?: string }> }) {
  const actor = await requirePortal("ADMIN");
  const { id } = await params;
  const sp = await searchParams;
  const item = await getItem(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const [byBranch, history, myBranches, allBranches, suppliers, categories, invSettings] = await Promise.all([
    itemStockByBranch(actor, id),
    listMovements(actor, { itemId: id, branchId: sp.branch, page: Number(sp.page) || 1 }),
    listAccessibleBranches(actor),
    prisma.branch.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listSuppliers(actor),
    listCategories(),
    getSetting("inventory"),
  ]);
  const canMove = can(actor, "inventory.edit_stock") || can(actor, "inventory.manage");
  const manage = can(actor, "inventory.manage");
  const total = byBranch.reduce((a, b) => a + b.qty, 0);
  const money = (v: { toString(): string } | null) => (v ? formatINR(toPaise(v.toString())) : "—");

  return (
    <div className="space-y-5">
      {sp.created && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Item created. Record stock in for each branch below.</div>}
      <div>
        <Link href="/admin/inventory" className="text-sm text-blue-700">← Inventory</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{item.kind === "PRODUCT" ? "Product" : "Raw material"}</span>
          {item.status === "INACTIVE" && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-700">Inactive</span>}
        </div>
        <p className="mt-1 text-sm text-slate-500">{item.code}{item.category ? ` · ${item.category}` : ""} · total across your branches {formatQty(total, item.unit)}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Stock by branch">
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="table-th">Branch</th><th className="table-th text-right">Quantity</th><th className="table-th">Low-stock level</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {byBranch.map((b) => {
                    const threshold = b.reorder ?? (Number(item.reorderLevel) * 1000);
                    const low = threshold > 0 && b.qty <= threshold;
                    return (
                      <tr key={b.branch.id}>
                        <td className="table-td font-medium">{b.branch.name}</td>
                        <td className={`table-td text-right font-semibold ${low ? "text-orange-700" : ""}`}>{formatQty(b.qty, item.unit)}{low && <span className="ml-1 rounded bg-orange-100 px-1.5 text-[10px] uppercase">Low</span>}</td>
                        <td className="table-td">
                          {canMove ? (
                            <ActionForm action={reorderLevelAction.bind(null, item.id, b.branch.id)} className="flex items-center gap-2">
                              <input name="level" defaultValue={b.reorder !== null ? String(b.reorder / 1000) : ""} placeholder={`default ${Number(item.reorderLevel)}`} className="input w-28" />
                              <SubmitButton className="btn-secondary px-3" pendingText="…">Set</SubmitButton>
                            </ActionForm>
                          ) : (
                            formatQty(threshold)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Stock history (${history.total})`} actions={
            <div className="flex gap-1 text-xs">
              <Link href={`?`} className={!sp.branch ? "font-semibold text-blue-700" : "text-slate-500"}>All</Link>
              {myBranches.map((b) => <Link key={b.id} href={`?branch=${b.id}`} className={sp.branch === b.id ? "font-semibold text-blue-700" : "text-slate-500"}>· {b.name}</Link>)}
            </div>
          }>
            {history.items.length === 0 ? (
              <p className="text-sm text-slate-500">No stock changes yet.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50"><tr><th className="table-th">When</th><th className="table-th">Type</th><th className="table-th">Branch</th><th className="table-th text-right">Before</th><th className="table-th text-right">Change</th><th className="table-th text-right">After</th><th className="table-th">Reason / by</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.items.map((m) => {
                      const ch = Number(m.change);
                      return (
                        <tr key={m.id}>
                          <td className="table-td whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}<div className="text-slate-400">{m.number}</div></td>
                          <td className="table-td text-xs">{MOVEMENT_LABELS[m.type]}</td>
                          <td className="table-td text-xs">{m.branch.name}</td>
                          <td className="table-td text-right">{formatQty(m.quantityBefore)}</td>
                          <td className={`table-td text-right font-medium ${ch < 0 ? "text-red-600" : "text-emerald-700"}`}>{ch > 0 ? "+" : ""}{formatQty(m.change)}</td>
                          <td className="table-td text-right">{formatQty(m.quantityAfter)}</td>
                          <td className="table-td text-xs">
                            {m.reason}
                            <div className="text-slate-400">{m.userName}{m.reference ? ` · ${m.reference}` : ""}{m.supplier ? ` · ${m.supplier.name}` : ""}{m.work ? <> · <Link className="text-blue-700" href={`/admin/works/${m.work.id}`}>{m.work.reference}</Link></> : null}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={history.page} pages={history.pages} makeHref={(p) => `?page=${p}${sp.branch ? `&branch=${sp.branch}` : ""}`} />
          </Card>

          {manage && (
            <Card title="Edit item">
              <ItemForm
                action={updateItemAction.bind(null, item.id)}
                suppliers={suppliers}
                categories={categories}
                submitLabel="Save item"
                item={{ ...item, sellingPrice: item.sellingPrice?.toString() ?? null, purchasePrice: item.purchasePrice?.toString() ?? null, reorderLevel: String(Number(item.reorderLevel)) }}
              />
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {canMove && myBranches.length > 0 && (
            <Card title="Change stock">
              <StockMoveForm
                action={moveStockAction.bind(null, item.id)}
                branches={myBranches}
                allBranches={allBranches}
                suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
                unit={item.unit}
                transfersEnabled={invSettings.transfersEnabled}
                defaultBranchId={sp.branch}
              />
            </Card>
          )}
          <Card title="Details">
            <DefinitionList
              items={[
                ["Unit", item.unit],
                ...(item.kind === "PRODUCT" ? ([["Selling price", money(item.sellingPrice)]] as [string, string][]) : []),
                ["Purchase price", money(item.purchasePrice)],
                ["Supplier", item.supplier ? item.supplier.name : null],
                ["Description", item.description],
                ["Notes", item.notes],
              ]}
            />
          </Card>
          {item.kind === "PRODUCT" && (
            <Card title="Website">
              {item.showOnWebsite ? (
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2 font-medium text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Shown on the website</p>
                  <a href={`/products/${item.slug}`} target="_blank" className="block text-blue-700">Public product page ↗</a>
                  <p className="text-xs text-slate-500">Product data for the website (JSON):</p>
                  <a href={`/api/public/products/${item.slug}`} target="_blank" className="block break-all rounded bg-slate-50 px-2 py-1.5 font-mono text-xs text-blue-700">/api/public/products/{item.slug}</a>
                  {item.websiteUrl && <a href={item.websiteUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-blue-700">Product page ↗</a>}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Not on the website. Tick &quot;Show this product on the website&quot; in Edit item to publish it.</p>
              )}
            </Card>
          )}
          <Card title="Images">
            <ImageGallery images={item.images.map((i) => ({ src: `/api/inventory/images/${i.id}` }))} />
            {manage && item.images.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.images.map((img, i) => (
                  <ActionForm key={img.id} action={removeItemImageAction.bind(null, img.id)} confirm="Remove this image?" className="">
                    <SubmitButton className="btn-secondary px-2 py-1 text-xs" pendingText="…">Remove image {i + 1}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
