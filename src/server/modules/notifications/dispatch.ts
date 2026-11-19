/**
 * Outbox dispatcher (spec §63 background processing, §77 delivery log).
 *
 * - Claims QUEUED rows with `FOR UPDATE SKIP LOCKED`, so several worker
 *   processes can run without sending a message twice.
 * - Retries temporary failures with exponential backoff (max 5 attempts);
 *   permanent failures (bad number, auth error) fail immediately.
 * - Rows stuck in SENDING (worker crashed) are re-queued after 10 minutes.
 * - Provider responses are stored with credentials redacted.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryStatus, NotificationChannel } from "@prisma/client";
import { prisma } from "../../db";
import { audit } from "../../lib/audit";
import { AppError, invalid, notFound } from "../../lib/errors";
import { redact } from "../../lib/secrets";
import { requirePermission, type Actor } from "../../rbac/actor";
import { loadProviderForSend } from "./config";
import { toE164, type SendResult } from "./providers";

export const MAX_ATTEMPTS = 5;
const SEND_TIMEOUT_MS = 20_000;

/** 30s, 2m, 8m, 32m, capped at 1h. */
export function backoffMs(attempt: number) {
  return Math.min(30_000 * 4 ** Math.max(attempt - 1, 0), 3_600_000);
}

function timedFetch(f: typeof fetch): typeof fetch {
  return (input, init) => f(input, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
}

function callbackUrl(channel: NotificationChannel, provider: string) {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!base.startsWith("https://")) return undefined; // providers require public HTTPS
  if (provider === "twilio" || provider === "twilio_whatsapp") return `${base}/api/webhooks/twilio`;
  return undefined;
}

type Claimed = { id: string; channel: NotificationChannel; to: string; subject: string | null; body: string; attempts: number };

export async function processQueue(opts: { limit?: number; fetchImpl?: typeof fetch } = {}): Promise<{ sent: number; failed: number; retried: number; skipped: number }> {
  const limit = opts.limit ?? 20;
  const f = timedFetch(opts.fetchImpl ?? fetch);

  // Recover rows from crashed workers.
  await prisma.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'QUEUED', "updatedAt" = now()
    WHERE "status" = 'SENDING' AND "updatedAt" < now() - interval '10 minutes'`;

  const claimed = await prisma.$queryRaw<Claimed[]>`
    UPDATE "NotificationDelivery" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "NotificationDelivery"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "channel", "to", "subject", "body", "attempts"`;

  const stats = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  const providers = new Map<NotificationChannel, Awaited<ReturnType<typeof loadProviderForSend>>>();
  for (const d of claimed) {
    if (!providers.has(d.channel)) providers.set(d.channel, await loadProviderForSend(d.channel));
    const p = providers.get(d.channel);
    if (!p) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "Channel is turned off" } });
      stats.skipped++;
      continue;
    }
    let result: SendResult;
    try {
      result = await p.def.send({ to: d.to, subject: d.subject, body: d.body, statusCallbackUrl: callbackUrl(d.channel, p.def.id) }, p.config, p.secrets, f, d.channel);
    } catch (e) {
      result = { ok: false, response: String((e as Error)?.message ?? e), error: "Network error", retryable: true };
    }
    const response = redact(result.response ?? "", p.secrets).slice(0, 1000);
    if (result.ok) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "SENT", sentAt: new Date(), provider: p.def.id, providerMessageId: result.providerMessageId ?? null, providerResponse: response, error: null },
      });
      stats.sent++;
    } else if (result.retryable !== false && d.attempts < MAX_ATTEMPTS) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "QUEUED", nextAttemptAt: new Date(Date.now() + backoffMs(d.attempts)), provider: p.def.id, providerResponse: response, error: redact(result.error ?? "Send failed", p.secrets) },
      });
      stats.retried++;
    } else {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "FAILED", provider: p.def.id, providerResponse: response, error: redact(result.error ?? "Send failed", p.secrets) },
      });
      stats.failed++;
    }
  }
  return stats;
}

/** Manually re-queue a failed or skipped message. */
export async function retryDelivery(actor: Actor, id: string) {
  requirePermission(actor, "notifications.manage");
  const d = await prisma.notificationDelivery.findUnique({ where: { id } });
  if (!d) throw notFound("Message");
  if (d.status !== "FAILED" && d.status !== "SKIPPED") throw new AppError("INVALID_STATE", "Only failed or skipped messages can be retried.");
  if (!d.to) throw invalid("This message has no recipient address.");
  await prisma.notificationDelivery.update({ where: { id }, data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), error: null } });
}

/** Send a test message right now (Settings → Notifications → "Send test"). */
export async function sendTestMessage(actor: Actor, channel: NotificationChannel, toRaw: string, fetchImpl: typeof fetch = fetch) {
  requirePermission(actor, "notifications.manage");
  const to = channel === "EMAIL" ? (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toRaw.trim()) ? toRaw.trim() : null) : toE164(toRaw);
  if (!to) throw invalid(channel === "EMAIL" ? "Enter a valid email address." : "Enter a valid phone number.");
  const p = await loadProviderForSend(channel);
  if (!p) throw new AppError("INVALID_STATE", "Turn this channel on and save its provider first.");
  const body = `Test message from the CRM (${channel.toLowerCase()}). If you received this, the provider is configured correctly.`;
  const delivery = await prisma.notificationDelivery.create({
    data: { event: "test", channel, to, recipientName: actor.name, userId: actor.id, subject: channel === "EMAIL" ? "CRM test message" : null, body, status: "SENDING", attempts: 1 },
  });
  let result: SendResult;
  try {
    result = await p.def.send({ to, subject: "CRM test message", body, statusCallbackUrl: callbackUrl(channel, p.def.id) }, p.config, p.secrets, timedFetch(fetchImpl), channel);
  } catch (e) {
    result = { ok: false, response: String((e as Error)?.message ?? e), error: "Network error" };
  }
  const response = redact(result.response ?? "", p.secrets).slice(0, 1000);
  await prisma.notificationDelivery.update({
    where: { id: delivery.id },
    data: { status: result.ok ? "SENT" : "FAILED", sentAt: result.ok ? new Date() : null, provider: p.def.id, providerMessageId: result.providerMessageId ?? null, providerResponse: response, error: result.ok ? null : redact(result.error ?? "Send failed", p.secrets) },
  });
  await prisma.$transaction((tx) => audit(tx, actor, { action: "notifications.test_send", entityType: "NotificationProvider", entityId: channel, after: { ok: result.ok } }));
  if (!result.ok) throw new AppError("VALIDATION", `Provider rejected the test: ${result.error ?? "error"} — ${response.slice(0, 200)}`);
}

// ───────────────────────────── Delivery status webhooks ─────────────────────────────

/** Apply a provider status callback (delivered / failed) to the log. */
export async function applyStatus(providerMessageId: string, status: "SENT" | "DELIVERED" | "FAILED", detail?: string) {
  const d = await prisma.notificationDelivery.findFirst({ where: { providerMessageId } });
  if (!d) return false;
  // Never move backwards (e.g. a late "sent" after "delivered").
  const rank: Record<DeliveryStatus, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, FAILED: 3, SKIPPED: 3 };
  if (rank[status] < rank[d.status]) return true;
  await prisma.notificationDelivery.update({
    where: { id: d.id },
    data: {
      status,
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      ...(status === "FAILED" ? { error: (detail ?? "Delivery failed").slice(0, 500) } : {}),
    },
  });
  return true;
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody). */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header || !appSecret) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected, header);
}

/** Twilio: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | null, authToken: string) {
  if (!header || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  return safeEqual(expected, header);
}
