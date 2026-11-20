import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Mail, MessageCircle, Phone } from "lucide-react";
import { ImageGallery } from "@/components/image-gallery";
import { waLink } from "@/components/support-chrome";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { getPublicProduct } from "@/server/modules/inventory/catalog";
import { getSetting } from "@/server/modules/settings/service";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p, company] = await Promise.all([getPublicProduct("", slug.toLowerCase()), getSetting("company")]);
  return p ? { title: `${p.name} · ${company.name}`, description: p.description ?? `${p.name} from ${company.name}.` } : { title: "Product not found" };
}

export default async function PublicProduct({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p, page] = await Promise.all([getPublicProduct("", slug.toLowerCase()), getSetting("supportPortal")]);
  if (!p) notFound();
  const wa = page.socials.whatsapp ? waLink(page.socials.whatsapp, `Hi, I'm interested in ${p.name} (${p.sku}).`) : null;

  return (
    <>
      <Link href="/products" className="text-sm text-blue-700">← All products</Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          {p.images.length > 0 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.images[0]} alt={p.name} className="mb-3 aspect-[4/3] w-full rounded-xl object-cover" />
              {p.images.length > 1 && <ImageGallery images={p.images.map((src, i) => ({ src, caption: `${p.name} ${i + 1}` }))} allowDownload={false} />}
            </>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-slate-100 text-slate-400">No photo yet</div>
          )}
        </div>
        <div>
          {p.category && <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">{p.category}</p>}
          <h1 className="mt-1 text-3xl font-bold">{p.name}</h1>
          <p className="mt-1 text-sm text-slate-500">SKU {p.sku}</p>
          <p className="mt-5 text-2xl font-semibold">{p.price !== null ? <>{formatINR(toPaise(String(p.price)))} <span className="text-base font-normal text-slate-500">/ {p.unit}</span></> : <span className="text-lg text-slate-600">Price on request</span>}</p>
          {p.description && <p className="mt-5 whitespace-pre-line leading-relaxed text-slate-700">{p.description}</p>}
          <div className="mt-8 flex flex-wrap gap-3">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn rounded-full bg-[#25D366] px-5 text-white hover:brightness-95"><MessageCircle className="h-4 w-4" /> Enquire on WhatsApp</a>}
            {page.contactPhone && <a href={`tel:${page.contactPhone.replace(/[^\d+]/g, "")}`} className="btn-secondary rounded-full px-5"><Phone className="h-4 w-4" /> Call us</a>}
            {page.contactEmail && <a href={`mailto:${page.contactEmail}?subject=${encodeURIComponent(`Enquiry: ${p.name}`)}`} className="btn-secondary rounded-full px-5"><Mail className="h-4 w-4" /> Email</a>}
            {p.websiteUrl && <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary rounded-full px-5"><ExternalLink className="h-4 w-4" /> More details</a>}
          </div>
        </div>
      </div>
    </>
  );
}
