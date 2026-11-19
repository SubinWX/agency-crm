import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getItemImage } from "@/server/modules/inventory/catalog";
import { storage } from "@/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const img = await getItemImage(actor, id);
    const data = await storage().get(img.storageKey);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": img.mimeType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
