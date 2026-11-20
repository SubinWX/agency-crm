import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDaysIso, businessToday } from "@/server/lib/dates";
import { createInvoice, getInvoice, listInvoices } from "@/server/modules/billing/invoices";
import { renderInvoicePdf } from "@/server/modules/billing/pdf";
import { GUIDES } from "@/server/modules/help/guides";
import { WALKTHROUGHS } from "@/server/modules/help/walkthroughs.generated";
import { approveWork, assignWorkers, createWork, submitCompletion } from "@/server/modules/works/service";
import { actor, branch, freshDate, png, requiredCustom } from "./helpers";

describe("invoices: overdue filter and ₹ in the PDF", () => {
  it("lists only unpaid invoices past their due date, and prints the rupee sign", async () => {
    const [agent, admin, w1] = await Promise.all([actor("agent@crm.test"), actor("admin@crm.test"), actor("worker1@crm.test")]);
    const work = await createWork(agent, { branchId: (await branch("MAIN")).id, workDate: freshDate(), newCustomer: { name: "Overdue Test", phone: "+91 90000 88888" }, customValues: requiredCustom });
    await assignWorkers(admin, work.id, [w1.id]);
    await submitCompletion(w1, work.id, { images: [png()] });
    await approveWork(admin, work.id);
    const today = businessToday();
    const inv = await createInvoice(admin, work.id, { invoiceDate: addDaysIso(today, -30), dueDate: addDaysIso(today, -5), items: [{ description: "Fitting", quantity: "1", rate: "1000", taxRate: 18 }] });

    const overdue = await listInvoices(admin, { status: "OVERDUE", q: inv.number });
    expect(overdue.items.map((i) => i.id)).toEqual([inv.id]);

    const pdf = await renderInvoicePdf(await getInvoice(admin, inv.id));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.includes(Buffer.from("NotoSans"))).toBe(true); // embedded font with the ₹ glyph
  });
});

describe("tutorial walk-throughs", () => {
  it("only reference existing guide steps and image files", () => {
    for (const [id, shots] of Object.entries(WALKTHROUGHS)) {
      const guide = GUIDES.find((g) => g.id === id);
      expect(guide, `guide ${id}`).toBeDefined();
      for (const s of shots) {
        expect(s.step).toBeLessThanOrEqual(guide!.steps.length);
        expect(existsSync(path.join(process.cwd(), "public", s.src)), s.src).toBe(true);
      }
    }
  });
});
