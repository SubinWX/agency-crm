/**
 * Provider & template configuration (spec §41, §56). Only users with
 * `notifications.manage` (Super Admin by default) can read or change it.
 * Secrets are write-only from the UI: they are encrypted on save and only a
 * masked hint is ever returned.
 */
import type { NotificationChannel, Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { invalid } from "../../lib/errors";
import { decryptJson, encryptJson, maskSecret } from "../../lib/secrets";
import { requirePermission, type Actor } from "../../rbac/actor";
import { CHANNELS, COMMON_VARS, EVENTS, getEvent } from "./events";
import { PROVIDERS } from "./providers";

export interface ProviderView {
  channel: NotificationChannel;
  provider: string | null;
  enabled: boolean;
  config: Record<string, string>;
  /** key → masked hint ("••••••3f9a") or "" when not set. Never the real value. */
  secretHints: Record<string, string>;
  updatedAt: Date | null;
}

export async function getProviderViews(actor: Actor): Promise<ProviderView[]> {
  requirePermission(actor, "notifications.manage");
  const rows = await prisma.notificationProvider.findMany();
  return CHANNELS.map((channel) => {
    const r = rows.find((x) => x.channel === channel);
    if (!r) return { channel, provider: null, enabled: false, config: {}, secretHints: {}, updatedAt: null };
    const secrets = decryptJson(r.secretsEnc);
    return {
      channel,
      provider: r.provider,
      enabled: r.enabled,
      config: r.config as Record<string, string>,
      secretHints: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, maskSecret(v)])),
      updatedAt: r.updatedAt,
    };
  });
}

/**
 * Save a channel's provider. Secret fields left blank keep their stored value
 * (when the provider is unchanged), so admins never need to re-enter keys.
 */
export async function saveProvider(
  actor: Actor,
  channel: NotificationChannel,
  input: { provider: string; enabled: boolean; values: Record<string, string> },
) {
  requirePermission(actor, "notifications.manage");
  if (!CHANNELS.includes(channel)) throw invalid("Unknown channel.");
  const def = PROVIDERS[input.provider];
  if (!def || !def.channels.includes(channel)) throw invalid("Choose a provider for this channel.");

  await transaction(async (tx) => {
    const existing = await tx.notificationProvider.findUnique({ where: { channel } });
    const keepOld = existing?.provider === input.provider ? decryptJson(existing.secretsEnc) : {};
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    const changedSecrets: string[] = [];
    for (const f of def.fields) {
      const v = (input.values[f.key] ?? "").trim();
      if (f.secret) {
        if (v) {
          secrets[f.key] = v;
          changedSecrets.push(f.key);
        } else if (keepOld[f.key]) secrets[f.key] = keepOld[f.key];
        if (f.required && !secrets[f.key] && input.enabled) throw invalid(`${f.label} is required.`);
      } else {
        if (v.length > 500) throw invalid(`${f.label} is too long.`);
        if (v) config[f.key] = v;
        if (f.required && !v && input.enabled) throw invalid(`${f.label} is required.`);
      }
    }
    if (def.id === "smtp" && config.port && !/^\d{2,5}$/.test(config.port)) throw invalid("Port must be a number.");
    if ((def.id === "smtp" || def.id === "resend") && config.fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.fromEmail)) throw invalid("From email is not valid.");

    const data = {
      provider: def.id,
      enabled: input.enabled,
      config,
      secretsEnc: Object.keys(secrets).length ? encryptJson(secrets) : null,
      updatedById: actor.id,
    };
    await tx.notificationProvider.upsert({ where: { channel }, create: { channel, ...data }, update: data });
    // Audit what changed — never the secret values themselves.
    await audit(tx, actor, {
      action: "notifications.provider_change",
      entityType: "NotificationProvider",
      entityId: channel,
      before: existing ? { provider: existing.provider, enabled: existing.enabled, config: existing.config } : null,
      after: { provider: def.id, enabled: input.enabled, config, secretsChanged: changedSecrets },
    });
  });
}

/** Internal: provider + decrypted secrets for sending. Never expose the result to the UI. */
export async function loadProviderForSend(channel: NotificationChannel, tx: Tx = prisma) {
  const r = await tx.notificationProvider.findUnique({ where: { channel } });
  if (!r || !r.enabled || !PROVIDERS[r.provider]) return null;
  return { def: PROVIDERS[r.provider], config: r.config as Record<string, string>, secrets: decryptJson(r.secretsEnc) };
}

export async function enabledChannels(tx: Tx = prisma): Promise<Set<NotificationChannel>> {
  const rows = await tx.notificationProvider.findMany({ where: { enabled: true }, select: { channel: true, provider: true } });
  return new Set(rows.filter((r) => PROVIDERS[r.provider]).map((r) => r.channel));
}

// ───────────────────────────── Templates ─────────────────────────────

/** Ensure a template row exists for every event × channel (defaults). Idempotent. */
export async function ensureTemplates(tx: Tx = prisma) {
  const existing = await tx.notificationTemplate.findMany({ select: { event: true, channel: true } });
  const have = new Set(existing.map((e) => `${e.event}:${e.channel}`));
  const data: Prisma.NotificationTemplateCreateManyInput[] = [];
  for (const ev of EVENTS) {
    for (const ch of CHANNELS) {
      if (have.has(`${ev.key}:${ch}`)) continue;
      const d = ev.defaults[ch];
      data.push({ event: ev.key, channel: ch, enabled: d.enabled, subject: ch === "EMAIL" ? d.subject : null, body: d.body, sendToCustomer: !!ev.defaultSendToCustomer });
    }
  }
  if (data.length) await tx.notificationTemplate.createMany({ data, skipDuplicates: true });
}

export async function listTemplates(actor: Actor) {
  requirePermission(actor, "notifications.manage");
  await ensureTemplates();
  return prisma.notificationTemplate.findMany({ orderBy: [{ event: "asc" }, { channel: "asc" }] });
}

/** Unknown {variables} are rejected so typos are caught at save time. */
export function unknownVariables(text: string, eventKey: string): string[] {
  const ev = getEvent(eventKey);
  const allowed = new Set<string>([...COMMON_VARS, ...(ev?.vars ?? [])]);
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !allowed.has(v)))];
}

export async function saveTemplate(
  actor: Actor,
  event: string,
  channel: NotificationChannel,
  input: { enabled: boolean; sendToCustomer: boolean; subject?: string; body: string },
) {
  requirePermission(actor, "notifications.manage");
  const ev = getEvent(event);
  if (!ev || !CHANNELS.includes(channel)) throw invalid("Unknown template.");
  const body = input.body.trim();
  const subject = channel === "EMAIL" ? (input.subject ?? "").trim() : null;
  if (!body) throw invalid("Message text is required.");
  if (body.length > (channel === "SMS" ? 640 : 4000)) throw invalid(channel === "SMS" ? "SMS text is too long (max 640 characters)." : "Message is too long.");
  if (channel === "EMAIL" && !subject) throw invalid("Email subject is required.");
  const unknown = unknownVariables(`${subject ?? ""} ${body}`, event);
  if (unknown.length) throw invalid(`Unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{${u}}`).join(", ")}.`);

  await transaction(async (tx) => {
    const before = await tx.notificationTemplate.findUnique({ where: { event_channel: { event, channel } } });
    const data = { enabled: input.enabled, sendToCustomer: ev.customerFacing ? input.sendToCustomer : false, subject, body, updatedById: actor.id };
    await tx.notificationTemplate.upsert({ where: { event_channel: { event, channel } }, create: { event, channel, ...data }, update: data });
    await audit(tx, actor, { action: "notifications.template_change", entityType: "NotificationTemplate", entityId: `${event}:${channel}`, before, after: data });
  });
}

export async function resetTemplate(actor: Actor, event: string, channel: NotificationChannel) {
  const ev = getEvent(event);
  if (!ev) throw invalid("Unknown template.");
  const d = ev.defaults[channel];
  await saveTemplate(actor, event, channel, { enabled: d.enabled, sendToCustomer: !!ev.defaultSendToCustomer, subject: d.subject, body: d.body });
}
