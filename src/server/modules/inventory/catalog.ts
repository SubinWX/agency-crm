/**
 * Products, raw materials (one catalog, `kind`) and suppliers — spec §30, §31, §34.
 * Catalog changes need `inventory.manage`; viewing needs `inventory.view`.
 */
import type { ItemKind, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { forbidden, invalid, notFound, parseInput } from "../../lib/errors";
import { canAny, requirePermission, type Actor } from "../../rbac/actor";
import { storeImage, type UploadInput } from "../../storage";
import { fromPaise, toPaise } from "../billing/calc";
import { fromMilli, toMilli } from "./qty";

export function canViewInventory(actor: Actor) {
  return canAny(actor, "inventory.view", "inventory.manage", "inventory.edit_stock");
}
function requireView(actor: Actor) {
  if (!canViewInventory(actor)) throw forbidden();
}

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const itemSchema = z.object({
  kind: z.enum(["PRODUCT", "RAW_MATERIAL"]),
  name: z.string().trim().min(1, "Name is required").max(150),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9\-_/.]{0,39}$/, "Code: letters, numbers, - _ / . (max 40)"),
  category: opt(80),
  description: opt(2000),
  unit: z.string().trim().min(1, "Unit is required").max(20),
  sellingPrice: z.string().optional(),
  purchasePrice: z.string().optional(),
  reorderLevel: z.string().optional(),
  supplierId: z.string().optional(),
  notes: opt(2000),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export type ItemInput = z.input<typeof itemSchema>;

function priceOrNull(v: string | undefined, field: string) {
  if (!v?.trim()) return null;
  const p = toPaise(v, field);
  if (p < 0) throw invalid(`${field} cannot be negative.`);
  return fromPaise(p);
}

export async function saveItem(actor: Actor, input: ItemInput, id?: string, images: UploadInput[] = []) {
  requirePermission(actor, "inventory.manage");
  const d = parseInput(itemSchema, input);
  const reorder = toMilli(d.reorderLevel || "0", "Low-stock level");
  if (reorder < 0) throw invalid("Low-stock level cannot be negative.");
  const data = {
    kind: d.kind as ItemKind,
    name: d.name,
    code: d.code,
    category: d.category,
    description: d.description,
    unit: d.unit,
    sellingPrice: d.kind === "PRODUCT" ? priceOrNull(d.sellingPrice, "Selling price") : null,
    purchasePrice: priceOrNull(d.purchasePrice, "Purchase price"),
    reorderLevel: fromMilli(reorder),
    supplierId: d.supplierId || null,
    notes: d.notes,
    status: d.status,
  };
  const stored = await Promise.all(images.filter((f) => f.size > 0).slice(0, 6).map((f) => storeImage(f, "items")));

  return transaction(async (tx) => {
    const dupe = await tx.item.findFirst({ where: { code: d.code, NOT: id ? { id } : undefined } });
    if (dupe) throw invalid(`Code ${d.code} is already used by “${dupe.name}”.`);
    if (data.supplierId && !(await tx.supplier.findFirst({ where: { id: data.supplierId, deletedAt: null } }))) throw invalid("Supplier not found.");
    let item;
    if (id) {
      const before = await tx.item.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound("Item");
      item = await tx.item.update({ where: { id }, data });
      await audit(tx, actor, { action: "item.update", entityType: "Item", entityId: id, before, after: item });
    } else {
      item = await tx.item.create({ data: { ...data, createdById: actor.id } });
      await audit(tx, actor, { action: "item.create", entityType: "Item", entityId: item.id, after: item });
    }
    for (const f of stored) {
      await tx.itemImage.create({ data: { itemId: item.id, storageKey: f.storageKey, mimeType: f.mimeType, uploadedById: actor.id } });
    }
    return item;
  });
}

/** Images are hidden, not deleted. */
export async function removeItemImage(actor: Actor, imageId: string) {
  requirePermission(actor, "inventory.manage");
  await transaction(async (tx) => {
    const img = await tx.itemImage.findFirst({ where: { id: imageId, removedAt: null } });
    if (!img) throw notFound("Image");
    await tx.itemImage.update({ where: { id: imageId }, data: { removedAt: new Date() } });
    await audit(tx, actor, { action: "item.image_remove", entityType: "Item", entityId: img.itemId, before: { imageId } });
  });
}

export async function listItems(actor: Actor, f: { q?: string; kind?: string; category?: string; status?: string } = {}) {
  requireView(actor);
  const and: Prisma.ItemWhereInput[] = [{ deletedAt: null }];
  if (f.q?.trim()) and.push({ OR: [{ name: { contains: f.q.trim(), mode: "insensitive" } }, { code: { contains: f.q.trim(), mode: "insensitive" } }] });
  if (f.kind === "PRODUCT" || f.kind === "RAW_MATERIAL") and.push({ kind: f.kind });
  if (f.category) and.push({ category: f.category });
  if (f.status === "INACTIVE") and.push({ status: "INACTIVE" });
  else and.push({ status: "ACTIVE" });
  return prisma.item.findMany({ where: { AND: and }, orderBy: [{ kind: "asc" }, { name: "asc" }], take: 500, include: { supplier: { select: { name: true } } } });
}

export async function listCategories() {
  const rows = await prisma.item.findMany({ where: { deletedAt: null, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((r) => r.category!);
}

export async function getItem(actor: Actor, id: string) {
  requireView(actor);
  const item = await prisma.item.findFirst({
    where: { id, deletedAt: null },
    include: { supplier: true, images: { where: { removedAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!item) throw notFound("Item");
  return item;
}

export async function getItemImage(actor: Actor, imageId: string) {
  requireView(actor);
  const img = await prisma.itemImage.findFirst({ where: { id: imageId } });
  if (!img) throw notFound("Image");
  return img;
}

// ───────────────────────────── Suppliers ─────────────────────────────

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  company: opt(150),
  phone: opt(30),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional().transform((v) => v || null),
  address: opt(500),
  gstNumber: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 letters/numbers").or(z.literal("")).optional().transform((v) => v || null),
  notes: opt(2000),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export async function saveSupplier(actor: Actor, input: SupplierInput, id?: string) {
  requirePermission(actor, "inventory.manage");
  const d = parseInput(supplierSchema, input);
  return transaction(async (tx) => {
    if (id) {
      const before = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound("Supplier");
      const s = await tx.supplier.update({ where: { id }, data: d });
      await audit(tx, actor, { action: "supplier.update", entityType: "Supplier", entityId: id, before, after: s });
      return s;
    }
    const s = await tx.supplier.create({ data: d });
    await audit(tx, actor, { action: "supplier.create", entityType: "Supplier", entityId: s.id, after: s });
    return s;
  });
}

export async function listSuppliers(actor: Actor, q = "") {
  requireView(actor);
  return prisma.supplier.findMany({
    where: { deletedAt: null, ...(q.trim() ? { OR: [{ name: { contains: q.trim(), mode: "insensitive" } }, { company: { contains: q.trim(), mode: "insensitive" } }, { phone: { contains: q.trim() } }] } : {}) },
    include: { _count: { select: { items: true } }, items: { where: { deletedAt: null }, select: { id: true, name: true, kind: true }, take: 8 } },
    orderBy: { name: "asc" },
  });
}
