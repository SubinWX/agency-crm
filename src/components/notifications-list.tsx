import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/admin";
import { formatDateTime } from "@/server/lib/dates";
import { listNotifications } from "@/server/modules/notifications/service";
import type { Actor } from "@/server/rbac/actor";
import { EmptyState, PageHeader } from "./ui";

export async function NotificationsList({ actor }: { actor: Actor }) {
  const items = await listNotifications(actor.id, 50);
  return (
    <>
      <PageHeader
        title="Alerts"
        actions={
          items.some((n) => !n.readAt) ? (
            <form action={markNotificationsReadAction}>
              <button className="btn-secondary">Mark all read</button>
            </form>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="No alerts." hint="You'll see assignments, approvals and date changes here." />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const body = (
              <div className={`card p-4 ${n.readAt ? "" : "border-blue-300 bg-blue-50/40"}`}>
                <p className="text-sm font-semibold">{n.title}</p>
                <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link}>{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </>
  );
}
