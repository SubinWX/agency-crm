import { notFound, redirect } from "next/navigation";
import { updateInvoiceAction } from "@/app/actions/billing";
import { InvoiceEditor } from "@/components/invoice-editor";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { fromDbDate } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { getInvoice } from "@/server/modules/billing/invoices";
import { getSetting } from "@/server/modules/settings/service";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("ADMIN", "invoices.create");
  const { id } = await params;
  const inv = await getInvoice(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  if (inv.status === "CANCELLED" || inv.payments.some((p) => !p.voidedAt)) redirect(`/admin/invoices/${id}`);
  const tax = await getSetting("tax");
  return (
    <>
      <PageHeader title={`Edit ${inv.number}`} subtitle="Changes are recorded in the audit log." />
      <InvoiceEditor
        action={updateInvoiceAction.bind(null, inv.id)}
        gstEnabled={tax.gstEnabled}
        roundToRupee={tax.roundToRupee}
        requireReason
        submitLabel="Save invoice"
        defaults={{
          invoiceDate: fromDbDate(inv.invoiceDate),
          dueDate: inv.dueDate ? fromDbDate(inv.dueDate) : "",
          taxType: inv.taxType,
          notes: inv.notes ?? "",
          defaultRate: tax.defaultRate,
          items: inv.items.map((i) => ({
            description: i.description,
            hsnSac: i.hsnSac ?? "",
            quantity: String(Number(i.quantity)),
            unit: i.unit ?? "",
            rate: i.rate.toString(),
            discount: Number(i.discount) ? i.discount.toString() : "",
            taxRate: String(Number(i.taxRate)),
          })),
        }}
      />
    </>
  );
}
