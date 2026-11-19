import Link from "next/link";
import { formatINR, toPaise } from "@/server/modules/billing/calc";
import { effectivePercent } from "@/server/modules/billing/sync";
import { listCommissions } from "@/server/modules/billing/commissions";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/rbac/actor";
import { CommissionStatusBadge } from "./billing-ui";
import { EmptyState, PageHeader, Stat } from "./ui";

/** A person's own commissions only — never anyone else's. */
export async function MyCommissions({ actor, workHref }: { actor: Actor; workHref: (id: string) => string }) {
  const type = actor.portal === "AGENT" ? "AGENT" : "WORKER";
  const [data, rate] = await Promise.all([listCommissions(actor, { type }), effectivePercent(prisma, actor.id, type)]);
  const sum = (s: string) => toPaise(data.byStatus.find((b) => b.status === s)?._sum.amount?.toString() ?? "0");
  return (
    <>
      <PageHeader title="My commission" subtitle={`Your current rate: ${rate}% of the work value (excl. GST)`} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Pending" value={formatINR(sum("ACCRUED") + sum("APPROVED"))} tone="blue" />
        <Stat label="Paid" value={formatINR(sum("PAID"))} tone="emerald" />
        <Stat label="Works" value={data.total} />
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="No commission yet." hint="Commission is added when your work is approved." />
      ) : (
        <ul className="space-y-2">
          {data.items.map((c) => (
            <li key={c.id} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link href={workHref(c.work.id)} className="font-medium text-blue-700">{c.work.reference}</Link>
                <p className="truncate text-xs text-slate-500">{c.work.customer.name} · {Number(c.percent)}%{Number(c.shareFactor) < 1 ? ` · ${Math.round(Number(c.shareFactor) * 100)}% share` : ""}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{toPaise(c.baseAmount.toString()) ? formatINR(toPaise(c.amount.toString())) : <span className="text-xs font-normal text-slate-500">Awaiting invoice</span>}</p>
                <CommissionStatusBadge status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
