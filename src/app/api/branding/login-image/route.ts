import { NextResponse } from "next/server";
import { getSetting } from "@/server/modules/settings/service";
import { storage } from "@/server/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };

/** Public login-page image (shown before sign-in). Only serves the configured branding file. */
export async function GET() {
  const { imageKey } = await getSetting("loginPage");
  if (!imageKey || !imageKey.startsWith("branding/")) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await storage().get(imageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[imageKey.split(".").pop() ?? ""] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
