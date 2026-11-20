import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listBranchesAdmin } from "@/server/modules/branches/service";

export const metadata = { title: "Branches" };

export default async function BranchesPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "branches.manage");
  const { created } = await searchParams;
  const branches = await listBranchesAdmin(actor);
  return (
    <>
      {created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Branch added.</div>}
      <PageHeader title="Branches" subtitle="Daily capacity is company-wide; inventory and staff are per branch." actions={actor.isSuperAdmin ? <Link href="/admin/branches/new" className="btn-primary">+ Add branch</Link> : null} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {branches.map((b) => (
          <Link key={b.id} href={`/admin/branches/${b.id}`} className="card p-5 transition hover:border-blue-300">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{b.name}</p>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{b.code}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{b.address ?? "No address"}</p>
            <p className="mt-4 text-xs text-slate-500">{b._count.works} works · {b._count.users} users · {b.status === "ACTIVE" ? "Active" : "Inactive"}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
