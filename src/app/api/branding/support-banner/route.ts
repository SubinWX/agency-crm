import { NextResponse } from "next/server";
import { getSetting } from "@/server/modules/settings/service";
import { storage } from "@/server/storage";

const TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", heic: "image/heic" };

/** Support portal banner image. */
export async function GET() {
  const { bannerImageKey } = await getSetting("supportPortal");
  if (!bannerImageKey?.startsWith("branding/")) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await storage().get(bannerImageKey);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": TYPES[bannerImageKey.split(".").pop() ?? ""] ?? "image/webp", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
