"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, FieldError, SubmitButton } from "./action-form";
import { AvailabilityPicker } from "./availability-picker";
import { CustomFieldInputs, type FieldDef } from "./custom-field-inputs";

type Option = { id: string; name: string };

/**
 * New-work flow: Customer → Work details → Date (calendar) → Submit.
 * Designed mobile-first for agents; the same form is used by office staff.
 */
export function WorkForm({
  action,
  fields,
  branches,
  customers,
  agents,
  today,
  offerInvoice = false,
}: {
  action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  fields: FieldDef[];
  branches: Option[];
  customers: (Option & { phone: string })[];
  agents?: Option[];
  today: string;
  offerInvoice?: boolean;
}) {
  const [mode, setMode] = useState<"existing" | "new">(customers.length ? "existing" : "new");
  const [gps, setGps] = useState<{ lat: string; lng: string } | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);

  const useLocation = () => {
    if (!navigator.geolocation) return setGpsMsg("Location is not available on this device.");
    setGpsMsg("Getting location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) });
        setGpsMsg(null);
      },
      () => setGpsMsg("Could not get location. You can type the address instead."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <ActionForm action={action} className="space-y-6">
      <input type="hidden" name="customerMode" value={mode} />

      <Step n={1} title="Customer">
        <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
          {(["existing", "new"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 ${mode === m ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
              {m === "existing" ? "Existing customer" : "New customer"}
            </button>
          ))}
        </div>
        {mode === "existing" ? (
          customers.length ? (
            <select name="customerId" className="input" required defaultValue="">
              <option value="" disabled>Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">No customers yet — add a new one.</p>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Name *</label><input name="customerName" className="input" required maxLength={120} /></div>
            <div><label className="label">Phone *</label><input name="customerPhone" type="tel" className="input" required /></div>
            <div><label className="label">Alternative phone</label><input name="customerAltPhone" type="tel" className="input" /></div>
            <div><label className="label">Email</label><input name="customerEmail" type="email" className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Address</label><input name="customerAddress" className="input" /></div>
          </div>
        )}
      </Step>

      <Step n={2} title="Work details">
        <div className="grid gap-3 sm:grid-cols-2">
          {branches.length > 1 ? (
            <div>
              <label className="label">Branch *</label>
              <select name="branchId" className="input" required defaultValue={branches[0]?.id}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          ) : (
            <input type="hidden" name="branchId" value={branches[0]?.id ?? ""} />
          )}
          {agents && agents.length > 0 && (
            <div>
              <label className="label">Agent</label>
              <select name="agentId" className="input" defaultValue="">
                <option value="">— No agent —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2"><label className="label">Title</label><input name="title" className="input" placeholder="e.g. Kitchen counter top" maxLength={150} /></div>
          <div className="sm:col-span-2"><label className="label">Description</label><textarea name="description" rows={3} className="input" /></div>
          <div className="sm:col-span-2">
            <label className="label">Location / address</label>
            <input name="locationAddress" className="input" />
          </div>
          <div className="sm:col-span-2"><label className="label">Location notes</label><input name="locationNotes" className="input" placeholder="Landmark, floor, gate code…" /></div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={useLocation}>Use my current location</button>
            {gps && <span className="text-xs text-slate-600">GPS: {gps.lat}, {gps.lng}</span>}
            {gpsMsg && <span className="text-xs text-slate-500">{gpsMsg}</span>}
            <input type="hidden" name="latitude" value={gps?.lat ?? ""} />
            <input type="hidden" name="longitude" value={gps?.lng ?? ""} />
          </div>
        </div>
        {fields.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <CustomFieldInputs fields={fields} />
          </div>
        )}
        <div className="mt-4">
          <label className="label">Work / location photos</label>
          <input name="images" type="file" accept="image/*" multiple className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700" />
          <p className="mt-1 text-xs text-slate-500">Up to 10 photos, 10 MB each (JPG, PNG, WEBP, HEIC).</p>
        </div>
      </Step>

      <Step n={3} title="Work date">
        <AvailabilityPicker today={today} />
        <FieldError name="workDate" />
      </Step>

      <div className="sticky bottom-16 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
        {offerInvoice && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="thenInvoice" className="h-4 w-4 rounded border-slate-300" /> Create the invoice right after saving
          </label>
        )}
        <SubmitButton className="btn-primary w-full sm:w-auto" pendingText="Submitting…">Submit work</SubmitButton>
      </div>
    </ActionForm>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
