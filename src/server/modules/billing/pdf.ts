/**
 * Invoice PDF (spec §25–26). Generated on demand from the stored invoice, so
 * it always reflects current payment status — a paid invoice carries a PAID
 * stamp, a cancelled one a CANCELLED stamp. Built-in PDF fonts lack the ₹
 * glyph, so amounts print as "Rs.".
 */
import PDFDocument from "pdfkit";
import { formatDateLabel, fromDbDate } from "../../lib/dates";
import { storage } from "../../storage";
import { formatINR, toPaise } from "./calc";
import { METHOD_LABELS, type getInvoice } from "./invoices";

type Inv = Awaited<ReturnType<typeof getInvoice>>;
type Company = { name: string; address: string; phone: string; email: string; gstNumber: string; logoKey: string | null };
type CustomerSnap = { name: string; phone?: string | null; email?: string | null; address?: string | null; gstNumber?: string | null };

const rs = (v: { toString(): string } | number) => formatINR(typeof v === "number" ? v : toPaise(v.toString()), "Rs. ");

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function threeDigits(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}
/** Indian-system amount in words: "Eleven Thousand Eight Hundred Rupees Only". */
export function amountInWords(paise: number): string {
  let rupees = Math.floor(paise / 100);
  const p = paise % 100;
  if (rupees === 0 && p === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));
  const r = parts.join(" ");
  return `${r ? `${r} Rupees` : ""}${p ? `${r ? " and " : ""}${twoDigits(p)} Paise` : ""} Only`;
}

export async function renderInvoicePdf(inv: Inv): Promise<Buffer> {
  const company = inv.companySnapshot as unknown as Company;
  const customer = inv.customerSnapshot as unknown as CustomerSnap;
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Invoice ${inv.number}`, Author: company.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 80; // content width
  const L = 40;
  const ink = "#0f172a";
  const muted = "#64748b";
  const line = "#e2e8f0";
  const brand = "#2563eb";

  // ── Header ──
  let logoW = 0;
  if (company.logoKey && /\.(png|jpe?g)$/i.test(company.logoKey)) {
    try {
      doc.image(await storage().get(company.logoKey), L, 40, { fit: [60, 60] });
      logoW = 72;
    } catch {
      /* logo missing — continue without it */
    }
  }
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(16).text(company.name, L + logoW, 42, { width: 280 });
  doc.font("Helvetica").fontSize(9).fillColor(muted);
  const companyLines = [company.address, [company.phone, company.email].filter(Boolean).join(" · "), company.gstNumber ? `GSTIN: ${company.gstNumber}` : ""].filter(Boolean);
  doc.text(companyLines.join("\n"), L + logoW, doc.y + 2, { width: 280 });

  doc.font("Helvetica-Bold").fontSize(20).fillColor(brand).text(inv.taxType === "NONE" ? "INVOICE" : "TAX INVOICE", L, 42, { width: W, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(ink);
  const meta: [string, string][] = [
    ["Invoice no.", inv.number],
    ["Invoice date", formatDateLabel(fromDbDate(inv.invoiceDate))],
    ...(inv.dueDate ? ([["Due date", formatDateLabel(fromDbDate(inv.dueDate))]] as [string, string][]) : []),
    ["Work ref.", inv.work.reference],
  ];
  let my = 70;
  for (const [k, v] of meta) {
    doc.fillColor(muted).text(k, L + W - 220, my, { width: 100, align: "right" });
    doc.fillColor(ink).font("Helvetica-Bold").text(v, L + W - 110, my, { width: 110, align: "right" });
    doc.font("Helvetica");
    my += 13;
  }

  // ── Bill to ──
  let y = Math.max(doc.y, my) + 18;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(line).stroke();
  y += 10;
  doc.fillColor(muted).fontSize(8).text("BILL TO", L, y);
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(11).text(customer.name, L, y + 11);
  doc.font("Helvetica").fontSize(9).fillColor(muted);
  doc.text([customer.address, [customer.phone, customer.email].filter(Boolean).join(" · "), customer.gstNumber ? `GSTIN: ${customer.gstNumber}` : ""].filter(Boolean).join("\n"), L, doc.y + 2, { width: 300 });
  if (inv.taxType !== "NONE") {
    doc.fillColor(muted).fontSize(8).text("SUPPLY", L + W - 160, y, { width: 160, align: "right" });
    doc.fillColor(ink).fontSize(9).text(inv.taxType === "INTRA_STATE" ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)", L + W - 160, y + 11, { width: 160, align: "right" });
  }
  y = doc.y + 16;

  // ── Items table ──
  const cols = [
    { h: "#", w: 22, a: "left" as const },
    { h: "Description", w: 196, a: "left" as const },
    { h: "Qty", w: 42, a: "right" as const },
    { h: "Rate", w: 66, a: "right" as const },
    { h: "Disc.", w: 50, a: "right" as const },
    { h: "GST %", w: 38, a: "right" as const },
    { h: "Amount", w: W - 22 - 196 - 42 - 66 - 50 - 38, a: "right" as const },
  ];
  const row = (cells: string[], yy: number, bold = false, color = ink) => {
    let x = L;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(color);
    let h = 0;
    cells.forEach((c, i) => {
      doc.text(c, x + 4, yy, { width: cols[i].w - 8, align: cols[i].a });
      h = Math.max(h, doc.heightOfString(c, { width: cols[i].w - 8 }));
      x += cols[i].w;
    });
    return h;
  };
  doc.rect(L, y, W, 20).fill("#f1f5f9");
  row(cols.map((c) => c.h), y + 6, true, muted);
  y += 24;
  inv.items.forEach((it, i) => {
    if (y > doc.page.height - 220) {
      doc.addPage();
      y = 40;
    }
    const desc = `${it.description}${it.hsnSac ? `\nHSN/SAC: ${it.hsnSac}` : ""}`;
    const qty = `${Number(it.quantity)}${it.unit ? ` ${it.unit}` : ""}`;
    const h = row([String(i + 1), desc, qty, rs(it.rate), toPaise(it.discount.toString()) ? rs(it.discount) : "—", inv.taxType === "NONE" ? "—" : `${Number(it.taxRate)}%`, rs(it.taxable)], y);
    y += h + 8;
    doc.moveTo(L, y - 4).lineTo(L + W, y - 4).strokeColor(line).stroke();
  });

  // ── Totals ──
  y += 6;
  const tx = L + W - 230;
  const totals: [string, string, boolean?][] = [
    ["Subtotal", rs(inv.subtotal)],
    ...(toPaise(inv.discountTotal.toString()) ? ([["Discount", `- ${rs(inv.discountTotal)}`]] as [string, string][]) : []),
    ["Taxable value", rs(inv.taxableTotal)],
    ...(inv.taxType === "INTRA_STATE" ? ([["CGST", rs(inv.cgstTotal)], ["SGST", rs(inv.sgstTotal)]] as [string, string][]) : []),
    ...(inv.taxType === "INTER_STATE" ? ([["IGST", rs(inv.igstTotal)]] as [string, string][]) : []),
    ...(toPaise(inv.roundOff.toString()) ? ([["Round off", rs(inv.roundOff)]] as [string, string][]) : []),
  ];
  const totalsTop = y;
  doc.fontSize(9);
  for (const [k, v] of totals) {
    doc.font("Helvetica").fillColor(muted).text(k, tx, y, { width: 120 });
    doc.fillColor(ink).text(v, tx + 120, y, { width: 110, align: "right" });
    y += 14;
  }
  doc.rect(tx - 6, y, 236, 24).fill("#eff6ff");
  doc.font("Helvetica-Bold").fontSize(11).fillColor(brand).text("Grand total", tx, y + 7, { width: 120 });
  doc.text(rs(inv.grandTotal), tx + 120, y + 7, { width: 110, align: "right" });
  y += 32;
  doc.font("Helvetica").fontSize(9);
  for (const [k, v] of [["Paid", rs(inv.amountPaid)], ["Balance due", rs(inv.balanceDue)]] as const) {
    doc.fillColor(muted).text(k, tx, y, { width: 120 });
    doc.fillColor(ink).font(k === "Balance due" ? "Helvetica-Bold" : "Helvetica").text(v, tx + 120, y, { width: 110, align: "right" });
    doc.font("Helvetica");
    y += 14;
  }

  const stampY = y + 20;
  const stamped = inv.status === "PAID" || inv.status === "CANCELLED";
  if (stamped) y += 100;

  // Amount in words (left of totals)
  doc.fillColor(muted).fontSize(8).text("AMOUNT IN WORDS", L, totalsTop);
  doc.fillColor(ink).fontSize(9).text(amountInWords(toPaise(inv.grandTotal.toString())), L, totalsTop + 11, { width: tx - L - 30 });

  // Payments received
  const active = inv.payments.filter((p) => !p.voidedAt);
  if (active.length) {
    doc.fillColor(muted).fontSize(8).text("PAYMENTS RECEIVED", L, doc.y + 12);
    doc.fillColor(ink).fontSize(8.5);
    for (const p of active) {
      doc.text(`${formatDateLabel(fromDbDate(p.paidOn))} · ${METHOD_LABELS[p.method]}${p.reference ? ` (${p.reference})` : ""} · ${rs(p.amount)}`, L, doc.y + 2, { width: tx - L - 30 });
    }
  }

  // Notes / terms / bank
  y = Math.max(y, doc.y) + 20;
  const footerBlocks = [
    ["NOTES", inv.notes],
    ["BANK DETAILS", (inv.companySnapshot as { bankDetails?: string }).bankDetails],
    ["TERMS", (inv.companySnapshot as { terms?: string }).terms],
  ].filter(([, v]) => v) as [string, string][];
  for (const [k, v] of footerBlocks) {
    doc.fillColor(muted).fontSize(8).text(k, L, y);
    doc.fillColor(ink).fontSize(9).text(v, L, y + 11, { width: W });
    y = doc.y + 10;
  }

  // Stamp — drawn in the space under the totals so no figures are covered.
  if (stamped) {
    const paid = inv.status === "PAID";
    const color = paid ? "#16a34a" : "#dc2626";
    const label = paid ? "PAID" : "CANCELLED";
    const sub = paid && inv.paidAt ? formatDateLabel(inv.paidAt.toISOString().slice(0, 10)) : (inv.cancelReason ?? "").slice(0, 40);
    const sx = tx + 20;
    doc.save();
    doc.rotate(-12, { origin: [sx + 95, stampY + 32] });
    doc.opacity(0.9);
    doc.lineWidth(3).roundedRect(sx, stampY, 190, 64, 8).strokeColor(color).stroke();
    doc.lineWidth(1).roundedRect(sx + 6, stampY + 6, 178, 52, 6).strokeColor(color).stroke();
    doc.font("Helvetica-Bold").fontSize(paid ? 34 : 24).fillColor(color).text(label, sx, stampY + (paid ? 10 : 16), { width: 190, align: "center" });
    if (sub) doc.font("Helvetica-Bold").fontSize(8).text(sub, sx, stampY + 46, { width: 190, align: "center" });
    doc.restore();
  }

  doc.fontSize(7.5).fillColor(muted).text("This is a computer-generated invoice.", L, doc.page.height - 50, { width: W, align: "center" });
  doc.end();
  return done;
}
