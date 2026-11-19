import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { formatDateLabel, fromDbDate } from "@/server/lib/dates";
import { listWorks } from "@/server/modules/works/queries";

export const metadata = { title: "Approvals" };

export default async function Approvals() {
  const actor = await requirePagePermission("ADMIN", "works.approve");
  const data = await listWorks(actor, { status: "PENDING_APPROVAL", pageSize: 100 });
  return (
    <>
      <PageHeader title="Pending approval" subtitle="Review worker completion photos and approve or request correction." />
      {data.items.length === 0 ? (
        <EmptyState title="Nothing waiting for approval." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.items.map((w) => (
            <li key={w.id}>
              <Link href={`/admin/works/${w.id}`} className="card block p-4 hover:border-orange-300">
                <p className="font-semibold">{w.reference} · {w.customer.name}</p>
                <p className="text-sm text-slate-500">{formatDateLabel(fromDbDate(w.workDate))} · {w.branch.name}</p>
                <p className="mt-2 text-xs text-slate-500">Workers: {w.assignments.map((a) => a.worker.name).join(", ")}</p>
                <span className="mt-3 inline-block text-sm font-medium text-orange-700">Review →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
