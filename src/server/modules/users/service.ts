import { z } from "zod";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { forbidden, invalid, notFound, parseInput } from "../../lib/errors";
import { hashPassword, passwordPolicyError } from "../../auth/password";
import { requirePermission, type Actor } from "../../rbac/actor";
import { ALL_PERMISSION_KEYS } from "../../rbac/permissions";

const userInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(20).optional(),
  roleId: z.string().min(1, "Choose a role"),
  branchIds: z.array(z.string()).default([]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  password: z.string().optional(),
});
export type UserInput = z.input<typeof userInput>;

export async function listUsers(actor: Actor, q = "") {
  requirePermission(actor, "users.manage");
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
      // Admins only see users of their branches (or users without a branch); Super Admin sees all.
      ...(actor.isSuperAdmin ? {} : { OR: [{ branches: { some: { branchId: { in: [...actor.branchIds] } } } }, { branches: { none: {} } }] }),
    },
    include: { role: true, branches: { include: { branch: { select: { name: true } } } } },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" }, include: { permissions: { include: { permission: true } } } });
}

export async function listWorkersForBranch(branchId: string) {
  return prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", role: { portal: "WORKER" }, branches: { some: { branchId } } },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
  });
}

export async function listAgents() {
  return prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", role: { portal: "AGENT" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function saveUser(actor: Actor, input: UserInput, id?: string) {
  requirePermission(actor, "users.manage");
  const d = parseInput(userInput, input);
  const role = await prisma.role.findUnique({ where: { id: d.roleId } });
  if (!role) throw invalid("Role not found.");
  // Prevent role escalation: only Super Admin can create/modify Super Admins or role-managers.
  if (role.isSuperAdmin && !actor.isSuperAdmin) throw forbidden("Only a Super Admin can grant Super Admin access.");
  if (!actor.isSuperAdmin && d.branchIds.some((b) => !actor.branchIds.includes(b))) {
    throw forbidden("You can only assign branches you have access to.");
  }
  if (!id || d.password) {
    const err = d.password ? passwordPolicyError(d.password) : "Password is required for new users.";
    if (err) throw invalid(err);
  }

  return transaction(async (tx) => {
    const dupe = await tx.user.findFirst({ where: { email: d.email, NOT: id ? { id } : undefined } });
    if (dupe) throw invalid("A user with this email already exists.");

    if (id) {
      const before = await tx.user.findFirst({ where: { id, deletedAt: null }, include: { role: true, branches: true } });
      if (!before) throw notFound("User");
      if (before.role.isSuperAdmin && !actor.isSuperAdmin) throw forbidden("Only a Super Admin can edit a Super Admin.");
      if (before.id === actor.id && before.roleId !== d.roleId) throw forbidden("You cannot change your own role.");
      const user = await tx.user.update({
        where: { id },
        data: {
          name: d.name,
          email: d.email,
          phone: d.phone || null,
          roleId: d.roleId,
          status: d.status,
          ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
          branches: { deleteMany: {}, create: d.branchIds.map((branchId) => ({ branchId })) },
        },
      });
      if (d.status === "INACTIVE" || d.password) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, actor, {
        action: before.roleId !== d.roleId ? "user.role_change" : "user.update",
        entityType: "User",
        entityId: id,
        before: { name: before.name, email: before.email, roleId: before.roleId, status: before.status, branchIds: before.branches.map((b) => b.branchId) },
        after: { name: d.name, email: d.email, roleId: d.roleId, status: d.status, branchIds: d.branchIds, passwordChanged: !!d.password },
      });
      return user;
    }
    const user = await tx.user.create({
      data: {
        name: d.name,
        email: d.email,
        phone: d.phone || null,
        roleId: d.roleId,
        status: d.status,
        passwordHash: await hashPassword(d.password!),
        branches: { create: d.branchIds.map((branchId) => ({ branchId })) },
      },
    });
    await audit(tx, actor, { action: "user.create", entityType: "User", entityId: user.id, after: { name: d.name, email: d.email, roleId: d.roleId, branchIds: d.branchIds } });
    return user;
  });
}

/** Super Admin configures which permissions each role holds. */
export async function setRolePermissions(actor: Actor, roleId: string, permissionKeys: string[]) {
  requirePermission(actor, "roles.manage");
  const keys = [...new Set(permissionKeys)].filter((k) => (ALL_PERMISSION_KEYS as string[]).includes(k));
  await transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw notFound("Role");
    if (role.isSuperAdmin) throw invalid("Super Admin always has every permission.");
    const perms = await tx.permission.findMany({ where: { key: { in: keys } } });
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
    await audit(tx, actor, {
      action: "role.permissions_change",
      entityType: "Role",
      entityId: roleId,
      before: role.permissions.map((rp) => rp.permission.key).sort(),
      after: keys.sort(),
    });
  });
}
