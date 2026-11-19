import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { forbidden, notFound, parseInput } from "../../lib/errors";
import { can, canAccessBranch, requirePermission, type Actor } from "../../rbac/actor";

export const customerInput = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, "Enter a valid phone number"),
  altPhone: z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, "Enter a valid phone number").or(z.literal("")).optional(),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  address: z.string().trim().max(500).optional(),
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  branchId: z.string().optional(),
});
export type CustomerInput = z.input<typeof customerInput>;

const blankToNull = (v?: string) => (v && v.length ? v : null);

/** Which customers an actor can see. Agents only see customers on their own works or created by them. */
function customerScope(actor: Actor): Prisma.CustomerWhereInput {
  if (actor.isSuperAdmin) return {};
  if (actor.portal === "AGENT") {
    return { OR: [{ createdById: actor.id }, { works: { some: { agentId: actor.id } } }] };
  }
  return { OR: [{ branchId: null }, { branchId: { in: [...actor.branchIds] } }] };
}

export async function searchCustomers(actor: Actor, q: string, page = 1, pageSize = 20) {
  requirePermission(actor, "customers.view");
  const term = q.trim();
  const where: Prisma.CustomerWhereInput = {
    deletedAt: null,
    AND: [
      customerScope(actor),
      term
        ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }, { altPhone: { contains: term } }] }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { branch: { select: { name: true } }, _count: { select: { works: true } } },
    }),
    prisma.customer.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getCustomer(actor: Actor, id: string) {
  requirePermission(actor, "customers.view");
  const c = await prisma.customer.findFirst({ where: { id, deletedAt: null, AND: [customerScope(actor)] } });
  if (!c) throw notFound("Customer");
  return c;
}

export async function createCustomer(actor: Actor, input: CustomerInput, tx?: Tx) {
  requirePermission(actor, "customers.create");
  const d = parseInput(customerInput, input);
  if (d.branchId && !canAccessBranch(actor, d.branchId)) throw forbidden("You do not have access to this branch.");
  const run = async (t: Tx) => {
    const c = await t.customer.create({
      data: {
        name: d.name,
        phone: d.phone,
        altPhone: blankToNull(d.altPhone),
        email: blankToNull(d.email),
        address: blankToNull(d.address),
        location: blankToNull(d.location),
        notes: blankToNull(d.notes),
        branchId: d.branchId || null,
        createdById: actor.id,
      },
    });
    await audit(t, actor, { action: "customer.create", entityType: "Customer", entityId: c.id, after: c });
    return c;
  };
  return tx ? run(tx) : transaction(run);
}

export async function updateCustomer(actor: Actor, id: string, input: CustomerInput) {
  requirePermission(actor, "customers.edit");
  const d = parseInput(customerInput, input);
  return transaction(async (tx) => {
    const before = await tx.customer.findFirst({ where: { id, deletedAt: null, AND: [customerScope(actor)] } });
    if (!before) throw notFound("Customer");
    if (before.name !== d.name && !can(actor, "customers.edit_protected") && actor.portal !== "ADMIN") {
      throw forbidden("Customer name is protected and cannot be changed.");
    }
    const after = await tx.customer.update({
      where: { id },
      data: {
        name: d.name,
        phone: d.phone,
        altPhone: blankToNull(d.altPhone),
        email: blankToNull(d.email),
        address: blankToNull(d.address),
        location: blankToNull(d.location),
        notes: blankToNull(d.notes),
        branchId: d.branchId || before.branchId,
      },
    });
    await audit(tx, actor, { action: "customer.update", entityType: "Customer", entityId: id, before, after });
    return after;
  });
}

export async function archiveCustomer(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "customers.archive");
  await transaction(async (tx) => {
    const before = await tx.customer.findFirst({ where: { id, deletedAt: null, AND: [customerScope(actor)] } });
    if (!before) throw notFound("Customer");
    await tx.customer.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    await audit(tx, actor, { action: "customer.archive", entityType: "Customer", entityId: id, before, reason });
  });
}
