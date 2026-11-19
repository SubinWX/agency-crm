import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { decryptJson } from "@/server/lib/secrets";
import { applyStatus, verifyTwilioSignature } from "@/server/modules/notifications/dispatch";

/** Twilio SMS / WhatsApp status callback. The URL is sent automatically when APP_URL is HTTPS. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  const url = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/webhooks/twilio`;
  const sig = req.headers.get("x-twilio-signature");

  const providers = await prisma.notificationProvider.findMany({ where: { provider: { in: ["twilio", "twilio_whatsapp"] } } });
  const ok = providers.some((p) => verifyTwilioSignature(url, params, sig, decryptJson(p.secretsEnc).authToken ?? ""));
  if (!ok) return new NextResponse("Invalid signature", { status: 401 });

  const status = params.MessageStatus;
  const map = status === "delivered" || status === "read" ? "DELIVERED" : status === "failed" || status === "undelivered" ? "FAILED" : status === "sent" ? "SENT" : null;
  if (params.MessageSid && map) await applyStatus(params.MessageSid, map, params.ErrorCode ? `Twilio error ${params.ErrorCode}` : undefined);
  return new NextResponse("<Response/>", { headers: { "Content-Type": "text/xml" } });
}
