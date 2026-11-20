import { NextResponse } from "next/server";
import { getPublicProductImage } from "@/server/modules/inventory/catalog";
import { storage } from "@/server/storage";
import { CORS } from "../../cors";

/** Product photos for the website — only for products marked "Show on website". */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await getPublicProductImage(id);
  if (!img) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await storage().get(img.storageKey);
    return new NextResponse(new Uint8Array(data), { headers: { ...CORS, "Content-Type": img.mimeType, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
