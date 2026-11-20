import { changeCapacityAction, saveCompanyAction, saveDateTimeAction, saveFieldAction, saveLoginBrandingAction, saveMessagesAction } from "@/app/actions/admin";
import { formatClock, tzOption } from "@/lib/clock";
import { systemTimeZone } from "@/server/lib/dates";
import { ImageInput } from "@/components/image-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveBillingSettingsAction, uploadLogoAction } from "@/app/actions/billing";
import { saveInventorySettingsAction } from "@/app/actions/inventory";
import { savePhase6SettingsAction } from "@/app/actions/portal";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateTime } from "@/server/lib/dates";
import { getCapacity, getCapacityHistory } from "@/server/modules/capacity/service";
import { listAllFields } from "@/server/modules/custom-fields/service";
import { getSetting } from "@/server/modules/settings/service";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Settings" };

const TYPES = ["TEXT", "NUMBER", "DECIMAL", "DROPDOWN", "DATE", "CHECKBOX", "RADIO", "TEXTAREA"];

export default async function SettingsPage() {
  const actor = await requirePagePermission("ADMIN", "settings.manage");
  const [capacity, history, fullSlot, blocked, company, fields, brand] = await Promise.all([
    getCapacity(),
    getCapacityHistory(10),
    getSetting("fullSlotMessage"),
    getSetting("blockedDateMessage"),
    getSetting("company"),
    listAllFields(),
    getSetting("loginPage"),
  ]);
  const [dateTime, tax, invoiceSettings, numbering, inventorySettings, scoreCfg, portalCfg] = await Promise.all([getSetting("dateTime"), getSetting("tax"), getSetting("invoice"), getSetting("numbering"), getSetting("inventory"), getSetting("agentScore"), getSetting("customerPortal")]);
  const changers = await prisma.user.findMany({ where: { id: { in: history.map((h) => h.changedById ?? "").filter(Boolean) } }, select: { id: true, name: true } });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Daily work capacity (company-wide)">
          <p className="mb-3 text-sm text-slate-600">
            Maximum works per day across <strong>all branches</strong>. Nobody can book above this limit — change the limit here instead.
          </p>
          {can(actor, "capacity.manage") ? (
            <ActionForm action={changeCapacityAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="w-32"><label className="label">Works / day</label><input name="maxPerDay" type="number" min={0} max={10000} required defaultValue={capacity} className="input" /></div>
              <div className="flex-1"><label className="label">Reason</label><input name="reason" className="input" placeholder="e.g. Extra team hired" /></div>
              <SubmitButton>Update</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-2xl font-semibold">{capacity}</p>
          )}
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2">
                <span>{h.oldValue ?? "—"} → <strong>{h.newValue}</strong>{h.reason ? <span className="text-slate-500"> · {h.reason}</span> : null}</span>
                <span className="shrink-0 text-xs text-slate-400">{changers.find((c) => c.id === h.changedById)?.name ?? "System"} · {formatDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Full-slot & closed-date messages">
          <ActionForm action={saveMessagesAction}>
            <div>
              <label className="label">Full-slot message</label>
              <textarea name="fullSlotMessage" rows={3} required defaultValue={fullSlot.template} className="input" />
              <p className="mt-1 text-xs text-slate-500">Variables: {"{date} {capacity} {booked_count} {remaining_slots} {next_available_dates}"}</p>
            </div>
            <div>
              <label className="label">Closed-date message</label>
              <textarea name="blockedDateMessage" rows={2} required defaultValue={blocked.template} className="input" />
              <p className="mt-1 text-xs text-slate-500">Variables: {"{date} {reason} {next_available_dates}"}</p>
            </div>
            <SubmitButton>Save messages</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Date & time">
          {(() => {
            const sys = systemTimeZone();
            const now = new Date();
            const zones = [...new Set([...Intl.supportedValuesOf("timeZone").map((z) => (z === "Asia/Calcutta" ? "Asia/Kolkata" : z)), dateTime.timeZone === "system" ? sys : dateTime.timeZone, "UTC"])].map((z) => tzOption(z, now)).sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value));
            const active = dateTime.timeZone === "system" ? sys : dateTime.timeZone;
            const preview = formatClock(now, active, dateTime.clockFormat !== "24h");
            return (
              <ActionForm action={saveDateTimeAction} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="timeZone">Time zone</label>
                  <select id="timeZone" name="timeZone" defaultValue={dateTime.timeZone} className="input">
                    <option value="system">Use server system time ({tzOption(sys, now).label})</option>
                    {zones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Decides what &quot;today&quot; is for works, reports and invoices, and the time shown in the top bar.</p>
                </div>
                <div>
                  <label className="label" htmlFor="clockFormat">Clock</label>
                  <select id="clockFormat" name="clockFormat" defaultValue={dateTime.clockFormat} className="input">
                    <option value="12h">12-hour (2:30 PM)</option>
                    <option value="24h">24-hour (14:30)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <p className="text-sm text-slate-600">Now: <b>{preview.date}, {preview.time}</b> {preview.zone}</p>
                </div>
                <div className="sm:col-span-2"><SubmitButton>Save date &amp; time</SubmitButton></div>
              </ActionForm>
            );
          })()}
        </Card>

        <Card title="Company details">
          <ActionForm action={saveCompanyAction} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label">Company name</label><input name="name" required defaultValue={company.name} className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Address</label><input name="address" defaultValue={company.address} className="input" /></div>
            <div><label className="label">Phone</label><input name="phone" defaultValue={company.phone} className="input" /></div>
            <div><label className="label">Email</label><input name="email" defaultValue={company.email} className="input" /></div>
            <div><label className="label">GST number</label><input name="gstNumber" defaultValue={company.gstNumber} className="input" /></div>
            <div className="sm:col-span-2"><SubmitButton>Save company</SubmitButton></div>
          </ActionForm>
          <ActionForm action={uploadLogoAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
              {company.logoKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/branding/logo?v=${encodeURIComponent(company.logoKey)}`} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400">Logo</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="label">Logo (SVG, PNG or JPG — shown in the app and on invoices)</label>
              <ImageInput name="logo" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" maxEdge={1200} label="Choose logo" />
              <p className="mt-1 text-xs text-slate-500">SVG stays sharp at any size; a PNG copy is made automatically for invoice PDFs.</p>
              {company.logoKey && <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="removeLogo" /> Remove logo</label>}
            </div>
            <SubmitButton className="btn-secondary">Save logo</SubmitButton>
          </ActionForm>
        </Card>

        {can(actor, "billing.settings") && (
          <Card title="GST & invoices">
            <ActionForm action={saveBillingSettingsAction} className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="gstEnabled" defaultChecked={tax.gstEnabled} /> Charge GST on invoices</label>
              <div><label className="label">Default GST %</label><input name="defaultRate" type="number" step="0.01" min={0} max={100} defaultValue={tax.defaultRate} className="input" /></div>
              <div>
                <label className="label">Default supply type</label>
                <select name="defaultTaxType" defaultValue={tax.defaultTaxType} className="input">
                  <option value="INTRA_STATE">Intra-state (CGST + SGST)</option>
                  <option value="INTER_STATE">Inter-state (IGST)</option>
                  <option value="NONE">No GST</option>
                </select>
              </div>
              <div><label className="label">Business state</label><input name="stateName" defaultValue={tax.stateName} className="input" /></div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="roundToRupee" defaultChecked={tax.roundToRupee} /> Round total to nearest rupee</label>
              <div><label className="label">Invoice prefix</label><input name="invoicePrefix" defaultValue={numbering.prefixes.INV ?? "INV"} className="input uppercase" /></div>
              <div><label className="label">Payment due (days)</label><input name="dueDays" type="number" min={0} max={365} defaultValue={invoiceSettings.dueDays} className="input" /></div>
              <div className="sm:col-span-2"><label className="label">Bank / UPI details (printed on invoice)</label><textarea name="bankDetails" rows={2} defaultValue={invoiceSettings.bankDetails} className="input" placeholder="A/c no, IFSC, UPI ID" /></div>
              <div className="sm:col-span-2"><label className="label">Terms</label><textarea name="terms" rows={2} defaultValue={invoiceSettings.terms} className="input" /></div>
              <p className="text-xs text-slate-500 sm:col-span-2">GST number and business name come from Company details. Existing invoices keep the details they were issued with.</p>
              <div className="sm:col-span-2"><SubmitButton>Save billing settings</SubmitButton></div>
            </ActionForm>
          </Card>
        )}

        <Card title="Agent score & customer portal">
          <ActionForm action={savePhase6SettingsAction}>
            <p className="text-xs text-slate-500">Score weights (relative — they don&apos;t need to add up to 100).</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><label className="label">Completion</label><input name="completionWeight" type="number" min={0} max={100} defaultValue={scoreCfg.completionWeight} className="input" /></div>
              <div><label className="label">On time</label><input name="onTimeWeight" type="number" min={0} max={100} defaultValue={scoreCfg.onTimeWeight} className="input" /></div>
              <div><label className="label">Few cancels</label><input name="cancellationWeight" type="number" min={0} max={100} defaultValue={scoreCfg.cancellationWeight} className="input" /></div>
              <div><label className="label">Work value</label><input name="revenueWeight" type="number" min={0} max={100} defaultValue={scoreCfg.revenueWeight} className="input" /></div>
              <div><label className="label">On-time grace (days)</label><input name="graceDays" type="number" min={0} max={30} defaultValue={scoreCfg.graceDays} className="input" /></div>
              <div><label className="label">Min. works to score</label><input name="minWorks" type="number" min={1} max={100} defaultValue={scoreCfg.minWorks} className="input" /></div>
            </div>
            <div className="space-y-1 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showCompletionImages" defaultChecked={portalCfg.showCompletionImages} /> Customers can see completion photos (after approval)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showPayments" defaultChecked={portalCfg.showPayments} /> Customers can see their payment history</label>
            </div>
            <SubmitButton className="btn-secondary">Save</SubmitButton>
          </ActionForm>
        </Card>

        {can(actor, "inventory.manage") && (
          <Card title="Inventory">
            <ActionForm action={saveInventorySettingsAction}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="transfersEnabled" defaultChecked={inventorySettings.transfersEnabled} /> Allow stock transfers between branches</label>
              <p className="text-xs text-slate-500">Each branch keeps its own stock. Stock can never go below zero, and every change is recorded in stock history.</p>
              <SubmitButton className="btn-secondary">Save</SubmitButton>
            </ActionForm>
          </Card>
        )}

        {can(actor, "branding.manage") && (
          <Card title="Login page" actions={<a href="/login" target="_blank" className="text-xs text-blue-700">Preview ↗</a>}>
            <ActionForm action={saveLoginBrandingAction} className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-blue-600 via-indigo-700 to-slate-900">
                  {brand.imageKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/branding/login-image?v=${encodeURIComponent(brand.imageKey)}`} alt="Current login image" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <label className="label">Left-side image</label>
                  <ImageInput name="image" accept="image/jpeg,image/png,image/webp" maxEdge={2400} label="Choose image" />
                  <p className="mt-1 text-xs text-slate-500">Landscape photo, at least 1600px wide. Max 10 MB.</p>
                  {brand.imageKey && (
                    <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="removeImage" /> Use the default artwork instead</label>
                  )}
                </div>
              </div>
              <div><label className="label">Headline</label><input name="headline" required maxLength={120} defaultValue={brand.headline} className="input" /></div>
              <div><label className="label">Sub-text</label><textarea name="subtext" rows={2} maxLength={300} defaultValue={brand.subtext} className="input" /></div>
              <SubmitButton>Save login page</SubmitButton>
            </ActionForm>
          </Card>
        )}

        {can(actor, "custom_fields.manage") && (
          <Card title="Custom work fields (agent form)">
            <ul className="mb-4 space-y-2">
              {fields.map((f) => (
                <li key={f.id}>
                  <details className="rounded-lg border border-slate-200 p-3">
                    <summary className="flex cursor-pointer items-center justify-between text-sm">
                      <span><strong>{f.label}</strong> <span className="text-xs text-slate-500">{f.type.toLowerCase()}{f.required ? " · required" : ""}</span></span>
                      <span className={`text-xs ${f.active ? "text-emerald-700" : "text-slate-400"}`}>{f.active ? "Active" : "Inactive"} · #{f.sortOrder}</span>
                    </summary>
                    <FieldForm field={f} />
                  </details>
                </li>
              ))}
            </ul>
            <details className="rounded-lg border border-dashed border-slate-300 p-3">
              <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Add field</summary>
              <FieldForm />
            </details>
          </Card>
        )}
      </div>
    </>
  );
}

function FieldForm({ field }: { field?: Awaited<ReturnType<typeof listAllFields>>[number] }) {
  return (
    <ActionForm action={saveFieldAction.bind(null, field?.id ?? null)} resetOnSuccess={!field} className="mt-3 grid gap-2 sm:grid-cols-2">
      <div><label className="label">Label *</label><input name="label" required defaultValue={field?.label} className="input" /></div>
      <div>
        <label className="label">Type</label>
        <select name="type" defaultValue={field?.type ?? "TEXT"} className="input">{TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}</select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Options (dropdown / radio — one per line)</label>
        <textarea name="options" rows={2} defaultValue={Array.isArray(field?.options) ? (field!.options as string[]).join("\n") : ""} className="input" />
      </div>
      <div><label className="label">Order</label><input name="sortOrder" type="number" min={0} defaultValue={field?.sortOrder ?? 100} className="input" /></div>
      <div><label className="label">Help text</label><input name="helpText" defaultValue={field?.helpText ?? ""} className="input" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" defaultChecked={field?.required} /> Required</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={field?.active ?? true} /> Active</label>
      <div className="sm:col-span-2"><SubmitButton className="btn-secondary">{field ? "Save field" : "Add field"}</SubmitButton></div>
    </ActionForm>
  );
}
