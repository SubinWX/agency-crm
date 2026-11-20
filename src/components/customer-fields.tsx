import { PhotoGenderFields } from "./photo-gender-fields";

/** Customer form fields (used on Add and Edit pages). */
export function CustomerFields({
  c,
  branches,
}: {
  c?: { name: string; phone: string; altPhone: string | null; email: string | null; address: string | null; location: string | null; branchId: string | null; notes: string | null; gstNumber?: string | null; id?: string; gender?: "MALE" | "FEMALE" | null; photoKey?: string | null; updatedAt?: Date };
  branches: { id: string; name: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3"><PhotoGenderFields photo={c?.photoKey && c.id ? `/api/customers/${c.id}/photo?v=${c.updatedAt?.getTime() ?? ""}` : null} gender={c?.gender} name={c?.name} /></div>
      <div><label className="label">Customer name *</label><input name="name" required defaultValue={c?.name} className="input" /></div>
      <div><label className="label">Phone *</label><input name="phone" type="tel" required defaultValue={c?.phone} className="input" /></div>
      <div><label className="label">Alternative phone</label><input name="altPhone" type="tel" defaultValue={c?.altPhone ?? ""} className="input" /></div>
      <div><label className="label">Email</label><input name="email" type="email" defaultValue={c?.email ?? ""} className="input" /></div>
      <div><label className="label">Location</label><input name="location" defaultValue={c?.location ?? ""} className="input" placeholder="City / area" /></div>
      <div>
        <label className="label">Branch</label>
        <select name="branchId" defaultValue={c?.branchId ?? ""} className="input">
          <option value="">— Any branch —</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-3"><label className="label">Address</label><textarea name="address" rows={2} defaultValue={c?.address ?? ""} className="input" /></div>
      <div className="sm:col-span-2 lg:col-span-3"><label className="label">Notes</label><textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} className="input" /></div>
    </div>
  );
}
