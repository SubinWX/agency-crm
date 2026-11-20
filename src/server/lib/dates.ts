import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** The server machine's own time zone. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fallback before the saved setting is loaded (env, else India). */
export const DEFAULT_TZ = process.env.BUSINESS_TIMEZONE && isValidTimeZone(process.env.BUSINESS_TIMEZONE) ? process.env.BUSINESS_TIMEZONE : "Asia/Kolkata";
let currentTz = DEFAULT_TZ;

/** Business time zone: decides which calendar day "today" is and how times are shown. Set in Settings → Date & time. */
export function businessTz(): string {
  return currentTz;
}

/** Apply the saved setting ("system" = the server's own time zone). */
export function setBusinessTz(setting: string) {
  const tz = setting === "system" ? systemTimeZone() : setting;
  currentTz = isValidTimeZone(tz) ? tz : DEFAULT_TZ;
  return currentTz;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function businessToday(now = new Date()): string {
  return formatInTimeZone(now, currentTz, "yyyy-MM-dd");
}

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = parseISO(s);
  return !Number.isNaN(d.getTime()) && format(d, "yyyy-MM-dd") === s;
}

/** Convert YYYY-MM-DD to the Date value Prisma uses for a DATE column. */
export function toDbDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Convert a DATE column value back to YYYY-MM-DD. */
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return fromDbDate(addDays(toDbDate(iso), days));
}

/** "20 Aug 2026" style label for user-facing messages. */
export function formatDateLabel(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy");
}

export function formatDateTime(d: Date): string {
  return formatInTimeZone(d, currentTz, "d MMM yyyy, h:mm a");
}

/** Start/end instant of a business-time-zone day (for timestamp filters). */
export function dayStart(iso: string): Date {
  return fromZonedTime(`${iso}T00:00:00`, currentTz);
}
export function dayEnd(iso: string): Date {
  return fromZonedTime(`${iso}T23:59:59.999`, currentTz);
}
