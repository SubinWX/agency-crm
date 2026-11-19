import type { CommissionStatus, InvoiceStatus } from "@prisma/client";

const INV: Record<InvoiceStatus, [string, string]> = {
  ISSUED: ["Unpaid", "bg-sky-100 text-sky-800"],
  PARTIALLY_PAID: ["Partially paid", "bg-amber-100 text-amber-800"],
  PAID: ["Paid", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Cancelled", "bg-red-100 text-red-700"],
};
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const [label, cls] = INV[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

const COM: Record<CommissionStatus, [string, string]> = {
  ACCRUED: ["Accrued", "bg-sky-100 text-sky-800"],
  APPROVED: ["Approved", "bg-violet-100 text-violet-800"],
  PAID: ["Paid", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Cancelled", "bg-red-100 text-red-700"],
};
export function CommissionStatusBadge({ status }: { status: CommissionStatus }) {
  const [label, cls] = COM[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
