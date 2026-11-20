import Link from "next/link";
import { SiteFooter, SmartLink, SupportLogo } from "@/components/support-chrome";
import { getSetting } from "@/server/modules/settings/service";

export const dynamic = "force-dynamic";

/** Public product catalogue — no sign-in needed. Only products marked "Show on website". */
export default async function ProductsLayout({ children }: { children: React.ReactNode }) {
  const [company, page] = await Promise.all([getSetting("company"), getSetting("supportPortal")]);
  const contact = page.contactPhone ? `tel:${page.contactPhone.replace(/[^\d+]/g, "")}` : page.contactEmail ? `mailto:${page.contactEmail}` : null;
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/products" className="flex min-w-0 items-center gap-3">
            <SupportLogo name={company.name} hasLogo={!!company.logoKey} version={company.logoKey} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold text-slate-900">{company.name}</p>
              <p className="text-xs font-medium uppercase tracking-wider text-blue-600">Products</p>
            </div>
          </Link>
          {contact && <SmartLink href={contact} className="btn-primary rounded-full px-5">Contact us</SmartLink>}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <SiteFooter company={company} page={page} />
    </div>
  );
}
