import Link from "next/link";
import { notFound } from "next/navigation";
import { createInvoiceAction } from "@/app/actions/billing";
import { InvoiceEditor } from "@/components/invoice-editor";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { addDaysIso, businessToday } from "@/server/lib/dates";
import { getSetting } from "@/server/modules/settings/service";
import { workAccessWhere } from "@/server/modules/works/access";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ workId?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "invoices.create");
  const { workId } = await searchParams;
  const work = workId
    ? await prisma.work.findFirst({ where: { id: workId, AND: [workAccessWhere(actor)] }, include: { customer: true, customValues: { include: { field: true } } } })
    : null;
  if (!work) notFound();
  const [tax, inv] = await Promise.all([getSetting("tax"), getSetting("invoice")]);
  const today = businessToday();
  const dims = work.customValues.filter((v) => ["width", "height", "quantity"].includes(v.field.key)).map((v) => `${v.field.label}: ${v.value}`).join(", ");
  return (
    <>
      <PageHeader
        title="New invoice"
        subtitle={<>For <Link className="text-blue-700" href={`/admin/works/${work.id}`}>{work.reference}</Link> · {work.customer.name}</>}
      />
      <InvoiceEditor
        action={createInvoiceAction.bind(null, work.id)}
        gstEnabled={tax.gstEnabled}
        roundToRupee={tax.roundToRupee}
        submitLabel="Create invoice"
        defaults={{
          invoiceDate: today,
          dueDate: addDaysIso(today, inv.dueDays),
          taxType: tax.defaultTaxType,
          notes: "",
          defaultRate: tax.defaultRate,
          items: [{ description: [work.title || "Work", dims].filter(Boolean).join(" — "), hsnSac: "", quantity: "1", unit: "", rate: "", discount: "", taxRate: String(tax.defaultRate) }],
        }}
      />
    </>
  );
}
