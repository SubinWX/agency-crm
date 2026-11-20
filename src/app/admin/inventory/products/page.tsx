import Link from "next/link";
import { Globe, Images, Package } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { canViewInventory, listCategories, listProducts } from "@/server/modules/inventory/catalog";
import { can } from "@/server/rbac/actor";
import { redirect } from "next/navigation";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; website?: string; status?: string }> }) {
  const actor = await requirePortal("ADMIN");
  if (!canViewInventory(actor)) redirect("/admin");
  const sp = await searchParams;
  const [products, categories] = await Promise.all([listProducts(actor, sp), listCategories()]);
  const onSite = products.filter((p) => p.showOnWebsite).length;
  const anyFilter = !!(sp.q || sp.category || sp.website || sp.status);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={`${products.length} product${products.length === 1 ? "" : "s"} · ${onSite} on the website`}
        actions={
          <>
            <a href="/products" target="_blank" className="btn-secondary"><Globe className="h-4 w-4" /> Public catalogue ↗</a>
            <a href="/api/public/products" target="_blank" className="btn-secondary">Data feed</a>
            {can(actor, "inventory.manage") && <Link href="/admin/inventory/items/new?kind=PRODUCT" className="btn-primary">+ Add product</Link>}
          </>
        }
      />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <input name="q" defaultValue={sp.q} placeholder="Name, SKU or web address" className="input lg:col-span-2" />
        <select name="category" defaultValue={sp.category ?? ""} className="input" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="website" defaultValue={sp.website ?? ""} className="input" aria-label="Website">
          <option value="">Website: any</option>
          <option value="on">On the website</option>
          <option value="off">Not on the website</option>
        </select>
        <div className="flex gap-2">
          <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status"><option value="">Active</option><option value="INACTIVE">Inactive</option></select>
          <button className="btn-primary">Filter</button>
        </div>
      </form>

      {products.length === 0 ? (
        <EmptyState
          title={anyFilter ? "No products match these filters." : "No products yet."}
          hint={anyFilter ? undefined : "Add products with photos, then tick “Show on website” to publish them."}
          action={can(actor, "inventory.manage") ? <Link href="/admin/inventory/items/new?kind=PRODUCT" className="btn-primary">Add product</Link> : undefined}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/inventory/items/${p.id}`} className="card group flex h-full flex-col overflow-hidden transition hover:border-blue-300 hover:shadow-md">
                <div className="relative aspect-[4/3] bg-slate-100">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/inventory/images/${p.images[0].id}`} alt={p.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400"><Package className="h-10 w-10" strokeWidth={1.25} /><span className="text-xs">No photo</span></div>
                  )}
                  {p.showOnWebsite && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white shadow"><Globe className="h-3 w-3" /> On website</span>}
                  {p._count.images > 1 && <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white"><Images className="h-3 w-3" /> {p._count.images}</span>}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <p className="font-semibold text-slate-900 group-hover:text-blue-700">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.code}{p.category ? ` · ${p.category}` : ""}</p>
                  <p className="mt-auto pt-2 text-sm font-semibold">{p.sellingPrice ? `${formatINR(toPaise(p.sellingPrice.toString()))} / ${p.unit}` : <span className="font-normal text-slate-400">No price</span>}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
