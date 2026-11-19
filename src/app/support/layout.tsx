import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { NavLink } from "@/components/nav-link";
import { PORTAL_HOME, requireUser } from "@/server/auth/session";
import { getSetting } from "@/server/modules/settings/service";
import { isManager } from "@/server/modules/support/service";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Support Portal", template: "%s · Support Portal" } };

/** The Support Portal is separate from the work portals, open to every signed-in user. */
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const company = await getSetting("company");
  const manager = isManager(actor);
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-gradient-to-r from-slate-900 to-indigo-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-indigo-200">{company.name}</p>
            <p className="text-lg font-semibold">Support Portal</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href={PORTAL_HOME[actor.portal]} className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20">← Back to app</Link>
            <form action={logoutAction}><button className="hidden rounded-lg px-3 py-1.5 text-indigo-100 hover:bg-white/10 sm:block">Sign out</button></form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm">
          <SupportTab href="/support" exact>{manager ? "Tickets" : "My tickets"}</SupportTab>
          <SupportTab href="/support/new">+ New request</SupportTab>
          {manager && <SupportTab href="/support/settings">Categories</SupportTab>}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

function SupportTab({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  return (
    <span className="[&_a]:!rounded-lg [&_a[aria-current=page]]:!bg-white [&_a[aria-current=page]]:!text-slate-900 [&_a]:!text-indigo-100">
      <NavLink href={href} exact={exact} variant="tab">{children}</NavLink>
    </span>
  );
}
