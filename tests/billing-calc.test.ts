import { describe, expect, it } from "vitest";
import { commissionAmount, computeInvoice, formatINR, fromPaise, toPaise } from "@/server/modules/billing/calc";

describe("money helpers", () => {
  it("parses and formats paise without floating-point errors", () => {
    expect(toPaise("0.1") + toPaise("0.2")).toBe(30);
    expect(toPaise("1,23,456.78")).toBe(12345678);
    expect(fromPaise(12345678)).toBe("123456.78");
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(() => toPaise("12.345")).toThrow();
    expect(() => toPaise("abc")).toThrow();
  });
});

describe("invoice totals", () => {
  it("splits GST into CGST + SGST for intra-state and rounds to the rupee", () => {
    const t = computeInvoice(
      [
        { description: "Granite slab fitting", quantity: "2.5", rate: "1499.99", discount: "100", taxRate: 18 },
        { description: "Labour", quantity: 1, rate: "800", taxRate: 18 },
      ],
      "INTRA_STATE",
      true,
    );
    // line1 gross = 2.5 × 1499.99 = 3749.975 → 3749.98; taxable 3649.98; tax 656.9964 → 657.00
    expect(t.items[0]).toMatchObject({ gross: 374998, discount: 10000, taxable: 364998, tax: 65700, cgst: 32850, sgst: 32850 });
    expect(t.items[1]).toMatchObject({ taxable: 80000, tax: 14400 });
    expect(t.taxableTotal).toBe(444998);
    expect(t.taxTotal).toBe(80100);
    expect(t.cgstTotal + t.sgstTotal).toBe(t.taxTotal);
    expect(t.igstTotal).toBe(0);
    expect(t.grandTotal).toBe(525100); // 5250.98 → 5251.00
    expect(t.roundOff).toBe(2);
  });

  it("uses IGST for inter-state and no tax when GST is off", () => {
    const inter = computeInvoice([{ description: "x", quantity: 1, rate: "1000", taxRate: 12 }], "INTER_STATE", false);
    expect(inter).toMatchObject({ igstTotal: 12000, cgstTotal: 0, grandTotal: 112000, roundOff: 0 });
    const none = computeInvoice([{ description: "x", quantity: 1, rate: "1000", taxRate: 18 }], "NONE", false);
    expect(none).toMatchObject({ taxTotal: 0, grandTotal: 100000 });
  });

  it("rejects invalid lines", () => {
    expect(() => computeInvoice([], "INTRA_STATE", true)).toThrow(/at least one/);
    expect(() => computeInvoice([{ description: "", quantity: 1, rate: 1, taxRate: 0 }], "NONE", true)).toThrow(/description/);
    expect(() => computeInvoice([{ description: "a", quantity: 0, rate: 1, taxRate: 0 }], "NONE", true)).toThrow(/quantity/);
    expect(() => computeInvoice([{ description: "a", quantity: 1, rate: "-5", taxRate: 0 }], "NONE", true)).toThrow();
    expect(() => computeInvoice([{ description: "a", quantity: 1, rate: 10, discount: 11, taxRate: 0 }], "NONE", true)).toThrow(/discount/);
    expect(() => computeInvoice([{ description: "a", quantity: 1, rate: 10, taxRate: 101 }], "INTRA_STATE", true)).toThrow();
  });

  it("calculates commission on the base amount", () => {
    expect(commissionAmount(1_000_000, 5)).toBe(50_000);
    expect(commissionAmount(1_000_000, "3", 0.5)).toBe(15_000);
    expect(commissionAmount(33_333, "7.5")).toBe(2_500);
  });
});
