import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getCustomerPhotoKey } from "@/server/modules/customers/service";
import { storage } from "@/server/storage";

const TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", heic: "image/heic" };

/** Customer photo — only for signed-in users who can see this customer. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const key = await getCustomerPhotoKey(actor, id);
    if (!key?.startsWith("customer-photos/")) return new NextResponse("Not found", { status: 404 });
    const data = await storage().get(key);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": TYPES[key.split(".").pop() ?? ""] ?? "image/webp", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: 404 });
    return new NextResponse("Not found", { status: 404 });
  }
}
