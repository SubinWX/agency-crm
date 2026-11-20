"use client";

import { useState } from "react";
import { ComboInput } from "./combo-input";
import { ImageInput } from "./image-input";
import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, SubmitButton } from "./action-form";

type Item = {
  kind: string; name: string; code: string; category: string | null; description: string | null; unit: string;
  sellingPrice: string | null; purchasePrice: string | null; reorderLevel: string; supplierId: string | null; notes: string | null; status: string;
  showOnWebsite?: boolean; slug?: string | null; websiteUrl?: string | null;
};

/** Product / raw-material form (fields shown depend on the kind). */
export function ItemForm({
  action, item, suppliers, categories, submitLabel, defaultKind = "PRODUCT",
}: {
  action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  item?: Item;
  suppliers: { id: string; name: string }[];
  categories: string[];
  submitLabel: string;
  defaultKind?: string;
}) {
  const [kind, setKind] = useState(item?.kind ?? defaultKind);
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2 inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
        {[["PRODUCT", "Product"], ["RAW_MATERIAL", "Raw material"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 ${kind === k ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{l}</button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />
      <div><label className="label">Name *</label><input name="name" required defaultValue={item?.name} className="input" /></div>
      <div><label className="label">{kind === "PRODUCT" ? "SKU / code" : "Material code"} *</label><input name="code" required defaultValue={item?.code} className="input uppercase" /></div>
      <div>
        <label className="label">Category</label>
        <ComboInput name="category" options={categories} defaultValue={item?.category ?? ""} placeholder={categories.length ? "Pick or type a new category" : kind === "PRODUCT" ? "e.g. Counter tops" : "e.g. Slabs, Cement"} newLabel="Add category" />
      </div>
      <div><label className="label">Unit *</label><input name="unit" required defaultValue={item?.unit ?? ""} className="input" placeholder="pcs, sq ft, bag, kg" /></div>
      {kind === "PRODUCT" && <div><label className="label">Selling price (₹)</label><input name="sellingPrice" inputMode="decimal" defaultValue={item?.sellingPrice ?? ""} className="input" /></div>}
      <div><label className="label">Purchase price (₹)</label><input name="purchasePrice" inputMode="decimal" defaultValue={item?.purchasePrice ?? ""} className="input" /></div>
      <div><label className="label">Low-stock level</label><input name="reorderLevel" inputMode="decimal" defaultValue={item?.reorderLevel ?? "0"} className="input" /><p className="mt-1 text-xs text-slate-500">Default for every branch (0 = no alert).</p></div>
      <div>
        <label className="label">Supplier</label>
        <select name="supplierId" defaultValue={item?.supplierId ?? ""} className="input">
          <option value="">— None —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2"><label className="label">Description</label><textarea name="description" rows={2} defaultValue={item?.description ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">Notes</label><textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} className="input" /></div>
      {kind === "PRODUCT" && (
        <fieldset className="sm:col-span-2 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">Website</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showOnWebsite" defaultChecked={item?.showOnWebsite ?? false} className="h-4 w-4 rounded border-slate-300" /> Show this product on the website <span className="text-xs text-slate-500">(name, photos, price and description become public)</span></label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Web address name</label>
              <input name="slug" defaultValue={item?.slug ?? ""} className="input lowercase" placeholder="made from the name, e.g. granite-counter-top" />
              <p className="mt-1 text-xs text-slate-500">Lowercase words joined by dashes. Used to find this product on the website.</p>
            </div>
            <div>
              <label className="label">Link to product page (optional)</label>
              <input name="websiteUrl" type="url" defaultValue={item?.websiteUrl ?? ""} className="input" placeholder="https://yourwebsite.com/products/…" />
            </div>
          </div>
        </fieldset>
      )}
      <div><label className="label">Images</label><ImageInput name="images" multiple maxFiles={6} maxEdge={1600} /></div>
      <div><label className="label">Status</label><select name="status" defaultValue={item?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
      <div className="sm:col-span-2"><SubmitButton>{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
