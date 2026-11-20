import { logoutAction } from "@/app/actions/auth";
import { prisma } from "@/server/db";
import { BUSINESS_TZ } from "@/server/lib/dates";
import { unreadCount } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import type { Actor } from "@/server/rbac/actor";
import { PORTAL_HOME } from "@/server/auth/session";
import { ShellChrome, type NavEntry, type NavLeaf } from "./shell-chrome";

export type { NavEntry, NavLeaf } from "./shell-chrome";

/** Server wrapper: loads user, company and alert count, then renders the client chrome. */
export async function AppShell({
  actor,
  nav,
  bottomNav,
  roleLabel,
  alertsHref,
  accountHref,
  searchAction,
  children,
}: {
  actor: Actor;
  nav: NavEntry[];
  bottomNav?: NavLeaf[];
  roleLabel: string;
  alertsHref: string;
  accountHref: string;
  searchAction?: string;
  children: React.ReactNode;
}) {
  const [unread, user, company] = await Promise.all([
    unreadCount(actor.id),
    prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true, photoUrl: true, updatedAt: true } }),
    getSetting("company"),
  ]);
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: BUSINESS_TZ });
  return (
    <ShellChrome
      nav={nav}
      bottomNav={bottomNav}
      user={{
        name: user?.name ?? actor.name,
        email: user?.email ?? "",
        roleLabel,
        avatarUrl: user?.photoUrl ? `/api/avatar/${actor.id}?v=${user.updatedAt.getTime()}` : null,
      }}
      company={company.name}
      logoUrl={company.logoKey ? "/api/branding/logo" : null}
      unread={unread}
      alertsHref={alertsHref}
      accountHref={accountHref}
      searchAction={searchAction}
      todayLabel={todayLabel}
      logoutAction={logoutAction}
      portal={actor.portal}
      userId={actor.id}
      homePath={PORTAL_HOME[actor.portal]}
      helpHref={`${PORTAL_HOME[actor.portal]}/help`}
    >
      {children}
    </ShellChrome>
  );
}
