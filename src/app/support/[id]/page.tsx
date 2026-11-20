import Link from "next/link";
import { ImageInput } from "@/components/image-input";
import { notFound } from "next/navigation";
import { rateTicketAction, replyAction, requesterAction_, updateTicketAction } from "@/app/actions/support";
import { StarRatingInput, Stars } from "@/components/star-rating";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PriorityLabel, TicketStatusBadge } from "@/components/support-ui";
import { Card, DefinitionList } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { formatDateTime } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { getTicket, listAssignees, listCategories, PRIORITY_LABELS, STATUS_LABELS } from "@/server/modules/support/service";

type Att = { id: string; originalName: string; mimeType: string; isInternal: boolean };
function Attachments({ items }: { items: Att[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) => (
        <a key={a.id} href={`/api/support/attachments/${a.id}`} target="_blank" rel="noopener" className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1.5 pr-3 text-xs hover:border-blue-300">
          {a.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/support/attachments/${a.id}`} alt="" className="h-10 w-10 rounded object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded bg-red-50 font-semibold text-red-700">PDF</span>
          )}
          <span className="max-w-[10rem] truncate">{a.originalName}</span>
        </a>
      ))}
    </div>
  );
}

const EVENT_TEXT: Record<string, string> = { created: "Raised the ticket", status: "Changed status", priority: "Changed priority", assigned: "Assigned", category: "Changed category", resolved: "Resolved", closed: "Closed", reopened: "Reopened", reviewed: "Rated the support" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  const { created } = await searchParams;
  const data = await getTicket(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const { ticket: t, manager, name, roleOf, branch, work } = data;
  const [assignees, categories] = manager ? await Promise.all([listAssignees(t.branchId), listCategories()]) : [[], []];
  const isRequester = t.submittedById === actor.id;
  const closed = t.status === "CLOSED";
  const label = (v: string | null) => (v && v in STATUS_LABELS ? STATUS_LABELS[v as keyof typeof STATUS_LABELS] : v && v in PRIORITY_LABELS ? PRIORITY_LABELS[v as keyof typeof PRIORITY_LABELS] : v);

  return (
    <div className="space-y-5">
      {created && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Request {t.number} submitted. You&apos;ll be notified when it is updated.</div>}
      <div>
        <Link href="/support" className="text-sm text-blue-700">← All tickets</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold sm:text-2xl">{t.title}</h1>
          <TicketStatusBadge status={t.status} />
          <PriorityLabel priority={t.priority} />
        </div>
        <p className="mt-1 text-sm text-slate-500">{t.number} · {t.category.name} · raised by {name(t.submittedById)} · {formatDateTime(t.createdAt)}</p>
      </div>

      {t.status === "RESOLVED" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">Resolved</p>
          <p className="mt-1 whitespace-pre-wrap text-emerald-900">{t.resolution}</p>
          {isRequester && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ActionForm action={requesterAction_.bind(null, t.id, "close")} className="">
                <SubmitButton className="btn-success w-full">Yes, this is solved — close it</SubmitButton>
              </ActionForm>
              <ActionForm action={requesterAction_.bind(null, t.id, "reopen")} className="flex gap-2">
                <input name="note" required className="input" placeholder="What is still wrong?" />
                <SubmitButton className="btn-secondary whitespace-nowrap">Reopen</SubmitButton>
              </ActionForm>
            </div>
          )}
        </div>
      )}
      {(t.status === "RESOLVED" || closed) && isRequester && (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
          <p className="font-semibold text-slate-900">{t.rating ? "Your review" : "How was our support?"}</p>
          <p className="mb-3 text-sm text-slate-600">{t.rating ? "Thanks for your feedback. You can change it any time." : "Your rating helps us improve. It takes a few seconds."}</p>
          <ActionForm action={rateTicketAction.bind(null, t.id)} className="space-y-3">
            <StarRatingInput name="rating" defaultValue={t.rating ?? 0} />
            <textarea name="comment" rows={2} maxLength={1000} defaultValue={t.ratingComment ?? ""} className="input" placeholder="Tell us what went well or what we could do better (optional)" />
            <SubmitButton>{t.rating ? "Update review" : "Submit review"}</SubmitButton>
          </ActionForm>
        </div>
      )}
      {t.rating && !isRequester && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <Stars value={t.rating} />
          <span className="font-semibold text-amber-900">{t.rating}/5 from {name(t.submittedById)}</span>
          {t.ratingComment && <span className="text-slate-700">“{t.ratingComment}”</span>}
          {t.ratedAt && <span className="text-xs text-slate-400">{formatDateTime(t.ratedAt)}</span>}
        </div>
      )}
      {t.status === "WAITING_FOR_USER" && isRequester && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">Support is waiting for your reply. Please answer below.</div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{t.description}</p>
            <Attachments items={t.attachments} />
          </Card>

          <ol className="space-y-3">
            {t.comments.map((c) => {
              const mine = c.authorId === actor.id;
              return (
                <li key={c.id} className={`rounded-xl border p-4 text-sm ${c.isInternal ? "border-amber-300 bg-amber-50" : mine ? "border-blue-200 bg-blue-50/60" : "border-slate-200 bg-white"}`}>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{name(c.authorId)}</span> · {roleOf(c.authorId)} · {formatDateTime(c.createdAt)}
                    {c.isInternal && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">Internal note</span>}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  <Attachments items={c.attachments.filter((a) => manager || !a.isInternal)} />
                </li>
              );
            })}
            {t.comments.length === 0 && <li className="text-sm text-slate-500">No replies yet.</li>}
          </ol>

          {!closed ? (
            <Card title={manager ? "Reply or add a note" : "Reply"}>
              <ActionForm action={replyAction.bind(null, t.id)} resetOnSuccess>
                <textarea name="body" required rows={4} maxLength={5000} className="input" placeholder="Write a message…" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <ImageInput name="attachments" accept="image/*,application/pdf" multiple maxFiles={5} label="Attach" />
                  {manager && <label className="flex items-center gap-2 text-sm text-amber-800"><input type="checkbox" name="internal" /> Internal note (staff only)</label>}
                </div>
                <SubmitButton pendingText="Sending…">Send</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">This ticket was closed {t.closedAt ? `on ${formatDateTime(t.closedAt)}` : ""}{t.closedById ? ` by ${name(t.closedById)}` : ""}.</p>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Details">
            <DefinitionList
              items={[
                ["Status", STATUS_LABELS[t.status]],
                ["Priority", PRIORITY_LABELS[t.priority]],
                ["Assigned to", t.assignedToId ? name(t.assignedToId) : "Not assigned yet"],
                ["Branch", branch?.name ?? "Company-wide"],
                ["Related work", work ? (manager ? <Link className="text-blue-700" href={`/admin/works/${work.id}`}>{work.reference}</Link> : work.reference) : null],
                ["Last activity", formatDateTime(t.lastActivityAt)],
              ]}
            />
          </Card>

          {manager && (
            <Card title="Manage ticket">
              <ActionForm action={updateTicketAction.bind(null, t.id)} confirm="Save these changes to the ticket?">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Status</label>
                    <select name="status" defaultValue={t.status} className="input">{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  </div>
                  <div>
                    <label className="label">Priority</label>
                    <select name="priority" defaultValue={t.priority} className="input">{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  </div>
                </div>
                <div>
                  <label className="label">Assign to</label>
                  <select name="assignedToId" defaultValue={t.assignedToId ?? ""} className="input">
                    <option value="">— Unassigned —</option>
                    {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === actor.id ? " (me)" : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Category</label>
                  <select name="categoryId" defaultValue={t.categoryId} className="input">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                </div>
                <div><label className="label">Resolution (needed to resolve)</label><textarea name="resolution" rows={2} defaultValue={t.resolution ?? ""} className="input" /></div>
                <div><label className="label">Reason / note{closed ? " (needed to reopen)" : ""}</label><input name="reason" className="input" /></div>
                <SubmitButton className="btn-primary w-full">Save</SubmitButton>
              </ActionForm>
              {!closed && (
                <ActionForm action={updateTicketAction.bind(null, t.id)} confirm="Close this ticket? The requester will be notified." className="mt-3 border-t border-slate-100 pt-3">
                  <input type="hidden" name="status" value="CLOSED" />
                  <SubmitButton className="btn-danger w-full">Close ticket</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="History">
            <ol className="space-y-2 text-xs">
              {t.events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium text-slate-700">{EVENT_TEXT[e.action] ?? e.action}</span>
                  {e.action === "reviewed" ? ` ${e.toValue}★` : e.fromValue && e.action !== "created" && e.action !== "category" && e.action !== "assigned" ? ` ${label(e.fromValue)} → ${label(e.toValue)}` : e.toValue && e.action !== "created" ? ` → ${label(e.toValue)}` : ""}
                  {e.note && <span className="text-slate-500"> · {e.note}</span>}
                  <div className="text-slate-400">{name(e.userId)} · {formatDateTime(e.createdAt)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
