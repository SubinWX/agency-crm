import { archiveCustomerAction, createCustomerAction, updateCustomerAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { searchCustomers } from "@/server/modules/customers/service";
import { can } from "@/server/rbac/actor";
import { grantPortalAction, revokePortalAction } from "@/app/actions/portal";
import { portalAccessFor } from "@/server/modules/portal/service";
import { formatDateTime } from "@/server/lib/dates";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; edit?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "customers.view");
  const sp = await searchParams;
  const [data, branches] = await Promise.all([searchCustomers(actor, sp.q ?? "", Number(sp.page) || 1), listAccessibleBranches(actor)]);
  const editing = sp.edit ? data.items.find((c) => c.id === sp.edit) : undefined;
  const portalUser = editing ? await portalAccessFor(editing.id) : null;
  const canPortal = can(actor, "customers.edit") && can(actor, "users.manage");

  const form = (c?: (typeof data.items)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label className="label">Name *</label><input name="name" required defaultValue={c?.name} className="input" /></div>
      <div><label className="label">Phone *</label><input name="phone" required defaultValue={c?.phone} className="input" /></div>
      <div><label className="label">Alternative phone</label><input name="altPhone" defaultValue={c?.altPhone ?? ""} className="input" /></div>
      <div><label className="label">Email</label><input name="email" type="email" defaultValue={c?.email ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">Address</label><input name="address" defaultValue={c?.address ?? ""} className="input" /></div>
      <div><label className="label">Location</label><input name="location" defaultValue={c?.location ?? ""} className="input" /></div>
      <div>
        <label className="label">Branch</label>
        <select name="branchId" defaultValue={c?.branchId ?? ""} className="input">
          <option value="">— Any —</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2"><label className="label">Notes</label><textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} className="input" /></div>
    </div>
  );

  return (
    <>
      <PageHeader title="Customers" subtitle={`${data.total} customer(s)`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form className="mb-3 flex gap-2">
            <input name="q" defaultValue={sp.q} placeholder="Search name or phone" className="input" />
            <button className="btn-secondary">Search</button>
          </form>
          {data.items.length === 0 ? (
            <EmptyState title="No customers found." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50"><tr><th className="table-th">Name</th><th className="table-th">Phone</th><th className="table-th">Branch</th><th className="table-th">Works</th><th className="table-th" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td className="table-td font-medium">{c.name}<div className="text-xs font-normal text-slate-500">{c.address}</div></td>
                      <td className="table-td">{c.phone}</td>
                      <td className="table-td">{c.branch?.name ?? "—"}</td>
                      <td className="table-td">{c._count.works}</td>
                      <td className="table-td text-right">{can(actor, "customers.edit") && <a className="text-blue-700" href={`?edit=${c.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>Edit</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pages={Math.ceil(data.total / data.pageSize)} makeHref={(p) => `?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} />
        </div>
        <div className="space-y-5">
          {editing && can(actor, "customers.edit") ? (
            <Card title={`Edit ${editing.name}`} actions={<a href="/admin/customers" className="text-xs text-slate-500">Close</a>}>
              <ActionForm action={updateCustomerAction.bind(null, editing.id)}>
                {form(editing)}
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
              {canPortal && (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <p className="text-sm font-semibold">Customer portal</p>
                  {portalUser && portalUser.status === "ACTIVE" ? (
                    <p className="text-xs text-slate-600">Login: <strong>{portalUser.email}</strong> · last sign-in {portalUser.lastLoginAt ? formatDateTime(portalUser.lastLoginAt) : "never"}</p>
                  ) : (
                    <p className="text-xs text-slate-500">{portalUser ? "Access is turned off." : "No portal login yet."} The customer signs in at /portal/login.</p>
                  )}
                  <ActionForm action={grantPortalAction.bind(null, editing.id)} resetOnSuccess className="space-y-2">
                    <input name="email" type="email" required defaultValue={portalUser?.email ?? editing.email ?? ""} className="input" placeholder="Customer's email" />
                    <input name="password" type="password" required autoComplete="new-password" className="input" placeholder={portalUser ? "New password" : "Password (min 8, letter + number)"} />
                    <SubmitButton className="btn-secondary w-full">{portalUser ? "Update login / turn on" : "Create portal login"}</SubmitButton>
                  </ActionForm>
                  {portalUser?.status === "ACTIVE" && (
                    <ActionForm action={revokePortalAction.bind(null, editing.id)} confirm="Turn off this customer's portal access?" className="">
                      <SubmitButton className="w-full text-xs text-red-700">Turn off portal access</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
              {can(actor, "customers.archive") && (
                <ActionForm action={archiveCustomerAction.bind(null, editing.id)} confirm="Archive this customer? Their works stay intact." className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <input name="reason" required className="input" placeholder="Reason for archiving *" />
                  <SubmitButton className="btn-danger">Archive customer</SubmitButton>
                </ActionForm>
              )}
            </Card>
          ) : (
            can(actor, "customers.create") && (
              <Card title="Add customer">
                <ActionForm action={createCustomerAction} resetOnSuccess>
                  {form()}
                  <SubmitButton>Add customer</SubmitButton>
                </ActionForm>
              </Card>
            )
          )}
        </div>
      </div>
    </>
  );
}
