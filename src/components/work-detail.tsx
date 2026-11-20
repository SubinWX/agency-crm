import Link from "next/link";
import { ImageInput } from "./image-input";
import {
  addImageAction, approveWorkAction, assignWorkersAction, cancelWorkAction, changeDateAction, commentAction,
  completeWorkAction, editWorkAction, rejectWorkAction, removeImageAction, removeWorkerAction, replaceImageAction, startWorkAction,
} from "@/app/actions/works";
import { businessToday, formatDateLabel, formatDateTime, fromDbDate } from "@/server/lib/dates";
import { listActiveFields } from "@/server/modules/custom-fields/service";
import { AGENT_EDITABLE_STATUSES, RESCHEDULABLE_STATUSES, isOwnWork } from "@/server/modules/works/access";
import type { getWorkDetail } from "@/server/modules/works/queries";
import { listWorkersForBranch } from "@/server/modules/users/service";
import { can, type Actor } from "@/server/rbac/actor";
import { prisma } from "@/server/db";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { canViewBilling } from "@/server/modules/billing/invoices";
import { InvoiceStatusBadge, CommissionStatusBadge } from "./billing-ui";
import { canViewInventory } from "@/server/modules/inventory/catalog";
import { formatQty, toMilli } from "@/server/modules/inventory/qty";
import { workMaterials } from "@/server/modules/inventory/stock";
import { workCosting } from "@/server/modules/analytics/service";
import { issueMaterialAction } from "@/app/actions/inventory";
import { ActionForm, SubmitButton } from "./action-form";
import { AvailabilityPicker } from "./availability-picker";
import { CustomFieldInputs } from "./custom-field-inputs";
import { ImageGallery } from "./image-gallery";
import { Card, DefinitionList, StatusBadge } from "./ui";

type Detail = Awaited<ReturnType<typeof getWorkDetail>>;
const fileUrl = (versionId: string) => `/api/files/${versionId}`;

export async function WorkDetailView({ actor, detail, backHref }: { actor: Actor; detail: Detail; backHref: string }) {
  const { work, images, timeline, activeWorkers, commentsWithAuthors, lastRejection } = detail;
  const isAdminPortal = actor.portal === "ADMIN";
  const isWorker = actor.portal === "WORKER";
  const workDate = fromDbDate(work.workDate);
  const open = RESCHEDULABLE_STATUSES.includes(work.status);
  const canFullEdit = can(actor, "works.edit");
  const canEdit = canFullEdit || (can(actor, "works.edit_own") && isOwnWork(actor, work) && AGENT_EDITABLE_STATUSES.includes(work.status));
  const canAssign = can(actor, "works.assign_workers") && open;
  const iAmAssigned = activeWorkers.some((w) => w.id === actor.id);
  const canComplete = can(actor, "works.complete") && iAmAssigned && (work.status === "ASSIGNED" || work.status === "IN_PROGRESS");
  const canApprove = can(actor, "works.approve") && work.status === "PENDING_APPROVAL";

  const showBilling = isAdminPortal && canViewBilling(actor);
  const showCommissions = isAdminPortal && can(actor, "commissions.manage");
  const [fields, branchWorkers, invoices, commissions] = await Promise.all([
    canEdit ? listActiveFields() : Promise.resolve([]),
    canAssign ? listWorkersForBranch(work.branchId) : Promise.resolve([]),
    showBilling ? prisma.invoice.findMany({ where: { workId: work.id }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    showCommissions ? prisma.commission.findMany({ where: { workId: work.id }, include: { user: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const money = (v: { toString(): string }) => formatINR(toPaise(v.toString()));
  const costing = isAdminPortal && can(actor, "reports.view") ? await workCosting(work.id) : null;
  const showMaterials = isAdminPortal && canViewInventory(actor);
  const canIssue =
    showMaterials &&
    (can(actor, "inventory.edit_stock") || can(actor, "inventory.manage")) &&
    (actor.isSuperAdmin || actor.branchIds.includes(work.branchId));
  const [materials, stockItems] = await Promise.all([
    showMaterials ? workMaterials(work.id) : Promise.resolve(null),
    canIssue
      ? prisma.stockLevel.findMany({
          where: { branchId: work.branchId, quantity: { gt: 0 }, item: { deletedAt: null, status: "ACTIVE" } },
          include: { item: { select: { id: true, name: true, code: true, unit: true } } },
          orderBy: { item: { name: "asc" } },
          take: 300,
        })
      : Promise.resolve([]),
  ]);
  const customByKey = Object.fromEntries(work.customValues.map((v) => [v.field.key, v.value]));
  const agentImages = images.filter((i) => i.kind === "AGENT");
  const completionImages = images.filter((i) => i.kind === "COMPLETION");
  const mapUrl =
    work.latitude && work.longitude
      ? `https://www.google.com/maps?q=${work.latitude},${work.longitude}`
      : work.locationAddress
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(work.locationAddress)}`
        : null;

  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="text-sm text-blue-700">← Back</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold sm:text-2xl">{work.reference}</h1>
          <StatusBadge status={work.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {formatDateLabel(workDate)} · {work.branch.name}
          {work.title ? ` · ${work.title}` : ""}
        </p>
      </div>

      {lastRejection && (work.status === "IN_PROGRESS" || work.status === "ASSIGNED") && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-semibold">Correction requested</p>
          <p className="mt-1">{lastRejection.comment}</p>
          <p className="mt-1 text-xs text-orange-700">{formatDateTime(lastRejection.createdAt)}</p>
        </div>
      )}

      {/* Worker primary actions first on mobile */}
      {isWorker && (work.status === "ASSIGNED" || canComplete) && (
        <Card title="Your actions">
          {work.status === "ASSIGNED" && iAmAssigned && (
            <ActionForm action={startWorkAction.bind(null, work.id)} className="mb-4">
              <SubmitButton className="btn-secondary w-full sm:w-auto">Start work</SubmitButton>
            </ActionForm>
          )}
          {canComplete && (
            <ActionForm action={completeWorkAction.bind(null, work.id)} confirm="Submit this work as completed?">
              <div>
                <label className="label">Completion photos *</label>
                <ImageInput name="images" multiple required capture="environment" maxFiles={10} label="Take / add photos" />
                <p className="mt-1 text-xs text-slate-500">Take photos or pick from gallery. Up to 10.</p>
              </div>
              <div><label className="label">Message</label><input name="message" className="input" placeholder="Short note for the office" /></div>
              <div><label className="label">Work description</label><textarea name="description" rows={3} className="input" placeholder="What was done" /></div>
              <SubmitButton className="btn-success w-full" pendingText="Uploading…">Mark completed</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Details">
            <DefinitionList
              items={[
                ["Customer", work.customer.name],
                ["Phone", work.customer.phone ? <a className="text-blue-700" href={`tel:${work.customer.phone}`}>{work.customer.phone}</a> : null],
                ["Agent", work.agent?.name ?? null],
                ["Work date", formatDateLabel(workDate)],
                ["Location", work.locationAddress],
                ["Location notes", work.locationNotes],
                ["Map", mapUrl ? <a className="text-blue-700" href={mapUrl} target="_blank" rel="noopener noreferrer">Open in Maps</a> : null],
                ["Created", formatDateTime(work.createdAt)],
                ...work.customValues
                  .sort((a, b) => a.field.sortOrder - b.field.sortOrder)
                  .map((v) => [v.field.label, typeof v.value === "boolean" ? (v.value ? "Yes" : "No") : String(v.value)] as [string, string]),
              ]}
            />
            {work.description && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm text-slate-700">{work.description}</p>}
            {work.cancelReason && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Cancelled: {work.cancelReason}</p>}
          </Card>

          <Card title={`Work images (${agentImages.filter((i) => i.status === "ACTIVE").length})`}>
            <ImageGallery
              images={agentImages
                .filter((i) => i.status === "ACTIVE" && i.current)
                .map((i) => ({ id: i.id, src: fileUrl(i.current!.id), caption: i.caption, meta: `Uploaded by ${i.currentBy} · ${formatDateTime(i.current!.createdAt)}`, badge: i.current!.version > 1 ? `v${i.current!.version}` : null }))}
              edit={canEdit ? { replace: replaceImageAction, remove: removeImageAction } : undefined}
            />
            {canEdit && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                <ActionForm action={addImageAction.bind(null, work.id)} resetOnSuccess className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="label">Add photos</label>
                    <ImageInput name="images" multiple required maxFiles={10} />
                  </div>
                  <SubmitButton className="btn-secondary">Upload</SubmitButton>
                </ActionForm>
              </div>
            )}
            {can(actor, "works.view_image_history") && agentImages.some((i) => i.previous.length || i.status === "REMOVED") && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Previous / removed images</h3>
                <ImageGallery
                  images={agentImages.flatMap((i) => [
                    ...(i.status === "REMOVED" && i.current
                      ? [{ src: fileUrl(i.current.id), badge: "Removed", meta: `Removed: ${i.removeReason ?? ""}` }]
                      : []),
                    ...i.previous.map((p) => ({ src: fileUrl(p.id), badge: `Previous v${p.version}`, meta: `v${p.version} by ${p.by} · ${formatDateTime(p.createdAt)}` })),
                  ])}
                />
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {agentImages.flatMap((i) =>
                    i.current && i.current.version > 1 ? [<li key={i.id}>v{i.current.version} replaced by {i.currentBy}: “{i.current.reason}”</li>] : [],
                  )}
                </ul>
              </div>
            )}
          </Card>

          {(completionImages.length > 0 || work.completions.length > 0) && (
            <Card title="Completion">
              <div className="space-y-5">
                {[...work.completions].reverse().map((c) => (
                  <div key={c.id} className="space-y-2">
                    <p className="text-xs text-slate-500">{detail.authorName(c.submittedById)} · {formatDateTime(c.createdAt)}</p>
                    {c.message && <p className="text-sm font-medium">{c.message}</p>}
                    {c.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{c.description}</p>}
                    <ImageGallery
                      images={completionImages
                        .filter((i) => i.completionId === c.id && i.current)
                        .map((i) => ({ src: fileUrl(i.current!.id), meta: `Completion photo · ${formatDateTime(i.current!.createdAt)}` }))}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {canApprove && (
            <Card title="Review completion">
              <div className="grid gap-4 sm:grid-cols-2">
                <ActionForm action={approveWorkAction.bind(null, work.id)} confirm="Approve this work?">
                  <input name="comment" className="input" placeholder="Comment (optional)" />
                  <SubmitButton className="btn-success w-full">Approve</SubmitButton>
                </ActionForm>
                <ActionForm action={rejectWorkAction.bind(null, work.id)} confirm="Send back to the workers for correction?">
                  <input name="reason" required className="input" placeholder="What needs to be corrected? *" />
                  <SubmitButton className="btn-danger w-full">Request correction</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}

          {canEdit && (
            <Card title="Edit details">
              <ActionForm action={editWorkAction.bind(null, work.id)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><label className="label">Title</label><input name="title" className="input" defaultValue={work.title ?? ""} /></div>
                  <div className="sm:col-span-2"><label className="label">Location / address</label><input name="locationAddress" className="input" defaultValue={work.locationAddress ?? ""} /></div>
                  <div className="sm:col-span-2"><label className="label">Location notes</label><input name="locationNotes" className="input" defaultValue={work.locationNotes ?? ""} /></div>
                  <div><label className="label">Latitude</label><input name="latitude" className="input" defaultValue={work.latitude?.toString() ?? ""} /></div>
                  <div><label className="label">Longitude</label><input name="longitude" className="input" defaultValue={work.longitude?.toString() ?? ""} /></div>
                  <div className="sm:col-span-2"><label className="label">Description</label><textarea name="description" rows={3} className="input" defaultValue={work.description ?? ""} /></div>
                </div>
                {fields.length > 0 && (
                  <CustomFieldInputs
                    fields={fields.map((f) => ({ ...f, options: Array.isArray(f.options) ? (f.options as string[]) : [] }))}
                    values={customByKey}
                  />
                )}
                <p className="text-xs text-slate-500">Customer name and contact details are protected and can only be changed by the office.</p>
                <div><label className="label">Reason for change *</label><input name="reason" required className="input" /></div>
                <SubmitButton>Save changes</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Comments">
            <ul className="mb-4 space-y-3">
              {commentsWithAuthors.length === 0 && <li className="text-sm text-slate-500">No comments yet.</li>}
              {commentsWithAuthors.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{c.author} · {formatDateTime(c.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
            {can(actor, "works.comment") && (
              <ActionForm action={commentAction.bind(null, work.id)} resetOnSuccess className="flex gap-2">
                <input name="body" required maxLength={2000} className="input" placeholder="Write a comment…" />
                <SubmitButton className="btn-secondary" pendingText="…">Post</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title={`Workers (${activeWorkers.length})`}>
            {activeWorkers.length === 0 ? (
              <p className="text-sm text-slate-500">No workers assigned.</p>
            ) : (
              <ul className="space-y-2">
                {activeWorkers.map((w) => (
                  <li key={w.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{w.name}</span>
                      {w.phone && !isWorker && <a className="text-xs text-blue-700" href={`tel:${w.phone}`}>{w.phone}</a>}
                    </div>
                    {canAssign && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-red-700">Remove</summary>
                        <ActionForm action={removeWorkerAction.bind(null, work.id, w.id)} className="mt-2 space-y-2" confirm={`Remove ${w.name} from this work?`}>
                          <input name="reason" required className="input" placeholder="Reason *" />
                          <SubmitButton className="btn-danger w-full">Remove worker</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canAssign && (
              <ActionForm action={assignWorkersAction.bind(null, work.id)} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assign workers</p>
                {branchWorkers.filter((w) => !activeWorkers.some((a) => a.id === w.id)).map((w) => (
                  <label key={w.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="workerIds" value={w.id} className="h-4 w-4 rounded border-slate-300" /> {w.name}
                  </label>
                ))}
                {branchWorkers.length === 0 && <p className="text-sm text-slate-500">No workers in this branch.</p>}
                <SubmitButton className="btn-primary w-full">Assign selected</SubmitButton>
              </ActionForm>
            )}
          </Card>

          {showBilling && (
            <Card title="Billing" actions={can(actor, "invoices.create") && work.status !== "CANCELLED" ? <Link href={`/admin/invoices/new?workId=${work.id}`} className="text-xs font-medium text-blue-700">+ Create invoice</Link> : null}>
              {invoices.length === 0 ? (
                <p className="text-sm text-slate-500">No invoice yet.</p>
              ) : (
                <ul className="space-y-2">
                  {invoices.map((i) => (
                    <li key={i.id}>
                      <Link href={`/admin/invoices/${i.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm hover:bg-slate-50">
                        <span><span className="font-medium">{i.number}</span><span className="block text-xs text-slate-500">{money(i.grandTotal)} · balance {money(i.balanceDue)}</span></span>
                        <InvoiceStatusBadge status={i.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {commissions.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Commission</p>
                  <ul className="space-y-1 text-sm">
                    {commissions.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.user.name} <span className="text-xs text-slate-400">{c.type === "AGENT" ? "agent" : "worker"} · {Number(c.percent)}%</span></span>
                        <span className="flex items-center gap-2">{money(c.amount)} <CommissionStatusBadge status={c.status} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {costing && (costing.revenue > 0 || costing.totalCost > 0) && (
            <Card title="Job costing">
              <dl className="space-y-1 text-sm">
                {([
                  ["Revenue (excl. GST)", costing.revenue],
                  ["Materials", -costing.materials],
                  ["Agent commission", -costing.agentCommission],
                  ["Worker commission", -costing.workerCommission],
                  ["Linked expenses", -costing.expenses],
                ] as [string, number][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-slate-600"><dt>{k}</dt><dd className={v < 0 ? "text-slate-800" : "text-slate-900"}>{formatINR(v)}</dd></div>
                ))}
                <div className={`flex justify-between border-t border-slate-200 pt-1 font-semibold ${costing.profit < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  <dt>Profit{costing.margin !== null ? ` (${costing.margin}%)` : ""}</dt><dd>{formatINR(costing.profit)}</dd>
                </div>
              </dl>
            </Card>
          )}

          {materials && (
            <Card title="Materials used">
              {materials.rows.length === 0 ? (
                <p className="text-sm text-slate-500">No materials issued to this work.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {materials.rows.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span className="truncate">{m.item.name}</span>
                      <span className="whitespace-nowrap text-slate-600">{formatQty(-toMilli(m.change.toString()), m.item.unit)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t border-slate-100 pt-1 font-medium"><span>Material cost</span><span>{formatINR(materials.total)}</span></li>
                </ul>
              )}
              {canIssue && stockItems.length > 0 && work.status !== "CANCELLED" && (
                <ActionForm action={issueMaterialAction.bind(null, work.id)} resetOnSuccess confirm="Take this material out of stock for this work?" className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  <select name="itemId" required defaultValue="" className="input">
                    <option value="" disabled>Material from {work.branch.name}…</option>
                    {stockItems.map((l) => <option key={l.itemId} value={l.itemId}>{l.item.name} ({formatQty(l.quantity, l.item.unit)} left)</option>)}
                  </select>
                  <div className="flex gap-2">
                    <input name="quantity" required inputMode="decimal" placeholder="Qty" className="input" />
                    <SubmitButton className="btn-secondary whitespace-nowrap">Use</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Card>
          )}

          {isAdminPortal && can(actor, "works.change_date") && open && (
            <Card title="Change date">
              <ActionForm action={changeDateAction.bind(null, work.id)}>
                <AvailabilityPicker name="newDate" today={businessToday()} />
                <input name="reason" required className="input" placeholder="Reason *" />
                <SubmitButton className="btn-secondary w-full">Move work</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {isAdminPortal && can(actor, "works.cancel") && (open || work.status === "PENDING_APPROVAL") && (
            <Card title="Cancel work">
              <ActionForm action={cancelWorkAction.bind(null, work.id)} confirm="Cancel this work? The date slot will be released.">
                <input name="reason" required className="input" placeholder="Reason *" />
                <SubmitButton className="btn-danger w-full">Cancel work</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Activity">
            <ol className="relative space-y-4 border-l border-slate-200 pl-4">
              {timeline.map((t, i) => (
                <li key={i} className="text-sm">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
                  <p className="font-medium text-slate-800">{t.text}</p>
                  {t.detail && <p className="whitespace-pre-wrap text-slate-600">{t.detail}</p>}
                  <p className="text-xs text-slate-400">{t.actor} · {formatDateTime(t.at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
