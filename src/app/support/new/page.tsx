import { createTicketAction } from "@/app/actions/support";
import { ImageInput } from "@/components/image-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listCategories, PRIORITY_LABELS } from "@/server/modules/support/service";

export const metadata = { title: "New request" };

export default async function NewTicketPage() {
  const actor = await requireUser();
  const [categories, branches] = await Promise.all([listCategories(), listAccessibleBranches(actor)]);
  return (
    <>
      <PageHeader title="New complaint or request" subtitle="We'll reply here and notify you when something changes." />
      <Card className="max-w-2xl">
        <ActionForm action={createTicketAction}>
          <div><label className="label">Title *</label><input name="title" required minLength={3} maxLength={150} className="input" placeholder="Short summary" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Category *</label>
              <select name="categoryId" required defaultValue="" className="input">
                <option value="" disabled>Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select name="priority" defaultValue="MEDIUM" className="input">{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            {branches.length > 1 && (
              <div>
                <label className="label">Branch</label>
                <select name="branchId" defaultValue="" className="input">
                  <option value="">Company-wide</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div><label className="label">Related work (optional)</label><input name="workReference" className="input" placeholder="WRK-000001" /></div>
          </div>
          <div><label className="label">Description *</label><textarea name="description" required minLength={5} rows={6} maxLength={5000} className="input" placeholder="What happened? What do you need?" /></div>
          <div>
            <label className="label">Attachments</label>
            <ImageInput name="attachments" accept="image/*,application/pdf" multiple maxFiles={5} label="Add files" />
            <p className="mt-1 text-xs text-slate-500">Photos or PDF, up to 5 files, 10 MB each.</p>
          </div>
          <SubmitButton pendingText="Submitting…">Submit request</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
