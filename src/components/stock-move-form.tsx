"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, SubmitButton } from "./action-form";

type Opt = { id: string; name: string };
const KINDS = [
  ["IN", "Stock in"],
  ["OUT", "Stock out / use"],
  ["DAMAGED", "Damaged"],
  ["ADJUSTMENT", "Adjust to count"],
  ["CORRECTION", "Manual correction"],
  ["TRANSFER", "Transfer to branch"],
] as const;

/** One form for every stock change; fields adapt to the chosen type. */
export function StockMoveForm({
  action,
  branches,
  allBranches,
  suppliers,
  unit,
  transfersEnabled,
  defaultBranchId,
}: {
  action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  branches: Opt[];
  allBranches: Opt[];
  suppliers: Opt[];
  unit: string;
  transfersEnabled: boolean;
  defaultBranchId?: string;
}) {
  const [kind, setKind] = useState<string>("IN");
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? "");
  const count = kind === "ADJUSTMENT" || kind === "CORRECTION";
  const kinds = KINDS.filter(([k]) => k !== "TRANSFER" || (transfersEnabled && allBranches.length > 1));
  return (
    <ActionForm action={action} resetOnSuccess confirm={kind === "IN" ? undefined : "Save this stock change? It will be recorded in stock history."}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Branch</label>
          <select name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      {count ? (
        <div><label className="label">Correct quantity on hand ({unit}) *</label><input name="newQuantity" required inputMode="decimal" className="input" /></div>
      ) : (
        <div><label className="label">Quantity ({unit}) *</label><input name="quantity" required inputMode="decimal" className="input" /></div>
      )}
      {kind === "TRANSFER" && (
        <div>
          <label className="label">To branch *</label>
          <select name="toBranchId" required className="input" defaultValue="">
            <option value="" disabled>Select…</option>
            {allBranches.filter((b) => b.id !== branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      {kind === "IN" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Supplier</label>
            <select name="supplierId" className="input" defaultValue="">
              <option value="">— Default —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label className="label">Unit cost (₹)</label><input name="unitCost" inputMode="decimal" className="input" placeholder="purchase price" /></div>
        </div>
      )}
      {kind === "OUT" && (
        <div><label className="label">For work (optional)</label><input name="workReference" className="input" placeholder="WRK-000001 — records material cost" /></div>
      )}
      <div><label className="label">Reference</label><input name="reference" className="input" placeholder={kind === "IN" ? "Supplier bill no." : "Voucher / note no."} /></div>
      <div><label className="label">Reason {kind === "IN" ? "" : "*"}</label><input name="reason" required={kind !== "IN"} className="input" placeholder={kind === "IN" ? "Stock received" : "Why is stock changing?"} /></div>
      <SubmitButton className="btn-primary w-full">Save stock change</SubmitButton>
    </ActionForm>
  );
}
