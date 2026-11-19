"use client";

import { FieldError } from "./action-form";

export type FieldDef = {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  helpText: string | null;
};

/** Renders admin-defined custom fields. Inputs are named cf_<key>. */
export function CustomFieldInputs({ fields, values = {} }: { fields: FieldDef[]; values?: Record<string, unknown> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const name = `cf_${f.key}`;
        const v = values[f.key];
        const label = (
          <label className="label" htmlFor={name}>
            {f.label} {f.required && <span className="text-red-600">*</span>}
          </label>
        );
        let input: React.ReactNode;
        switch (f.type) {
          case "TEXTAREA":
            input = <textarea id={name} name={name} rows={3} className="input" defaultValue={(v as string) ?? ""} required={f.required} />;
            break;
          case "NUMBER":
            input = <input id={name} name={name} type="number" step="1" inputMode="numeric" className="input" defaultValue={(v as number) ?? ""} required={f.required} />;
            break;
          case "DECIMAL":
            input = <input id={name} name={name} type="number" step="any" inputMode="decimal" className="input" defaultValue={(v as number) ?? ""} required={f.required} />;
            break;
          case "DATE":
            input = <input id={name} name={name} type="date" className="input" defaultValue={(v as string) ?? ""} required={f.required} />;
            break;
          case "CHECKBOX":
            return (
              <div key={f.id} className="flex items-center gap-2 sm:col-span-2">
                <input id={name} name={name} type="checkbox" className="h-4 w-4 rounded border-slate-300" defaultChecked={v === true} />
                <label htmlFor={name} className="text-sm">{f.label}{f.required && " *"}</label>
                <FieldError name={f.key} />
              </div>
            );
          case "DROPDOWN":
            input = (
              <select id={name} name={name} className="input" defaultValue={(v as string) ?? ""} required={f.required}>
                <option value="">Select…</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
            break;
          case "RADIO":
            input = (
              <div className="flex flex-wrap gap-3 pt-1">
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={name} value={o} defaultChecked={v === o} required={f.required} /> {o}
                  </label>
                ))}
              </div>
            );
            break;
          default:
            input = <input id={name} name={name} className="input" defaultValue={(v as string) ?? ""} required={f.required} />;
        }
        return (
          <div key={f.id} className={f.type === "TEXTAREA" ? "sm:col-span-2" : ""}>
            {label}
            {input}
            {f.helpText && <p className="mt-1 text-xs text-slate-500">{f.helpText}</p>}
            <FieldError name={f.key} />
          </div>
        );
      })}
    </div>
  );
}
