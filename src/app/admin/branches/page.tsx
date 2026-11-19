import { saveBranchAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listBranchesAdmin } from "@/server/modules/branches/service";

export const metadata = { title: "Branches" };

export default async function BranchesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "branches.manage");
  const { edit } = await searchParams;
  const branches = await listBranchesAdmin(actor);
  const editing = edit ? branches.find((b) => b.id === edit) : undefined;
  const showForm = editing || actor.isSuperAdmin;
  return (
    <>
      <PageHeader title="Branches" subtitle="Daily capacity is company-wide; inventory and staff are per branch." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          {branches.map((b) => (
            <div key={b.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{b.name} <span className="text-xs font-normal text-slate-500">{b.code}</span></p>
                  <p className="text-sm text-slate-500">{b.address}</p>
                </div>
                <a className="text-sm text-blue-700" href={`?edit=${b.id}`}>Edit</a>
              </div>
              <p className="mt-3 text-xs text-slate-500">{b._count.works} works · {b._count.users} users · {b.status.toLowerCase()}</p>
            </div>
          ))}
        </div>
        {showForm && (
          <Card title={editing ? `Edit ${editing.name}` : "Add branch"}>
            <ActionForm key={editing?.id ?? "new"} action={saveBranchAction.bind(null, editing?.id ?? null)} resetOnSuccess={!editing}>
              <div><label className="label">Name *</label><input name="name" required defaultValue={editing?.name} className="input" /></div>
              <div><label className="label">Code *</label><input name="code" required defaultValue={editing?.code} className="input uppercase" /></div>
              <div><label className="label">Address</label><input name="address" defaultValue={editing?.address ?? ""} className="input" /></div>
              <div><label className="label">Phone</label><input name="phone" defaultValue={editing?.phone ?? ""} className="input" /></div>
              <div><label className="label">Email</label><input name="email" type="email" defaultValue={editing?.email ?? ""} className="input" /></div>
              <div><label className="label">Status</label><select name="status" defaultValue={editing?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
              <SubmitButton>{editing ? "Save" : "Add branch"}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
