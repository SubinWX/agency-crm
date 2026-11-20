import Link from "next/link";
import { Package, Search } from "lucide-react";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { listPublicProducts } from "@/server/modules/inventory/catalog";
import { getSetting } from "@/server/modules/settings/service";

export async function generateMetadata() {
  const company = await getSetting("company");
  return { title: `Products · ${company.name}`, description: `Products from ${company.name}.` };
}

export default async function PublicProducts({ searchParams }: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const sp = await searchParams;
  // Relative image URLs: this page is served by the CRM itself.
  const all = await listPublicProducts("");
  const categories = [...new Set(all.map((p) => p.category).filter(Boolean) as string[])].sort();
  const q = sp.q?.trim().toLowerCase();
  const products = all.filter((p) => (!sp.category || p.category === sp.category) && (!q || `${p.name} ${p.sku} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q)));
  const chip = (label: string, category?: string) => {
    const on = (sp.category ?? "") === (category ?? "");
    const qs = new URLSearchParams(Object.entries({ category, q: sp.q }).filter(([, v]) => v) as [string, string][]).toString();
    return <Link key={label} href={`/products${qs ? `?${qs}` : ""}`} className={`rounded-full px-4 py-1.5 text-sm ${on ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"}`}>{label}</Link>;
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Our products</h1>
          <p className="mt-1 text-sm text-slate-500">{all.length} product{all.length === 1 ? "" : "s"}</p>
        </div>
        <form className="relative w-full sm:w-72">
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q} placeholder="Search products" className="input rounded-full pl-9" />
        </form>
      </div>
      {categories.length > 1 && <div className="mb-6 flex flex-wrap gap-2">{chip("All")}{categories.map((c) => chip(c, c))}</div>}

      {products.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-500">
          <Package className="h-10 w-10" strokeWidth={1.25} />
          <p>{all.length ? "No products match your search." : "Products will appear here soon."}</p>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <li key={p.slug}>
              <Link href={`/products/${p.slug}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-12 w-12" strokeWidth={1} /></div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  {p.category && <p className="text-xs font-medium uppercase tracking-wider text-blue-600">{p.category}</p>}
                  <p className="mt-1 text-lg font-semibold text-slate-900">{p.name}</p>
                  {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description}</p>}
                  <div className="mt-auto flex items-center justify-between pt-4">
                    <span className="font-semibold">{p.price !== null ? <>{formatINR(toPaise(String(p.price)))} <span className="text-xs font-normal text-slate-500">/ {p.unit}</span></> : <span className="text-sm font-normal text-slate-500">Price on request</span>}</span>
                    <span className="text-sm font-medium text-blue-700 group-hover:underline">View →</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
