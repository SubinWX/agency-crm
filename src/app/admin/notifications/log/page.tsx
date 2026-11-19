import type { DeliveryStatus, NotificationChannel, Prisma } from "@prisma/client";
import { processQueueNowAction, retryDeliveryAction } from "@/app/actions/notifications";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { NotificationsTabs } from "@/components/notifications-tabs";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateTime } from "@/server/lib/dates";
import { CHANNEL_LABELS, EVENTS } from "@/server/modules/notifications/events";

export const metadata = { title: "Delivery log" };

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  QUEUED: "bg-sky-100 text-sky-800",
  SENDING: "bg-violet-100 text-violet-800",
  SENT: "bg-emerald-100 text-emerald-800",
  DELIVERED: "bg-green-200 text-green-900",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-slate-100 text-slate-600",
};

export default async function DeliveryLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("ADMIN", "notifications.manage");
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const pageSize = 40;
  const where: Prisma.NotificationDeliveryWhereInput = {
    ...(sp.status && sp.status in STATUS_STYLE ? { status: sp.status as DeliveryStatus } : {}),
    ...(sp.channel && sp.channel in CHANNEL_LABELS ? { channel: sp.channel as NotificationChannel } : {}),
    ...(sp.event ? { event: sp.event } : {}),
    ...(sp.q ? { OR: [{ to: { contains: sp.q } }, { recipientName: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.notificationDelivery.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.notificationDelivery.count({ where }),
    prisma.notificationDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const count = (st: DeliveryStatus) => counts.find((c) => c.status === st)?._count._all ?? 0;
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  const eventLabel = (k: string) => EVENTS.find((e) => e.key === k)?.label ?? k;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Every Email / SMS / WhatsApp message with its delivery status and provider response."
        actions={
          <ActionForm action={processQueueNowAction} className="">
            <SubmitButton className="btn-secondary" pendingText="Sending…">Send queued now ({count("QUEUED")})</SubmitButton>
          </ActionForm>
        }
      />
      <NotificationsTabs active="log" />
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_STYLE) as DeliveryStatus[]).map((st) => (
          <a key={st} href={`?status=${st}`} className={`rounded-full px-2.5 py-1 font-medium ${STATUS_STYLE[st]} ${sp.status === st ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}>{st.toLowerCase()} · {count(st)}</a>
        ))}
        {sp.status && <a href="?" className="px-2 py-1 text-slate-500 underline">clear</a>}
      </div>
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-4">
        <input name="q" defaultValue={sp.q} placeholder="Recipient name, phone or email" className="input" />
        <select name="channel" defaultValue={sp.channel ?? ""} className="input"><option value="">All channels</option>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="event" defaultValue={sp.event ?? ""} className="input"><option value="">All events</option>{EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}<option value="test">Test message</option></select>
        <button className="btn-primary">Filter</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No messages yet." hint="Turn on a channel under Providers. Messages appear here as events happen." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50"><tr><th className="table-th">When</th><th className="table-th">Event</th><th className="table-th">To</th><th className="table-th">Message</th><th className="table-th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="table-td whitespace-nowrap text-xs">{formatDateTime(d.createdAt)}<div className="text-slate-400">{CHANNEL_LABELS[d.channel]}{d.provider ? ` · ${d.provider}` : ""}</div></td>
                  <td className="table-td text-xs">{d.event === "test" ? "Test message" : eventLabel(d.event)}</td>
                  <td className="table-td text-xs">{d.recipientName}<div className="text-slate-500">{d.to ?? "—"}</div>{d.customerId && <span className="text-[10px] text-blue-700">customer</span>}</td>
                  <td className="table-td max-w-md text-xs">
                    {d.subject && <p className="font-medium">{d.subject}</p>}
                    <p className="line-clamp-3 whitespace-pre-wrap text-slate-600">{d.body}</p>
                    {(d.providerResponse || d.error) && (
                      <details className="mt-1"><summary className="cursor-pointer text-slate-400">Provider response</summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px]">{[d.error, d.providerResponse].filter(Boolean).join("\n")}</pre>
                      </details>
                    )}
                  </td>
                  <td className="table-td text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[d.status]}`}>{d.status.toLowerCase()}</span>
                    <div className="mt-1 text-slate-400">
                      {d.attempts > 0 && `${d.attempts} attempt${d.attempts > 1 ? "s" : ""}`}
                      {d.status === "QUEUED" && d.attempts > 0 && <div>next {formatDateTime(d.nextAttemptAt)}</div>}
                      {d.sentAt && <div>sent {formatDateTime(d.sentAt)}</div>}
                      {d.deliveredAt && <div>delivered {formatDateTime(d.deliveredAt)}</div>}
                    </div>
                    {(d.status === "FAILED" || d.status === "SKIPPED") && d.to && (
                      <ActionForm action={retryDeliveryAction.bind(null, d.id)} className="mt-1">
                        <SubmitButton className="text-xs text-blue-700" pendingText="…">Retry</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / pageSize))} makeHref={qs} />
    </>
  );
}
