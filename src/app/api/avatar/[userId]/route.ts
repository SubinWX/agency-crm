import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };

/** Profile pictures — visible to signed-in users only. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await getActor())) return new NextResponse("Unauthorized", { status: 401 });
  const { userId } = await params;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { photoUrl: true } });
  if (!u?.photoUrl?.startsWith("avatars/")) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await storage().get(u.photoUrl);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": TYPES[u.photoUrl.split(".").pop() ?? ""] ?? "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
