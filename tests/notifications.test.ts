import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, transaction } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { decryptJson, encryptJson } from "@/server/lib/secrets";
import { getProviderViews, saveProvider, saveTemplate } from "@/server/modules/notifications/config";
import { applyStatus, processQueue, verifyMetaSignature, verifyTwilioSignature } from "@/server/modules/notifications/dispatch";
import { PROVIDERS, toE164 } from "@/server/modules/notifications/providers";
import { notify } from "@/server/modules/notifications/service";
import { assignWorkers, createWork } from "@/server/modules/works/service";
import { actor, branch, freshDate, requiredCustom } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

const SECRET = "AC-super-secret-token-9f3a";
type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

async function enable(channel: "SMS" | "WHATSAPP" | "EMAIL", provider: string, values: Record<string, string> = {}) {
  const sa = await actor("superadmin@crm.test");
  await saveProvider(sa, channel, { provider, enabled: true, values });
}
async function disableAll() {
  await prisma.notificationProvider.updateMany({ data: { enabled: false } });
}
/** Only look at messages created by this test. */
async function clearQueue() {
  await prisma.notificationDelivery.updateMany({ where: { status: { in: ["QUEUED", "SENDING"] } }, data: { status: "SKIPPED", error: "test cleanup" } });
}

beforeEach(async () => {
  await disableAll();
  await clearQueue();
});
afterAll(async () => {
  await disableAll();
  await clearQueue();
});

describe("provider credentials", () => {
  it("encrypts secrets, never returns them, and keeps them when left blank", async () => {
    const sa = await actor("superadmin@crm.test");
    await saveProvider(sa, "SMS", { provider: "twilio", enabled: true, values: { accountSid: "AC123", authToken: SECRET, fromNumber: "+15005550006" } });
    const row = await prisma.notificationProvider.findUniqueOrThrow({ where: { channel: "SMS" } });
    expect(row.secretsEnc).not.toContain(SECRET);
    expect(decryptJson(row.secretsEnc).authToken).toBe(SECRET);

    const views = await getProviderViews(sa);
    expect(JSON.stringify(views)).not.toContain(SECRET);
    expect(views.find((v) => v.channel === "SMS")!.secretHints.authToken).toBe("••••••9f3a");

    // Re-save without the token → kept.
    await saveProvider(sa, "SMS", { provider: "twilio", enabled: true, values: { accountSid: "AC123", authToken: "", fromNumber: "+15005550007" } });
    expect(decryptJson((await prisma.notificationProvider.findUniqueOrThrow({ where: { channel: "SMS" } })).secretsEnc).authToken).toBe(SECRET);

    const logs = await prisma.auditLog.findMany({ where: { action: "notifications.provider_change" } });
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(encryptJson({ a: "1" })).not.toBe(encryptJson({ a: "1" })); // random IV
  });

  it("only Super Admin (notifications.manage) can see or change providers", async () => {
    const admin = await actor("admin@crm.test");
    expect(await code(getProviderViews(admin))).toBe("FORBIDDEN");
    expect(await code(saveProvider(admin, "SMS", { provider: "log", enabled: true, values: {} }))).toBe("FORBIDDEN");
  });

  it("validates required fields when enabling", async () => {
    const sa = await actor("superadmin@crm.test");
    await prisma.notificationProvider.update({ where: { channel: "EMAIL" }, data: { provider: "log", secretsEnc: null } });
    expect(await code(saveProvider(sa, "EMAIL", { provider: "resend", enabled: true, values: { fromEmail: "a@b.co" } }))).toBe("VALIDATION");
    expect(await code(saveProvider(sa, "EMAIL", { provider: "msg91", enabled: true, values: {} }))).toBe("VALIDATION"); // wrong channel
  });
});

describe("queueing (outbox)", () => {
  it("queues rendered WhatsApp messages for assigned workers; SMS template is off by default", async () => {
    await enable("WHATSAPP", "log");
    await enable("SMS", "log");
    const admin = await actor("admin@crm.test");
    const w1 = await actor("worker1@crm.test");
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } });
    const work = await createWork(admin, { branchId: (await branch("MAIN")).id, workDate: freshDate(), customerId: c.id, customValues: requiredCustom, locationAddress: "Kakkanad" });
    await assignWorkers(admin, work.id, [w1.id]);
    const rows = await prisma.notificationDelivery.findMany({ where: { event: "work.assigned", userId: w1.id, body: { contains: work.reference } } });
    expect(rows.map((r) => r.channel)).toEqual(["WHATSAPP"]);
    expect(rows[0]).toMatchObject({ status: "QUEUED", to: "+919000020001" });
    expect(rows[0].body).toContain("Hello Wasim Worker");
    expect(rows[0].body).toContain("Location: Kakkanad");
  });

  it("sends customer-facing events to the customer when the template allows it", async () => {
    await enable("WHATSAPP", "log");
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Meera Nair" } });
    await transaction((tx) => notify(tx, { userIds: [], type: "payment.received", title: "t", body: "b", customerId: c.id, vars: { amount: "₹500.00", invoice_number: "INV-9", balance: "₹0.00" } }));
    const row = await prisma.notificationDelivery.findFirstOrThrow({ where: { customerId: c.id, event: "payment.received" }, orderBy: { createdAt: "desc" } });
    expect(row.body).toBe("Hello Meera Nair, Payment of ₹500.00 received for invoice INV-9. Balance due: ₹0.00.");
  });

  it("queues nothing if the business change rolls back", async () => {
    await enable("WHATSAPP", "log");
    const w1 = await actor("worker1@crm.test");
    const before = await prisma.notificationDelivery.count();
    await transaction(async (tx) => {
      await notify(tx, { userIds: [w1.id], type: "work.rejected", title: "x", body: "y", vars: { work_id: "WRK-X", reason: "z" } });
      throw new Error("boom");
    }).catch(() => null);
    expect(await prisma.notificationDelivery.count()).toBe(before);
  });

  it("logs SKIPPED when a recipient has no usable address", async () => {
    await enable("EMAIL", "log");
    const w1 = await actor("worker1@crm.test"); // seed email ends in .test → undeliverable
    await transaction((tx) => notify(tx, { userIds: [w1.id], type: "work.rejected", title: "x", body: "y", vars: { work_id: "WRK-Y", reason: "z" } }));
    const row = await prisma.notificationDelivery.findFirstOrThrow({ where: { userId: w1.id, channel: "EMAIL", event: "work.rejected" }, orderBy: { createdAt: "desc" } });
    expect([row.status, row.error]).toEqual(["SKIPPED", "No deliverable email address"]);
  });

  it("rejects templates with unknown variables", async () => {
    const sa = await actor("superadmin@crm.test");
    expect(await code(saveTemplate(sa, "work.assigned", "SMS", { enabled: true, sendToCustomer: false, body: "Job {work_id} on {dat}" }))).toBe("VALIDATION");
  });
});

describe("dispatcher", () => {
  async function queueOne() {
    const w1 = await actor("worker1@crm.test");
    await transaction((tx) => notify(tx, { userIds: [w1.id], type: "work.rejected", title: "x", body: "y", vars: { work_id: `WRK-${Date.now()}`, reason: "z" } }));
    return prisma.notificationDelivery.findFirstOrThrow({ where: { userId: w1.id, status: "QUEUED" }, orderBy: { createdAt: "desc" } });
  }

  it("sends via the provider and stores the message id; secrets are redacted from responses", async () => {
    await enable("SMS", "twilio", { accountSid: "AC1", authToken: SECRET, fromNumber: "+15005550006" });
    await saveTemplate(await actor("superadmin@crm.test"), "work.rejected", "SMS", { enabled: true, sendToCustomer: false, body: "Fix {work_id}: {reason}" });
    const d = await queueOne();
    const calls: Call[] = [];
    const stats = await processQueue({ fetchImpl: fakeFetch(201, { sid: "SM123", echo: SECRET }, calls) });
    expect(stats.sent).toBeGreaterThanOrEqual(1);
    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.status, row.providerMessageId, row.provider]).toEqual(["SENT", "SM123", "twilio"]);
    expect(row.providerResponse).toContain("[redacted]");
    expect(row.providerResponse).not.toContain(SECRET);
    const sent = calls.find((c) => String(c.init.body).includes(encodeURIComponent("+919000020001")))!;
    expect(sent.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(String(sent.init.body)).toContain("StatusCallback=" + encodeURIComponent("https://crm.test/api/webhooks/twilio"));
  });

  it("retries temporary failures with backoff and fails permanent ones at once", async () => {
    await enable("SMS", "twilio", { accountSid: "AC1", authToken: SECRET, fromNumber: "+15005550006" });
    await saveTemplate(await actor("superadmin@crm.test"), "work.rejected", "SMS", { enabled: true, sendToCustomer: false, body: "Fix {work_id}" });
    const a = await queueOne();
    await processQueue({ fetchImpl: fakeFetch(503, "unavailable") });
    const r1 = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: a.id } });
    expect([r1.status, r1.attempts]).toEqual(["QUEUED", 1]);
    expect(r1.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    const b = await queueOne();
    await processQueue({ fetchImpl: fakeFetch(400, { code: 21211, message: "Invalid 'To' number" }) });
    const r2 = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: b.id } });
    expect([r2.status, r2.error]).toEqual(["FAILED", "HTTP 400"]);
  });

  it("never sends the same message twice when workers run in parallel", async () => {
    await enable("WHATSAPP", "meta_whatsapp", { phoneNumberId: "111", accessToken: SECRET, templateName: "crm_update" });
    const w1 = await actor("worker1@crm.test");
    await transaction(async (tx) => {
      for (let i = 0; i < 6; i++) await notify(tx, { userIds: [w1.id], type: "work.rejected", title: "x", body: "y", vars: { work_id: `WRK-P${i}`, reason: "z" } });
    });
    const calls: Call[] = [];
    const f = fakeFetch(200, { messages: [{ id: "wamid.X" }] }, calls);
    await Promise.all([processQueue({ fetchImpl: f, limit: 4 }), processQueue({ fetchImpl: f, limit: 4 }), processQueue({ fetchImpl: f, limit: 4 })]);
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)).template.components[0].parameters[0].text as string);
    expect(new Set(bodies).size).toBe(bodies.length);
    expect(bodies.length).toBe(6);
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload).toMatchObject({ messaging_product: "whatsapp", to: "919000020001", type: "template", template: { name: "crm_update", language: { code: "en" } } });
  });
});

describe("delivery webhooks & helpers", () => {
  it("verifies Meta and Twilio signatures and applies delivery status", async () => {
    const body = JSON.stringify({ x: 1 });
    const good = "sha256=" + createHmac("sha256", "appsecret").update(body).digest("hex");
    expect(verifyMetaSignature(body, good, "appsecret")).toBe(true);
    expect(verifyMetaSignature(body, good, "wrong")).toBe(false);
    expect(verifyMetaSignature(body, null, "appsecret")).toBe(false);

    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    const tw = createHmac("sha1", "tok").update("https://crm.test/api/webhooks/twilio" + "MessageSidSM1MessageStatusdelivered").digest("base64");
    expect(verifyTwilioSignature("https://crm.test/api/webhooks/twilio", params, tw, "tok")).toBe(true);
    expect(verifyTwilioSignature("https://crm.test/api/webhooks/twilio", { ...params, MessageStatus: "failed" }, tw, "tok")).toBe(false);

    const d = await prisma.notificationDelivery.create({ data: { event: "test", channel: "SMS", to: "+911234567890", body: "b", status: "SENT", providerMessageId: `SM-${Date.now()}` } });
    await applyStatus(d.providerMessageId!, "DELIVERED");
    await applyStatus(d.providerMessageId!, "SENT"); // late, must not move backwards
    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe("DELIVERED");
    expect(row.deliveredAt).not.toBeNull();
  });

  it("normalises phone numbers and detects MSG91 soft errors", async () => {
    expect(toE164("+91 98470 11111")).toBe("+919847011111");
    expect(toE164("9847011111")).toBe("+919847011111");
    expect(toE164("09847011111")).toBe("+919847011111");
    expect(toE164("12")).toBeNull();
    const r = await PROVIDERS.msg91.send({ to: "+919847011111", body: "hi" }, { flowTemplateId: "T1" }, { authKey: "k" }, fakeFetch(200, { type: "error", message: "Invalid template" }), "SMS");
    expect(r.ok).toBe(false);
  });
});
