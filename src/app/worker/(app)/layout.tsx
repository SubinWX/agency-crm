import { AppShell } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";
import { can } from "@/server/rbac/actor";

export const dynamic = "force-dynamic";

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("WORKER");
  return (
    <AppShell
      actor={actor}
      portalLabel="Worker"
      notificationsHref="/worker/alerts"
      bottomNav
      nav={[
        { href: "/worker", label: "My works", exact: true },
        ...(can(actor, "commissions.view_own") ? [{ href: "/worker/commissions", label: "Commission" }] : []),
        { href: "/worker/alerts", label: "Alerts" },
        { href: "/support", label: "Support" },
      ]}
    >
      {children}
    </AppShell>
  );
}
