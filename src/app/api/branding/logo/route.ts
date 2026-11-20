import { NextResponse } from "next/server";
import { getSetting } from "@/server/modules/settings/service";
import { storage } from "@/server/storage";

const TYPES: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Public company logo (login page, sidebar). SVGs are served with a no-script policy. */
export async function GET() {
  const { logoKey } = await getSetting("company");
  if (!logoKey || !logoKey.startsWith("branding/")) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await storage().get(logoKey);
    const ext = logoKey.split(".").pop() ?? "";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        // Even if opened directly, an SVG can't run scripts or load anything.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
