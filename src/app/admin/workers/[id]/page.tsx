import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonForm } from "@/components/people";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { AppError } from "@/server/lib/errors";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { getPerson } from "@/server/modules/people/service";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Worker" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const { id } = await params;
  const { created } = await searchParams;
  const data = await getPerson(actor, "WORKER", id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const branches = await listAccessibleBranches(actor);
  const u = data.user;
  return (
    <>
      {created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Worker added. Share their email and password so they can sign in.</div>}
      <PageHeader title={u.name} subtitle={`${u.phone ?? ""}${u.staffProfile?.address ? ` · ${u.staffProfile.address}` : ""}`} actions={<Link href="/admin/workers" className="btn-secondary">← All workers</Link>} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Details" className="xl:col-span-2">
          <PersonForm
            kind="WORKER"
            id={u.id}
            branches={branches}
            showCommission={can(actor, "commissions.manage")}
            p={{ name: u.name, email: u.email, phone: u.phone, status: u.status, branchIds: u.branches.map((b) => b.branchId), address: u.staffProfile?.address ?? null, joiningDate: data.joiningDate, emergencyContact: u.staffProfile?.emergencyContact ?? null, commissionPercent: u.commissionPercent !== null ? String(Number(u.commissionPercent)) : "" }}
          />
        </Card>
        <Card title={`Recent works (${data.works.length})`}>
          {data.works.length === 0 ? <p className="text-sm text-slate-500">No works yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.works.map((w) => (
                <li key={w.id}><Link href={`/admin/works/${w.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-blue-700"><span className="min-w-0 truncate">{w.reference} · {w.customer.name}<span className="block text-xs text-slate-500">{formatDateLabel(fromDbDate(w.workDate))}</span></span><StatusBadge status={w.status} /></Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
