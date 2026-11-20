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
type Company = { name: string; address: string; phone: string; email: string; gstNumber: string; logoKey: string | null; logoPdfKey?: string | null };
type CustomerSnap = { name: string; phone?: string | null; email?: string | null; address?: string | null; gstNumber?: string | null };

const n = (p: number) => formatINR(p, "");
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

type Align = "left" | "right" | "center";
type Col = { h: string; w: number; a: Align };

const C = {
  ink: "#0f172a",
  muted: "#64748b",
  border: "#cbd5e1",
  soft: "#f1f5f9",
  zebra: "#f8fafc",
  navy: "#0f1b3d",
  brand: "#2563eb",
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
};

export async function renderInvoicePdf(inv: Inv): Promise<Buffer> {
  const company = inv.companySnapshot as unknown as Company & { bankDetails?: string; terms?: string };
  const customer = inv.customerSnapshot as unknown as CustomerSnap;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Invoice ${inv.number}`, Author: company.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const L = 40;
  const W = doc.page.width - 80;
  const bottom = () => doc.page.height - 60;
  const taxed = inv.taxType !== "NONE";
  const paise = (v: { toString(): string }) => toPaise(v.toString());
  let y = 0;
  let stampAt = { x: 0, y: 0 };

  const newPage = () => {
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 6).fill(C.navy);
    y = 40;
  };
  const ensure = (h: number) => {
    if (y + h > bottom()) newPage();
  };
  const font = (bold: boolean, size: number, color: string = C.ink) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
  const label = (text: string, x: number, yy: number, w: number) => font(true, 7.5, C.muted).text(text.toUpperCase(), x, yy, { width: w, characterSpacing: 0.6 });

  /** Bordered table with a dark header row, zebra rows and page breaks (header repeats). */
  const table = (cols: Col[], rows: { cells: string[]; bold?: boolean; fill?: string; color?: string }[], x = L, opts: { headFill?: string; headColor?: string; size?: number } = {}) => {
    const pad = 5;
    const size = opts.size ?? 8.5;
    const width = cols.reduce((a, c) => a + c.w, 0);
    const heightOf = (cells: string[], bold: boolean) => {
      font(bold, size);
      return Math.max(...cells.map((c, i) => doc.heightOfString(c || " ", { width: cols[i].w - pad * 2 }))) + pad * 2;
    };
    const drawRow = (cells: string[], h: number, bold: boolean, fill: string | null, color: string) => {
      if (fill) doc.rect(x, y, width, h).fill(fill);
      let cx = x;
      cells.forEach((c, i) => {
        font(bold, size, color).text(c, cx + pad, y + pad, { width: cols[i].w - pad * 2, align: cols[i].a });
        cx += cols[i].w;
      });
      // grid
      doc.lineWidth(0.5).strokeColor(C.border);
      doc.rect(x, y, width, h).stroke();
      cx = x;
      for (const c of cols.slice(0, -1)) {
        cx += c.w;
        doc.moveTo(cx, y).lineTo(cx, y + h).stroke();
      }
      y += h;
    };
    const head = () => {
      const h = heightOf(cols.map((c) => c.h), true);
      drawRow(cols.map((c) => c.h), h, true, opts.headFill ?? C.navy, opts.headColor ?? "#ffffff");
    };
    ensure(40);
    head();
    rows.forEach((r, i) => {
      const h = heightOf(r.cells, !!r.bold);
      if (y + h > bottom()) {
        newPage();
        head();
      }
      drawRow(r.cells, h, !!r.bold, r.fill ?? (i % 2 ? C.zebra : null), r.color ?? C.ink);
    });
  };

  // ── Top band + header ──
  doc.rect(0, 0, doc.page.width, 6).fill(C.navy);
  y = 34;
  // Logo on its own line (keeps wide logos readable), then name and contact lines.
  const pdfLogo = company.logoPdfKey ?? company.logoKey;
  let ny = y;
  if (pdfLogo && /\.(png|jpe?g)$/i.test(pdfLogo)) {
    try {
      const img = await storage().get(pdfLogo);
      doc.image(img, L, y, { fit: [150, 38] });
      ny = y + 44;
    } catch {
      /* logo missing — continue without it */
    }
  }
  font(true, 15).text(company.name, L, ny, { width: 300 });
  const companyLines = [company.address, [company.phone, company.email].filter(Boolean).join("  ·  "), company.gstNumber ? `GSTIN: ${company.gstNumber}` : ""].filter(Boolean);
  if (companyLines.length) font(false, 8.5, C.muted).text(companyLines.join("\n"), L, doc.y + 3, { width: 300, lineGap: 1 });
  const leftBottom = doc.y;

  font(true, 20, C.navy).text(taxed ? "TAX INVOICE" : "INVOICE", L, y, { width: W, align: "right", characterSpacing: 1 });
  // Status pill
  const today = new Date().toISOString().slice(0, 10);
  const overdue = inv.dueDate && fromDbDate(inv.dueDate) < today && paise(inv.balanceDue) > 0;
  const status =
    inv.status === "PAID" ? { t: "PAID", c: C.green } :
    inv.status === "CANCELLED" ? { t: "CANCELLED", c: C.red } :
    inv.status === "PARTIALLY_PAID" ? { t: overdue ? "PART PAID · OVERDUE" : "PARTIALLY PAID", c: C.amber } :
    { t: overdue ? "OVERDUE" : "PAYMENT DUE", c: overdue ? C.red : C.brand };
  font(true, 8);
  const pw = doc.widthOfString(status.t, { characterSpacing: 0.6 }) + 18;
  doc.roundedRect(L + W - pw, y + 28, pw, 17, 8.5).fill(status.c);
  font(true, 8, "#ffffff").text(status.t, L + W - pw, y + 33, { width: pw, align: "center", characterSpacing: 0.6 });
  y = Math.max(leftBottom, y + 50) + 16;

  // ── Bill to | Invoice details ──
  const boxW = (W - 12) / 2;
  const billLines = [customer.address, customer.phone ? `Phone: ${customer.phone}` : "", customer.email ? `Email: ${customer.email}` : "", customer.gstNumber ? `GSTIN: ${customer.gstNumber}` : ""].filter(Boolean).join("\n");
  const details: [string, string][] = [
    ["Invoice no.", inv.number],
    ["Invoice date", formatDateLabel(fromDbDate(inv.invoiceDate))],
    ...(inv.dueDate ? ([["Due date", formatDateLabel(fromDbDate(inv.dueDate))]] as [string, string][]) : []),
    ["Work ref.", inv.work.reference],
    ...(taxed ? ([["Supply", inv.taxType === "INTRA_STATE" ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)"]] as [string, string][]) : []),
  ];
  font(true, 11);
  let billH = doc.heightOfString(customer.name, { width: boxW - 20 });
  font(false, 8.5);
  if (billLines) billH += 4 + doc.heightOfString(billLines, { width: boxW - 20, lineGap: 1 });
  stampAt = { x: L + boxW - 62, y: 0 };
  const boxH = Math.max(billH + 34, details.length * 15 + 30);
  stampAt.y = y + boxH / 2 + 6;
  for (const [i, title] of ["Bill to", "Invoice details"].entries()) {
    const bx = L + i * (boxW + 12);
    doc.lineWidth(0.5).strokeColor(C.border).roundedRect(bx, y, boxW, boxH, 4).stroke();
    doc.save().roundedRect(bx, y, boxW, 18, 4).clip().rect(bx, y, boxW, 18).fill(C.soft).restore();
    doc.moveTo(bx, y + 18).lineTo(bx + boxW, y + 18).strokeColor(C.border).stroke();
    label(title, bx + 10, y + 6, boxW - 20);
  }
  font(true, 11).text(customer.name, L + 10, y + 26, { width: boxW - 20 });
  if (billLines) font(false, 8.5, C.muted).text(billLines, L + 10, doc.y + 4, { width: boxW - 20, lineGap: 1 });
  let dy = y + 26;
  const dx = L + boxW + 12;
  for (const [k, v] of details) {
    font(false, 8.5, C.muted).text(k, dx + 10, dy, { width: 90 });
    font(true, 8.5).text(v, dx + 100, dy, { width: boxW - 110, align: "right" });
    dy += 15;
  }
  y += boxH + 16;

  // ── Items ──
  const hasHsn = inv.items.some((i) => i.hsnSac);
  const hasDisc = inv.items.some((i) => paise(i.discount) > 0);
  const fixed: Col[] = [
    ...(hasHsn ? [{ h: "HSN/SAC", w: 46, a: "center" as Align }] : []),
    { h: "Qty", w: 40, a: "right" },
    { h: "Rate", w: 60, a: "right" },
    ...(hasDisc ? [{ h: "Discount", w: 54, a: "right" as Align }] : []),
    ...(taxed ? [{ h: "Taxable", w: 62, a: "right" as Align }, { h: "GST", w: 58, a: "right" as Align }] : []),
    { h: "Amount", w: 68, a: "right" },
  ];
  const descW = W - 22 - fixed.reduce((a, c) => a + c.w, 0);
  const itemCols: Col[] = [{ h: "#", w: 22, a: "center" }, { h: "Item / service", w: descW, a: "left" }, ...fixed];
  table(
    itemCols,
    inv.items.map((it, i) => ({
      cells: [
        String(i + 1),
        it.description,
        ...(hasHsn ? [it.hsnSac ?? ""] : []),
        `${Number(it.quantity)}${it.unit ? ` ${it.unit}` : ""}`,
        rs(it.rate),
        ...(hasDisc ? [paise(it.discount) ? `- ${rs(it.discount)}` : "—"] : []),
        ...(taxed ? [rs(it.taxable), `${Number(it.taxRate)}%\n${rs(it.taxAmount)}`] : []),
        rs(taxed ? it.lineTotal : it.taxable),
      ],
    })),
  );
  y += 14;

  // ── Left: words, GST summary, payments | Right: totals ──
  const rightW = 230;
  const leftW = W - rightW - 14;
  const rx = L + W - rightW;
  const totals: { cells: string[]; bold?: boolean; fill?: string; color?: string }[] = [
    { cells: ["Subtotal", rs(inv.subtotal)] },
    ...(paise(inv.discountTotal) ? [{ cells: ["Discount", `- ${rs(inv.discountTotal)}`] }] : []),
    ...(taxed || paise(inv.discountTotal) ? [{ cells: ["Taxable value", rs(inv.taxableTotal)] }] : []),
    ...(inv.taxType === "INTRA_STATE" ? [{ cells: ["CGST", rs(inv.cgstTotal)] }, { cells: ["SGST", rs(inv.sgstTotal)] }] : []),
    ...(inv.taxType === "INTER_STATE" ? [{ cells: ["IGST", rs(inv.igstTotal)] }] : []),
    ...(paise(inv.roundOff) ? [{ cells: ["Round off", rs(inv.roundOff)] }] : []),
    { cells: ["Grand total", rs(inv.grandTotal)], bold: true, fill: "#e0e7ff", color: C.navy },
    { cells: ["Paid", rs(inv.amountPaid)], color: paise(inv.amountPaid) ? C.green : C.ink },
    { cells: ["Balance due", rs(inv.balanceDue)], bold: true, fill: paise(inv.balanceDue) > 0 && inv.status !== "CANCELLED" ? "#fef3c7" : "#dcfce7" },
  ];
  ensure(totals.length * 19 + 30);
  const blockTop = y;
  table([{ h: "Summary", w: 110, a: "left" }, { h: "Amount", w: rightW - 110, a: "right" }], totals.map((t) => ({ ...t, fill: t.fill ?? "#ffffff" })), rx, { size: 9 });
  const rightBottom = y;
  y = blockTop;

  // Amount in words
  const words = amountInWords(paise(inv.grandTotal));
  font(true, 9);
  const wordsH = doc.heightOfString(words, { width: leftW - 20 }) + 30;
  doc.lineWidth(0.5).strokeColor(C.border).roundedRect(L, y, leftW, wordsH, 4).stroke();
  label("Amount in words", L + 10, y + 8, leftW - 20);
  font(true, 9).text(words, L + 10, y + 19, { width: leftW - 20 });
  y += wordsH + 12;

  // GST summary by rate
  if (taxed) {
    const byRate = new Map<number, { taxable: number; tax: number }>();
    for (const it of inv.items) {
      const r = Number(it.taxRate);
      const cur = byRate.get(r) ?? { taxable: 0, tax: 0 };
      byRate.set(r, { taxable: cur.taxable + paise(it.taxable), tax: cur.tax + paise(it.taxAmount) });
    }
    const intra = inv.taxType === "INTRA_STATE";
    const cw = intra ? [36, (leftW - 36) / 4, (leftW - 36) / 4, (leftW - 36) / 4, (leftW - 36) / 4] : [36, (leftW - 36) / 3, (leftW - 36) / 3, (leftW - 36) / 3];
    const heads = intra ? ["GST %", "Taxable (Rs.)", "CGST (Rs.)", "SGST (Rs.)", "Total tax (Rs.)"] : ["GST %", "Taxable (Rs.)", "IGST (Rs.)", "Total tax (Rs.)"];
    table(
      heads.map((h, i) => ({ h, w: cw[i], a: i === 0 ? "center" : "right" })),
      [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([r, v]) => {
        const half = Math.round(v.tax / 2);
        return { cells: intra ? [`${r}%`, n(v.taxable), n(half), n(v.tax - half), n(v.tax)] : [`${r}%`, n(v.taxable), n(v.tax), n(v.tax)] };
      }),
      L,
      { headFill: C.soft, headColor: C.muted, size: 8 },
    );
    y += 12;
  }

  // Payments received
  const active = inv.payments.filter((p) => !p.voidedAt);
  if (active.length) {
    table(
      [{ h: "Date", w: 68, a: "left" }, { h: "Method", w: 62, a: "left" }, { h: "Reference", w: leftW - 68 - 62 - 76, a: "left" }, { h: "Amount", w: 76, a: "right" }],
      active.map((p) => ({ cells: [formatDateLabel(fromDbDate(p.paidOn)), METHOD_LABELS[p.method], p.reference ?? "—", rs(p.amount)] })),
      L,
      { headFill: C.soft, headColor: C.muted, size: 8 },
    );
    y += 12;
  }
  y = Math.max(y, rightBottom) + 18;

  // ── Notes / bank / terms + signature ──
  const blocks = ([["Notes", inv.notes], ["Bank details", company.bankDetails], ["Terms & conditions", company.terms]] as [string, string | null | undefined][]).filter(([, v]) => v) as [string, string][];
  const sigW = 170;
  const textW = W - sigW - 20;
  ensure(90);
  const notesTop = y;
  for (const [k, v] of blocks) {
    font(false, 8.5);
    ensure(doc.heightOfString(v, { width: textW }) + 20);
    label(k, L, y, textW);
    font(false, 8.5, C.ink).text(v, L, y + 11, { width: textW, lineGap: 1 });
    y = doc.y + 12;
  }
  const sy = Math.max(notesTop, blocks.length ? notesTop : y);
  const sx = L + W - sigW;
  font(false, 8.5, C.muted).text(`For ${company.name}`, sx, sy, { width: sigW, align: "center" });
  doc.moveTo(sx + 10, sy + 52).lineTo(sx + sigW - 10, sy + 52).lineWidth(0.5).strokeColor(C.border).stroke();
  font(false, 8, C.muted).text("Authorised signatory", sx, sy + 56, { width: sigW, align: "center" });
  y = Math.max(y, sy + 70);

  // ── PAID / CANCELLED stamp over the first page ──
  if (inv.status === "PAID" || inv.status === "CANCELLED") {
    const paid = inv.status === "PAID";
    const color = paid ? C.green : C.red;
    const sub = paid ? (inv.paidAt ? formatDateLabel(inv.paidAt.toISOString().slice(0, 10)) : "") : "";
    doc.switchToPage(0);
    // Sits on the right side of the Bill-to box, where there is usually free space.
    const { x: cx, y: cy } = stampAt;
    doc.save();
    doc.rotate(-14, { origin: [cx, cy] });
    doc.opacity(0.85);
    doc.lineWidth(3.5).circle(cx, cy, 50).strokeColor(color).stroke();
    doc.lineWidth(1).circle(cx, cy, 44).strokeColor(color).stroke();
    // tick icon
    if (paid) {
      doc.lineWidth(4).lineCap("round").lineJoin("round").moveTo(cx - 9, cy - 23).lineTo(cx - 2, cy - 16).lineTo(cx + 11, cy - 30).strokeColor(color).stroke();
    }
    doc.fillColor(color).font("Helvetica-Bold").fontSize(paid ? 24 : 13).text(paid ? "PAID" : "CANCELLED", cx - 50, cy - (paid ? 9 : 5), { width: 100, align: "center", characterSpacing: 1 });
    if (sub) doc.font("Helvetica-Bold").fontSize(7).text(sub.toUpperCase(), cx - 50, cy + 17, { width: 100, align: "center" });
    if (!paid && inv.cancelReason) doc.font("Helvetica").fontSize(7).text(inv.cancelReason.slice(0, 30), cx - 40, cy + 12, { width: 80, align: "center" });
    doc.restore();
  }

  // ── Footer on every page ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // footer sits below the content area — don't spill onto a new page
    const fy = doc.page.height - 38;
    doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.5).strokeColor(C.border).stroke();
    font(false, 7.5, C.muted).text(`${inv.number}  ·  This is a computer-generated invoice.`, L, fy, { width: W - 80, lineBreak: false });
    font(false, 7.5, C.muted).text(`Page ${i - range.start + 1} of ${range.count}`, L + W - 80, fy, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
