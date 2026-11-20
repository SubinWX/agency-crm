import { z } from "zod";
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { forbidden, invalid, notFound, parseInput } from "../../lib/errors";
import { hashPassword, passwordPolicyError } from "../../auth/password";
import { requirePermission, type Actor } from "../../rbac/actor";
import { ALL_PERMISSION_KEYS } from "../../rbac/permissions";
import { storeImage, type UploadInput } from "../../storage";

const userInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(20).optional(),
  roleId: z.string().min(1, "Choose a role"),
  branchIds: z.array(z.string()).default([]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  password: z.string().optional(),
  /** Picks the default icon when there is no photo. Omit to leave unchanged. */
  gender: z.enum(["MALE", "FEMALE"]).or(z.literal("")).optional(),
  /** Optional profile details (location, joining date, emergency contact). */
  profile: z
    .object({
      address: z.string().trim().max(500).optional(),
      joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid joining date").or(z.literal("")).optional(),
      emergencyContact: z.string().trim().max(200).optional(),
    })
    .optional(),
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
  // Super Admin has full access built in: always linked to every branch.
  if (role.isSuperAdmin) d.branchIds = (await prisma.branch.findMany({ where: { deletedAt: null }, select: { id: true } })).map((b) => b.id);
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
          ...(d.gender !== undefined ? { gender: d.gender || null } : {}),
          ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
          branches: { deleteMany: {}, create: d.branchIds.map((branchId) => ({ branchId })) },
        },
      });
      if (d.status === "INACTIVE" || d.password) await tx.session.deleteMany({ where: { userId: id } });
      if (d.profile) await saveProfile(tx, id, d.profile);
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
        gender: d.gender || null,
        passwordHash: await hashPassword(d.password!),
        branches: { create: d.branchIds.map((branchId) => ({ branchId })) },
      },
    });
    if (d.profile) await saveProfile(tx, user.id, d.profile);
    await audit(tx, actor, { action: "user.create", entityType: "User", entityId: user.id, after: { name: d.name, email: d.email, roleId: d.roleId, branchIds: d.branchIds, profile: d.profile ?? null } });
    return user;
  });
}

/** Admin sets or removes someone's profile picture. Only a Super Admin can change a Super Admin's. */
export async function setUserPhoto(actor: Actor, userId: string, file: UploadInput | null, remove = false) {
  requirePermission(actor, "users.manage");
  const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, include: { role: true, branches: true } });
  if (!u) throw notFound("User");
  if (u.role.isSuperAdmin && !actor.isSuperAdmin) throw forbidden("Only a Super Admin can edit a Super Admin.");
  if (!actor.isSuperAdmin && u.branches.length && !u.branches.some((b) => actor.branchIds.includes(b.branchId))) throw forbidden();
  let key: string | null = null;
  if (!remove) {
    if (!file || file.size === 0) throw invalid("Choose a picture.");
    if (file.size > 10 * 1024 * 1024) throw invalid("Picture is too large (max 10 MB).");
    key = (await storeImage(file, "avatars", { maxEdge: 512, square: true })).storageKey;
  }
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { photoUrl: key } });
    await audit(tx, actor, { action: remove ? "user.photo_remove" : "user.photo_change", entityType: "User", entityId: userId });
  });
}

async function saveProfile(tx: Tx, userId: string, p: { address?: string; joiningDate?: string; emergencyContact?: string }) {
  const data = {
    address: p.address || null,
    joiningDate: p.joiningDate ? new Date(`${p.joiningDate}T00:00:00.000Z`) : null,
    emergencyContact: p.emergencyContact || null,
  };
  await tx.staffProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
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
