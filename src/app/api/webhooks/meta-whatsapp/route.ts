import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { decryptJson } from "@/server/lib/secrets";
import { applyStatus, safeEqual, verifyMetaSignature } from "@/server/modules/notifications/dispatch";

/**
 * WhatsApp Cloud API delivery-status webhook.
 * Configure in Meta: Callback URL = {APP_URL}/api/webhooks/meta-whatsapp,
 * Verify token = the one saved in Settings → Notifications.
 */
async function secrets() {
  const p = await prisma.notificationProvider.findUnique({ where: { channel: "WHATSAPP" } });
  return p?.provider === "meta_whatsapp" ? decryptJson(p.secretsEnc) : null;
}

export async function GET(req: NextRequest) {
  const s = await secrets();
  const q = req.nextUrl.searchParams;
  if (s?.verifyToken && q.get("hub.mode") === "subscribe" && safeEqual(q.get("hub.verify_token") ?? "", s.verifyToken)) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

type MetaStatus = { id: string; status: string; errors?: { title?: string; message?: string }[] };

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const s = await secrets();
  if (!s?.appSecret || !verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), s.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: { entry?: { changes?: { value?: { statuses?: MetaStatus[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  for (const e of body.entry ?? []) {
    for (const c of e.changes ?? []) {
      for (const st of c.value?.statuses ?? []) {
        const map = st.status === "delivered" || st.status === "read" ? "DELIVERED" : st.status === "failed" ? "FAILED" : st.status === "sent" ? "SENT" : null;
        if (map) await applyStatus(st.id, map, st.errors?.map((x) => x.title ?? x.message).join("; "));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
