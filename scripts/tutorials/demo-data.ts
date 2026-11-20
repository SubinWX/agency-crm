/**
 * Fills a DEMO database with realistic sample data for tutorial screenshots:
 * works in every stage, photos, invoices (paid / overdue), products on the
 * website, low stock, support tickets and a review.
 *
 *   DATABASE_URL=…/crm_demo npx tsx scripts/tutorials/demo-data.ts
 *
 * Refuses to run unless the database name contains "demo".
 */
import "../load-env";
import sharp from "sharp";
import { prisma } from "../../src/server/db";
import { addDaysIso, businessToday } from "../../src/server/lib/dates";
import { loadActor } from "../../src/server/rbac/load-actor";
import { createInvoice, recordPayment } from "../../src/server/modules/billing/invoices";
import { setCustomerPhoto } from "../../src/server/modules/customers/service";
import { grantPortalAccess } from "../../src/server/modules/portal/service";
import { saveItem, saveSupplier } from "../../src/server/modules/inventory/catalog";
import { moveStock } from "../../src/server/modules/inventory/stock";
import { updateSetting } from "../../src/server/modules/settings/service";
import { addReply, createTicket, rateTicket, updateTicket } from "../../src/server/modules/support/service";
import { approveWork, assignWorkers, createWork, startWork, submitCompletion } from "../../src/server/modules/works/service";
import { transaction } from "../../src/server/db";
import type { UploadInput } from "../../src/server/storage";

const db = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (!db.includes("demo")) {
  console.error(`Refusing to add demo data to "${db}". Point DATABASE_URL at a database whose name contains "demo".`);
  process.exit(1);
}

/** A soft "photo" with a gradient, stone-like speckles and a caption. */
async function photo(label: string, from: string, to: string, name = "photo.jpg"): Promise<UploadInput> {
  const dots = Array.from({ length: 140 }, (_, i) => {
    const x = (i * 97) % 1200, y = (i * 59) % 900, r = 2 + ((i * 7) % 9);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.04 + ((i % 5) * 0.03)}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="1200" height="900" fill="url(#g)"/>${dots}
    <rect x="0" y="760" width="1200" height="140" fill="#000" opacity="0.35"/>
    <text x="60" y="845" font-family="Helvetica, Arial" font-size="56" font-weight="700" fill="#fff">${label}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  return { name, type: "image/jpeg", size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer };
}

/** Customer portal login for Ravi Kumar (demo password = the seed's dev password). */
async function ensurePortalLogin() {
  const ravi = await prisma.customer.findFirst({ where: { name: "Ravi Kumar" } });
  if (!ravi || ravi.userId) return;
  const sa = (await loadActor((await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@crm.test" } })).id))!;
  await grantPortalAccess(sa, ravi.id, { email: "ravi.customer@example.com", password: "Password@123" });
}

async function main() {
  await ensurePortalLogin();
  if ((await prisma.work.count()) > 0) {
    console.log("Demo data already present — nothing to do.");
    return;
  }
  const by = async (email: string) => (await loadActor((await prisma.user.findUniqueOrThrow({ where: { email } })).id))!;
  const [sa, admin, agent, agent2, w1, w2] = await Promise.all(["superadmin@crm.test", "admin@crm.test", "agent@crm.test", "agent2@crm.test", "worker1@crm.test", "worker2@crm.test"].map(by));
  const main = await prisma.branch.findUniqueOrThrow({ where: { code: "MAIN" } });
  const north = await prisma.branch.findUniqueOrThrow({ where: { code: "NORTH" } });
  const today = businessToday();

  // Branding + support page
  await transaction((tx) => updateSetting(sa, "company", { name: "Kochi Stone Works", address: "MG Road, Ernakulam, Kochi 682016", phone: "+91 98470 00000", email: "hello@kochistone.example", gstNumber: "32ABCDE1234F1Z5", logoKey: null, logoPdfKey: null }, tx));
  await transaction(async (tx) =>
    updateSetting(sa, "supportPortal", {
      headerCtaLabel: "New request", headerCtaHref: "/support/new", showBanner: true, bannerImageKey: null,
      bannerHeadline: "How can we help you today?", bannerSubtext: "Raise a request and follow every reply here. We usually respond within one working day.",
      bannerCtaLabel: "Raise a request", bannerCtaHref: "/support/new", bannerOverlay: 50,
      footerText: "Granite, marble and quartz — measured, cut and fitted across Kerala since 2009.",
      contactEmail: "support@kochistone.example", contactPhone: "+91 98470 00000", address: "MG Road, Ernakulam, Kochi",
      socials: { website: "https://kochistone.example", facebook: "https://facebook.com/kochistone", instagram: "https://instagram.com/kochistone", linkedin: "", x: "", youtube: "", whatsapp: "+91 98470 00000" },
    }, tx, "branding.manage"),
  );

  // People: genders (default icons)
  for (const [email, gender] of [["superadmin@crm.test", "FEMALE"], ["admin@crm.test", "MALE"], ["staff@crm.test", "FEMALE"], ["agent@crm.test", "MALE"], ["agent2@crm.test", "FEMALE"], ["worker1@crm.test", "MALE"], ["worker2@crm.test", "MALE"]] as const) {
    await prisma.user.update({ where: { email }, data: { gender } });
  }
  const ravi = await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } });
  const meera = await prisma.customer.findFirstOrThrow({ where: { name: "Meera Nair" } });
  const thomas = await prisma.customer.findFirstOrThrow({ where: { name: "Thomas George" } });
  await prisma.customer.update({ where: { id: ravi.id }, data: { gender: "MALE" } });
  await prisma.customer.update({ where: { id: meera.id }, data: { gender: "FEMALE" } });
  await prisma.customer.update({ where: { id: thomas.id }, data: { gender: "MALE" } });
  await setCustomerPhoto(admin, meera.id, await photo("", "#f9a8d4", "#a78bfa", "meera.jpg"));

  // Works in every stage
  const custom = (w: string, h: string, c = "Black Galaxy") => ({ width: w, height: h, slab_color: c });
  const site = (l: string) => photo(l, "#475569", "#0f172a", "site.jpg");
  const done = (l: string) => photo(l, "#1f2937", "#78716c", "done.jpg");

  // Today: one in progress, one assigned, one new from an agent
  const wToday1 = await createWork(admin, { branchId: main.id, workDate: today, agentId: agent.id, customerId: ravi.id, title: "Kitchen counter top", locationAddress: "Kakkanad, Kochi", customValues: custom("8", "2.5"), images: [await site("Kitchen — before")] });
  await assignWorkers(admin, wToday1.id, [w1.id, w2.id]);
  await startWork(w1, wToday1.id);
  const wToday2 = await createWork(admin, { branchId: main.id, workDate: today, customerId: meera.id, agentId: agent2.id, title: "Bathroom vanity top", locationAddress: "Edappally, Kochi", customValues: custom("4", "1.8", "White") });
  await assignWorkers(admin, wToday2.id, [w2.id]);
  await createWork(agent, { branchId: north.id, workDate: today, newCustomer: { name: "Anitha Joseph", phone: "+91 94470 12345", gender: "FEMALE" }, title: "Staircase cladding", locationAddress: "Aluva", customValues: custom("12", "1", "Tan Brown"), images: [await site("Staircase")] });

  // Upcoming
  for (let i = 1; i <= 6; i++) {
    const w = await createWork(admin, { agentId: (i % 2 ? agent : agent2).id, branchId: i % 3 ? main.id : north.id, workDate: addDaysIso(today, i), customerId: [ravi, meera, thomas][i % 3].id, title: ["Dining table top", "Window sills", "Kitchen backsplash", "Reception counter", "Wash basin counter", "Pooja room shelf"][i - 1], locationAddress: ["Vyttila", "Kaloor", "Thrippunithura", "Panampilly Nagar", "Fort Kochi", "Angamaly"][i - 1], customValues: custom(String(3 + i), "2") });
    if (i <= 3) await assignWorkers(admin, w.id, [i % 2 ? w1.id : w2.id]);
  }

  // Pending approval (with completion photos)
  for (const [title, cust] of [["Island counter", thomas], ["Bar counter", ravi]] as const) {
    const w = await createWork(admin, { agentId: agent.id, branchId: main.id, workDate: today, customerId: cust.id, title, locationAddress: "Marine Drive, Kochi", customValues: custom("6", "3") });
    await assignWorkers(admin, w.id, [w1.id]);
    await submitCompletion(w1, w.id, { message: "Fitted and polished", description: "Edges rounded, sink cut-out done, area cleaned.", images: [await done(`${title} — fitted`), await done("Edge finish")] });
  }

  // Approved + invoiced: one paid, one partly paid & overdue, one unpaid
  const approved = async (title: string, cust: typeof ravi, date: string) => {
    const w = await createWork(admin, { agentId: agent.id, branchId: main.id, workDate: date, customerId: cust.id, title, locationAddress: "Kochi", customValues: custom("10", "2.5") });
    await assignWorkers(admin, w.id, [w1.id, w2.id]);
    await submitCompletion(w1, w.id, { message: "Completed", images: [await done(title)] });
    await approveWork(admin, w.id, "Good finish");
    return w;
  };
  const lines = (rate: string) => [{ description: "Granite slab — Black Galaxy", hsnSac: "6802", quantity: "25", unit: "sq ft", rate, taxRate: 18 }, { description: "Cutting, polishing and fitting", hsnSac: "998719", quantity: "1", unit: "job", rate: "3500", taxRate: 18 }];
  const paidWork = await approved("Kitchen counter top", ravi, today);
  const paid = await createInvoice(admin, paidWork.id, { invoiceDate: today, items: lines("450") });
  await recordPayment(admin, paid.id, { amount: paid.grandTotal.toString(), paidOn: today, method: "UPI", reference: "UTR4458120933" });
  const lateWork = await approved("Office reception top", thomas, today);
  const late = await createInvoice(admin, lateWork.id, { invoiceDate: addDaysIso(today, -20), dueDate: addDaysIso(today, -13), items: lines("520") });
  await recordPayment(admin, late.id, { amount: "5000", paidOn: addDaysIso(today, -10), method: "CASH" });
  const openWork = await approved("Wash basin counter", meera, today);
  await createInvoice(admin, openWork.id, { invoiceDate: today, items: lines("400") });

  // Products (with photos, on the website) + raw materials with low stock
  const supplier = await saveSupplier(sa, { name: "Southern Granite Traders", phone: "+91 484 220 0000", email: "sales@sgt.example" });
  const products: [string, string, string, string, string, string][] = [
    ["Black Galaxy Granite", "Counter tops", "520", "#111827", "#4b5563", "Deep black granite with golden flecks. Ideal for kitchen counters."],
    ["Absolute Black Granite", "Counter tops", "480", "#030712", "#1f2937", "Uniform jet-black finish, polished or leathered."],
    ["Statuario Marble", "Flooring", "650", "#f8fafc", "#cbd5e1", "Italian-look white marble with soft grey veins."],
    ["Tan Brown Granite", "Counter tops", "390", "#7c2d12", "#292524", "Warm brown granite, hard-wearing and easy to clean."],
    ["Quartz Wash Basin", "Wash basins", "6500", "#e2e8f0", "#94a3b8", "Single-piece quartz basin with matching counter."],
    ["Kota Stone Tiles", "Flooring", "85", "#64748b", "#334155", "Natural blue-grey limestone for outdoor flooring."],
  ];
  for (const [i, [name, category, price, a, b, description]] of products.entries()) {
    await saveItem(sa, { kind: "PRODUCT", name, code: `PRD-${String(i + 1).padStart(3, "0")}`, category, unit: i === 4 ? "pcs" : "sq ft", sellingPrice: price, purchasePrice: String(Math.round(Number(price) * 0.7)), description, supplierId: supplier.id, showOnWebsite: i !== 5 }, undefined, [await photo(name, a, b, "p1.jpg"), await photo(`${name} — detail`, b, a, "p2.jpg")]);
  }
  for (const [name, unit, qty, reorder] of [["Epoxy adhesive", "kg", "3", "10"], ["Edge polishing pads", "pcs", "4", "12"], ["Silicone sealant", "tube", "40", "10"]] as const) {
    const it = await saveItem(sa, { kind: "RAW_MATERIAL", name, code: `RM-${name.slice(0, 3).toUpperCase()}-${unit.toUpperCase()}`, category: "Consumables", unit, reorderLevel: reorder, purchasePrice: "250", supplierId: supplier.id });
    await moveStock(admin, { itemId: it.id, branchId: main.id, kind: "IN", quantity: qty, reason: "Opening stock", supplierId: supplier.id, unitCost: "250" });
  }

  // Support tickets
  const cat = async (n: string) => (await prisma.supportCategory.findFirstOrThrow({ where: { name: n } })).id;
  const t1 = await createTicket(agent, { title: "Commission for October not shown", description: "My commission for WRK-000003 is missing in My commission.", categoryId: await cat("Payment / invoice"), priority: "HIGH" });
  await addReply(admin, t1.id, { body: "Thanks Anil — checking with accounts, will update today." });
  await createTicket(w1, { title: "Cutting blade worn out", description: "The 14-inch cutting blade needs replacement before Friday's job.", categoryId: await cat("Equipment / material"), priority: "MEDIUM" });
  const t3 = await createTicket(agent2, { title: "Cannot upload site photos", description: "The app shows an error when I add more than 5 photos.", categoryId: await cat("App / login problem"), priority: "LOW" });
  await updateTicket(admin, t3.id, { status: "RESOLVED", resolution: "Photos are now resized on the phone before upload — please try again." });
  await rateTicket(agent2, t3.id, { rating: 5, comment: "Works now, thank you!" });

  console.log("Demo data ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
