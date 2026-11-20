import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveCustomerAction, updateCustomerAction } from "@/app/actions/admin";
import { grantPortalAction, revokePortalAction } from "@/app/actions/portal";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CustomerFields } from "@/components/customer-fields";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateLabel, formatDateTime, fromDbDate } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { getCustomer } from "@/server/modules/customers/service";
import { portalAccessFor } from "@/server/modules/portal/service";
import { workAccessWhere } from "@/server/modules/works/access";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "customers.view");
  const { id } = await params;
  const { created } = await searchParams;
  const c = await getCustomer(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const [branches, portalUser, works] = await Promise.all([
    listAccessibleBranches(actor),
    portalAccessFor(c.id),
    prisma.work.findMany({ where: { customerId: c.id, AND: [workAccessWhere(actor)] }, orderBy: { workDate: "desc" }, take: 20, select: { id: true, reference: true, title: true, workDate: true, status: true } }),
  ]);
  const editable = can(actor, "customers.edit");
  const canPortal = editable && can(actor, "users.manage");

  return (
    <>
      {created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Customer added.</div>}
      <PageHeader
        title={c.name}
        subtitle={`${c.phone}${c.email ? ` · ${c.email}` : ""}`}
        actions={
          <>
            <Link href="/admin/customers" className="btn-secondary">← All customers</Link>
            {can(actor, "works.create") && <Link href="/admin/works/new" className="btn-primary">+ New work</Link>}
          </>
        }
      />
      <div className="space-y-5">
        <Card title={editable ? "Edit details" : "Details"}>
          <ActionForm action={updateCustomerAction.bind(null, c.id)} className="space-y-5">
            <fieldset disabled={!editable}><CustomerFields c={c} branches={branches} /></fieldset>
            {editable && <SubmitButton>Save changes</SubmitButton>}
          </ActionForm>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={`Works (${works.length})`}>
            {works.length === 0 ? <p className="text-sm text-slate-500">No works yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {works.map((w) => (
                  <li key={w.id}><Link href={`/admin/works/${w.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-blue-700"><span>{w.reference} · {w.title || "—"} <span className="text-xs text-slate-500">{formatDateLabel(fromDbDate(w.workDate))}</span></span><StatusBadge status={w.status} /></Link></li>
                ))}
              </ul>
            )}
          </Card>

          {canPortal && (
            <Card title="Customer portal access">
              {portalUser && portalUser.status === "ACTIVE" ? (
                <p className="mb-3 text-sm text-slate-600">Login: <strong>{portalUser.email}</strong> · last sign-in {portalUser.lastLoginAt ? formatDateTime(portalUser.lastLoginAt) : "never"}</p>
              ) : (
                <p className="mb-3 text-sm text-slate-500">{portalUser ? "Access is turned off." : "No portal login yet."} The customer signs in at /portal/login.</p>
              )}
              <ActionForm action={grantPortalAction.bind(null, c.id)} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
                <input name="email" type="email" required defaultValue={portalUser?.email ?? c.email ?? ""} className="input" placeholder="Customer's email" />
                <input name="password" type="password" required autoComplete="new-password" className="input" placeholder={portalUser ? "New password" : "Password (min 8, letter + number)"} />
                <div className="sm:col-span-2"><SubmitButton className="btn-secondary">{portalUser ? "Update login / turn on" : "Create portal login"}</SubmitButton></div>
              </ActionForm>
              {portalUser?.status === "ACTIVE" && (
                <ActionForm action={revokePortalAction.bind(null, c.id)} confirm="Turn off this customer's portal access?" className="mt-3">
                  <SubmitButton className="text-sm text-red-700">Turn off portal access</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>

        {can(actor, "customers.archive") && (
          <Card title="Archive customer">
            <ActionForm action={archiveCustomerAction.bind(null, c.id)} confirm="Archive this customer? Their works stay intact." className="flex max-w-xl gap-2">
              <input name="reason" required className="input" placeholder="Reason for archiving *" />
              <SubmitButton className="btn-danger whitespace-nowrap">Archive</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
