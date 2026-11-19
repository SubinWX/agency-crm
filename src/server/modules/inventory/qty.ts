/** Stock quantities as integer thousandths (3 decimals) — no floating-point drift. */
import type { Prisma } from "@prisma/client";
import { invalid } from "../../lib/errors";

export type Milli = number;

export function toMilli(v: string | number | Prisma.Decimal | null | undefined, field = "Quantity"): Milli {
  if (v === null || v === undefined || v === "") return 0;
  const s = typeof v === "string" ? v.replace(/,/g, "").trim() : v.toString();
  if (!/^-?\d+(\.\d{1,3})?$/.test(s)) throw invalid(`${field} must be a number with up to 3 decimals.`);
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  const m = Number(w) * 1000 + Number((f + "000").slice(0, 3));
  if (!Number.isSafeInteger(m)) throw invalid(`${field} is too large.`);
  return neg ? -m : m;
}

export function fromMilli(m: Milli): string {
  const sign = m < 0 ? "-" : "";
  const a = Math.abs(m);
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, "0")}`;
}

/** "12.5" style display (trailing zeros removed). */
export function formatQty(v: Milli | { toString(): string }, unit?: string | null): string {
  const m = typeof v === "number" ? v : toMilli(v.toString());
  const n = (m / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return unit ? `${n} ${unit}` : n;
}
