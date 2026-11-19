import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { renderInvoicePdf } from "@/server/modules/billing/pdf";
import { portalInvoiceId } from "@/server/modules/portal/service";

export const runtime = "nodejs";

/** Customer's own invoice PDF (with PAID stamp when paid). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const invoiceId = await portalInvoiceId(actor, id);
    const inv = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { createdAt: "asc" } }, work: { select: { id: true, reference: true, status: true, title: true } }, branch: { select: { name: true } } },
    });
    const pdf = await renderInvoicePdf(inv);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.number}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
