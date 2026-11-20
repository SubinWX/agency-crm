"use client";

import { useMemo, useState } from "react";
import { computeInvoice, formatINR, type TaxType } from "@/server/modules/billing/calc";
import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, SubmitButton } from "./action-form";

type Line = { description: string; hsnSac: string; quantity: string; unit: string; rate: string; discount: string; taxRate: string };

/**
 * Invoice line editor with live totals. Uses the same calculator as the
 * server; the server recomputes everything on save (client numbers are only a preview).
 */
export function InvoiceEditor({
  action,
  defaults,
  gstEnabled,
  roundToRupee,
  requireReason = false,
  submitLabel,
}: {
  action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  defaults: { invoiceDate: string; dueDate: string; taxType: TaxType; notes: string; items: Line[]; defaultRate: number };
  gstEnabled: boolean;
  roundToRupee: boolean;
  requireReason?: boolean;
  submitLabel: string;
}) {
  const blank = (): Line => ({ description: "", hsnSac: "", quantity: "1", unit: "", rate: "", discount: "", taxRate: String(defaults.defaultRate) });
  const [items, setItems] = useState<Line[]>(defaults.items.length ? defaults.items : [blank()]);
  const [taxType, setTaxType] = useState<TaxType>(gstEnabled ? defaults.taxType : "NONE");

  const preview = useMemo(() => {
    try {
      const filled = items.filter((i) => i.description.trim() || i.rate);
      if (!filled.length) return { totals: null, error: null };
      return { totals: computeInvoice(filled.map((i) => ({ ...i, rate: i.rate || "0", discount: i.discount || "0", taxRate: i.taxRate || "0" })), taxType, roundToRupee), error: null };
    } catch (e) {
      return { totals: null, error: (e as Error).message };
    }
  }, [items, taxType, roundToRupee]);

  const set = (idx: number, k: keyof Line, v: string) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, [k]: v } : x)));
  const t = preview.totals;

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="items" value={JSON.stringify(items.filter((i) => i.description.trim() || i.rate))} />
      <div className="card grid gap-3 p-4 sm:grid-cols-4">
        <div><label className="label">Invoice date *</label><input type="date" name="invoiceDate" required defaultValue={defaults.invoiceDate} className="input" /></div>
        <div><label className="label">Due date</label><input type="date" name="dueDate" defaultValue={defaults.dueDate} className="input" /></div>
        <div className="sm:col-span-2">
          <label className="label">GST</label>
          {gstEnabled ? (
            <select name="taxType" value={taxType} onChange={(e) => setTaxType(e.target.value as TaxType)} className="input">
              <option value="INTRA_STATE">Intra-state (CGST + SGST)</option>
              <option value="INTER_STATE">Inter-state (IGST)</option>
              <option value="NONE">No GST</option>
            </select>
          ) : (
            <p className="py-2 text-sm text-slate-500">GST is turned off in settings.</p>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th w-[34%]">Item / service</th>
              <th className="table-th">Qty</th>
              <th className="table-th">Unit</th>
              <th className="table-th">Rate (₹)</th>
              <th className="table-th">Discount (₹)</th>
              {taxType !== "NONE" && <th className="table-th">GST %</th>}
              <th className="table-th text-right">Amount</th>
              <th className="table-th">HSN/SAC</th>
              <th className="table-th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it, i) => {
              const line = t?.items[items.filter((x, j) => j < i && (x.description.trim() || x.rate)).length];
              return (
                <tr key={i} className="align-top">
                  <td className="p-2"><input value={it.description} onChange={(e) => set(i, "description", e.target.value)} placeholder="e.g. Granite counter top" className="input" /></td>
                  <td className="p-2"><input value={it.quantity} onChange={(e) => set(i, "quantity", e.target.value)} inputMode="decimal" className="input w-20" /></td>
                  <td className="p-2"><input value={it.unit} onChange={(e) => set(i, "unit", e.target.value)} placeholder="sq ft" className="input w-20" /></td>
                  <td className="p-2"><input value={it.rate} onChange={(e) => set(i, "rate", e.target.value)} inputMode="decimal" className="input w-28" /></td>
                  <td className="p-2"><input value={it.discount} onChange={(e) => set(i, "discount", e.target.value)} inputMode="decimal" className="input w-24" /></td>
                  {taxType !== "NONE" && <td className="p-2"><input value={it.taxRate} onChange={(e) => set(i, "taxRate", e.target.value)} inputMode="decimal" className="input w-20" /></td>}
                  <td className="p-2 pt-4 text-right font-medium">{line && (it.description.trim() || it.rate) ? formatINR(line.lineTotal) : "—"}</td>
                  <td className="p-2"><input value={it.hsnSac} onChange={(e) => set(i, "hsnSac", e.target.value)} placeholder="Optional" aria-label="HSN/SAC code" className="input w-24" /></td>
                  <td className="p-2 pt-3">
                    {items.length > 1 && (
                      <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="rounded px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line">✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-slate-100 p-3">
          <button type="button" onClick={() => setItems((xs) => [...xs, blank()])} className="btn-secondary">+ Add line</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div><label className="label">Notes (printed on invoice)</label><textarea name="notes" rows={3} defaultValue={defaults.notes} className="input" /></div>
          {requireReason && <div><label className="label">Reason for change *</label><input name="reason" required className="input" /></div>}
        </div>
        <div className="card p-4 text-sm">
          {preview.error && <p className="mb-2 rounded bg-amber-50 p-2 text-amber-800">{preview.error}</p>}
          <Row k="Subtotal" v={t?.subtotal} />
          {!!t?.discountTotal && <Row k="Discount" v={-t.discountTotal} />}
          <Row k="Taxable value" v={t?.taxableTotal} />
          {taxType === "INTRA_STATE" && (<><Row k="CGST" v={t?.cgstTotal} /><Row k="SGST" v={t?.sgstTotal} /></>)}
          {taxType === "INTER_STATE" && <Row k="IGST" v={t?.igstTotal} />}
          {!!t?.roundOff && <Row k="Round off" v={t.roundOff} />}
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <span>Grand total</span><span>{t ? formatINR(t.grandTotal) : "—"}</span>
          </div>
        </div>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

function Row({ k, v }: { k: string; v?: number }) {
  return (
    <div className="flex justify-between py-0.5 text-slate-600">
      <span>{k}</span><span className="text-slate-900">{v === undefined ? "—" : formatINR(v)}</span>
    </div>
  );
}
