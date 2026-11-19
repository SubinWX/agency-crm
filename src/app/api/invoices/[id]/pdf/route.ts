import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { getInvoice } from "@/server/modules/billing/invoices";
import { renderInvoicePdf } from "@/server/modules/billing/pdf";

export const runtime = "nodejs";

/** Open / download / print the invoice PDF. Generated fresh each time, so the PAID stamp is always current. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const inv = await getInvoice(actor, id);
    const pdf = await renderInvoicePdf(inv);
    const download = req.nextUrl.searchParams.get("download") === "1";
    await prisma.auditLog.create({ data: { userId: actor.id, action: download ? "invoice.pdf_download" : "invoice.pdf_view", entityType: "Invoice", entityId: id } });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${inv.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
