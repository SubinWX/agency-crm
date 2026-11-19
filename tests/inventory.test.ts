import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { saveItem, saveSupplier } from "@/server/modules/inventory/catalog";
import { branchStock, itemStockByBranch, listMovements, lowStock, moveStock, workMaterials } from "@/server/modules/inventory/stock";
import { createWork } from "@/server/modules/works/service";
import { actor, branch, freshDate, requiredCustom } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

let seq = 0;
async function newItem(kind: "PRODUCT" | "RAW_MATERIAL" = "RAW_MATERIAL", extra: Record<string, string> = {}) {
  const sa = await actor("superadmin@crm.test");
  seq += 1;
  return saveItem(sa, { kind, name: `Test slab ${seq}`, code: `T-${Date.now().toString(36)}-${seq}`.toUpperCase(), unit: "sq ft", purchasePrice: "120", ...extra });
}
const qtyAt = async (itemId: string, code: "MAIN" | "NORTH") => {
  const b = await branch(code);
  const l = await prisma.stockLevel.findUnique({ where: { itemId_branchId: { itemId, branchId: b.id } } });
  return l?.quantity.toString() ?? "0";
};

describe("branch-wise inventory", () => {
  it("keeps each branch's stock separate", async () => {
    const admin = await actor("admin@crm.test");
    const item = await newItem();
    const [main, north] = [await branch("MAIN"), await branch("NORTH")];
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "100" });
    await moveStock(admin, { itemId: item.id, branchId: north.id, kind: "IN", quantity: "40" });
    expect([await qtyAt(item.id, "MAIN"), await qtyAt(item.id, "NORTH")]).toEqual(["100", "40"]);
    const byBranch = await itemStockByBranch(admin, item.id);
    expect(byBranch.map((b) => [b.branch.code, b.qty])).toEqual(expect.arrayContaining([["MAIN", 100_000], ["NORTH", 40_000]]));
  });

  it("records previous, new, difference, reason, user and branch on every change", async () => {
    const admin = await actor("admin@crm.test");
    const item = await newItem();
    const main = await branch("MAIN");
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "100", reference: "BILL-55" });
    expect(await code(moveStock(admin, { itemId: item.id, branchId: main.id, kind: "OUT", quantity: "5" }))).toBe("VALIDATION"); // reason required
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "OUT", quantity: "20", reason: "Sold over counter" });
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "DAMAGED", quantity: "2.5", reason: "Cracked" });
    const [mv] = await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "ADJUSTMENT", newQuantity: "70", reason: "Monthly count" });
    expect([mv.quantityBefore.toString(), mv.quantityAfter.toString(), mv.change.toString(), mv.reason, mv.userId, mv.branchId]).toEqual(["77.5", "70", "-7.5", "Monthly count", admin.id, main.id]);
    expect(mv.number).toMatch(/^STK-\d{6}$/);
    const hist = await listMovements(admin, { itemId: item.id });
    expect(hist.items.map((h) => h.type)).toEqual(["ADJUSTMENT", "DAMAGED", "OUT", "IN"]);
  });

  it("never goes below zero, even with concurrent stock-outs", async () => {
    const admin = await actor("admin@crm.test");
    const item = await newItem();
    const main = await branch("MAIN");
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "10" });
    expect(await code(moveStock(admin, { itemId: item.id, branchId: main.id, kind: "OUT", quantity: "11", reason: "x" }))).toBe("VALIDATION");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => moveStock(admin, { itemId: item.id, branchId: main.id, kind: "OUT", quantity: "3", reason: "Rush" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await qtyAt(item.id, "MAIN")).toBe("1");
  });

  it("transfers atomically between branches as a linked pair", async () => {
    const admin = await actor("admin@crm.test");
    const item = await newItem();
    const [main, north] = [await branch("MAIN"), await branch("NORTH")];
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "50" });
    expect(await code(moveStock(admin, { itemId: item.id, branchId: main.id, kind: "TRANSFER", toBranchId: north.id, quantity: "60", reason: "x" }))).toBe("VALIDATION");
    const [out, inn] = await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "TRANSFER", toBranchId: north.id, quantity: "15", reason: "North short" });
    expect([out.type, inn.type, out.transferGroup === inn.transferGroup]).toEqual(["TRANSFER_OUT", "TRANSFER_IN", true]);
    expect([await qtyAt(item.id, "MAIN"), await qtyAt(item.id, "NORTH")]).toEqual(["35", "15"]);
  });

  it("only lets authorised staff change stock, and only in their branches", async () => {
    const item = await newItem();
    const [main, north] = [await branch("MAIN"), await branch("NORTH")];
    const staff = await actor("staff@crm.test"); // MAIN only, has inventory.edit_stock
    await moveStock(staff, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "5" });
    expect(await code(moveStock(staff, { itemId: item.id, branchId: north.id, kind: "IN", quantity: "5" }))).toBe("FORBIDDEN");
    expect(await code(branchStock(staff, north.id))).toBe("FORBIDDEN");
    expect(await code(saveItem(staff, { kind: "PRODUCT", name: "x", code: "NOPE-1", unit: "pcs" }))).toBe("FORBIDDEN");
    for (const who of ["agent@crm.test", "worker1@crm.test"]) {
      expect(await code(moveStock(await actor(who), { itemId: item.id, branchId: main.id, kind: "IN", quantity: "1" }))).toBe("FORBIDDEN");
    }
  });

  it("flags low stock per branch", async () => {
    const admin = await actor("admin@crm.test");
    const item = await newItem("PRODUCT", { reorderLevel: "10", sellingPrice: "300" });
    const main = await branch("MAIN");
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "8" });
    const rows = await branchStock(admin, main.id, { lowOnly: true });
    expect(rows.some((r) => r.item.id === item.id)).toBe(true);
    const low = await lowStock(admin, 500);
    expect(low.some((r) => r.itemId === item.id && r.branch === main.name)).toBe(true);
  });

  it("issues materials to a work with cost, only from the work's branch", async () => {
    const admin = await actor("admin@crm.test");
    const item = await newItem();
    const [main, north] = [await branch("MAIN"), await branch("NORTH")];
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } });
    const work = await createWork(admin, { branchId: main.id, workDate: freshDate(), customerId: c.id, customValues: requiredCustom });
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "IN", quantity: "20" });
    await moveStock(admin, { itemId: item.id, branchId: north.id, kind: "IN", quantity: "20" });
    expect(await code(moveStock(admin, { itemId: item.id, branchId: north.id, kind: "OUT", quantity: "2", reason: "x", workReference: work.reference }))).toBe("VALIDATION");
    await moveStock(admin, { itemId: item.id, branchId: main.id, kind: "OUT", quantity: "4", reason: "Fitting", workReference: work.reference });
    const m = await workMaterials(work.id);
    expect(m.rows).toHaveLength(1);
    expect(m.total).toBe(48_000); // 4 × ₹120
  });

  it("validates catalog data and keeps codes unique", async () => {
    const sa = await actor("superadmin@crm.test");
    const s = await saveSupplier(sa, { name: "Kerala Granites", gstNumber: "32ABCDE1234F1Z5", phone: "+91 90000 55555" });
    const item = await newItem("PRODUCT", { supplierId: s.id, sellingPrice: "450" });
    expect(await code(saveItem(sa, { kind: "PRODUCT", name: "Dup", code: item.code, unit: "pcs" }))).toBe("VALIDATION");
    expect(await code(saveSupplier(sa, { name: "Bad GST", gstNumber: "123" }))).toBe("VALIDATION");
    expect(await code(saveItem(sa, { kind: "PRODUCT", name: "Neg", code: "NEG-PRICE-1", unit: "pcs", sellingPrice: "-1" }))).toBe("VALIDATION");
  });
});
