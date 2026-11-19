import { saveProviderAction, sendTestAction } from "@/app/actions/notifications";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { NotificationsTabs } from "@/components/notifications-tabs";
import { ProviderForm } from "@/components/provider-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { getProviderViews } from "@/server/modules/notifications/config";
import { CHANNEL_LABELS } from "@/server/modules/notifications/events";
import { providersFor } from "@/server/modules/notifications/providers";

export const metadata = { title: "Notifications" };

export default async function NotificationProvidersPage() {
  const actor = await requirePagePermission("ADMIN", "notifications.manage");
  const views = await getProviderViews(actor);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const webhookUrls = { meta_whatsapp: `${base}/api/webhooks/meta-whatsapp`, twilio: `${base}/api/webhooks/twilio`, twilio_whatsapp: `${base}/api/webhooks/twilio` };
  return (
    <>
      <PageHeader title="Notifications" subtitle="In-app alerts always work. Turn on Email, SMS and WhatsApp once you subscribe to a provider." />
      <NotificationsTabs active="providers" />
      {!process.env.SECRETS_ENCRYPTION_KEY && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">SECRETS_ENCRYPTION_KEY is not set on the server, so provider credentials can&apos;t be saved.</div>
      )}
      <div className="grid gap-5 xl:grid-cols-3">
        {views.map((v) => (
          <Card
            key={v.channel}
            title={CHANNEL_LABELS[v.channel]}
            actions={<span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${v.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{v.enabled ? (v.provider === "log" ? "On · test mode" : "On") : "Off"}</span>}
          >
            <ProviderForm
              action={saveProviderAction.bind(null, v.channel)}
              providers={providersFor(v.channel).map((p) => ({ id: p.id, label: p.label, help: p.help, fields: p.fields }))}
              current={v}
              webhookUrls={webhookUrls}
            />
            {v.updatedAt && <p className="mt-2 text-xs text-slate-400">Last changed {formatDateTime(v.updatedAt)}</p>}
            <ActionForm action={sendTestAction.bind(null, v.channel)} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <input name="to" required className="input" placeholder={v.channel === "EMAIL" ? "you@example.com" : "+91 98xxx xxxxx"} />
              <SubmitButton className="btn-secondary whitespace-nowrap" pendingText="Sending…">Send test</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
      <Card title="How sending works" className="mt-5">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Messages are queued with the change that triggered them and sent by the background worker (<code>npm run worker</code>). If the change fails, nothing is sent.</li>
          <li>Temporary provider errors are retried up to 5 times with increasing delays; wrong numbers or auth errors fail at once.</li>
          <li>Credentials are encrypted in the database and never shown again — leave a secret field blank to keep it.</li>
          <li>WhatsApp business-initiated messages need a Meta-approved template with one body variable; the message text goes into it.</li>
        </ul>
      </Card>
    </>
  );
}
