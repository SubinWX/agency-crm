import Link from "next/link";
import { savePersonAction } from "@/app/actions/people";
import { formatDateTime } from "@/server/lib/dates";
import type { listPeople, PersonKind } from "@/server/modules/people/service";
import { KIND_LABEL } from "@/server/modules/people/service";
import { ActionForm, SubmitButton } from "./action-form";
import { EmptyState, PageHeader } from "./ui";

type Row = Awaited<ReturnType<typeof listPeople>>[number];

export function PeopleList({ kind, rows, branches, sp }: { kind: PersonKind; rows: Row[]; branches: { id: string; name: string }[]; sp: { q?: string; branchId?: string; status?: string } }) {
  const L = KIND_LABEL[kind];
  const agent = kind === "AGENT";
  return (
    <>
      <PageHeader
        title={L.many}
        subtitle={agent ? "People who bring in works. Each has their own login at /agent/login." : "People who do the works. Each has their own login at /worker/login."}
        actions={<Link href={`${L.base}/new`} className="btn-primary">+ Add {agent ? "agent" : "worker"}</Link>}
      />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-4">
        <input name="q" defaultValue={sp.q} placeholder="Name, phone, email or location" className="input sm:col-span-2" />
        <select name="branchId" defaultValue={sp.branchId ?? ""} className="input"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <div className="flex gap-2">
          <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
          <button className="btn-primary">Filter</button>
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={`No ${agent ? "agents" : "workers"} found.`} action={<Link href={`${L.base}/new`} className="btn-primary">Add {agent ? "agent" : "worker"}</Link>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Phone</th>
                <th className="table-th">Location</th>
                <th className="table-th">Branch</th>
                <th className="table-th text-right">{agent ? "Works added" : "Jobs"}</th>
                <th className="table-th text-right">Open</th>
                <th className="table-th text-right">Completed</th>
                <th className="table-th text-right">Commission</th>
                <th className="table-th">Status</th>
                <th className="table-th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="table-td"><Link href={`${L.base}/${u.id}`} className="font-medium text-blue-700">{u.name}</Link><div className="text-xs text-slate-500">{u.email}</div></td>
                  <td className="table-td whitespace-nowrap">{u.phone ? <a href={`tel:${u.phone}`} className="hover:text-blue-700">{u.phone}</a> : "—"}</td>
                  <td className="table-td max-w-[14rem] truncate text-sm">{u.staffProfile?.address ?? <span className="text-slate-400">—</span>}</td>
                  <td className="table-td text-xs">{u.branches.map((b) => b.branch.name).join(", ") || "—"}</td>
                  <td className="table-td text-right">{u.stats.total}</td>
                  <td className="table-td text-right">{u.stats.active}</td>
                  <td className="table-td text-right">{u.stats.done}</td>
                  <td className="table-td text-right text-xs">{u.commissionPercent !== null ? `${Number(u.commissionPercent)}%` : "default"}</td>
                  <td className="table-td">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{u.status === "ACTIVE" ? "Active" : "Inactive"}</span>
                    <div className="mt-0.5 text-[11px] text-slate-400">{u.lastLoginAt ? `seen ${formatDateTime(u.lastLoginAt)}` : "never signed in"}</div>
                  </td>
                  <td className="table-td text-right"><Link className="text-blue-700" href={`${L.base}/${u.id}`}>Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PersonForm({
  kind,
  id,
  branches,
  showCommission,
  p,
}: {
  kind: PersonKind;
  id: string | null;
  branches: { id: string; name: string }[];
  showCommission: boolean;
  p?: { name: string; email: string; phone: string | null; status: string; branchIds: string[]; address: string | null; joiningDate: string; emergencyContact: string | null; commissionPercent: string };
}) {
  const agent = kind === "AGENT";
  return (
    <ActionForm action={savePersonAction.bind(null, kind, id)} className="space-y-6">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="label">Full name *</label><input name="name" required defaultValue={p?.name} className="input" /></div>
          <div><label className="label">Phone *</label><input name="phone" type="tel" required defaultValue={p?.phone ?? ""} className="input" placeholder="+91 9xxxx xxxxx" /></div>
          <div><label className="label">Email (sign-in) *</label><input name="email" type="email" required defaultValue={p?.email} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Location / address</label><input name="address" defaultValue={p?.address ?? ""} className="input" placeholder="Area, city" /></div>
          <div><label className="label">Emergency contact</label><input name="emergencyContact" defaultValue={p?.emergencyContact ?? ""} className="input" placeholder="Name & phone" /></div>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Work</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="label">Branch * <span className="font-normal text-slate-500">— {agent ? "branches this agent brings works for" : "branches this worker can be assigned in"}</span></legend>
            <div className="flex flex-wrap gap-3">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                  <input type="checkbox" name="branchIds" value={b.id} defaultChecked={p ? p.branchIds.includes(b.id) : branches.length === 1} className="h-4 w-4 rounded border-slate-300" /> {b.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div><label className="label">Joining date</label><input name="joiningDate" type="date" defaultValue={p?.joiningDate ?? ""} className="input" /></div>
          {showCommission && (
            <div>
              <label className="label">Commission %</label>
              <input name="commissionPercent" type="number" step="0.01" min={0} max={100} defaultValue={p?.commissionPercent ?? ""} placeholder="company default" className="input" />
            </div>
          )}
          <div><label className="label">Status</label><select name="status" defaultValue={p?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Login</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">{p ? "New password (leave blank to keep)" : "Password *"}</label>
            <input name="password" type="password" autoComplete="new-password" required={!p} className="input" />
            <p className="mt-1 text-xs text-slate-500">At least 8 characters with a letter and a number. They sign in at {agent ? "/agent/login" : "/worker/login"}.</p>
          </div>
        </div>
      </section>
      <SubmitButton>{p ? "Save changes" : `Add ${agent ? "agent" : "worker"}`}</SubmitButton>
    </ActionForm>
  );
}
