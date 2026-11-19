/**
 * Notification provider adapters (spec §41, §78). Each provider is a small
 * object: its settings fields (secret ones are encrypted at rest) and a send()
 * that calls the provider's HTTP API. Adding a provider = adding one entry.
 *
 * `fetchImpl` is injectable so tests never hit the network.
 */
import type { NotificationChannel } from "@prisma/client";
import { createTransport } from "nodemailer";

export interface OutgoingMessage {
  to: string; // email address or E.164 phone
  subject?: string | null;
  body: string;
  statusCallbackUrl?: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  response: string;
  /** false = permanent failure (bad number, auth) — don't retry. */
  retryable?: boolean;
  error?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderDef {
  id: string;
  label: string;
  channels: NotificationChannel[];
  fields: FieldDef[];
  help?: string;
  send(msg: OutgoingMessage, cfg: Record<string, string>, secrets: Record<string, string>, fetchImpl: typeof fetch, channel: NotificationChannel): Promise<SendResult>;
}

async function httpResult(res: Response, idFrom: (json: unknown) => string | undefined): Promise<SendResult> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (res.ok) return { ok: true, providerMessageId: json ? idFrom(json) : undefined, response: text.slice(0, 1000) };
  return {
    ok: false,
    response: text.slice(0, 1000),
    error: `HTTP ${res.status}`,
    // 4xx (except 408/429) are permanent: bad request, auth, invalid number.
    retryable: res.status >= 500 || res.status === 408 || res.status === 429,
  };
}

const digits = (phone: string) => phone.replace(/[^\d]/g, "");

export const PROVIDERS: Record<string, ProviderDef> = {
  log: {
    id: "log",
    label: "Test mode (log only — nothing is sent)",
    channels: ["EMAIL", "SMS", "WHATSAPP"],
    fields: [],
    help: "Messages are recorded in the delivery log as sent, but never leave the server. Use this until you subscribe to a provider.",
    async send(msg) {
      return { ok: true, providerMessageId: `log-${Date.now().toString(36)}`, response: `Logged message to ${msg.to} (${msg.body.length} chars)` };
    },
  },

  smtp: {
    id: "smtp",
    label: "SMTP server",
    channels: ["EMAIL"],
    fields: [
      { key: "host", label: "SMTP host", required: true, placeholder: "smtp.gmail.com" },
      { key: "port", label: "Port", required: true, placeholder: "587" },
      { key: "secure", label: "Use TLS from start (true for port 465)", placeholder: "false" },
      { key: "username", label: "Username", required: true },
      { key: "password", label: "Password / app password", secret: true, required: true },
      { key: "fromEmail", label: "From email", required: true },
      { key: "fromName", label: "From name" },
    ],
    async send(msg, cfg, secrets) {
      const transport = createTransport({
        host: cfg.host,
        port: Number(cfg.port || 587),
        secure: cfg.secure === "true",
        auth: { user: cfg.username, pass: secrets.password },
        connectionTimeout: 15_000,
      });
      try {
        const info = await transport.sendMail({ from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail, to: msg.to, subject: msg.subject ?? "", text: msg.body });
        return { ok: true, providerMessageId: info.messageId, response: String(info.response ?? "accepted") };
      } catch (e) {
        const err = e as { message?: string; responseCode?: number };
        // 5xx SMTP replies are permanent (bad address, rejected); 4xx and network errors are retried.
        return { ok: false, response: String(err.message ?? e), error: "SMTP error", retryable: !(err.responseCode && err.responseCode >= 500) };
      }
    },
  },

  resend: {
    id: "resend",
    label: "Resend (email API)",
    channels: ["EMAIL"],
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "fromEmail", label: "From email (verified domain)", required: true },
      { key: "fromName", label: "From name" },
    ],
    async send(msg, cfg, secrets, f) {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${secrets.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail, to: [msg.to], subject: msg.subject ?? "", text: msg.body }),
      });
      return httpResult(res, (j) => (j as { id?: string }).id);
    },
  },

  msg91: {
    id: "msg91",
    label: "MSG91 (India SMS, DLT flow)",
    channels: ["SMS"],
    fields: [
      { key: "authKey", label: "Auth key", secret: true, required: true },
      { key: "flowTemplateId", label: "Flow / DLT template ID", required: true, help: "Create one DLT-approved template with a single variable for the message text." },
      { key: "variableName", label: "Template variable name", placeholder: "VAR1" },
    ],
    async send(msg, cfg, secrets, f) {
      const res = await f("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: { authkey: secrets.authKey, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ template_id: cfg.flowTemplateId, short_url: "0", recipients: [{ mobiles: digits(msg.to), [cfg.variableName || "VAR1"]: msg.body }] }),
      });
      const r = await httpResult(res, (j) => (j as { message?: string }).message);
      // MSG91 returns 200 with {"type":"error"} for some failures.
      if (r.ok && /"type"\s*:\s*"error"/.test(r.response)) return { ...r, ok: false, error: "MSG91 error", retryable: false };
      return r;
    },
  },

  twilio: {
    id: "twilio",
    label: "Twilio SMS",
    channels: ["SMS"],
    fields: [
      { key: "accountSid", label: "Account SID", required: true },
      { key: "authToken", label: "Auth token", secret: true, required: true },
      { key: "fromNumber", label: "From number / Messaging Service SID", required: true, placeholder: "+1415… or MG…" },
    ],
    async send(msg, cfg, secrets, f, channel) {
      return twilioSend(msg, cfg, secrets, f, channel);
    },
  },

  meta_whatsapp: {
    id: "meta_whatsapp",
    label: "WhatsApp Cloud API (Meta)",
    channels: ["WHATSAPP"],
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", required: true },
      { key: "accessToken", label: "Permanent access token", secret: true, required: true },
      { key: "templateName", label: "Approved template name", placeholder: "crm_update", help: "Business-initiated messages need an approved template with one body variable {{1}}; the message text is passed into it. Leave empty to send plain text (only works inside a 24-hour customer session)." },
      { key: "languageCode", label: "Template language", placeholder: "en" },
      { key: "apiVersion", label: "Graph API version", placeholder: "v21.0" },
      { key: "appSecret", label: "App secret (verifies delivery webhooks)", secret: true },
      { key: "verifyToken", label: "Webhook verify token", secret: true },
    ],
    async send(msg, cfg, secrets, f) {
      const payload = cfg.templateName
        ? {
            messaging_product: "whatsapp",
            to: digits(msg.to),
            type: "template",
            template: { name: cfg.templateName, language: { code: cfg.languageCode || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: msg.body.slice(0, 1000) }] }] },
          }
        : { messaging_product: "whatsapp", to: digits(msg.to), type: "text", text: { body: msg.body } };
      const res = await f(`https://graph.facebook.com/${cfg.apiVersion || "v21.0"}/${cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secrets.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return httpResult(res, (j) => (j as { messages?: { id: string }[] }).messages?.[0]?.id);
    },
  },

  twilio_whatsapp: {
    id: "twilio_whatsapp",
    label: "Twilio WhatsApp",
    channels: ["WHATSAPP"],
    fields: [
      { key: "accountSid", label: "Account SID", required: true },
      { key: "authToken", label: "Auth token", secret: true, required: true },
      { key: "fromNumber", label: "WhatsApp sender number", required: true, placeholder: "+14155238886" },
    ],
    async send(msg, cfg, secrets, f, channel) {
      return twilioSend(msg, cfg, secrets, f, channel);
    },
  },
};

async function twilioSend(msg: OutgoingMessage, cfg: Record<string, string>, secrets: Record<string, string>, f: typeof fetch, channel: NotificationChannel) {
  const wa = channel === "WHATSAPP";
  const params = new URLSearchParams({ To: wa ? `whatsapp:${msg.to}` : msg.to, Body: msg.body });
  if (cfg.fromNumber.startsWith("MG")) params.set("MessagingServiceSid", cfg.fromNumber);
  else params.set("From", wa ? `whatsapp:${cfg.fromNumber}` : cfg.fromNumber);
  if (msg.statusCallbackUrl) params.set("StatusCallback", msg.statusCallbackUrl);
  const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${secrets.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return httpResult(res, (j) => (j as { sid?: string }).sid);
}

export function providersFor(channel: NotificationChannel) {
  return Object.values(PROVIDERS).filter((p) => p.channels.includes(channel));
}

/** Normalise an Indian/international phone to E.164 (+91XXXXXXXXXX). Returns null if unusable. */
export function toE164(phone: string | null | undefined, defaultCountry = "91"): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  let d = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = defaultCountry + d.slice(1);
  else if (d.length === 10) d = defaultCountry + d;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
