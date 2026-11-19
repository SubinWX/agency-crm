import { AppShell } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";
import { can } from "@/server/rbac/actor";

export const dynamic = "force-dynamic";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("AGENT");
  return (
    <AppShell
      actor={actor}
      portalLabel="Agent"
      notificationsHref="/agent/alerts"
      bottomNav
      nav={[
        { href: "/agent", label: "My works", exact: true },
        { href: "/agent/works/new", label: "New work" },
        { href: "/agent/calendar", label: "Calendar" },
        { href: "/agent/score", label: "Score" },
        ...(can(actor, "commissions.view_own") ? [{ href: "/agent/commissions", label: "Commission" }] : []),
        { href: "/support", label: "Support" },
      ]}
    >
      {children}
    </AppShell>
  );
}
