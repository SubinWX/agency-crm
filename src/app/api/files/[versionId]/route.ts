import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getImageVersionForDownload } from "@/server/modules/works/images";
import { storage } from "@/server/storage";

/** Access-controlled file delivery. Files are never exposed as public static assets. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { versionId } = await params;
  try {
    const v = await getImageVersionForDownload(actor, versionId);
    const data = await storage().get(v.storageKey);
    const download = req.nextUrl.searchParams.get("download") === "1";
    const safeName = v.originalName.replace(/[^\w.\- ]+/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": v.mimeType,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
