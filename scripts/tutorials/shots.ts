/**
 * Screenshot plan: one entry per guide step (same order as the steps in
 * src/server/modules/help/guides.ts; null = no picture for that step).
 *
 *  go     page to open. {WRK-000001}, {INV-000001}, {SUP-000001}, {PRD-001},
 *         {RM-EPO-KG} and {customer:Ravi Kumar} are replaced with real ids.
 *  mark   what to highlight: visible text of a button / link / label / heading
 *         ("button:Add agent" to pick the tag). Headings highlight their card.
 */
import type { Role } from "./browser";

export type Shot = { as: Role; go: string; mark?: string | string[]; device?: "desktop" | "phone" } | null;

const A = (go: string, mark?: string | string[]): Shot => ({ as: "admin", go, mark, device: "desktop" });
const AG = (go: string, mark?: string | string[]): Shot => ({ as: "agent", go, mark, device: "phone" });
const WK = (go: string, mark?: string | string[]): Shot => ({ as: "worker", go, mark, device: "phone" });
const CU = (go: string, mark?: string | string[]): Shot => ({ as: "customer", go, mark, device: "phone" });

export const SHOTS: Record<string, Shot[]> = {
  flow: [
    A("/admin/works?view=day", "+ New work"),
    A("/admin/works/{WRK-000002}", "h2:Workers (1)"),
    WK("/worker/works/{WRK-000001}", "h2:Your actions"),
    A("/admin/works/{WRK-000010}", "h2:Review completion"),
    A("/admin/commissions", "a:ACCRUED"),
    A("/admin/invoices/{INV-000001}", "h2:Payments (1)"),
  ],
  "add-work": [
    A("/admin/works/new", "h1:New work"),
    A("/admin/works/new", "h2:1 Customer"),
    A("/admin/works/new", "h2:2 Work details"),
    A("/admin/works/new", "h2:3 Work date"),
    A("/admin/works/new", "button:Submit work"),
  ],
  assign: [A("/admin/works?view=day", "a:WRK-000002"), A("/admin/works/{WRK-000002}", "h2:Workers (1)"), null],
  approve: [A("/admin/approvals", "a:WRK-000010"), A("/admin/works/{WRK-000010}", "h2:Completion"), A("/admin/works/{WRK-000010}", "h2:Review completion")],
  reschedule: [A("/admin/works/{WRK-000004}", "h1:WRK-000004"), A("/admin/works/{WRK-000004}", "h2:Change date"), A("/admin/works/{WRK-000004}", "button:Move work")],
  invoice: [
    A("/admin/works/{WRK-000001}", "h2:Billing"),
    A("/admin/invoices/new?workId={WRK-000014}", "button:+ Add line"),
    A("/admin/invoices/{INV-000001}", "a:Open PDF / Print"),
    A("/admin/invoices/{INV-000002}", "h2:Payments (1)"),
  ],
  commission: [A("/admin/commissions", "h1:Commissions"), A("/admin/commissions", "label:With selected"), A("/admin/commissions", "label:Payout reference (for paid)")],
  people: [A("/admin/agents/new", "h1:Add agent"), A("/admin/agents/new", "label:Phone *"), A("/admin/agents/new", "legend:Branch *"), A("/admin/agents/new", "button:Add agent")],
  capacity: [A("/admin/settings", "h2:Daily work capacity (company-wide)"), A("/admin/calendar", "h2:Block / unblock a date (holidays)")],
  stock: [A("/admin/inventory", "a:Epoxy adhesive"), A("/admin/inventory/items/{RM-EPO-KG}", "h2:Change stock"), A("/admin/inventory/items/{RM-EPO-KG}", "h2:Stock history"), A("/admin/works/{WRK-000001}", "h2:Materials used")],
  notify: [A("/admin/notifications", "a:Providers"), A("/admin/notifications", "h2:WhatsApp"), A("/admin/notifications", "button:Send test"), A("/admin/notifications", "a:Templates")],
  "portal-access": [A("/admin/customers", "a:Ravi Kumar"), A("/admin/customers/{customer:Ravi Kumar}", "h2:Customer portal access"), null],
  reports: [A("/admin/reports", "a:Work report"), A("/admin/reports", "button:Run report"), A("/admin/reports", "a:PDF")],
  "support-admin": [
    A("/support", "a:Commission for October not shown"),
    A("/support/{SUP-000001}", "h2:Reply or add a note"),
    A("/support/{SUP-000001}", "h2:Manage ticket"),
    A("/support/{SUP-000001}", "label:Resolution (needed to resolve)"),
  ],
  "products-website": [
    A("/admin/inventory/products", "a:+ Add product"),
    A("/admin/inventory/items/{PRD-001}", "legend:Website"),
    A("/admin/inventory/items/{PRD-001}", "h2:Website"),
    A("/products"),
  ],
  "support-customize": [A("/support/customize", "h2:Top banner"), A("/support/customize", "h2:Footer & contact"), A("/support", "h1:How can we help you today?")],
  "time-zone": [A("/admin/settings", "h2:Date & time"), A("/admin", "[title^='Time zone']")],

  "agent-new": [AG("/agent", "a:+ New work"), AG("/agent/works/new", "h2:1 Customer"), AG("/agent/works/new", "h2:2 Work details"), AG("/agent/works/new", "h2:3 Work date"), AG("/agent/works/new", "button:Submit work")],
  "agent-edit": [AG("/agent", "a:Ravi Kumar WRK-000001"), AG("/agent/works/{WRK-000001}", "h2:Edit details"), AG("/agent/works/{WRK-000001}", "h2:Work images (1)")],
  "agent-money": [AG("/agent/commissions", "h1:My commission"), AG("/agent/score", "h1:My score")],
  "agent-support": [AG("/support", "a:+ New request"), AG("/support/new", "label:Category *"), null],
  "worker-day": [WK("/worker", "h1:Today's works"), WK("/worker", "a:‹"), WK("/worker/works/{WRK-000001}", "h2:Details")],
  "worker-complete": [WK("/worker/works/{WRK-000004}", "button:Start work"), WK("/worker/works/{WRK-000001}", "label:Completion photos *"), WK("/worker/works/{WRK-000001}", "button:Mark completed")],
  "worker-support": [WK("/support", "a:+ New request"), WK("/support/new", "label:Description *")],
  "customer-works": [CU("/portal", "h2:My works"), CU("/portal/works/{WRK-000012}", "h2:Completion photos")],
  "customer-invoices": [CU("/portal", "h2:Invoices"), CU("/portal", "a:PDF"), CU("/portal", "h2:Payments")],
  "customer-help": [CU("/portal", "a:Need help?"), CU("/support/new", "label:Category *")],
};
