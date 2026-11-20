import { AppShell } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("CUSTOMER");
  return (
    <AppShell
      actor={actor}
      roleLabel="Customer"
      alertsHref="/support"
      accountHref="/portal/account"
      nav={[
        { href: "/portal", label: "My account", icon: "home", exact: true },
        { href: "/support", label: "Help & support", icon: "support" },
      ]}
      bottomNav={[
        { href: "/portal", label: "My account", exact: true },
        { href: "/support", label: "Help & support" },
      ]}
    >
      {children}
    </AppShell>
  );
}
