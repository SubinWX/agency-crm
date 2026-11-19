/**
 * Permission catalog. Permissions are stored in the database and attached to
 * roles; Super Admin can reconfigure them. This list only defines what exists
 * (seeded) — it does not hard-code who has what.
 */
export const PERMISSIONS = {
  // Customers
  "customers.view": ["Customers", "View customers"],
  "customers.create": ["Customers", "Create customers"],
  "customers.edit": ["Customers", "Edit customers"],
  "customers.archive": ["Customers", "Archive customers"],
  "customers.edit_protected": ["Customers", "Edit protected customer info (e.g. name) from a work"],

  // Works
  "works.view_all": ["Works", "View all works in authorised branches"],
  "works.view_own": ["Works", "View works the user created (agents)"],
  "works.view_assigned": ["Works", "View works assigned to the user (workers)"],
  "works.create": ["Works", "Create works"],
  "works.edit": ["Works", "Edit any work in authorised branches"],
  "works.edit_own": ["Works", "Edit permitted fields on own works (location, images, details)"],
  "works.change_date": ["Works", "Change a work's date"],
  "works.assign_workers": ["Works", "Assign / remove workers"],
  "works.complete": ["Works", "Submit completion for assigned works"],
  "works.approve": ["Works", "Approve or reject completed works"],
  "works.change_status": ["Works", "Change work status manually"],
  "works.cancel": ["Works", "Cancel works"],
  "works.comment": ["Works", "Comment on accessible works"],
  "works.view_image_history": ["Works", "View previous / removed images"],

  // Capacity & calendar
  "calendar.view": ["Calendar", "View availability calendar"],
  "capacity.manage": ["Calendar", "Change company-wide daily capacity"],

  // Configuration
  "custom_fields.manage": ["Settings", "Manage custom work fields"],
  "settings.manage": ["Settings", "Manage system settings and messages"],
  "branding.manage": ["Settings", "Change login page image and text"],
  "branches.manage": ["Branches", "Manage branches"],
  "users.manage": ["Users", "Manage users"],
  "roles.manage": ["Users", "Configure roles and permissions"],
  "audit.view": ["Audit", "View audit logs"],

  // Later phases (catalogued now so roles can be configured up front)
  "invoices.view": ["Billing", "View invoices"],
  "invoices.create": ["Billing", "Create and edit invoices"],
  "invoices.cancel": ["Billing", "Cancel invoices"],
  "payments.record": ["Billing", "Record payments"],
  "payments.view": ["Billing", "View payments"],
  "payments.void": ["Billing", "Void payments"],
  "billing.settings": ["Billing", "Manage GST, invoice and commission settings"],
  "expenses.manage": ["Billing", "Manage expenses"],
  "commissions.manage": ["Billing", "Manage commissions"],
  "commissions.view_own": ["Billing", "View own commission"],
  "inventory.view": ["Inventory", "View products, materials and stock"],
  "inventory.manage": ["Inventory", "Manage products, raw materials and suppliers"],
  "inventory.edit_stock": ["Inventory", "Change stock (in / out / adjust / transfer) in own branches"],
  "staff.manage": ["Staff", "Manage staff and salary"],
  "expenses.view": ["Billing", "View expenses"],
  "notifications.manage": ["Settings", "Manage notification providers"],
  "support.create": ["Support", "Raise support complaints / requests"],
  "support.manage": ["Support", "Manage support tickets: assign, reply, internal notes, resolve, close"],
  "reports.view": ["Reports", "View reports"],
} as const satisfies Record<string, readonly [string, string]>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Default grants for seeded system roles (editable afterwards in the UI). */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: ALL_PERMISSION_KEYS.filter(
    (k) => !["roles.manage", "notifications.manage", "branding.manage", "works.view_own", "works.view_assigned", "works.complete", "works.edit_own", "commissions.view_own"].includes(k),
  ),
  staff: [
    "customers.view", "customers.create", "customers.edit",
    "works.view_all", "works.create", "works.comment", "calendar.view",
    "inventory.view", "inventory.edit_stock", "support.create",
  ],
  agent: [
    "customers.view", "customers.create",
    "works.view_own", "works.create", "works.edit_own", "works.comment",
    "calendar.view", "commissions.view_own", "support.create",
  ],
  worker: ["works.view_assigned", "works.complete", "works.comment", "support.create"],
  customer: ["support.create"],
};
