import Link from "next/link";
import { notFound } from "next/navigation";
import { saveSupplierAction } from "@/app/actions/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SupplierFields } from "@/components/branch-supplier-fields";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("ADMIN", "inventory.manage");
  const { id } = await params;
  const s = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, include: { items: { where: { deletedAt: null }, select: { id: true, name: true, code: true } } } });
  if (!s) notFound();
  return (
    <>
      <PageHeader title={s.name} subtitle={s.company ?? undefined} actions={<Link href="/admin/suppliers" className="btn-secondary">← All suppliers</Link>} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Edit supplier" className="xl:col-span-2">
          <ActionForm action={saveSupplierAction.bind(null, s.id)} className="space-y-5">
            <SupplierFields s={s} />
            <SubmitButton>Save supplier</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={`Items supplied (${s.items.length})`}>
          {s.items.length === 0 ? <p className="text-sm text-slate-500">No items linked yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">{s.items.map((i) => <li key={i.id}><Link className="block py-2 hover:text-blue-700" href={`/admin/inventory/items/${i.id}`}>{i.name} <span className="text-xs text-slate-500">{i.code}</span></Link></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
