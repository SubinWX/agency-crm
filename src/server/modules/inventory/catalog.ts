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
  /** Website listing (products only). */
  showOnWebsite: z.boolean().default(false),
  slug: z.string().trim().toLowerCase().max(80).optional(),
  websiteUrl: z.string().trim().max(500).optional(),
});
export type ItemInput = z.input<typeof itemSchema>;

/** "Granite Counter-Top 60\"" → "granite-counter-top-60". */
export function slugify(v: string) {
  return v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function cleanWebsiteUrl(v?: string) {
  const t = v?.trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw invalid("Website link must be a full address starting with https://");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw invalid("Website link must start with https://");
  return u.toString();
}

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
    showOnWebsite: d.kind === "PRODUCT" && d.showOnWebsite,
    slug: d.kind === "PRODUCT" ? (d.slug ? slugify(d.slug) : d.showOnWebsite ? slugify(d.name) : null) || null : null,
    websiteUrl: d.kind === "PRODUCT" ? cleanWebsiteUrl(d.websiteUrl) : null,
  };
  if (data.showOnWebsite && !data.slug) throw invalid("Web address name: use letters or numbers.");
  const stored = await Promise.all(images.filter((f) => f.size > 0).slice(0, 6).map((f) => storeImage(f, "items", { maxEdge: 1600 })));

  return transaction(async (tx) => {
    const dupe = await tx.item.findFirst({ where: { code: d.code, NOT: id ? { id } : undefined } });
    if (dupe) throw invalid(`Code ${d.code} is already used by “${dupe.name}”.`);
    if (data.slug) {
      const taken = await tx.item.findFirst({ where: { slug: data.slug, NOT: id ? { id } : undefined }, select: { name: true } });
      if (taken) throw invalid(`Web address “${data.slug}” is already used by “${taken.name}”. Choose another.`);
    }
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

/** Product catalogue (cards with a cover image). */
export async function listProducts(actor: Actor, f: { q?: string; category?: string; website?: string; status?: string } = {}) {
  requireView(actor);
  const and: Prisma.ItemWhereInput[] = [{ deletedAt: null, kind: "PRODUCT" }];
  const q = f.q?.trim();
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase() } }] });
  if (f.category) and.push({ category: f.category });
  if (f.website === "on") and.push({ showOnWebsite: true });
  if (f.website === "off") and.push({ showOnWebsite: false });
  and.push({ status: f.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" });
  return prisma.item.findMany({
    where: { AND: and },
    orderBy: { name: "asc" },
    take: 500,
    select: {
      id: true, name: true, code: true, category: true, unit: true, sellingPrice: true, showOnWebsite: true, slug: true, websiteUrl: true, status: true,
      images: { where: { removedAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
      _count: { select: { images: { where: { removedAt: null } } } },
    },
  });
}

// ───────────────────────────── Public website feed ─────────────────────────────

const publicWhere: Prisma.ItemWhereInput = { kind: "PRODUCT", showOnWebsite: true, status: "ACTIVE", deletedAt: null };

function toPublic(base: string, i: { name: string; slug: string | null; code: string; category: string | null; description: string | null; unit: string; sellingPrice: Prisma.Decimal | null; websiteUrl: string | null; updatedAt: Date; images: { id: string }[] }) {
  return {
    name: i.name,
    slug: i.slug,
    sku: i.code,
    category: i.category,
    description: i.description,
    unit: i.unit,
    price: i.sellingPrice ? Number(i.sellingPrice) : null,
    currency: "INR",
    websiteUrl: i.websiteUrl,
    images: i.images.map((img) => `${base}/api/public/products/images/${img.id}`),
    updatedAt: i.updatedAt.toISOString(),
  };
}
const publicSelect = {
  name: true, slug: true, code: true, category: true, description: true, unit: true, sellingPrice: true, websiteUrl: true, updatedAt: true,
  images: { where: { removedAt: null }, orderBy: { createdAt: "asc" as const }, select: { id: true } },
} satisfies Prisma.ItemSelect;

/** Products marked "Show on website" — no sign-in needed (for the company website). */
export async function listPublicProducts(base: string, category?: string) {
  const rows = await prisma.item.findMany({ where: { ...publicWhere, ...(category ? { category } : {}) }, orderBy: { name: "asc" }, take: 1000, select: publicSelect });
  return rows.map((r) => toPublic(base, r));
}
export async function getPublicProduct(base: string, slug: string) {
  const r = await prisma.item.findFirst({ where: { ...publicWhere, slug }, select: publicSelect });
  return r ? toPublic(base, r) : null;
}
/** Image of a product that is on the website (else null). */
export async function getPublicProductImage(imageId: string) {
  return prisma.itemImage.findFirst({ where: { id: imageId, removedAt: null, item: publicWhere }, select: { storageKey: true, mimeType: true } });
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
