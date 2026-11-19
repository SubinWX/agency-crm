import { PageHeader, Pagination } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateTime } from "@/server/lib/dates";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePagePermission("ADMIN", "audit.view");
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const pageSize = 50;
  const where = sp.q ? { OR: [{ action: { contains: sp.q } }, { entityType: { contains: sp.q } }, { entityId: sp.q }] } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId ?? "").filter(Boolean) } }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of critical actions." />
      <form className="mb-3 flex gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Action (e.g. capacity, work.create) or entity id" className="input" />
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50"><tr><th className="table-th">When</th><th className="table-th">User</th><th className="table-th">Action</th><th className="table-th">Entity</th><th className="table-th">Reason</th><th className="table-th">IP</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="table-td whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</td>
                <td className="table-td">{users.find((u) => u.id === r.userId)?.name ?? "—"}</td>
                <td className="table-td font-mono text-xs">{r.action}</td>
                <td className="table-td text-xs">{r.entityType}<div className="text-slate-400">{r.entityId}</div></td>
                <td className="table-td text-xs">{r.reason ?? ""}</td>
                <td className="table-td text-xs text-slate-500">{r.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / pageSize))} makeHref={(p) => `?page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} />
    </>
  );
}
