import { z } from "zod";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { invalid, notFound, parseInput } from "../../lib/errors";
import { requirePermission, type Actor } from "../../rbac/actor";

/** Branches the actor may access (all for Super Admin). */
export async function listAccessibleBranches(actor: Actor) {
  return prisma.branch.findMany({
    where: { deletedAt: null, status: "ACTIVE", ...(actor.isSuperAdmin ? {} : { id: { in: [...actor.branchIds] } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
}

export async function listBranchesAdmin(actor: Actor) {
  requirePermission(actor, "branches.manage");
  return prisma.branch.findMany({
    where: { deletedAt: null, ...(actor.isSuperAdmin ? {} : { id: { in: [...actor.branchIds] } }) },
    include: { inCharge: { select: { name: true } }, _count: { select: { works: true, users: true } } },
    orderBy: { name: "asc" },
  });
}

const branchInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "Code: 2–12 letters/numbers"),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().or(z.literal("")).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export type BranchInput = z.input<typeof branchInput>;

export async function saveBranch(actor: Actor, input: BranchInput, id?: string) {
  requirePermission(actor, "branches.manage");
  if (!id && !actor.isSuperAdmin) throw invalid("Only a Super Admin can create branches.");
  const d = parseInput(branchInput, input);
  return transaction(async (tx) => {
    const dupe = await tx.branch.findFirst({ where: { code: d.code, NOT: id ? { id } : undefined } });
    if (dupe) throw invalid("Another branch already uses this code.");
    const data = { name: d.name, code: d.code, address: d.address || null, phone: d.phone || null, email: d.email || null, status: d.status };
    if (id) {
      const before = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound("Branch");
      if (!actor.isSuperAdmin && !actor.branchIds.includes(id)) throw notFound("Branch");
      const b = await tx.branch.update({ where: { id }, data });
      await audit(tx, actor, { action: "branch.update", entityType: "Branch", entityId: id, before, after: b });
      return b;
    }
    const b = await tx.branch.create({ data });
    await audit(tx, actor, { action: "branch.create", entityType: "Branch", entityId: b.id, after: b });
    return b;
  });
}
