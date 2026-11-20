"use client";

import { useState } from "react";
import { PhotoGenderFields } from "./photo-gender-fields";

/** User form fields (Add / Edit user pages). Super Admin = full access, all branches, nothing to tick. */
export function UserFields({
  u,
  roles,
  branches,
}: {
  u?: { id?: string; name: string; email: string; phone: string | null; roleId: string; status: string; branches: { branchId: string }[]; photoUrl?: string | null; gender?: "MALE" | "FEMALE" | null; updatedAt?: Date };
  roles: { id: string; name: string; isSuperAdmin: boolean }[];
  branches: { id: string; name: string }[];
}) {
  const [roleId, setRoleId] = useState(u?.roleId ?? "");
  const superAdmin = roles.find((r) => r.id === roleId)?.isSuperAdmin ?? false;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3"><PhotoGenderFields photo={u?.photoUrl && u.id ? `/api/avatar/${u.id}?v=${u.updatedAt?.getTime() ?? ""}` : null} gender={u?.gender} name={u?.name} /></div>
      <div><label className="label">Name *</label><input name="name" required defaultValue={u?.name} className="input" /></div>
      <div><label className="label">Email (sign-in) *</label><input name="email" type="email" required defaultValue={u?.email} className="input" /></div>
      <div><label className="label">Phone</label><input name="phone" defaultValue={u?.phone ?? ""} className="input" /></div>
      <div>
        <label className="label">Role *</label>
        <select name="roleId" required value={roleId} onChange={(e) => setRoleId(e.target.value)} className="input">
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
        {superAdmin ? (
          <>
            <div className="flex flex-wrap gap-4 opacity-80">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked disabled className="h-4 w-4 rounded border-slate-300" /> {b.name}
                </label>
              ))}
            </div>
            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Super Admin has full access built in: every permission and every branch, including branches added later. Nothing needs to be ticked.
            </p>
          </>
        ) : (
          <div className="flex flex-wrap gap-4">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="branchIds" value={b.id} defaultChecked={u?.branches.some((x) => x.branchId === b.id)} className="h-4 w-4 rounded border-slate-300" /> {b.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
