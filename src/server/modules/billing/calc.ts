/**
 * Invoice arithmetic in integer paise (no floating-point money).
 * Pure functions — unit tested in tests/billing-calc.test.ts.
 */
import type { Prisma } from "@prisma/client";
import { invalid } from "../../lib/errors";

export type Paise = number;

/** Parse "1,234.50" / 1234.5 / Decimal into paise. Throws on invalid input. */
export function toPaise(v: string | number | Prisma.Decimal | null | undefined, field = "Amount"): Paise {
  if (v === null || v === undefined || v === "") return 0;
  const s = typeof v === "string" ? v.replace(/,/g, "").trim() : v.toString();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw invalid(`${field} must be a number with up to 2 decimals.`);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise)) throw invalid(`${field} is too large.`);
  return s.startsWith("-") ? -paise : paise;
}

/** Paise → "1234.50" (string for Prisma Decimal columns). */
export function fromPaise(p: Paise): string {
  const sign = p < 0 ? "-" : "";
  const a = Math.abs(p);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Paise → "₹1,23,456.50" (Indian grouping). */
export function formatINR(p: Paise, symbol = "₹"): string {
  const n = Math.abs(p) / 100;
  const s = n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${p < 0 ? "-" : ""}${symbol}${s}`;
}

/** Quantity with up to 3 decimals → thousandths. */
function toMilli(v: string | number, field: string): number {
  const s = String(v).replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw invalid(`${field} must be a positive number (max 3 decimals).`);
  const [w, f = ""] = s.split(".");
  return Number(w) * 1000 + Number((f + "000").slice(0, 3));
}

/** Tax % with up to 2 decimals → basis points. */
function toBasisPoints(v: string | number): number {
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw invalid("GST % must be a number with up to 2 decimals.");
  const [w, f = ""] = s.split(".");
  const bp = Number(w) * 100 + Number((f + "00").slice(0, 2));
  if (bp > 10_000) throw invalid("GST % cannot exceed 100.");
  return bp;
}

/** Round half away from zero for non-negative integers division. */
const div = (num: number, den: number) => Math.floor((num + Math.floor(den / 2)) / den);

export interface ItemInput {
  description: string;
  hsnSac?: string;
  quantity: string | number;
  unit?: string;
  rate: string | number;
  discount?: string | number;
  taxRate: string | number;
}

export interface ComputedItem {
  description: string;
  hsnSac: string | null;
  unit: string | null;
  quantityMilli: number;
  rate: Paise;
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  taxBp: number;
  tax: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  lineTotal: Paise;
}

export type TaxType = "INTRA_STATE" | "INTER_STATE" | "NONE";

export interface InvoiceTotals {
  items: ComputedItem[];
  subtotal: Paise;
  discountTotal: Paise;
  taxableTotal: Paise;
  cgstTotal: Paise;
  sgstTotal: Paise;
  igstTotal: Paise;
  taxTotal: Paise;
  roundOff: Paise;
  grandTotal: Paise;
}

export function computeInvoice(rawItems: ItemInput[], taxType: TaxType, roundToRupee: boolean): InvoiceTotals {
  if (rawItems.length === 0) throw invalid("Add at least one item.");
  if (rawItems.length > 200) throw invalid("Too many items (max 200).");

  const items = rawItems.map((it, i): ComputedItem => {
    const n = i + 1;
    const description = it.description?.trim();
    if (!description) throw invalid(`Item ${n}: description is required.`);
    const quantityMilli = toMilli(it.quantity, `Item ${n} quantity`);
    if (quantityMilli <= 0) throw invalid(`Item ${n}: quantity must be more than 0.`);
    const rate = toPaise(it.rate, `Item ${n} rate`);
    if (rate < 0) throw invalid(`Item ${n}: rate cannot be negative.`);
    const gross = div(quantityMilli * rate, 1000);
    const discount = toPaise(it.discount ?? 0, `Item ${n} discount`);
    if (discount < 0) throw invalid(`Item ${n}: discount cannot be negative.`);
    if (discount > gross) throw invalid(`Item ${n}: discount cannot exceed the line amount.`);
    const taxable = gross - discount;
    const taxBp = taxType === "NONE" ? 0 : toBasisPoints(it.taxRate ?? 0);
    const tax = div(taxable * taxBp, 10_000);
    const cgst = taxType === "INTRA_STATE" ? Math.floor(tax / 2) : 0;
    const sgst = taxType === "INTRA_STATE" ? tax - cgst : 0;
    const igst = taxType === "INTER_STATE" ? tax : 0;
    return {
      description: description.slice(0, 500),
      hsnSac: it.hsnSac?.trim().slice(0, 20) || null,
      unit: it.unit?.trim().slice(0, 20) || null,
      quantityMilli,
      rate,
      gross,
      discount,
      taxable,
      taxBp,
      tax,
      cgst,
      sgst,
      igst,
      lineTotal: taxable + tax,
    };
  });

  const sum = (f: (i: ComputedItem) => number) => items.reduce((a, i) => a + f(i), 0);
  const taxableTotal = sum((i) => i.taxable);
  const taxTotal = sum((i) => i.tax);
  const exact = taxableTotal + taxTotal;
  const grandTotal = roundToRupee ? div(exact, 100) * 100 : exact;
  return {
    items,
    subtotal: sum((i) => i.gross),
    discountTotal: sum((i) => i.discount),
    taxableTotal,
    cgstTotal: sum((i) => i.cgst),
    sgstTotal: sum((i) => i.sgst),
    igstTotal: sum((i) => i.igst),
    taxTotal,
    roundOff: grandTotal - exact,
    grandTotal,
  };
}

/** Commission amount = base × percent, rounded to paise. */
export function commissionAmount(base: Paise, percent: string | number, shareFactor = 1): Paise {
  const bp = toBasisPoints(percent);
  return div(Math.round(base * bp * shareFactor), 10_000);
}

export function quantityFromMilli(m: number): string {
  return `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, "0")}`;
}
