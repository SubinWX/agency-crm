/**
 * Branch-wise stock (spec §32–33).
 *
 * - Each branch has its own StockLevel row per item; quantities are never merged.
 * - Quantities change ONLY here, and every change writes an append-only
 *   StockMovement with before / after / difference / reason / user / branch / time.
 * - Rows are locked with SELECT … FOR UPDATE (two branches of a transfer are
 *   locked in a fixed order) so concurrent changes can't oversell or deadlock.
 * - Stock can't go below zero (also enforced by a DB CHECK).
 */
import { randomUUID } from "node:crypto";
import { Prisma as P, type Prisma, type StockMovementType } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalid, notFound } from "../../lib/errors";
import { nextReference } from "../../lib/numbering";
import { can, canAccessBranch, requireBranch, type Actor } from "../../rbac/actor";
import { fromPaise, toPaise } from "../billing/calc";
import { getSetting } from "../settings/service";
import { canViewInventory } from "./catalog";
import { formatQty, fromMilli, toMilli, type Milli } from "./qty";

export type MovementKind = "IN" | "OUT" | "ADJUSTMENT" | "CORRECTION" | "DAMAGED" | "TRANSFER";

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  IN: "Stock in",
  OUT: "Stock out",
  ADJUSTMENT: "Adjustment (count)",
  CORRECTION: "Manual correction",
  DAMAGED: "Damaged",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
};

export interface MovementInput {
  itemId: string;
  branchId: string;
  kind: MovementKind;
  /** IN / OUT / DAMAGED / TRANSFER: how much. */
  quantity?: string;
  /** ADJUSTMENT / CORRECTION: the correct quantity now on hand. */
  newQuantity?: string;
  toBranchId?: string;
  reason?: string;
  reference?: string;
  supplierId?: string;
  unitCost?: string;
  workReference?: string;
}

function requireEdit(actor: Actor, branchId: string) {
  if (!can(actor, "inventory.edit_stock") && !can(actor, "inventory.manage")) throw forbidden("You do not have permission to change stock.");
  requireBranch(actor, branchId);
}

/** Ensure level rows exist, then lock them in a stable order. Returns current quantities (milli). */
async function lockLevels(tx: Tx, itemId: string, branchIds: string[]): Promise<Map<string, Milli>> {
  const ordered = [...new Set(branchIds)].sort();
  for (const b of ordered) {
    await tx.$executeRaw`INSERT INTO "StockLevel" ("id", "itemId", "branchId", "quantity", "updatedAt")
      VALUES (${randomUUID()}, ${itemId}, ${b}, 0, now()) ON CONFLICT ("itemId", "branchId") DO NOTHING`;
  }
  const out = new Map<string, Milli>();
  for (const b of ordered) {
    const [row] = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
      SELECT "quantity" FROM "StockLevel" WHERE "itemId" = ${itemId} AND "branchId" = ${b} FOR UPDATE`;
    out.set(b, toMilli(row.quantity.toString()));
  }
  return out;
}

async function writeMovement(
  tx: Tx,
  actor: Actor,
  m: { itemId: string; branchId: string; type: StockMovementType; before: Milli; after: Milli; reason: string; reference?: string | null; supplierId?: string | null; unitCost?: number | null; workId?: string | null; transferGroup?: string | null },
) {
  await tx.stockLevel.update({ where: { itemId_branchId: { itemId: m.itemId, branchId: m.branchId } }, data: { quantity: fromMilli(m.after) } });
  return tx.stockMovement.create({
    data: {
      number: await nextReference(tx, "STK"),
      itemId: m.itemId,
      branchId: m.branchId,
      type: m.type,
      quantityBefore: fromMilli(m.before),
      quantityAfter: fromMilli(m.after),
      change: fromMilli(m.after - m.before),
      unitCost: m.unitCost === null || m.unitCost === undefined ? null : fromPaise(m.unitCost),
      reason: m.reason,
      reference: m.reference ?? null,
      supplierId: m.supplierId ?? null,
      workId: m.workId ?? null,
      transferGroup: m.transferGroup ?? null,
      userId: actor.id,
    },
  });
}

export async function moveStock(actor: Actor, input: MovementInput) {
  requireEdit(actor, input.branchId);
  const reason = input.reason?.trim().slice(0, 500) || "";
  const reference = input.reference?.trim().slice(0, 100) || null;
  const isCount = input.kind === "ADJUSTMENT" || input.kind === "CORRECTION";
  const qty = isCount ? 0 : toMilli(input.quantity, "Quantity");
  const counted = isCount ? toMilli(input.newQuantity, "New quantity") : 0;
  if (!isCount && qty <= 0) throw invalid("Quantity must be more than zero.");
  if (isCount && (input.newQuantity ?? "").trim() === "") throw invalid("Enter the correct quantity on hand.");
  if (isCount && counted < 0) throw invalid("Quantity cannot be negative.");
  if (input.kind !== "IN" && !reason) throw invalid("Please give a reason for this stock change.");
  const unitCost = input.unitCost?.trim() ? toPaise(input.unitCost, "Unit cost") : null;
  if (unitCost !== null && unitCost < 0) throw invalid("Unit cost cannot be negative.");

  if (input.kind === "TRANSFER") {
    if (!(await getSetting("inventory")).transfersEnabled) throw new AppError("INVALID_STATE", "Branch transfers are turned off.");
    if (!input.toBranchId || input.toBranchId === input.branchId) throw invalid("Choose a different branch to transfer to.");
  }

  return transaction(async (tx) => {
    const item = await tx.item.findFirst({ where: { id: input.itemId, deletedAt: null } });
    if (!item) throw notFound("Item");
    if (item.status !== "ACTIVE" && input.kind !== "ADJUSTMENT" && input.kind !== "CORRECTION") {
      throw new AppError("INVALID_STATE", "This item is inactive.");
    }
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, deletedAt: null } });
    if (!branch) throw notFound("Branch");

    let workId: string | null = null;
    if (input.workReference?.trim()) {
      const w = await tx.work.findFirst({ where: { reference: input.workReference.trim().toUpperCase(), deletedAt: null } });
      if (!w) throw invalid("Work reference not found.");
      if (w.branchId !== input.branchId) throw invalid("Materials for a work must come from that work's branch.");
      if (input.kind !== "OUT") throw invalid("Only stock out can be linked to a work.");
      workId = w.id;
    }

    const branches = input.kind === "TRANSFER" ? [input.branchId, input.toBranchId!] : [input.branchId];
    if (input.kind === "TRANSFER") {
      const dest = await tx.branch.findFirst({ where: { id: input.toBranchId, deletedAt: null, status: "ACTIVE" } });
      if (!dest) throw invalid("Destination branch not found.");
    }
    const levels = await lockLevels(tx, item.id, branches);
    const before = levels.get(input.branchId)!;
    const available = `Only ${formatQty(before, item.unit)} available at ${branch.name}.`;
    const cost = unitCost ?? (item.purchasePrice ? toPaise(item.purchasePrice.toString()) : null);

    switch (input.kind) {
      case "IN": {
        const mv = await writeMovement(tx, actor, { itemId: item.id, branchId: input.branchId, type: "IN", before, after: before + qty, reason: reason || "Stock received", reference, supplierId: input.supplierId || item.supplierId, unitCost: cost });
        await audit(tx, actor, { action: "stock.in", entityType: "StockMovement", entityId: mv.id, after: { item: item.code, branch: branch.name, qty: fromMilli(qty) }, reason });
        return [mv];
      }
      case "OUT":
      case "DAMAGED": {
        if (qty > before) throw invalid(available);
        const mv = await writeMovement(tx, actor, { itemId: item.id, branchId: input.branchId, type: input.kind, before, after: before - qty, reason, reference, unitCost: cost, workId });
        await audit(tx, actor, { action: `stock.${input.kind.toLowerCase()}`, entityType: "StockMovement", entityId: mv.id, after: { item: item.code, branch: branch.name, qty: fromMilli(qty), workId }, reason });
        return [mv];
      }
      case "ADJUSTMENT":
      case "CORRECTION": {
        if (counted === before) throw invalid("The quantity is already " + formatQty(before, item.unit) + ".");
        const mv = await writeMovement(tx, actor, { itemId: item.id, branchId: input.branchId, type: input.kind, before, after: counted, reason, reference });
        await audit(tx, actor, { action: `stock.${input.kind.toLowerCase()}`, entityType: "StockMovement", entityId: mv.id, before: { qty: fromMilli(before) }, after: { qty: fromMilli(counted) }, reason });
        return [mv];
      }
      case "TRANSFER": {
        if (qty > before) throw invalid(available);
        const group = randomUUID();
        const destBefore = levels.get(input.toBranchId!)!;
        const outMv = await writeMovement(tx, actor, { itemId: item.id, branchId: input.branchId, type: "TRANSFER_OUT", before, after: before - qty, reason, reference, unitCost: cost, transferGroup: group });
        const inMv = await writeMovement(tx, actor, { itemId: item.id, branchId: input.toBranchId!, type: "TRANSFER_IN", before: destBefore, after: destBefore + qty, reason, reference, unitCost: cost, transferGroup: group });
        await audit(tx, actor, { action: "stock.transfer", entityType: "StockMovement", entityId: outMv.id, after: { item: item.code, from: input.branchId, to: input.toBranchId, qty: fromMilli(qty) }, reason });
        return [outMv, inMv];
      }
    }
  });
}

export async function setBranchReorderLevel(actor: Actor, itemId: string, branchId: string, level: string) {
  requireEdit(actor, branchId);
  const v = level.trim() === "" ? null : toMilli(level, "Low-stock level");
  if (v !== null && v < 0) throw invalid("Low-stock level cannot be negative.");
  await transaction(async (tx) => {
    await lockLevels(tx, itemId, [branchId]);
    await tx.stockLevel.update({ where: { itemId_branchId: { itemId, branchId } }, data: { reorderLevel: v === null ? null : fromMilli(v) } });
    await audit(tx, actor, { action: "stock.reorder_level", entityType: "Item", entityId: itemId, after: { branchId, level: v === null ? null : fromMilli(v) } });
  });
}

// ───────────────────────────── Queries ─────────────────────────────

function branchIdsFor(actor: Actor, branchId?: string) {
  if (branchId) {
    if (!canAccessBranch(actor, branchId)) throw forbidden("You do not have access to this branch.");
    return [branchId];
  }
  return actor.isSuperAdmin ? undefined : [...actor.branchIds];
}

/** Items with their quantity at one branch (0 if never stocked there). */
export async function branchStock(actor: Actor, branchId: string, f: { q?: string; kind?: string; lowOnly?: boolean } = {}) {
  if (!canViewInventory(actor)) throw forbidden();
  branchIdsFor(actor, branchId);
  const items = await prisma.item.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      ...(f.kind === "PRODUCT" || f.kind === "RAW_MATERIAL" ? { kind: f.kind } : {}),
      ...(f.q?.trim() ? { OR: [{ name: { contains: f.q.trim(), mode: "insensitive" } }, { code: { contains: f.q.trim(), mode: "insensitive" } }] } : {}),
    },
    include: { stock: { where: { branchId } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    take: 500,
  });
  const rows = items.map((i) => {
    const lvl = i.stock[0];
    const qty = toMilli(lvl?.quantity.toString() ?? "0");
    const reorder = toMilli((lvl?.reorderLevel ?? i.reorderLevel).toString());
    const cost = i.purchasePrice ? toPaise(i.purchasePrice.toString()) : 0;
    return { item: i, qty, reorder, low: reorder > 0 && qty <= reorder, value: Math.round((qty * cost) / 1000) };
  });
  return f.lowOnly ? rows.filter((r) => r.low) : rows;
}

/** Per-branch quantities for one item (only branches the actor can see). */
export async function itemStockByBranch(actor: Actor, itemId: string) {
  if (!canViewInventory(actor)) throw forbidden();
  const ids = branchIdsFor(actor);
  const [branches, levels] = await Promise.all([
    prisma.branch.findMany({ where: { deletedAt: null, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { name: "asc" } }),
    prisma.stockLevel.findMany({ where: { itemId, ...(ids ? { branchId: { in: ids } } : {}) } }),
  ]);
  return branches.map((b) => {
    const l = levels.find((x) => x.branchId === b.id);
    return { branch: b, qty: toMilli(l?.quantity.toString() ?? "0"), reorder: l?.reorderLevel ? toMilli(l.reorderLevel.toString()) : null };
  });
}

export async function listMovements(actor: Actor, f: { itemId?: string; branchId?: string; type?: string; workId?: string; from?: string; to?: string; page?: number } = {}) {
  if (!canViewInventory(actor)) throw forbidden();
  const ids = branchIdsFor(actor, f.branchId);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 40;
  const where: Prisma.StockMovementWhereInput = {
    ...(ids ? { branchId: { in: ids } } : {}),
    ...(f.itemId ? { itemId: f.itemId } : {}),
    ...(f.workId ? { workId: f.workId } : {}),
    ...(f.type && f.type in MOVEMENT_LABELS ? { type: f.type as StockMovementType } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+05:30`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59+05:30`) } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { item: { select: { id: true, name: true, code: true, unit: true } }, branch: { select: { name: true } }, supplier: { select: { name: true } }, work: { select: { id: true, reference: true } } },
    }),
    prisma.stockMovement.count({ where }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, name: true } });
  return { items: items.map((m) => ({ ...m, userName: users.find((u) => u.id === m.userId)?.name ?? "—" })), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Low-stock rows across the actor's branches (quantity ≤ branch or item threshold). */
export async function lowStock(actor: Actor, limit = 20) {
  if (!canViewInventory(actor)) return [];
  const ids = actor.isSuperAdmin ? null : [...actor.branchIds];
  if (ids && ids.length === 0) return [];
  const rows = await prisma.$queryRaw<{ itemId: string; name: string; code: string; unit: string; branch: string; quantity: Prisma.Decimal; threshold: Prisma.Decimal }[]>`
    SELECT i."id" AS "itemId", i."name", i."code", i."unit", b."name" AS "branch",
           COALESCE(s."quantity", 0) AS "quantity", COALESCE(s."reorderLevel", i."reorderLevel") AS "threshold"
    FROM "Item" i
    CROSS JOIN "Branch" b
    LEFT JOIN "StockLevel" s ON s."itemId" = i."id" AND s."branchId" = b."id"
    WHERE i."deletedAt" IS NULL AND i."status" = 'ACTIVE' AND b."deletedAt" IS NULL AND b."status" = 'ACTIVE'
      AND COALESCE(s."reorderLevel", i."reorderLevel") > 0
      AND COALESCE(s."quantity", 0) <= COALESCE(s."reorderLevel", i."reorderLevel")
      ${ids ? PrismaSql.branchFilter(ids) : PrismaSql.empty}
    ORDER BY (COALESCE(s."quantity", 0) / NULLIF(COALESCE(s."reorderLevel", i."reorderLevel"), 0)) ASC, i."name"
    LIMIT ${limit}`;
  return rows;
}

const PrismaSql = {
  empty: P.empty,
  branchFilter: (ids: string[]) => P.sql`AND b."id" IN (${P.join(ids)})`,
};

/** Materials issued to a work, with cost (job costing §50). */
export async function workMaterials(workId: string) {
  const rows = await prisma.stockMovement.findMany({
    where: { workId },
    orderBy: { createdAt: "asc" },
    include: { item: { select: { name: true, code: true, unit: true } } },
  });
  const total = rows.reduce((a, r) => a + Math.round((toMilli(r.change.toString()) * -1 * (r.unitCost ? toPaise(r.unitCost.toString()) : 0)) / 1000), 0);
  return { rows, total };
}
