import { AppShell } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("CUSTOMER");
  return (
    <AppShell actor={actor} portalLabel="Customer" notificationsHref="/support" bottomNav nav={[{ href: "/portal", label: "My account", exact: true }, { href: "/support", label: "Help & support" }]}>
      {children}
    </AppShell>
  );
}
