/** User form fields (Add / Edit user pages). */
export function UserFields({
  u,
  roles,
  branches,
}: {
  u?: { name: string; email: string; phone: string | null; roleId: string; status: string; branches: { branchId: string }[] };
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div><label className="label">Name *</label><input name="name" required defaultValue={u?.name} className="input" /></div>
      <div><label className="label">Email (sign-in) *</label><input name="email" type="email" required defaultValue={u?.email} className="input" /></div>
      <div><label className="label">Phone</label><input name="phone" defaultValue={u?.phone ?? ""} className="input" /></div>
      <div>
        <label className="label">Role *</label>
        <select name="roleId" required defaultValue={u?.roleId ?? ""} className="input">
          <option value="" disabled>Select role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Status</label>
        <select name="status" defaultValue={u?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
      </div>
      <div>
        <label className="label">{u ? "New password (leave blank to keep)" : "Password *"}</label>
        <input name="password" type="password" autoComplete="new-password" required={!u} className="input" />
        <p className="mt-1 text-xs text-slate-500">At least 8 characters with a letter and a number.</p>
      </div>
      <fieldset className="sm:col-span-2 lg:col-span-3">
        <legend className="label">Branches</legend>
        <div className="flex flex-wrap gap-4">
          {branches.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="branchIds" value={b.id} defaultChecked={u?.branches.some((x) => x.branchId === b.id)} className="h-4 w-4 rounded border-slate-300" /> {b.name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
