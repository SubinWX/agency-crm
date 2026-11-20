"use client";

import Link from "next/link";
import { PersonAvatar } from "./person-avatar";
import { LiveClock } from "./live-clock";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GuidedTour, startTour } from "./guided-tour";
import type { TourPortal } from "./tour-steps";

/** Stable marker used by the guided tour: "Agents / Brokers" → "nav-agents-brokers". */
const tourId = (label: string) => `nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
import {
  BarChart3, Bell, BadgeIndianRupee, Boxes, Briefcase, CalendarDays, ChevronDown, CircleUserRound, Handshake, HardHat, Home, ImageIcon,
  CircleHelp, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Menu, PlusCircle, Search, ShieldCheck, Sparkles, Trophy, Users, Wallet, X,
} from "lucide-react";

const ICONS = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  works: Briefcase,
  customers: Users,
  workers: HardHat,
  agents: Handshake,
  finance: Wallet,
  inventory: Boxes,
  insights: BarChart3,
  support: LifeBuoy,
  admin: ShieldCheck,
  alerts: Bell,
  commission: BadgeIndianRupee,
  score: Trophy,
  add: PlusCircle,
  home: Home,
} as const;
export type IconName = keyof typeof ICONS;

export type NavLeaf = { href: string; label: string; exact?: boolean };
export type NavEntry = (NavLeaf & { icon: IconName; children?: undefined }) | { label: string; icon: IconName; children: NavLeaf[]; href?: undefined };

export interface ShellUser {
  name: string;
  email: string;
  roleLabel: string;
  avatarUrl: string | null;
  gender?: "MALE" | "FEMALE" | null;
}

const isActive = (path: string, l: NavLeaf) => (l.exact ? path === l.href : path === l.href || path.startsWith(l.href + "/"));

function Avatar({ user, size = 36 }: { user: ShellUser; size?: number }) {
  return <PersonAvatar src={user.avatarUrl} gender={user.gender} name={user.name} size={size} className="ring-2 ring-white" />;
}

/**
 * App chrome shared by every portal: dark sidebar with icon groups that expand
 * into sub-menus, a top bar (page title, search, date, alerts, profile menu)
 * and, on phones, a slide-in drawer plus an optional bottom tab bar.
 */
export function ShellChrome({
  nav,
  bottomNav,
  user,
  company,
  logoUrl,
  unread,
  alertsHref,
  accountHref,
  searchAction,
  clock,
  logoutAction,
  portal,
  userId,
  homePath,
  helpHref,
  children,
}: {
  nav: NavEntry[];
  bottomNav?: NavLeaf[];
  user: ShellUser;
  company: string;
  logoUrl: string | null;
  unread: number;
  alertsHref: string;
  accountHref: string;
  searchAction?: string;
  clock: { timeZone: string; hour12: boolean; initial: { date: string; time: string; zone: string } };
  logoutAction: () => Promise<void>;
  portal: TourPortal;
  userId: string;
  homePath: string;
  helpHref: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(nav.filter((n) => n.children).map((n) => [n.label, n.children!.some((c) => isActive(path, c))])),
  );
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    // Keep the active group expanded when navigating.
    setOpen((o) => ({ ...o, ...Object.fromEntries(nav.filter((n) => n.children?.some((c) => isActive(path, c))).map((n) => [n.label, true])) }));
  }, [path, nav]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  // Only the most specific matching item is highlighted (e.g. "Add work" not also "All works").
  const leaves = nav.flatMap((n) => (n.children ? n.children : [n as NavLeaf]));
  const activeHref = leaves.filter((l) => isActive(path, l)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const title = leaves.find((l) => l.href === activeHref)?.label ?? (path.includes("/account") ? "My profile" : path.includes("/search") ? "Search" : path.endsWith("/help") ? "Help & tutorials" : "");

  const bottomActive = (bottomNav ?? []).filter((l) => isActive(path, l)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const sidebar = (
    <div className="flex h-full flex-col bg-[#0f1b3d] text-slate-300">
      <div className="flex items-center gap-3 px-5 py-5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-1" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-bold text-[#0f1b3d]">{company.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
        )}
        <span className="truncate text-base font-semibold text-white">{company}</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {nav.map((n) => {
          const Icon = ICONS[n.icon];
          if (!n.children) {
            const active = n.href === activeHref;
            return (
              <Link key={n.href} href={n.href} data-tour={tourId(n.label)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"}`}>
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                {n.label}
              </Link>
            );
          }
          const groupActive = n.children.some((c) => c.href === activeHref);
          const isOpen = open[n.label];
          return (
            <div key={n.label}>
              <button
                type="button"
                data-tour={tourId(n.label)}
                onClick={() => setOpen((o) => ({ ...o, [n.label]: !o[n.label] }))}
                aria-expanded={isOpen}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-white/5 hover:text-white ${groupActive ? "text-white" : ""}`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                <span className="flex-1 text-left">{n.label}</span>
                <ChevronDown className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="mb-1 ml-[22px] space-y-0.5 border-l border-white/10 pl-3">
                  {n.children.map((c) => (
                    <Link key={c.href} href={c.href} className={`block rounded-md px-3 py-1.5 text-[13px] transition ${c.href === activeHref ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"}`}>
                      {c.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="space-y-0.5 border-t border-white/10 px-3 py-2">
        <Link href={helpHref} data-tour="nav-help" className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${path === helpHref ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"}`}>
          <CircleHelp className="h-[18px] w-[18px]" strokeWidth={1.75} /> Help & tutorials
        </Link>
      </div>
      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
        <Avatar user={user} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-slate-400">{user.roleLabel}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <GuidedTour portal={portal} userId={userId} homePath={homePath} />
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-xl">
            {sidebar}
            <button className="absolute right-3 top-5 rounded-md p-1 text-slate-300 hover:text-white" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8">
          <button className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">{title}</h1>
          {searchAction && (
            <form action={searchAction} data-tour="search" className="hidden w-80 md:block">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input name="q" placeholder="Search customers, works, invoices…" className="input pl-9" />
              </label>
            </form>
          )}
          <LiveClock {...clock} />
          <Link href={alertsHref} data-tour="alerts" className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label={`Alerts (${unread} unread)`}>
            <Bell className="h-5 w-5" strokeWidth={1.75} />
            {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <div className="relative" ref={menuRef} data-tour="profile">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" aria-label={`Account menu for ${user.name}`} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-slate-100">
              <Avatar user={user} size={34} />
              <span className="hidden text-sm sm:block"><span className="font-semibold text-slate-900">{user.name.split(" ")[0]}</span> <span className="text-slate-500">({user.roleLabel})</span></span>
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-center gap-4 border-b border-slate-100 p-5">
                  <Avatar user={user} size={64} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{user.name}</p>
                    <p className="truncate text-sm text-slate-600">{user.email}</p>
                    <p className="text-xs text-slate-500">{user.roleLabel}</p>
                  </div>
                </div>
                <div className="py-2 text-sm text-slate-700">
                  {[
                    ["profile", "My Profile", CircleUserRound],
                    ["password", "Change Password", KeyRound],
                    ["picture", "Change Picture", ImageIcon],
                  ].map(([tab, label, Icon]) => {
                    const I = Icon as typeof KeyRound;
                    return (
                      <Link key={tab as string} role="menuitem" href={`${accountHref}?tab=${tab}`} onClick={() => setMenu(false)} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                        <I className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.75} /> {label as string}
                      </Link>
                    );
                  })}
                  <Link role="menuitem" href={helpHref} onClick={() => setMenu(false)} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                    <CircleHelp className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.75} /> Help & tutorials
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setDrawer(false);
                      setTimeout(startTour, 150);
                    }}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50"
                  >
                    <Sparkles className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.75} /> Take the tour
                  </button>
                </div>
                <form action={logoutAction} className="border-t border-slate-100 p-4">
                  <button role="menuitem" className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <LogOut className="h-4 w-4" /> Logout
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>

        <main className={`mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 ${bottomNav ? "pb-24 lg:pb-6" : ""}`}>{children}</main>

        {bottomNav && (
          <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${bottomNav.length}, minmax(0, 1fr))` }}>
            {bottomNav.map((n) => (
              <Link key={n.href} href={n.href} className={`flex flex-col items-center py-3 text-xs ${n.href === bottomActive ? "font-semibold text-blue-700" : "text-slate-500"}`}>{n.label}</Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
