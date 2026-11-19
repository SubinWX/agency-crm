import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

/** Business timezone decides which calendar day "today" is. */
export const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function businessToday(now = new Date()): string {
  return formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM-dd");
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
  return formatInTimeZone(d, BUSINESS_TZ, "d MMM yyyy, h:mm a");
}
