export function BranchFields({ b }: { b?: { name: string; code: string; address: string | null; phone: string | null; email: string | null; status: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div><label className="label">Branch name *</label><input name="name" required defaultValue={b?.name} className="input" /></div>
      <div><label className="label">Code *</label><input name="code" required defaultValue={b?.code} className="input uppercase" placeholder="MAIN" /></div>
      <div><label className="label">Status</label><select name="status" defaultValue={b?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
      <div><label className="label">Phone</label><input name="phone" defaultValue={b?.phone ?? ""} className="input" /></div>
      <div><label className="label">Email</label><input name="email" type="email" defaultValue={b?.email ?? ""} className="input" /></div>
      <div className="sm:col-span-2 lg:col-span-3"><label className="label">Address</label><textarea name="address" rows={2} defaultValue={b?.address ?? ""} className="input" /></div>
    </div>
  );
}

export function SupplierFields({ s }: { s?: { name: string; company: string | null; phone: string | null; email: string | null; address: string | null; gstNumber: string | null; notes: string | null; status: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div><label className="label">Name *</label><input name="name" required defaultValue={s?.name} className="input" /></div>
      <div><label className="label">Company</label><input name="company" defaultValue={s?.company ?? ""} className="input" /></div>
      <div><label className="label">GST number</label><input name="gstNumber" defaultValue={s?.gstNumber ?? ""} maxLength={15} className="input uppercase" /></div>
      <div><label className="label">Phone</label><input name="phone" defaultValue={s?.phone ?? ""} className="input" /></div>
      <div><label className="label">Email</label><input name="email" type="email" defaultValue={s?.email ?? ""} className="input" /></div>
      <div><label className="label">Status</label><select name="status" defaultValue={s?.status ?? "ACTIVE"} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
      <div className="sm:col-span-2 lg:col-span-3"><label className="label">Address</label><textarea name="address" rows={2} defaultValue={s?.address ?? ""} className="input" /></div>
      <div className="sm:col-span-2 lg:col-span-3"><label className="label">Notes</label><textarea name="notes" rows={2} defaultValue={s?.notes ?? ""} className="input" /></div>
    </div>
  );
}
