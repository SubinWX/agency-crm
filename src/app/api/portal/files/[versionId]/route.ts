import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { portalPhoto } from "@/server/modules/portal/service";
import { storage } from "@/server/storage";

export async function GET(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { versionId } = await params;
  try {
    const v = await portalPhoto(actor, versionId);
    const data = await storage().get(v.storageKey);
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": v.mimeType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="photo.${v.mimeType.split("/")[1] ?? "jpg"}"` } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
