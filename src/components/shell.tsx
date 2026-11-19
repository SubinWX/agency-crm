import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import type { Actor } from "@/server/rbac/actor";
import { unreadCount } from "@/server/modules/notifications/service";
import { NavLink } from "./nav-link";

export type NavItem = { href: string; label: string; exact?: boolean };

/** Desktop: sidebar. Mobile: top bar + bottom tab bar (for agent/worker) or scrollable tabs. */
export async function AppShell({
  actor,
  nav,
  portalLabel,
  notificationsHref,
  children,
  bottomNav = false,
}: {
  actor: Actor;
  nav: NavItem[];
  portalLabel: string;
  notificationsHref: string;
  children: React.ReactNode;
  bottomNav?: boolean;
}) {
  const unread = await unreadCount(actor.id);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">{portalLabel}</p>
          <p className="truncate text-sm font-semibold">{actor.name}</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.exact} variant="side">{n.label}</NavLink>
          ))}
        </nav>
        <form action={logoutAction} className="border-t border-slate-100 p-3">
          <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">Sign out</button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="min-w-0 lg:hidden">
            <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">{portalLabel}</p>
            <p className="truncate text-sm font-semibold">{actor.name}</p>
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <Link href={notificationsHref} className="relative rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
              Alerts
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>
              )}
            </Link>
            <form action={logoutAction} className="lg:hidden">
              <button className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Sign out</button>
            </form>
          </div>
        </header>

        {!bottomNav && (
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 lg:hidden">
            {nav.map((n) => (
              <NavLink key={n.href} href={n.href} exact={n.exact} variant="tab">{n.label}</NavLink>
            ))}
          </nav>
        )}

        <main className={`mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 ${bottomNav ? "pb-24 lg:pb-6" : ""}`}>{children}</main>

        {bottomNav && (
          <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map((n) => (
              <NavLink key={n.href} href={n.href} exact={n.exact} variant="bottom">{n.label}</NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
