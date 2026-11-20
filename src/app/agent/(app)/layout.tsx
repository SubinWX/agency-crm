import { AppShell } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";
import { can } from "@/server/rbac/actor";

export const dynamic = "force-dynamic";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("AGENT");
  const commission = can(actor, "commissions.view_own");
  return (
    <AppShell
      actor={actor}
      roleLabel="Agent"
      alertsHref="/agent/alerts"
      accountHref="/agent/account"
      nav={[
        { href: "/agent", label: "My works", icon: "works", exact: true },
        { href: "/agent/works/new", label: "New work", icon: "add" },
        { href: "/agent/calendar", label: "Availability", icon: "calendar" },
        ...(commission ? [{ href: "/agent/commissions", label: "My commission", icon: "commission" as const }] : []),
        { href: "/agent/score", label: "My score", icon: "score" },
        { href: "/support", label: "Support", icon: "support" },
      ]}
      bottomNav={[
        { href: "/agent", label: "Works", exact: true },
        { href: "/agent/works/new", label: "New" },
        { href: "/agent/calendar", label: "Calendar" },
        { href: "/agent/score", label: "Score" },
      ]}
    >
      {children}
    </AppShell>
  );
}
