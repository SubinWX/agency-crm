import { NextResponse } from "next/server";
import { getSetting } from "@/server/modules/settings/service";
import { storage } from "@/server/storage";

/** Public company logo (login page, invoices). */
export async function GET() {
  const { logoKey } = await getSetting("company");
  if (!logoKey || !logoKey.startsWith("branding/")) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await storage().get(logoKey);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": logoKey.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
