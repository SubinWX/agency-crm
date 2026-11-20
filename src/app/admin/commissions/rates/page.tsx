import Link from "next/link";
import { saveDefaultRatesAction, saveUserRateAction } from "@/app/actions/billing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { listRatePeople, rateHistory } from "@/server/modules/billing/commissions";
import { getSetting } from "@/server/modules/settings/service";

export const metadata = { title: "Commission rates" };

export default async function CommissionRatesPage() {
  await requirePagePermission("ADMIN", "commissions.manage");
  const [settings, people, history] = await Promise.all([getSetting("commission"), listRatePeople(), rateHistory(30)]);
  return (
    <>
      <PageHeader title="Commission rates" subtitle="New rates apply to works approved after the change. Existing commissions keep their %." actions={<Link href="/admin/commissions" className="btn-secondary">← Commissions</Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Default rates">
          <ActionForm action={saveDefaultRatesAction}>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Agent %</label><input name="agentPercent" type="number" step="0.01" min={0} max={100} defaultValue={settings.agentPercent} className="input" /></div>
              <div><label className="label">Worker %</label><input name="workerPercent" type="number" step="0.01" min={0} max={100} defaultValue={settings.workerPercent} className="input" /></div>
            </div>
            <div>
              <label className="label">Several workers on one work</label>
              <select name="workerMode" defaultValue={settings.workerMode} className="input">
                <option value="SPLIT">Split the worker % equally</option>
                <option value="EACH">Each worker gets the full %</option>
              </select>
            </div>
            <div><label className="label">Reason</label><input name="reason" className="input" /></div>
            <SubmitButton>Save defaults</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Personal rates">
          <ul className="space-y-2">
            {people.map((p) => (
              <li key={p.id}>
                <ActionForm action={saveUserRateAction.bind(null, p.id)} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name} <span className="text-xs text-slate-400">{p.role.portal === "AGENT" ? "Agent" : "Worker"}</span></span>
                  <input name="percent" type="number" step="0.01" min={0} max={100} defaultValue={p.commissionPercent?.toString() ?? ""} placeholder="default" className="input w-28" />
                  <SubmitButton className="btn-secondary px-3" pendingText="…">Save</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Leave empty to use the default.</p>
        </Card>
        <Card title="Rate history" className="lg:col-span-2">
          <ul className="space-y-1 text-sm text-slate-600">
            {history.length === 0 && <li>No changes yet.</li>}
            {history.map((h) => (
              <li key={h.id}>{h.target}: {h.oldPercent?.toString() ?? "default"}% → <strong>{h.newPercent?.toString() ?? "default"}%</strong> · {h.who} · {formatDateTime(h.createdAt)}{h.reason ? ` · ${h.reason}` : ""}</li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
