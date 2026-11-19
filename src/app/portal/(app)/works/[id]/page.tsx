import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageGallery } from "@/components/image-gallery";
import { Card, DefinitionList } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { formatDateLabel, formatDateTime, fromDbDate } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { CUSTOMER_STATUS, portalWork } from "@/server/modules/portal/service";

export default async function PortalWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePortal("CUSTOMER");
  const { id } = await params;
  const { work: w, photos, completed } = await portalWork(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  return (
    <div className="space-y-5">
      <div>
        <Link href="/portal" className="text-sm text-blue-700">← My account</Link>
        <h1 className="mt-2 text-xl font-semibold">{w.title || w.reference}</h1>
        <p className="text-sm text-slate-500">{w.reference} · {CUSTOMER_STATUS[w.status]}</p>
      </div>
      <Card title="Details">
        <DefinitionList items={[["Work date", formatDateLabel(fromDbDate(w.workDate))], ["Status", CUSTOMER_STATUS[w.status]], ["Location", w.locationAddress], ["Completed on", completed && w.approvedAt ? formatDateTime(w.approvedAt) : null], ["Branch", w.branch.name], ["Branch phone", w.branch.phone]]} />
        {w.description && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm">{w.description}</p>}
      </Card>
      {photos.length > 0 && (
        <Card title="Completion photos">
          <ImageGallery images={photos.map((p) => ({ src: `/api/portal/files/${p.id}`, meta: formatDateTime(p.createdAt) }))} />
        </Card>
      )}
      {w.invoices.length > 0 && (
        <Card title="Invoices">
          <ul className="divide-y divide-slate-100 text-sm">
            {w.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>{i.number} · {formatINR(toPaise(i.grandTotal.toString()))}{i.status === "PAID" ? " · Paid" : ` · balance ${formatINR(toPaise(i.balanceDue.toString()))}`}</span>
                <a href={`/api/portal/invoices/${i.id}/pdf`} target="_blank" rel="noopener" className="text-blue-700">PDF</a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Link href={`/support/new`} className="btn-secondary">Report a problem with this work</Link>
    </div>
  );
}
