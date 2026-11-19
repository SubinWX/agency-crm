import { resetTemplateAction, saveTemplateAction } from "@/app/actions/notifications";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { NotificationsTabs } from "@/components/notifications-tabs";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listTemplates } from "@/server/modules/notifications/config";
import { CHANNEL_LABELS, CHANNELS, COMMON_VARS, EVENTS } from "@/server/modules/notifications/events";

export const metadata = { title: "Notification templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "notifications.manage");
  const { event } = await searchParams;
  const templates = await listTemplates(actor);
  const current = EVENTS.find((e) => e.key === event) ?? EVENTS[0];
  return (
    <>
      <PageHeader title="Notifications" subtitle="Edit the wording of each message. Use {variables} — they're filled in when the message is sent." />
      <NotificationsTabs active="templates" />
      <div className="grid gap-5 lg:grid-cols-4">
        <nav className="card h-fit p-2 lg:col-span-1">
          {EVENTS.map((e) => {
            const on = templates.filter((t) => t.event === e.key && t.enabled).map((t) => CHANNEL_LABELS[t.channel]);
            return (
              <a key={e.key} href={`?event=${e.key}`} className={`block rounded-lg px-3 py-2 text-sm ${e.key === current.key ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
                {e.label}
                <span className="block text-[11px] font-normal text-slate-400">{on.join(" · ") || "all off"}</span>
              </a>
            );
          })}
        </nav>
        <div className="space-y-5 lg:col-span-3">
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            Variables: {[...current.vars, ...COMMON_VARS].map((v) => <code key={v} className="mr-1 rounded bg-white px-1 py-0.5 ring-1 ring-slate-200">{`{${v}}`}</code>)}
          </div>
          {CHANNELS.map((ch) => {
            const t = templates.find((x) => x.event === current.key && x.channel === ch)!;
            return (
              <Card key={ch} title={CHANNEL_LABELS[ch]} actions={
                <ActionForm action={resetTemplateAction.bind(null, current.key, ch)} confirm="Reset this template to the default wording?" className="">
                  <SubmitButton className="text-xs text-slate-500 hover:text-slate-800" pendingText="…">Reset to default</SubmitButton>
                </ActionForm>
              }>
                <ActionForm key={`${t.id}-${t.updatedAt.toISOString()}`} action={saveTemplateAction.bind(null, current.key, ch)}>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={t.enabled} /> Send this {CHANNEL_LABELS[ch]}</label>
                    {current.customerFacing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sendToCustomer" defaultChecked={t.sendToCustomer} /> Also send to the customer</label>}
                  </div>
                  {ch === "EMAIL" && <div><label className="label">Subject</label><input name="subject" defaultValue={t.subject ?? ""} className="input" /></div>}
                  <div>
                    <label className="label">Message</label>
                    <textarea name="body" rows={ch === "EMAIL" ? 6 : 3} defaultValue={t.body} className="input font-mono text-xs" maxLength={ch === "SMS" ? 640 : 4000} />
                    {ch === "SMS" && <p className="mt-1 text-xs text-slate-500">In India, SMS text must match a DLT-registered template.</p>}
                  </div>
                  <SubmitButton className="btn-secondary">Save {CHANNEL_LABELS[ch]} template</SubmitButton>
                </ActionForm>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
