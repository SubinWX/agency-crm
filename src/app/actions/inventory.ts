"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth/session";
import { notFound, runAction, type ActionResult } from "@/server/lib/errors";
import { prisma, transaction } from "@/server/db";
import { updateSetting } from "@/server/modules/settings/service";
import { workAccessWhere } from "@/server/modules/works/access";
import { removeItemImage, saveItem, saveSupplier } from "@/server/modules/inventory/catalog";
import { moveStock, setBranchReorderLevel, type MovementKind } from "@/server/modules/inventory/stock";
import type { UploadInput } from "@/server/storage";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const files = (fd: FormData, k: string) =>
  fd.getAll(k).filter((f) => typeof f === "object" && f !== null && (f as File).size > 0) as unknown as UploadInput[];

const itemFromForm = (fd: FormData) => ({
  kind: (s(fd, "kind") === "PRODUCT" ? "PRODUCT" : "RAW_MATERIAL") as "PRODUCT" | "RAW_MATERIAL",
  name: s(fd, "name") ?? "",
  code: s(fd, "code") ?? "",
  category: s(fd, "category"),
  description: s(fd, "description"),
  unit: s(fd, "unit") ?? "",
  sellingPrice: s(fd, "sellingPrice"),
  purchasePrice: s(fd, "purchasePrice"),
  reorderLevel: s(fd, "reorderLevel"),
  supplierId: s(fd, "supplierId"),
  notes: s(fd, "notes"),
  status: (s(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE") as "ACTIVE" | "INACTIVE",
});

export async function createItemAction(_p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => saveItem(await actorOrThrow(), itemFromForm(fd), undefined, files(fd, "images")));
  if (!res.ok) return res;
  revalidatePath("/admin/inventory", "layout");
  redirect(`/admin/inventory/items/${(res.data as { id: string }).id}?created=1`);
}

export async function updateItemAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await saveItem(await actorOrThrow(), itemFromForm(fd), id, files(fd, "images"));
    revalidatePath("/admin/inventory", "layout");
  }, "Item saved.");
}

export async function removeItemImageAction(imageId: string): Promise<R> {
  return runAction(async () => {
    await removeItemImage(await actorOrThrow(), imageId);
    revalidatePath("/admin/inventory", "layout");
  }, "Image removed.");
}

export async function moveStockAction(itemId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const mv = await moveStock(await actorOrThrow(), {
      itemId,
      branchId: s(fd, "branchId") ?? "",
      kind: (s(fd, "kind") ?? "IN") as MovementKind,
      quantity: s(fd, "quantity"),
      newQuantity: s(fd, "newQuantity"),
      toBranchId: s(fd, "toBranchId"),
      reason: s(fd, "reason"),
      reference: s(fd, "reference"),
      supplierId: s(fd, "supplierId"),
      unitCost: s(fd, "unitCost"),
      workReference: s(fd, "workReference"),
    });
    revalidatePath("/", "layout");
    return mv.length;
  }, "Stock updated.");
}

export async function reorderLevelAction(itemId: string, branchId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await setBranchReorderLevel(await actorOrThrow(), itemId, branchId, s(fd, "level") ?? "");
    revalidatePath("/admin/inventory", "layout");
  }, "Low-stock level saved.");
}

export async function saveSupplierAction(id: string | null, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => {
    return saveSupplier(
      await actorOrThrow(),
      {
        name: s(fd, "name") ?? "",
        company: s(fd, "company"),
        phone: s(fd, "phone"),
        email: s(fd, "email"),
        address: s(fd, "address"),
        gstNumber: s(fd, "gstNumber"),
        notes: s(fd, "notes"),
        status: s(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      },
      id ?? undefined,
    );
  }, "Supplier saved.");
  if (res.ok) revalidatePath("/admin/suppliers");
  if (res.ok && !id) redirect("/admin/suppliers?created=1");
  return res;
}

/** Issue stock from the work's branch to the work (records cost for job costing). */
export async function issueMaterialAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    const work = await prisma.work.findFirst({ where: { id: workId, AND: [workAccessWhere(actor)] }, select: { reference: true, branchId: true } });
    if (!work) throw notFound("Work");
    await moveStock(actor, { itemId: s(fd, "itemId") ?? "", branchId: work.branchId, kind: "OUT", quantity: s(fd, "quantity"), reason: `Used on ${work.reference}`, workReference: work.reference });
    revalidatePath("/", "layout");
  }, "Material recorded for this work.");
}

export async function saveInventorySettingsAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    await transaction((tx) => updateSetting(actor, "inventory", { transfersEnabled: fd.get("transfersEnabled") === "on" }, tx, "inventory.manage"));
    revalidatePath("/admin/settings");
  }, "Inventory settings saved.");
}
