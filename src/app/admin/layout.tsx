import { AppShell, type NavItem } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";
import { can } from "@/server/rbac/actor";
import { reportsFor } from "@/server/modules/reports/definitions";
import type { PermissionKey } from "@/server/rbac/permissions";

export const dynamic = "force-dynamic";

const NAV: (NavItem & { perm?: PermissionKey })[] = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/works", label: "Works", perm: "works.view_all" },
  { href: "/admin/approvals", label: "Approvals", perm: "works.approve" },
  { href: "/admin/calendar", label: "Calendar", perm: "calendar.view" },
  { href: "/admin/analytics", label: "Analytics", perm: "reports.view" },
  { href: "/admin/reports", label: "Reports", perm: "__reports" as PermissionKey },
  { href: "/admin/customers", label: "Customers", perm: "customers.view" },
  { href: "/admin/invoices", label: "Invoices", perm: "invoices.view" },
  { href: "/admin/payments", label: "Payments", perm: "payments.view" },
  { href: "/admin/expenses", label: "Expenses", perm: "expenses.view" },
  { href: "/admin/commissions", label: "Commissions", perm: "commissions.manage" },
  { href: "/admin/salaries", label: "Salaries", perm: "staff.manage" },
  { href: "/admin/inventory", label: "Inventory", perm: "inventory.view" },
  { href: "/admin/suppliers", label: "Suppliers", perm: "inventory.view" },
  { href: "/admin/users", label: "Users", perm: "users.manage" },
  { href: "/admin/roles", label: "Roles & permissions", perm: "roles.manage" },
  { href: "/admin/branches", label: "Branches", perm: "branches.manage" },
  { href: "/support", label: "Support Portal ↗" },
  { href: "/admin/notifications", label: "Notifications", perm: "notifications.manage" },
  { href: "/admin/settings", label: "Settings", perm: "settings.manage" },
  { href: "/admin/audit", label: "Audit log", perm: "audit.view" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("ADMIN");
  const portalLabel = actor.isSuperAdmin ? "Super Admin" : actor.roleKey === "staff" ? "Staff" : "Admin";
  return (
    <AppShell actor={actor} portalLabel={portalLabel} notificationsHref="/admin/alerts" nav={NAV.filter((n) => !n.perm || (n.perm === ("__reports" as PermissionKey) ? reportsFor(actor).length > 0 : can(actor, n.perm)))}>
      {children}
    </AppShell>
  );
}
