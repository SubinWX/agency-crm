/**
 * Company-wide daily work capacity.
 *
 * RULES (spec §8, §61, §69):
 *  - Capacity is company-wide (all branches combined), never per branch.
 *  - Nobody — Agent, Staff, Admin or Super Admin — can book above capacity. There is no override.
 *  - Admin/Super Admin can change the capacity value itself (audited).
 *
 * CONCURRENCY: every booking runs `lockDate()` inside its transaction. That
 * upserts a WorkDay row for the date and takes `SELECT … FOR UPDATE` on it, so
 * all bookings for the same date are serialised by PostgreSQL. The count is
 * taken *after* the lock, so two requests racing for the last slot cannot both
 * succeed.
 */
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { addDaysIso, businessToday, formatDateLabel, fromDbDate, isIsoDate, toDbDate } from "../../lib/dates";
import { AppError, invalid } from "../../lib/errors";
import { requirePermission, type Actor } from "../../rbac/actor";
import { getSetting, renderTemplate } from "../settings/service";

/** Statuses that do NOT consume a slot. */
export const NON_BOOKING_STATUSES = ["CANCELLED"] as const;

export type DayStatus = "available" | "full" | "blocked" | "past";

export interface DayAvailability {
  date: string;
  capacity: number;
  booked: number;
  remaining: number;
  status: DayStatus;
  blockReason?: string | null;
}

export async function getCapacity(tx: Tx = prisma): Promise<number> {
  const row = await tx.capacitySetting.findUnique({ where: { id: 1 } });
  if (!row) throw new AppError("INVALID_STATE", "Daily capacity has not been configured yet.");
  return row.maxPerDay;
}

async function countBooked(tx: Tx, iso: string): Promise<number> {
  return tx.work.count({
    where: { workDate: toDbDate(iso), deletedAt: null, status: { notIn: [...NON_BOOKING_STATUSES] } },
  });
}

/** Availability for every date in [from, to] (inclusive, max 92 days). */
export async function getAvailability(from: string, to: string, tx: Tx = prisma): Promise<DayAvailability[]> {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw invalid("Invalid date range.");
  const capacity = await getCapacity(tx);
  const today = businessToday();

  const [counts, blocked] = await Promise.all([
    tx.work.groupBy({
      by: ["workDate"],
      where: {
        workDate: { gte: toDbDate(from), lte: toDbDate(to) },
        deletedAt: null,
        status: { notIn: [...NON_BOOKING_STATUSES] },
      },
      _count: { _all: true },
    }),
    tx.workDay.findMany({
      where: { date: { gte: toDbDate(from), lte: toDbDate(to) }, isBlocked: true },
    }),
  ]);
  const countByDate = new Map(counts.map((c) => [fromDbDate(c.workDate), c._count._all]));
  const blockByDate = new Map(blocked.map((b) => [fromDbDate(b.date), b.blockReason]));

  const days: DayAvailability[] = [];
  for (let d = from, i = 0; d <= to && i < 92; d = addDaysIso(d, 1), i++) {
    const booked = countByDate.get(d) ?? 0;
    const remaining = Math.max(capacity - booked, 0);
    let status: DayStatus = remaining > 0 ? "available" : "full";
    if (blockByDate.has(d)) status = "blocked";
    if (d < today) status = "past";
    days.push({ date: d, capacity, booked, remaining, status, blockReason: blockByDate.get(d) ?? null });
  }
  return days;
}

/** Next `count` bookable dates on or after `from` (searches up to 120 days ahead). */
export async function getNextAvailableDates(from: string, count = 3, tx: Tx = prisma): Promise<string[]> {
  const start = from < businessToday() ? businessToday() : from;
  const result: string[] = [];
  for (let offset = 0; offset < 120 && result.length < count; offset += 30) {
    const chunkStart = addDaysIso(start, offset);
    const days = await getAvailability(chunkStart, addDaysIso(chunkStart, 29), tx);
    for (const d of days) {
      if (d.status === "available") result.push(d.date);
      if (result.length >= count) break;
    }
  }
  return result;
}

/**
 * Lock `iso` for booking and verify a slot is free. MUST be called inside a
 * transaction, immediately before inserting/moving the work.
 * Throws a friendly CAPACITY_FULL / DATE_BLOCKED error otherwise.
 */
export async function lockDateForBooking(tx: Tx, iso: string): Promise<void> {
  if (!isIsoDate(iso)) throw invalid("Please select a valid date.");
  if (iso < businessToday()) throw invalid("Works cannot be scheduled on a past date.");

  await tx.$executeRaw`INSERT INTO "WorkDay" ("date", "isBlocked", "updatedAt")
    VALUES (${iso}::date, false, now()) ON CONFLICT ("date") DO NOTHING`;
  const [day] = await tx.$queryRaw<{ isBlocked: boolean; blockReason: string | null }[]>`
    SELECT "isBlocked", "blockReason" FROM "WorkDay" WHERE "date" = ${iso}::date FOR UPDATE`;

  if (day.isBlocked) {
    const next = await getNextAvailableDates(addDaysIso(iso, 1), 3, tx);
    const { template } = await getSetting("blockedDateMessage", tx);
    throw new AppError(
      "DATE_BLOCKED",
      renderTemplate(template, {
        date: formatDateLabel(iso),
        reason: day.blockReason || "date blocked",
        next_available_dates: next.map(formatDateLabel).join(", ") || "none in the next few months",
      }),
      { date: iso, nextAvailableDates: next },
    );
  }

  const capacity = await getCapacity(tx);
  const booked = await countBooked(tx, iso);
  if (booked >= capacity) {
    const next = await getNextAvailableDates(addDaysIso(iso, 1), 3, tx);
    const { template } = await getSetting("fullSlotMessage", tx);
    throw new AppError(
      "CAPACITY_FULL",
      renderTemplate(template, {
        date: formatDateLabel(iso),
        capacity,
        booked_count: booked,
        remaining_slots: Math.max(capacity - booked, 0),
        next_available_dates: next.map(formatDateLabel).join(", ") || "none in the next few months",
      }),
      { date: iso, capacity, booked, nextAvailableDates: next },
    );
  }
}

/** Change the company-wide capacity (audited, with history). */
export async function changeCapacity(actor: Actor, newValue: number, reason?: string): Promise<void> {
  requirePermission(actor, "capacity.manage");
  if (!Number.isInteger(newValue) || newValue < 0 || newValue > 10_000) {
    throw invalid("Capacity must be a whole number between 0 and 10,000.");
  }
  await transaction(async (tx) => {
    const current = await tx.capacitySetting.findUnique({ where: { id: 1 } });
    await tx.capacitySetting.upsert({
      where: { id: 1 },
      create: { id: 1, maxPerDay: newValue, updatedById: actor.id },
      update: { maxPerDay: newValue, updatedById: actor.id },
    });
    await tx.capacityHistory.create({
      data: { oldValue: current?.maxPerDay ?? null, newValue, reason: reason || null, changedById: actor.id },
    });
    await audit(tx, actor, {
      action: "capacity.change",
      entityType: "CapacitySetting",
      entityId: "1",
      before: { maxPerDay: current?.maxPerDay ?? null },
      after: { maxPerDay: newValue },
      reason,
    });
  });
}

/** Block / unblock a date (holidays). Architecture for spec §54. */
export async function setDateBlocked(actor: Actor, iso: string, blocked: boolean, reason?: string): Promise<void> {
  requirePermission(actor, "capacity.manage");
  if (!isIsoDate(iso)) throw invalid("Invalid date.");
  if (blocked && !reason?.trim()) throw invalid("Please give a reason for blocking this date.");
  await transaction(async (tx) => {
    const before = await tx.workDay.findUnique({ where: { date: toDbDate(iso) } });
    await tx.workDay.upsert({
      where: { date: toDbDate(iso) },
      create: { date: toDbDate(iso), isBlocked: blocked, blockReason: blocked ? reason : null },
      update: { isBlocked: blocked, blockReason: blocked ? reason : null },
    });
    await audit(tx, actor, {
      action: blocked ? "calendar.block_date" : "calendar.unblock_date",
      entityType: "WorkDay",
      entityId: iso,
      before: before ? { isBlocked: before.isBlocked, blockReason: before.blockReason } : null,
      after: { isBlocked: blocked, blockReason: blocked ? reason : null },
      reason,
    });
  });
}

export async function getCapacityHistory(limit = 20) {
  return prisma.capacityHistory.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
