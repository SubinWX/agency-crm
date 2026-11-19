"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, SubmitButton } from "./action-form";

type Field = { key: string; label: string; secret?: boolean; required?: boolean; placeholder?: string; help?: string };
type Provider = { id: string; label: string; help?: string; fields: Field[] };

/** Choose a provider for one channel and enter its settings. Secrets are write-only. */
export function ProviderForm({
  action,
  providers,
  current,
  webhookUrls,
}: {
  action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  providers: Provider[];
  current: { provider: string | null; enabled: boolean; config: Record<string, string>; secretHints: Record<string, string> };
  webhookUrls: Record<string, string>;
}) {
  const [id, setId] = useState(current.provider ?? providers[0].id);
  const def = providers.find((p) => p.id === id)!;
  const sameProvider = id === current.provider;
  return (
    <ActionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Provider</label>
          <select name="provider" value={id} onChange={(e) => setId(e.target.value)} className="input">
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input type="checkbox" name="enabled" defaultChecked={current.enabled} className="h-4 w-4" /> Channel on
        </label>
      </div>
      {def.help && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{def.help}</p>}
      {def.fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {def.fields.map((f) => {
            const hint = sameProvider ? current.secretHints[f.key] : "";
            return (
              <div key={f.key}>
                <label className="label">{f.label}{f.required && " *"}</label>
                <input
                  name={`f_${f.key}`}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  defaultValue={f.secret || !sameProvider ? "" : (current.config[f.key] ?? "")}
                  placeholder={f.secret ? (hint ? `Saved ${hint} — leave blank to keep` : "Not set") : f.placeholder}
                  className="input"
                />
                {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
              </div>
            );
          })}
        </div>
      )}
      {webhookUrls[id] && (
        <p className="text-xs text-slate-600">
          Delivery-status webhook: <code className="rounded bg-slate-100 px-1">{webhookUrls[id]}</code>
        </p>
      )}
      <SubmitButton>Save provider</SubmitButton>
    </ActionForm>
  );
}
