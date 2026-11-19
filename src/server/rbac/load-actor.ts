import { prisma } from "../db";
import type { Actor } from "./actor";

/** Build an Actor (role, permissions, branches) for a user id. Returns null if inactive/deleted. */
export async function loadActor(userId: string, meta?: { ip?: string | null; userAgent?: string | null }): Promise<Actor | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "ACTIVE" },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      branches: true,
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    roleKey: user.role.key,
    portal: user.role.portal,
    isSuperAdmin: user.role.isSuperAdmin,
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
    branchIds: user.branches.map((b) => b.branchId),
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  };
}
