import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getAttachment } from "@/server/modules/support/service";
import { storage } from "@/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const a = await getAttachment(actor, id);
    const data = await storage().get(a.storageKey);
    const safe = a.originalName.replace(/[^\w.\- ]+/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": a.mimeType, "Content-Disposition": `inline; filename="${safe}"`, "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
