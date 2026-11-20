import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { NavLink } from "@/components/nav-link";
import { ContactIcons, SmartLink, SOCIAL_ICONS, SOCIAL_LABELS, SupportLogo } from "@/components/support-chrome";
import { PORTAL_HOME, requireUser } from "@/server/auth/session";
import { getSetting } from "@/server/modules/settings/service";
import { whatsappLink } from "@/server/modules/support/page-settings";
import { isManager } from "@/server/modules/support/service";
import { can } from "@/server/rbac/actor";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Support", template: "%s · Support" } };

/** The Support Portal is separate from the work portals, open to every signed-in user. */
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const [company, page] = await Promise.all([getSetting("company"), getSetting("supportPortal")]);
  const manager = isManager(actor);
  const canCustomize = can(actor, "branding.manage");
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof typeof SOCIAL_ICONS)[])
    .map((k) => ({ k, href: k === "whatsapp" ? whatsappLink(page.socials.whatsapp) : page.socials[k] }))
    .filter((s): s is { k: keyof typeof SOCIAL_ICONS; href: string } => !!s.href);
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/support" className="flex min-w-0 items-center gap-3">
            <SupportLogo name={company.name} hasLogo={!!company.logoKey} version={company.logoKey} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold text-slate-900">{company.name}</p>
              <p className="text-xs font-medium uppercase tracking-wider text-blue-600">Support</p>
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <Link href={PORTAL_HOME[actor.portal]} className="hidden items-center gap-1 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 sm:inline-flex"><ArrowLeft className="h-4 w-4" /> Back to app</Link>
            {page.headerCtaLabel && page.headerCtaHref && <SmartLink href={page.headerCtaHref} className="btn-primary rounded-full px-5">{page.headerCtaLabel}</SmartLink>}
            <form action={logoutAction}><button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button></form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm">
          <NavLink href="/support" exact variant="tab">{manager ? "Tickets" : "My tickets"}</NavLink>
          <NavLink href="/support/new" variant="tab">New request</NavLink>
          {manager && <NavLink href="/support/settings" variant="tab">Categories</NavLink>}
          {canCustomize && <NavLink href="/support/customize" variant="tab">Customise page</NavLink>}
          <Link href={PORTAL_HOME[actor.portal]} className="rounded-lg px-3 py-1.5 text-slate-500 sm:hidden">← App</Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      <footer className="mt-10 bg-[#0f1b3d] text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <SupportLogo name={company.name} hasLogo={!!company.logoKey} version={company.logoKey} dark />
              <span className="font-semibold text-white">{company.name}</span>
            </div>
            {page.footerText && <p className="max-w-sm text-sm leading-relaxed text-slate-400">{page.footerText}</p>}
          </div>
          {(page.contactEmail || page.contactPhone || page.address) && (
            <div className="space-y-2 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Contact us</p>
              {page.contactEmail && <a href={`mailto:${page.contactEmail}`} className="flex items-center gap-2 hover:text-white"><ContactIcons.Mail className="h-4 w-4" /> {page.contactEmail}</a>}
              {page.contactPhone && <a href={`tel:${page.contactPhone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 hover:text-white"><ContactIcons.Phone className="h-4 w-4" /> {page.contactPhone}</a>}
              {page.address && <p className="flex items-start gap-2"><ContactIcons.MapPin className="mt-0.5 h-4 w-4 shrink-0" /> <span className="whitespace-pre-line">{page.address}</span></p>}
            </div>
          )}
          {socials.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Follow us</p>
              <div className="flex flex-wrap gap-2">
                {socials.map(({ k, href }) => {
                  const Icon = SOCIAL_ICONS[k];
                  return (
                    <a key={k} href={href} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABELS[k]} title={SOCIAL_LABELS[k]} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white hover:text-[#0f1b3d]">
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">© {year} {company.name}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
