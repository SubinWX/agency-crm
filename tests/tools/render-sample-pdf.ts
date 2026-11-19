/** Dev helper: render the latest PAID and latest open invoice from crm_test to PDFs for visual checks. */
import { writeFileSync } from "node:fs";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/rbac/load-actor";
import { getInvoice } from "@/server/modules/billing/invoices";
import { renderInvoicePdf } from "@/server/modules/billing/pdf";

const out = process.argv[2] ?? ".";
(async () => {
  const sa = await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@crm.test" } });
  const actor = (await loadActor(sa.id))!;
  for (const status of ["PAID", "PARTIALLY_PAID"] as const) {
    const inv = await prisma.invoice.findFirst({ where: { status }, orderBy: { createdAt: "desc" } });
    if (!inv) continue;
    const full = await getInvoice(actor, inv.id);
    writeFileSync(`${out}/${status.toLowerCase()}.pdf`, await renderInvoicePdf(full));
    // Preview of the PAID stamp layout using the same data.
    writeFileSync(`${out}/preview-paid.pdf`, await renderInvoicePdf({ ...full, status: "PAID", paidAt: new Date() }));
    console.log("wrote", status);
  }
  await prisma.$disconnect();
})();
