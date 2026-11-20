import { logoutAction } from "@/app/actions/auth";
import { prisma } from "@/server/db";
import { formatClock } from "@/lib/clock";
import { setBusinessTz } from "@/server/lib/dates";
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
  const [unread, user, company, dt] = await Promise.all([
    unreadCount(actor.id),
    prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true, photoUrl: true, gender: true, updatedAt: true } }),
    getSetting("company"),
    getSetting("dateTime"),
  ]);
  const timeZone = setBusinessTz(dt.timeZone); // keep this server process in sync with Settings
  const hour12 = dt.clockFormat !== "24h";
  const clock = { timeZone, hour12, initial: formatClock(new Date(), timeZone, hour12) };
  return (
    <ShellChrome
      nav={nav}
      bottomNav={bottomNav}
      user={{
        name: user?.name ?? actor.name,
        email: user?.email ?? "",
        roleLabel,
        gender: user?.gender ?? null,
        avatarUrl: user?.photoUrl ? `/api/avatar/${actor.id}?v=${user.updatedAt.getTime()}` : null,
      }}
      company={company.name}
      logoUrl={company.logoKey ? "/api/branding/logo" : null}
      unread={unread}
      alertsHref={alertsHref}
      accountHref={accountHref}
      searchAction={searchAction}
      clock={clock}
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
