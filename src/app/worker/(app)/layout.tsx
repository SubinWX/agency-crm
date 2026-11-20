import { AppShell } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";
import { can } from "@/server/rbac/actor";

export const dynamic = "force-dynamic";

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("WORKER");
  const commission = can(actor, "commissions.view_own");
  return (
    <AppShell
      actor={actor}
      roleLabel="Worker"
      alertsHref="/worker/alerts"
      accountHref="/worker/account"
      nav={[
        { href: "/worker", label: "My works", icon: "works", exact: true },
        ...(commission ? [{ href: "/worker/commissions", label: "My commission", icon: "commission" as const }] : []),
        { href: "/worker/alerts", label: "Alerts", icon: "alerts" },
        { href: "/support", label: "Support", icon: "support" },
      ]}
      bottomNav={[
        { href: "/worker", label: "My works", exact: true },
        { href: "/worker/alerts", label: "Alerts" },
        { href: "/support", label: "Support" },
      ]}
    >
      {children}
    </AppShell>
  );
}
