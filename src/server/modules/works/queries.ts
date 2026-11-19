import type { Prisma, WorkStatus } from "@prisma/client";
import { prisma } from "../../db";
import { addDaysIso, businessToday, isIsoDate, toDbDate } from "../../lib/dates";
import { notFound } from "../../lib/errors";
import { can, type Actor } from "../../rbac/actor";
import { STATUS_LABELS, workAccessWhere } from "./access";

export interface WorkFilters {
  q?: string;
  status?: string;
  date?: string;
  from?: string;
  to?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
}

export async function listWorks(actor: Actor, f: WorkFilters = {}) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, f.pageSize ?? 20));
  const and: Prisma.WorkWhereInput[] = [workAccessWhere(actor)];
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q } } },
        { locationAddress: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (f.status && f.status in STATUS_LABELS) and.push({ status: f.status as WorkStatus });
  if (f.date && isIsoDate(f.date)) and.push({ workDate: toDbDate(f.date) });
  if (f.from && isIsoDate(f.from)) and.push({ workDate: { gte: toDbDate(f.from) } });
  if (f.to && isIsoDate(f.to)) and.push({ workDate: { lte: toDbDate(f.to) } });
  if (f.branchId) and.push({ branchId: f.branchId });
  const where: Prisma.WorkWhereInput = { AND: and };

  const [items, total] = await Promise.all([
    prisma.work.findMany({
      where,
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        reference: true,
        workDate: true,
        status: true,
        title: true,
        locationAddress: true,
        customer: { select: { name: true, phone: true } },
        branch: { select: { name: true } },
        agent: { select: { name: true } },
        assignments: { where: { removedAt: null }, select: { worker: { select: { name: true } } } },
      },
    }),
    prisma.work.count({ where }),
  ]);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type TimelineEvent = {
  at: Date;
  kind: "status" | "change" | "comment" | "assign" | "unassign" | "completion" | "review" | "image";
  actor: string;
  text: string;
  detail?: string | null;
};

/** Full work detail for the actor, including a merged activity timeline. */
export async function getWorkDetail(actor: Actor, workId: string) {
  const work = await prisma.work.findFirst({
    where: { id: workId, AND: [workAccessWhere(actor)] },
    include: {
      customer: true,
      branch: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, phone: true } },
      customValues: { include: { field: true } },
      images: { include: { versions: { orderBy: { version: "desc" } } }, orderBy: { createdAt: "asc" } },
      assignments: { orderBy: { assignedAt: "asc" }, include: { worker: { select: { id: true, name: true, phone: true } } } },
      comments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      changes: { orderBy: { createdAt: "asc" } },
      completions: { orderBy: { createdAt: "asc" } },
      reviews: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!work) throw notFound("Work");

  const canSeeHistory = can(actor, "works.view_image_history");
  const userIds = new Set<string>([
    ...work.comments.map((c) => c.authorId),
    ...work.statusHistory.map((s) => s.changedById),
    ...work.changes.map((c) => c.changedById),
    ...work.completions.map((c) => c.submittedById),
    ...work.reviews.map((r) => r.reviewedById),
    ...work.assignments.flatMap((a) => [a.assignedById, a.removedById ?? ""]),
    ...work.images.flatMap((i) => i.versions.map((v) => v.uploadedById)),
  ]);
  userIds.delete("");
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
  const name = (id?: string | null) => users.find((u) => u.id === id)?.name ?? "System";

  const timeline: TimelineEvent[] = [
    ...work.statusHistory.map((s) => ({
      at: s.createdAt,
      kind: "status" as const,
      actor: name(s.changedById),
      text: s.fromStatus ? `Status: ${STATUS_LABELS[s.fromStatus]} → ${STATUS_LABELS[s.toStatus]}` : `Work created (${STATUS_LABELS[s.toStatus]})`,
      detail: s.reason,
    })),
    ...work.changes
      .filter((c) => c.field !== "image" && c.field !== "image_removed")
      .map((c) => ({
        at: c.createdAt,
        kind: "change" as const,
        actor: name(c.changedById),
        text: `${c.field === "workDate" ? "Date" : c.field.replace(/^custom:/, "")} changed: ${fmt(c.oldValue)} → ${fmt(c.newValue)}`,
        detail: c.reason ? `Reason: ${c.reason}` : null,
      })),
    ...work.comments.map((c) => ({ at: c.createdAt, kind: "comment" as const, actor: name(c.authorId), text: "Comment", detail: c.body })),
    ...work.assignments.flatMap((a) => [
      { at: a.assignedAt, kind: "assign" as const, actor: name(a.assignedById), text: `Assigned ${a.worker.name}` },
      ...(a.removedAt
        ? [{ at: a.removedAt, kind: "unassign" as const, actor: name(a.removedById), text: `Removed ${a.worker.name}`, detail: a.removeReason }]
        : []),
    ]),
    ...work.completions.map((c) => ({
      at: c.createdAt,
      kind: "completion" as const,
      actor: name(c.submittedById),
      text: "Marked work completed",
      detail: [c.message, c.description].filter(Boolean).join(" — ") || null,
    })),
    ...work.reviews.map((r) => ({
      at: r.createdAt,
      kind: "review" as const,
      actor: name(r.reviewedById),
      text: r.decision === "APPROVED" ? "Approved completion" : "Requested correction",
      detail: r.comment,
    })),
    ...work.images.flatMap((img) =>
      img.versions
        .filter((v) => v.version > 1)
        .map((v) => ({ at: v.createdAt, kind: "image" as const, actor: name(v.uploadedById), text: `Replaced image (v${v.version})`, detail: v.reason })),
    ),
    ...work.images
      .filter((i) => i.status === "REMOVED" && i.removedAt)
      .map((i) => ({ at: i.removedAt!, kind: "image" as const, actor: name(i.removedById), text: "Removed image", detail: i.removeReason })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const images = work.images
    .filter((i) => canSeeHistory || i.status === "ACTIVE")
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      caption: i.caption,
      status: i.status,
      removeReason: i.removeReason,
      completionId: i.completionId,
      current: i.versions.find((v) => v.isCurrent) ?? null,
      previous: canSeeHistory
        ? i.versions.filter((v) => !v.isCurrent).map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt, by: name(v.uploadedById), reason: v.reason }))
        : [],
      currentBy: name(i.versions.find((v) => v.isCurrent)?.uploadedById),
    }));

  return {
    work,
    images,
    timeline,
    authorName: name,
    activeWorkers: work.assignments.filter((a) => !a.removedAt).map((a) => a.worker),
    commentsWithAuthors: work.comments.map((c) => ({ ...c, author: name(c.authorId) })),
    lastRejection: [...work.reviews].reverse().find((r) => r.decision === "REJECTED") ?? null,
  };
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Admin dashboard counters (branch-scoped). */
export async function dashboardStats(actor: Actor) {
  const scope = workAccessWhere(actor);
  const today = businessToday();
  const weekEnd = addDaysIso(today, 7);
  const [todayCount, upcoming, pending, completedMonth, byStatus] = await Promise.all([
    prisma.work.count({ where: { AND: [scope, { workDate: toDbDate(today), status: { not: "CANCELLED" } }] } }),
    prisma.work.count({ where: { AND: [scope, { workDate: { gt: toDbDate(today), lte: toDbDate(weekEnd) }, status: { not: "CANCELLED" } }] } }),
    prisma.work.count({ where: { AND: [scope, { status: "PENDING_APPROVAL" }] } }),
    prisma.work.count({ where: { AND: [scope, { status: "APPROVED", approvedAt: { gte: toDbDate(today.slice(0, 8) + "01") } }] } }),
    prisma.work.groupBy({ by: ["status"], where: { AND: [scope] }, _count: { _all: true } }),
  ]);
  return { today, todayCount, upcoming, pending, completedMonth, byStatus };
}
