import { AppShell, type NavEntry, type NavLeaf } from "@/components/shell";
import { requirePortal } from "@/server/auth/session";
import { canViewBilling } from "@/server/modules/billing/invoices";
import { canViewInventory } from "@/server/modules/inventory/catalog";
import { reportsFor } from "@/server/modules/reports/definitions";
import { can, canAny, type Actor } from "@/server/rbac/actor";

export const dynamic = "force-dynamic";

type Leaf = NavLeaf & { show?: (a: Actor) => boolean };
type Entry = (Leaf & { icon: NavEntry["icon"] }) | { label: string; icon: NavEntry["icon"]; children: Leaf[] };

/** Grouped office menu; items the user can't use are hidden (the server still enforces every permission). */
const MENU: Entry[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", exact: true },
  { href: "/admin/calendar", label: "Calendar", icon: "calendar", show: (a) => can(a, "calendar.view") },
  {
    label: "Works",
    icon: "works",
    children: [
      { href: "/admin/works", label: "All works", show: (a) => can(a, "works.view_all") },
      { href: "/admin/works/new", label: "Add work", show: (a) => can(a, "works.create") },
      { href: "/admin/approvals", label: "Pending approval", show: (a) => can(a, "works.approve") },
    ],
  },
  {
    label: "Customers",
    icon: "customers",
    children: [
      { href: "/admin/customers", label: "All customers", show: (a) => can(a, "customers.view") },
      { href: "/admin/customers/new", label: "Add customer", show: (a) => can(a, "customers.create") },
    ],
  },
  {
    label: "Agents / Brokers",
    icon: "agents",
    children: [
      { href: "/admin/agents", label: "All agents", show: (a) => can(a, "users.manage") },
      { href: "/admin/agents/new", label: "Add agent", show: (a) => can(a, "users.manage") },
      { href: "/admin/commissions?type=AGENT", label: "Agent commission", show: (a) => can(a, "commissions.manage") },
    ],
  },
  {
    label: "Workers",
    icon: "workers",
    children: [
      { href: "/admin/workers", label: "All workers", show: (a) => can(a, "users.manage") },
      { href: "/admin/workers/new", label: "Add worker", show: (a) => can(a, "users.manage") },
      { href: "/admin/commissions?type=WORKER", label: "Worker commission", show: (a) => can(a, "commissions.manage") },
    ],
  },
  {
    label: "Finance",
    icon: "finance",
    children: [
      { href: "/admin/invoices", label: "Invoices", show: (a) => canViewBilling(a) },
      { href: "/admin/payments", label: "Payments", show: (a) => can(a, "payments.view") },
      { href: "/admin/expenses", label: "Expenses", show: (a) => canAny(a, "expenses.view", "expenses.manage") },
      { href: "/admin/expenses/new", label: "Add expense", show: (a) => can(a, "expenses.manage") },
      { href: "/admin/commissions", label: "Commissions", show: (a) => can(a, "commissions.manage") },
      { href: "/admin/salaries", label: "Salaries", show: (a) => can(a, "staff.manage") },
    ],
  },
  {
    label: "Inventory",
    icon: "inventory",
    children: [
      { href: "/admin/inventory/products", label: "Products", show: (a) => canViewInventory(a) },
      { href: "/admin/inventory", label: "Stock", exact: true, show: (a) => canViewInventory(a) },
      { href: "/admin/inventory/items/new", label: "Add item", show: (a) => can(a, "inventory.manage") },
      { href: "/admin/inventory/movements", label: "Stock history", show: (a) => canViewInventory(a) },
      { href: "/admin/suppliers", label: "Suppliers", show: (a) => canViewInventory(a) },
      { href: "/admin/suppliers/new", label: "Add supplier", show: (a) => can(a, "inventory.manage") },
    ],
  },
  {
    label: "Insights",
    icon: "insights",
    children: [
      { href: "/admin/analytics", label: "Analytics", show: (a) => can(a, "reports.view") },
      { href: "/admin/reports", label: "Reports", show: (a) => reportsFor(a).length > 0 },
    ],
  },
  {
    label: "Support",
    icon: "support",
    children: [
      { href: "/support", label: "Support tickets" },
      { href: "/support/new", label: "New request" },
    ],
  },
  {
    label: "Administration",
    icon: "admin",
    children: [
      { href: "/admin/users", label: "All users & logins", show: (a) => can(a, "users.manage") },
      { href: "/admin/users/new", label: "Add office user", show: (a) => can(a, "users.manage") },
      { href: "/admin/roles", label: "Roles & permissions", show: (a) => can(a, "roles.manage") },
      { href: "/admin/branches", label: "Branches", show: (a) => can(a, "branches.manage") },
      { href: "/admin/notifications", label: "Notifications", show: (a) => can(a, "notifications.manage") },
      { href: "/admin/settings", label: "Settings", show: (a) => can(a, "settings.manage") },
      { href: "/admin/audit", label: "Audit log", show: (a) => can(a, "audit.view") },
    ],
  },
];

function buildNav(actor: Actor): NavEntry[] {
  const out: NavEntry[] = [];
  for (const e of MENU) {
    if ("children" in e) {
      const children = e.children.filter((c) => !c.show || c.show(actor)).map((c) => ({ href: c.href, label: c.label, exact: c.exact }));
      if (children.length) out.push({ label: e.label, icon: e.icon, children });
    } else if (!e.show || e.show(actor)) {
      out.push({ href: e.href, label: e.label, icon: e.icon, exact: e.exact });
    }
  }
  return out;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePortal("ADMIN");
  const roleLabel = actor.isSuperAdmin ? "Super Admin" : actor.roleKey === "staff" ? "Staff" : actor.roleKey === "admin" ? "Admin" : actor.roleKey;
  return (
    <AppShell actor={actor} roleLabel={roleLabel} nav={buildNav(actor)} alertsHref="/admin/alerts" accountHref="/admin/account" searchAction="/admin/search">
      {children}
    </AppShell>
  );
}
