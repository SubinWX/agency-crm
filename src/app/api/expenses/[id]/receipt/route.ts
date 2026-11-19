import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getExpenseReceipt } from "@/server/modules/billing/expenses";
import { storage } from "@/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const e = await getExpenseReceipt(actor, id);
    const data = await storage().get(e.receiptKey!);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": e.receiptMime ?? "application/octet-stream", "Content-Disposition": `inline; filename="${e.number}-receipt"`, "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    if (err instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
