/**
 * Phase 6 analytics (spec §50 costing, §51 agent score, §52 worker performance,
 * §58 dashboard graphs). All money in paise; all results respect branch access.
 *
 * Profit & loss (management view, excl. GST):
 *   Revenue      = taxable value of non-cancelled invoices (by invoice date)
 *   − Expenses   = active expenses (by expense date)
 *   − Salaries   = salary payments (by paid date)
 *   − Commission = approved/paid commissions (by approval date)
 *   − Materials  = stock issued to works × unit cost (by movement date)
 *   = Net
 */
import { Prisma, type WorkStatus } from "@prisma/client";
import { prisma } from "../../db";
import { addDaysIso, businessTz, businessToday, fromDbDate, isIsoDate, toDbDate } from "../../lib/dates";
import { forbidden, invalid } from "../../lib/errors";
import { canAccessBranch, type Actor } from "../../rbac/actor";
import { toPaise } from "../billing/calc";
import { getSetting } from "../settings/service";
import { toMilli } from "../inventory/qty";

const DONE: WorkStatus[] = ["APPROVED", "INVOICED", "PAYMENT_PENDING", "PAID", "CLOSED"];

export interface Range {
  from: string;
  to: string;
  branchId?: string;
}

/** Validate a date range + branch for the actor. Returns branch ids to filter by (null = all). */
export function resolveScope(actor: Actor, r: Partial<Range>): { from: string; to: string; branchIds: string[] | null } {
  const to = r.to && isIsoDate(r.to) ? r.to : businessToday();
  const from = r.from && isIsoDate(r.from) ? r.from : addDaysIso(to, -365);
  if (from > to) throw invalid("Start date must be before end date.");
  if (r.branchId) {
    if (!canAccessBranch(actor, r.branchId)) throw forbidden("You do not have access to this branch.");
    return { from, to, branchIds: [r.branchId] };
  }
  return { from, to, branchIds: actor.isSuperAdmin ? null : [...actor.branchIds] };
}

const branchSql = (col: string, ids: string[] | null) =>
  ids === null ? Prisma.empty : ids.length ? Prisma.sql`AND ${Prisma.raw(col)} IN (${Prisma.join(ids)})` : Prisma.sql`AND false`;

// ───────────────────────────── Job costing ─────────────────────────────

export interface Costing {
  revenue: number;
  materials: number;
  agentCommission: number;
  workerCommission: number;
  expenses: number;
  totalCost: number;
  profit: number;
  margin: number | null; // %
}

/** Costing for many works at once (one query per source). */
export async function costingForWorks(workIds: string[]): Promise<Map<string, Costing>> {
  const out = new Map<string, Costing>();
  if (workIds.length === 0) return out;
  const [inv, mats, coms, exps] = await Promise.all([
    prisma.invoice.groupBy({ by: ["workId"], where: { workId: { in: workIds }, status: { not: "CANCELLED" } }, _sum: { taxableTotal: true } }),
    prisma.stockMovement.findMany({ where: { workId: { in: workIds } }, select: { workId: true, change: true, unitCost: true } }),
    prisma.commission.groupBy({ by: ["workId", "type"], where: { workId: { in: workIds }, status: { not: "CANCELLED" } }, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ["workId"], where: { workId: { in: workIds }, status: "ACTIVE" }, _sum: { amount: true } }),
  ]);
  for (const id of workIds) {
    const revenue = toPaise(inv.find((i) => i.workId === id)?._sum.taxableTotal?.toString() ?? "0");
    const materials = mats
      .filter((m) => m.workId === id)
      .reduce((a, m) => a + Math.round((-toMilli(m.change.toString()) * toPaise(m.unitCost?.toString() ?? "0")) / 1000), 0);
    const agentCommission = toPaise(coms.find((c) => c.workId === id && c.type === "AGENT")?._sum.amount?.toString() ?? "0");
    const workerCommission = toPaise(coms.find((c) => c.workId === id && c.type === "WORKER")?._sum.amount?.toString() ?? "0");
    const expenses = toPaise(exps.find((e) => e.workId === id)?._sum.amount?.toString() ?? "0");
    const totalCost = materials + agentCommission + workerCommission + expenses;
    const profit = revenue - totalCost;
    out.set(id, { revenue, materials, agentCommission, workerCommission, expenses, totalCost, profit, margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null });
  }
  return out;
}

export async function workCosting(workId: string): Promise<Costing> {
  return (await costingForWorks([workId])).get(workId)!;
}

// ───────────────────────────── Agent score ─────────────────────────────

export type Tier = "Gold" | "Silver" | "Bronze" | "Needs attention" | "New";
export interface AgentPerf {
  agentId: string;
  name: string;
  works: number;
  completed: number;
  cancelled: number;
  onTime: number;
  completionRate: number; // 0–1 of non-cancelled
  cancellationRate: number;
  onTimeRate: number; // of completed
  revenue: number; // paise
  commission: number; // paise
  score: number | null; // 0–100
  tier: Tier;
}

export function tierFor(score: number | null): Tier {
  if (score === null) return "New";
  if (score >= 80) return "Gold";
  if (score >= 60) return "Silver";
  if (score >= 40) return "Bronze";
  return "Needs attention";
}

/** Pure scoring so it can be unit tested. */
export function scoreAgent(
  m: { works: number; completed: number; cancelled: number; onTime: number; revenue: number },
  maxRevenue: number,
  w: { completionWeight: number; onTimeWeight: number; cancellationWeight: number; revenueWeight: number; minWorks: number },
): number | null {
  if (m.works < w.minWorks) return null;
  const active = m.works - m.cancelled;
  const completion = active > 0 ? m.completed / active : 0;
  const onTime = m.completed > 0 ? m.onTime / m.completed : 0;
  const keep = 1 - m.cancelled / m.works;
  const revenue = maxRevenue > 0 ? m.revenue / maxRevenue : 0;
  const total = w.completionWeight + w.onTimeWeight + w.cancellationWeight + w.revenueWeight;
  if (total === 0) return null;
  const s = (completion * w.completionWeight + onTime * w.onTimeWeight + keep * w.cancellationWeight + revenue * w.revenueWeight) / total;
  return Math.round(s * 100);
}

export async function agentPerformance(actor: Actor, r: Partial<Range> & { agentId?: string }): Promise<AgentPerf[]> {
  return agentPerformanceScoped(resolveScope(actor, r), r.agentId);
}

/** Internal: scope already validated by the caller. */
async function agentPerformanceScoped({ from, to, branchIds }: { from: string; to: string; branchIds: string[] | null }, agentId?: string): Promise<AgentPerf[]> {
  const r = { agentId };
  const cfg = await getSetting("agentScore");
  const works = await prisma.work.findMany({
    where: {
      deletedAt: null,
      agentId: r.agentId ? r.agentId : { not: null },
      workDate: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
    },
    select: { id: true, agentId: true, status: true, workDate: true, approvedAt: true, agent: { select: { name: true } } },
    take: 20_000,
  });
  const ids = works.map((w) => w.id);
  const [inv, coms] = await Promise.all([
    prisma.invoice.groupBy({ by: ["workId"], where: { workId: { in: ids }, status: { not: "CANCELLED" } }, _sum: { taxableTotal: true } }),
    prisma.commission.groupBy({ by: ["workId"], where: { workId: { in: ids }, type: "AGENT", status: { not: "CANCELLED" } }, _sum: { amount: true } }),
  ]);
  const revByWork = new Map(inv.map((i) => [i.workId, toPaise(i._sum.taxableTotal?.toString() ?? "0")]));
  const comByWork = new Map(coms.map((c) => [c.workId, toPaise(c._sum.amount?.toString() ?? "0")]));
  const byAgent = new Map<string, Omit<AgentPerf, "completionRate" | "cancellationRate" | "onTimeRate" | "score" | "tier">>();
  for (const w of works) {
    const a = byAgent.get(w.agentId!) ?? { agentId: w.agentId!, name: w.agent?.name ?? "—", works: 0, completed: 0, cancelled: 0, onTime: 0, revenue: 0, commission: 0 };
    a.works++;
    if (w.status === "CANCELLED") a.cancelled++;
    if (DONE.includes(w.status)) {
      a.completed++;
      const approvedDay = w.approvedAt ? new Date(w.approvedAt).toLocaleDateString("en-CA", { timeZone: businessTz() }) : null;
      if (approvedDay && approvedDay <= addDaysIso(fromDbDate(w.workDate), cfg.graceDays)) a.onTime++;
    }
    a.revenue += revByWork.get(w.id) ?? 0;
    a.commission += comByWork.get(w.id) ?? 0;
    byAgent.set(a.agentId, a);
  }
  const maxRevenue = Math.max(0, ...[...byAgent.values()].map((a) => a.revenue));
  return [...byAgent.values()]
    .map((a) => {
      const score = scoreAgent(a, maxRevenue, cfg);
      const active = a.works - a.cancelled;
      return {
        ...a,
        completionRate: active ? a.completed / active : 0,
        cancellationRate: a.works ? a.cancelled / a.works : 0,
        onTimeRate: a.completed ? a.onTime / a.completed : 0,
        score,
        tier: tierFor(score),
      };
    })
    .sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || y.works - x.works);
}

/** An agent's own score (last 90 days). */
export async function myAgentScore(actor: Actor) {
  if (actor.portal !== "AGENT") throw forbidden();
  const to = businessToday();
  // An agent's own works, whichever branch they were for.
  const [mine] = await agentPerformanceScoped({ from: addDaysIso(to, -90), to, branchIds: null }, actor.id);
  return mine ?? null;
}

// ───────────────────────────── Worker performance ─────────────────────────────

export interface WorkerPerf {
  workerId: string;
  name: string;
  assigned: number;
  completed: number;
  rejections: number;
  firstTimeRight: number; // 0–1
  avgCompletionHours: number | null;
  commission: number;
}

export async function workerPerformance(actor: Actor, r: Partial<Range> & { workerId?: string }): Promise<WorkerPerf[]> {
  const { from, to, branchIds } = resolveScope(actor, r);
  const assignments = await prisma.workAssignment.findMany({
    where: {
      ...(r.workerId ? { workerId: r.workerId } : {}),
      work: { deletedAt: null, workDate: { gte: toDbDate(from), lte: toDbDate(to) }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    },
    select: {
      workerId: true,
      assignedAt: true,
      removedAt: true,
      worker: { select: { name: true } },
      work: { select: { id: true, status: true, completions: { select: { submittedById: true, createdAt: true }, orderBy: { createdAt: "asc" } }, reviews: { select: { decision: true } } } },
    },
    take: 50_000,
  });
  const coms = await prisma.commission.groupBy({
    by: ["userId"],
    where: { type: "WORKER", status: { not: "CANCELLED" }, work: { workDate: { gte: toDbDate(from), lte: toDbDate(to) }, ...(branchIds ? { branchId: { in: branchIds } } : {}) } },
    _sum: { amount: true },
  });
  const map = new Map<string, WorkerPerf & { hours: number[] }>();
  for (const a of assignments) {
    if (a.removedAt) continue; // removed before finishing — not their job
    const p = map.get(a.workerId) ?? { workerId: a.workerId, name: a.worker.name, assigned: 0, completed: 0, rejections: 0, firstTimeRight: 0, avgCompletionHours: null, commission: 0, hours: [] };
    p.assigned++;
    const rejected = a.work.reviews.filter((x) => x.decision === "REJECTED").length;
    if (DONE.includes(a.work.status)) {
      p.completed++;
      if (rejected === 0) p.firstTimeRight++;
    }
    p.rejections += rejected;
    const first = a.work.completions[0];
    if (first) p.hours.push((first.createdAt.getTime() - a.assignedAt.getTime()) / 3_600_000);
    map.set(a.workerId, p);
  }
  return [...map.values()]
    .map(({ hours, ...p }) => ({
      ...p,
      firstTimeRight: p.completed ? p.firstTimeRight / p.completed : 0,
      avgCompletionHours: hours.length ? Math.round((hours.reduce((x, y) => x + y, 0) / hours.length) * 10) / 10 : null,
      commission: toPaise(coms.find((c) => c.userId === p.workerId)?._sum.amount?.toString() ?? "0"),
    }))
    .sort((x, y) => y.completed - x.completed);
}

// ───────────────────────────── Time series for graphs ─────────────────────────────

export interface MonthRow {
  month: string; // YYYY-MM
  revenue: number;
  received: number;
  expenses: number;
  salaries: number;
  commissions: number;
  materials: number;
  net: number;
}

/** Monthly money flows (management P&L, see header). */
export async function monthlyFinance(actor: Actor, r: Partial<Range>): Promise<MonthRow[]> {
  return monthlyFinanceScoped(resolveScope(actor, r));
}

async function monthlyFinanceScoped({ from, to, branchIds }: { from: string; to: string; branchIds: string[] | null }): Promise<MonthRow[]> {
  const f = toDbDate(from);
  const t = toDbDate(to);
  const tz = businessTz();
  type Row = { m: string; v: Prisma.Decimal | null };
  const [rev, rec, exp, sal, com, mat] = await Promise.all([
    prisma.$queryRaw<Row[]>`SELECT to_char("invoiceDate", 'YYYY-MM') m, SUM("taxableTotal") v FROM "Invoice"
      WHERE "status" <> 'CANCELLED' AND "invoiceDate" BETWEEN ${f} AND ${t} ${branchSql(`"branchId"`, branchIds)} GROUP BY 1`,
    prisma.$queryRaw<Row[]>`SELECT to_char(p."paidOn", 'YYYY-MM') m, SUM(p."amount") v FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId"
      WHERE p."voidedAt" IS NULL AND p."paidOn" BETWEEN ${f} AND ${t} ${branchSql(`i."branchId"`, branchIds)} GROUP BY 1`,
    prisma.$queryRaw<Row[]>`SELECT to_char("spentOn", 'YYYY-MM') m, SUM("amount") v FROM "Expense"
      WHERE "status" = 'ACTIVE' AND "spentOn" BETWEEN ${f} AND ${t} ${branchIds === null ? Prisma.empty : Prisma.sql`AND ("branchId" IS NULL OR "branchId" IN (${Prisma.join(branchIds.length ? branchIds : ["-"])}))`} GROUP BY 1`,
    // Salaries are company-level unless filtering one branch: then staff of that branch.
    prisma.$queryRaw<Row[]>`SELECT to_char(s."paidOn", 'YYYY-MM') m, SUM(s."amount") v FROM "SalaryPayment" s
      WHERE s."voidedAt" IS NULL AND s."paidOn" BETWEEN ${f} AND ${t}
      ${branchIds === null ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM "UserBranch" ub WHERE ub."userId" = s."userId" AND ub."branchId" IN (${Prisma.join(branchIds.length ? branchIds : ["-"])}))`}
      GROUP BY 1`,
    prisma.$queryRaw<Row[]>`SELECT to_char(c."approvedAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(c."amount") v FROM "Commission" c JOIN "Work" w ON w."id" = c."workId"
      WHERE c."status" IN ('APPROVED','PAID') AND (c."approvedAt" AT TIME ZONE ${tz})::date BETWEEN ${f} AND ${t} ${branchSql(`w."branchId"`, branchIds)} GROUP BY 1`,
    prisma.$queryRaw<Row[]>`SELECT to_char(m."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(-m."change" * COALESCE(m."unitCost", 0)) v FROM "StockMovement" m
      WHERE m."workId" IS NOT NULL AND (m."createdAt" AT TIME ZONE ${tz})::date BETWEEN ${f} AND ${t} ${branchSql(`m."branchId"`, branchIds)} GROUP BY 1`,
  ]);
  const months: string[] = [];
  for (let d = from.slice(0, 7); d <= to.slice(0, 7); ) {
    months.push(d);
    const [y, m] = d.split("-").map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  const val = (rows: Row[], m: string) => Math.round(Number(rows.find((x) => x.m === m)?.v ?? 0) * 100);
  return months.map((m) => {
    const row = { month: m, revenue: val(rev, m), received: val(rec, m), expenses: val(exp, m), salaries: val(sal, m), commissions: val(com, m), materials: val(mat, m) };
    return { ...row, net: row.revenue - row.expenses - row.salaries - row.commissions - row.materials };
  });
}

export async function worksPerDay(actor: Actor, r: Partial<Range>) {
  const { from, to, branchIds } = resolveScope(actor, r);
  const rows = await prisma.work.groupBy({
    by: ["workDate"],
    where: { deletedAt: null, status: { not: "CANCELLED" }, workDate: { gte: toDbDate(from), lte: toDbDate(to) }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    _count: { _all: true },
  });
  const map = new Map(rows.map((x) => [fromDbDate(x.workDate), x._count._all]));
  const out: { date: string; works: number }[] = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDaysIso(d, 1), i++) out.push({ date: d, works: map.get(d) ?? 0 });
  return out;
}

export async function worksByStatus(actor: Actor, r: Partial<Range>) {
  const { from, to, branchIds } = resolveScope(actor, r);
  const rows = await prisma.work.groupBy({
    by: ["status"],
    where: { deletedAt: null, workDate: { gte: toDbDate(from), lte: toDbDate(to) }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    _count: { _all: true },
  });
  return rows.map((x) => ({ status: x.status, count: x._count._all }));
}

export async function branchPerformance(actor: Actor, r: Partial<Range>) {
  const { from, to, branchIds } = resolveScope(actor, { ...r, branchId: undefined });
  const branches = await prisma.branch.findMany({ where: { deletedAt: null, ...(branchIds ? { id: { in: branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return Promise.all(
    branches.map(async (b) => {
      const [works, completed, fin] = await Promise.all([
        prisma.work.count({ where: { branchId: b.id, deletedAt: null, status: { not: "CANCELLED" }, workDate: { gte: toDbDate(from), lte: toDbDate(to) } } }),
        prisma.work.count({ where: { branchId: b.id, deletedAt: null, status: { in: DONE }, workDate: { gte: toDbDate(from), lte: toDbDate(to) } } }),
        monthlyFinanceScoped({ from, to, branchIds: [b.id] }), // b is one of the actor's branches
      ]);
      const sum = (k: keyof MonthRow) => fin.reduce((a, m) => a + (m[k] as number), 0);
      return { branchId: b.id, name: b.name, works, completed, revenue: sum("revenue"), received: sum("received"), expenses: sum("expenses") + sum("salaries") + sum("commissions") + sum("materials"), net: sum("net") };
    }),
  );
}

export async function inventoryMovementByMonth(actor: Actor, r: Partial<Range>) {
  const { from, to, branchIds } = resolveScope(actor, r);
  const tz = businessTz();
  const rows = await prisma.$queryRaw<{ m: string; inv: Prisma.Decimal | null; outv: Prisma.Decimal | null }[]>`
    SELECT to_char(m."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM') m,
           SUM(CASE WHEN m."change" > 0 AND m."type" IN ('IN') THEN m."change" * COALESCE(m."unitCost", i."purchasePrice", 0) ELSE 0 END) inv,
           SUM(CASE WHEN m."change" < 0 AND m."type" IN ('OUT','DAMAGED') THEN -m."change" * COALESCE(m."unitCost", i."purchasePrice", 0) ELSE 0 END) outv
    FROM "StockMovement" m JOIN "Item" i ON i."id" = m."itemId"
    WHERE (m."createdAt" AT TIME ZONE ${tz})::date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)} ${branchSql(`m."branchId"`, branchIds)}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((x) => ({ month: x.m, stockIn: Math.round(Number(x.inv ?? 0) * 100), stockOut: Math.round(Number(x.outv ?? 0) * 100) }));
}
