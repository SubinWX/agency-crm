/**
 * Development seed. Creates permissions, system roles, two branches, capacity,
 * custom fields and one test login per role.
 *
 * DEV/TEST ACCOUNTS — all use the password: Password@123
 *   superadmin@crm.test  (Super Admin, all branches)
 *   admin@crm.test       (Admin, both branches)
 *   staff@crm.test       (Staff, Main branch)
 *   agent@crm.test       (Agent)
 *   agent2@crm.test      (Agent)
 *   worker1@crm.test     (Worker, both branches)
 *   worker2@crm.test     (Worker, Main branch)
 * Never use these in production.
 */
import { PrismaClient, type Portal } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSION_KEYS } from "../src/server/rbac/permissions";
import { SETTING_DEFAULTS } from "../src/server/modules/settings/service";

const prisma = new PrismaClient();
const DEV_PASSWORD = "Password@123";

const ROLES: { key: string; name: string; portal: Portal; isSuperAdmin?: boolean }[] = [
  { key: "super_admin", name: "Super Admin", portal: "ADMIN", isSuperAdmin: true },
  { key: "admin", name: "Admin", portal: "ADMIN" },
  { key: "staff", name: "Staff", portal: "ADMIN" },
  { key: "agent", name: "Agent / Broker", portal: "AGENT" },
  { key: "worker", name: "Worker", portal: "WORKER" },
  { key: "customer", name: "Customer", portal: "CUSTOMER" },
];

async function main() {
  // Permissions. Keys new to this database are granted to existing system roles
  // that include them by default (upgrade path), without touching choices
  // Super Admin made for keys that already existed.
  const existingKeys = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const newKeys = existingKeys.size ? ALL_PERMISSION_KEYS.filter((k) => !existingKeys.has(k)) : [];
  for (const key of ALL_PERMISSION_KEYS) {
    const [group, description] = PERMISSIONS[key];
    await prisma.permission.upsert({ where: { key }, create: { key, group, description }, update: { group, description } });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  // Roles (permissions only set when the role is first created — later edits are preserved)
  const roleId: Record<string, string> = {};
  for (const r of ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    const role =
      existing ??
      (await prisma.role.create({
        data: {
          key: r.key,
          name: r.name,
          portal: r.portal,
          isSuperAdmin: !!r.isSuperAdmin,
          isSystem: true,
          permissions: {
            create: (DEFAULT_ROLE_PERMISSIONS[r.key] ?? []).map((k) => ({ permissionId: permId.get(k)! })),
          },
        },
      }));
    roleId[r.key] = role.id;
    // Roles created empty in earlier versions (e.g. customer) get their defaults once.
    if (existing && (await prisma.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      for (const k of DEFAULT_ROLE_PERMISSIONS[r.key] ?? []) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permId.get(k)! } });
      }
    }
    if (existing) {
      for (const k of (DEFAULT_ROLE_PERMISSIONS[r.key] ?? []).filter((k) => newKeys.includes(k))) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permId.get(k)! } },
          create: { roleId: role.id, permissionId: permId.get(k)! },
          update: {},
        });
      }
    }
  }

  // Branches
  const main = await prisma.branch.upsert({
    where: { code: "MAIN" },
    create: { name: "Main Workshop", code: "MAIN", address: "12 MG Road, Kochi", phone: "+91 90000 00001" },
    update: {},
  });
  const north = await prisma.branch.upsert({
    where: { code: "NORTH" },
    create: { name: "North Branch", code: "NORTH", address: "45 Station Road, Thrissur", phone: "+91 90000 00002" },
    update: {},
  });

  // Users
  const hash = await bcrypt.hash(DEV_PASSWORD, 12);
  const users: { email: string; name: string; role: string; branches: string[]; phone?: string }[] = [
    { email: "superadmin@crm.test", name: "Sana Super", role: "super_admin", branches: [main.id, north.id] },
    { email: "admin@crm.test", name: "Arun Admin", role: "admin", branches: [main.id, north.id] },
    { email: "staff@crm.test", name: "Sita Staff", role: "staff", branches: [main.id] },
    { email: "agent@crm.test", name: "Anil Agent", role: "agent", branches: [main.id, north.id], phone: "+91 90000 10001" },
    { email: "agent2@crm.test", name: "Asha Agent", role: "agent", branches: [main.id], phone: "+91 90000 10002" },
    { email: "worker1@crm.test", name: "Wasim Worker", role: "worker", branches: [main.id, north.id], phone: "+91 90000 20001" },
    { email: "worker2@crm.test", name: "Vinod Worker", role: "worker", branches: [main.id], phone: "+91 90000 20002" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        phone: u.phone,
        passwordHash: hash,
        roleId: roleId[u.role],
        branches: { create: u.branches.map((branchId) => ({ branchId })) },
      },
      update: {},
    });
  }

  // Capacity + settings
  await prisma.capacitySetting.upsert({ where: { id: 1 }, create: { id: 1, maxPerDay: 10 }, update: {} });
  if ((await prisma.capacityHistory.count()) === 0) {
    await prisma.capacityHistory.create({ data: { oldValue: null, newValue: 10, reason: "Initial setup" } });
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  // Custom work fields (examples from the spec)
  const fields = [
    { key: "width", label: "Width (ft)", type: "DECIMAL" as const, required: true, sortOrder: 10 },
    { key: "height", label: "Height (ft)", type: "DECIMAL" as const, required: true, sortOrder: 20 },
    { key: "slab_color", label: "Slab colour", type: "DROPDOWN" as const, required: false, sortOrder: 30, options: ["Black Galaxy", "Absolute Black", "White", "Tan Brown", "Other"] },
    { key: "quantity", label: "Quantity", type: "NUMBER" as const, required: false, sortOrder: 40 },
    { key: "special_instructions", label: "Special instructions", type: "TEXTAREA" as const, required: false, sortOrder: 50 },
  ];
  for (const f of fields) {
    await prisma.customField.upsert({ where: { key: f.key }, create: f, update: {} });
  }

  // Sample customers
  if ((await prisma.customer.count()) === 0) {
    const agent = await prisma.user.findUniqueOrThrow({ where: { email: "agent@crm.test" } });
    await prisma.customer.createMany({
      data: [
        { name: "Ravi Kumar", phone: "+91 98470 11111", address: "Kakkanad, Kochi", branchId: main.id, createdById: agent.id },
        { name: "Meera Nair", phone: "+91 98470 22222", address: "Edappally, Kochi", branchId: main.id, createdById: agent.id },
        { name: "Thomas George", phone: "+91 98470 33333", address: "Punkunnam, Thrissur", branchId: north.id, createdById: agent.id },
      ],
    });
  }

  for (const name of ["Transport", "Material purchase", "Maintenance", "Electricity", "Salary-related cash", "Other"]) {
    await prisma.expenseCategory.upsert({ where: { name }, create: { name }, update: {} });
  }

  // Support categories
  for (const [i, name] of ["Work / job issue", "Payment / invoice", "App / login problem", "Equipment / material", "Complaint", "Request", "Other"].entries()) {
    await prisma.supportCategory.upsert({ where: { name }, create: { name, sortOrder: i }, update: {} });
  }

  // Notification templates (defaults) and a Test-mode provider for each channel
  // (turned off — Super Admin chooses real providers after subscribing).
  const { ensureTemplates } = await import("../src/server/modules/notifications/config");
  await ensureTemplates(prisma);
  for (const channel of ["EMAIL", "SMS", "WHATSAPP"] as const) {
    await prisma.notificationProvider.upsert({ where: { channel }, create: { channel, provider: "log", enabled: false, config: {} }, update: {} });
  }

  console.log("Seed complete. Dev accounts use password:", DEV_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
