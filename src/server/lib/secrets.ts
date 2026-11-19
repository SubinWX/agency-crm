/**
 * Encryption for stored credentials (notification provider API keys etc.).
 * AES-256-GCM with a key from SECRETS_ENCRYPTION_KEY (32 bytes, base64).
 * Plaintext secrets are only ever held in memory while sending.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors";

function key(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : null;
  if (!buf || buf.length !== 32) {
    throw new AppError("INVALID_STATE", "Server is missing SECRETS_ENCRYPTION_KEY (32-byte base64). Ask your administrator to set it.");
  }
  return buf;
}

export function encryptJson(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptJson(payload: string | null | undefined): Record<string, string> {
  if (!payload) return {};
  const [v, iv, tag, data] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new AppError("INVALID_STATE", "Stored credentials are unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(out) as Record<string, string>;
}

/** "••••••3f9a" — enough to recognise a key without revealing it. */
export function maskSecret(v: string | undefined): string {
  if (!v) return "";
  return v.length <= 8 ? "••••••••" : `••••••${v.slice(-4)}`;
}

/** Remove any secret values from a string before it is stored or logged. */
export function redact(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(secrets)) {
    if (v && v.length >= 4) out = out.split(v).join("[redacted]");
  }
  return out;
}
