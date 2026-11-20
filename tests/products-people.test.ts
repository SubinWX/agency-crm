import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { createCustomer, getCustomerPhotoKey, setCustomerPhoto, updateCustomer } from "@/server/modules/customers/service";
import { getPublicProduct, getPublicProductImage, listProducts, listPublicProducts, saveItem, slugify } from "@/server/modules/inventory/catalog";
import { savePerson } from "@/server/modules/people/service";
import { setUserPhoto } from "@/server/modules/users/service";
import { actor, branch, png } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const base = "https://crm.example";

describe("products for the website", () => {
  it("makes a web address from the name and lists only published products publicly", async () => {
    const sa = await actor("superadmin@crm.test");
    const id = uid();
    const shown = await saveItem(sa, { kind: "PRODUCT", name: `Granite Top ${id}`, code: `GT-${id}`.toUpperCase(), unit: "pcs", sellingPrice: "1500", showOnWebsite: true, websiteUrl: "https://shop.example/granite" }, undefined, [png("top.png")]);
    const hidden = await saveItem(sa, { kind: "PRODUCT", name: `Hidden ${id}`, code: `HD-${id}`.toUpperCase(), unit: "pcs" }, undefined, [png("h.png")]);
    expect(shown.slug).toBe(slugify(`Granite Top ${id}`));

    const feed = await listPublicProducts(base);
    expect(feed.find((p) => p.slug === shown.slug)).toMatchObject({ price: 1500, websiteUrl: "https://shop.example/granite", currency: "INR" });
    expect(feed.find((p) => p.sku === hidden.code)).toBeUndefined();
    const one = await getPublicProduct(base, shown.slug!);
    expect(one?.images[0]).toMatch(new RegExp(`^${base}/api/public/products/images/`));

    // Images are public only while the product is on the website.
    const [shownImg, hiddenImg] = await Promise.all([prisma.itemImage.findFirstOrThrow({ where: { itemId: shown.id } }), prisma.itemImage.findFirstOrThrow({ where: { itemId: hidden.id } })]);
    expect(await getPublicProductImage(shownImg.id)).not.toBeNull();
    expect(await getPublicProductImage(hiddenImg.id)).toBeNull();

    const grid = await listProducts(sa, { website: "on", q: id });
    expect(grid.map((p) => p.id)).toEqual([shown.id]);
    expect(grid[0].images).toHaveLength(1);
  });

  it("rejects duplicate web addresses and non-web links", async () => {
    const sa = await actor("superadmin@crm.test");
    const id = uid();
    await saveItem(sa, { kind: "PRODUCT", name: "A", code: `SA-${id}`.toUpperCase(), unit: "pcs", showOnWebsite: true, slug: `same-${id}` });
    expect(await code(saveItem(sa, { kind: "PRODUCT", name: "B", code: `SB-${id}`.toUpperCase(), unit: "pcs", slug: `same-${id}` }))).toBe("VALIDATION");
    expect(await code(saveItem(sa, { kind: "PRODUCT", name: "C", code: `SC-${id}`.toUpperCase(), unit: "pcs", websiteUrl: "javascript:alert(1)" }))).toBe("VALIDATION");
    // Raw materials never go on the website.
    const raw = await saveItem(sa, { kind: "RAW_MATERIAL", name: "Cement", code: `RM-${id}`.toUpperCase(), unit: "bag", showOnWebsite: true });
    expect([raw.showOnWebsite, raw.slug]).toEqual([false, null]);
  });
});

describe("customer photo and gender", () => {
  it("stores gender and a photo, visible only to users who can see the customer", async () => {
    const admin = await actor("admin@crm.test");
    const c = await createCustomer(admin, { name: "Meera", phone: "9000011111", gender: "FEMALE", branchId: (await branch("MAIN")).id });
    expect(c.gender).toBe("FEMALE");
    await setCustomerPhoto(admin, c.id, png("meera.png"));
    expect(await getCustomerPhotoKey(admin, c.id)).toMatch(/^customer-photos\//);
    expect(await code(getCustomerPhotoKey(await actor("agent2@crm.test"), c.id))).toBe("NOT_FOUND");

    await updateCustomer(admin, c.id, { name: "Meera", phone: "9000011111", gender: "" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).gender).toBeNull();
    await setCustomerPhoto(admin, c.id, null, true);
    expect(await getCustomerPhotoKey(admin, c.id)).toBeNull();
  });
});

describe("staff, agent and worker gender + photo", () => {
  it("saves gender on people and lets admins set their photo", async () => {
    const sa = await actor("superadmin@crm.test");
    const main = await branch("MAIN");
    const w = await savePerson(sa, "WORKER", { name: "Fatima", email: `fatima-${uid()}@crm.test`, phone: "9000022222", branchIds: [main.id], status: "ACTIVE", password: "Password123", gender: "FEMALE" });
    expect(w.gender).toBe("FEMALE");
    await setUserPhoto(sa, w.id, png("f.png"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).photoUrl).toMatch(/^avatars\//);
    expect(await code(setUserPhoto(await actor("agent@crm.test"), w.id, png()))).toBe("FORBIDDEN");
    // A plain admin can't change a Super Admin's picture.
    expect(await code(setUserPhoto(await actor("admin@crm.test"), sa.id, png()))).toBe("FORBIDDEN");
  });
});
