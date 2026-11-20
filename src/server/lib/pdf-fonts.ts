import { existsSync } from "node:fs";
import path from "node:path";

/**
 * PDF fonts. The built-in PDF fonts (Helvetica) have no ₹ glyph, so invoices and
 * reports use Noto Sans (SIL Open Font License, see assets/fonts/OFL.txt).
 * Falls back to Helvetica + "Rs." if the font files are missing.
 */
const DIR = path.join(process.cwd(), "assets", "fonts");
const REGULAR = path.join(DIR, "NotoSans-Regular.ttf");
const BOLD = path.join(DIR, "NotoSans-Bold.ttf");

export type PdfFonts = { regular: string; bold: string; currency: string };

export function registerPdfFonts(doc: PDFKit.PDFDocument): PdfFonts {
  if (existsSync(REGULAR) && existsSync(BOLD)) {
    doc.registerFont("Body", REGULAR);
    doc.registerFont("Body-Bold", BOLD);
    return { regular: "Body", bold: "Body-Bold", currency: "₹" };
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold", currency: "Rs. " };
}
