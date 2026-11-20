import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { NavLink } from "@/components/nav-link";
import { SiteFooter, SmartLink, SupportLogo } from "@/components/support-chrome";
import { PORTAL_HOME, requireUser } from "@/server/auth/session";
import { getSetting } from "@/server/modules/settings/service";
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

      <SiteFooter company={company} page={page} />
    </div>
  );
}
