import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { changeCapacity, getAvailability, setDateBlocked } from "@/server/modules/capacity/service";
import { updateSetting } from "@/server/modules/settings/service";
import { transaction } from "@/server/db";
import { cancelWork, changeWorkDate, createWork } from "@/server/modules/works/service";
import { actor, branch, freshDate, requiredCustom, setCapacity } from "./helpers";

async function customerId() {
  return (await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } })).id;
}

async function book(email: string, date: string) {
  const a = await actor(email);
  const b = await branch("MAIN");
  return createWork(a, { branchId: b.id, workDate: date, customerId: await customerId(), customValues: requiredCustom });
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

afterEach(async () => setCapacity(10));

describe("company-wide daily capacity", () => {
  it("blocks every role — agent, staff, admin and super admin — once a date is full", async () => {
    await setCapacity(2);
    const date = freshDate();
    await book("agent@crm.test", date);
    await book("admin@crm.test", date);
    for (const who of ["agent@crm.test", "staff@crm.test", "admin@crm.test", "superadmin@crm.test"]) {
      await expectCode(book(who, date), "CAPACITY_FULL");
    }
    expect(await prisma.work.count({ where: { workDate: new Date(`${date}T00:00:00Z`) } })).toBe(2);
  });

  it("counts both branches together (capacity is not per branch)", async () => {
    await setCapacity(2);
    const date = freshDate();
    const a = await actor("admin@crm.test");
    const north = await branch("NORTH");
    const thomas = await prisma.customer.findFirstOrThrow({ where: { name: "Thomas George" } });
    await createWork(a, { branchId: north.id, workDate: date, customerId: thomas.id, customValues: requiredCustom });
    await book("admin@crm.test", date); // MAIN
    await expectCode(book("admin@crm.test", date), "CAPACITY_FULL");
  });

  it("never exceeds capacity when many users race for the last slots", async () => {
    await setCapacity(3);
    const date = freshDate();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => book(["agent@crm.test", "staff@crm.test", "admin@crm.test"][i % 3], date)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const full = results.filter((r) => r.status === "rejected" && (r.reason as AppError).code === "CAPACITY_FULL");
    expect(ok).toHaveLength(3);
    expect(full).toHaveLength(9);
    expect(await prisma.work.count({ where: { workDate: new Date(`${date}T00:00:00Z`) } })).toBe(3);
  });

  it("shows a configurable full-slot message with variables and next available dates", async () => {
    await setCapacity(1);
    const date = freshDate();
    const sa = await actor("superadmin@crm.test");
    await transaction((tx) =>
      updateSetting(sa, "fullSlotMessage", { template: "FULL {date} cap={capacity} booked={booked_count} next={next_available_dates}" }, tx),
    );
    await book("agent@crm.test", date);
    const err = await expectCode(book("agent@crm.test", date), "CAPACITY_FULL");
    expect(err.message).toMatch(/^FULL \d+ \w+ \d{4} cap=1 booked=1 next=.+/);
    expect((err.details?.nextAvailableDates as string[]).length).toBeGreaterThan(0);
    expect((err.details?.nextAvailableDates as string[])).not.toContain(date);
  });

  it("lets admins change capacity itself, with history and audit", async () => {
    await setCapacity(1);
    const date = freshDate();
    await book("agent@crm.test", date);
    await expectCode(book("agent@crm.test", date), "CAPACITY_FULL");

    const admin = await actor("admin@crm.test");
    await changeCapacity(admin, 2, "Extra crew this week");
    await book("agent@crm.test", date); // now allowed

    const hist = await prisma.capacityHistory.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(hist).toMatchObject({ oldValue: 1, newValue: 2, reason: "Extra crew this week", changedById: admin.id });
    expect(await prisma.auditLog.count({ where: { action: "capacity.change", userId: admin.id } })).toBeGreaterThan(0);
  });

  it("does not let agents or workers change capacity", async () => {
    await expectCode(changeCapacity(await actor("agent@crm.test"), 50), "FORBIDDEN");
    await expectCode(changeCapacity(await actor("worker1@crm.test"), 50), "FORBIDDEN");
  });

  it("checks capacity when rescheduling and records old/new date + reason", async () => {
    await setCapacity(1);
    const full = freshDate();
    const free = freshDate();
    await book("agent@crm.test", full);
    const w = await book("agent@crm.test", free);
    const admin = await actor("admin@crm.test");

    await expectCode(changeWorkDate(admin, w.id, full, "Customer asked"), "CAPACITY_FULL");
    const other = freshDate();
    await changeWorkDate(admin, w.id, other, "Customer asked");
    const change = await prisma.workFieldChange.findFirstOrThrow({ where: { workId: w.id, field: "workDate" } });
    expect(change).toMatchObject({ oldValue: free, newValue: other, reason: "Customer asked", changedById: admin.id });
  });

  it("frees the slot when a work is cancelled", async () => {
    await setCapacity(1);
    const date = freshDate();
    const w = await book("agent@crm.test", date);
    await expectCode(book("agent@crm.test", date), "CAPACITY_FULL");
    await cancelWork(await actor("admin@crm.test"), w.id, "Customer cancelled");
    await book("agent@crm.test", date);
  });

  it("refuses blocked dates with the reason", async () => {
    const date = freshDate();
    await setDateBlocked(await actor("superadmin@crm.test"), date, true, "Onam holiday");
    const err = await expectCode(book("agent@crm.test", date), "DATE_BLOCKED");
    expect(err.message).toContain("Onam holiday");
    const [day] = await getAvailability(date, date);
    expect(day.status).toBe("blocked");
  });

  it("reports availability per date", async () => {
    await setCapacity(3);
    const date = freshDate();
    await book("agent@crm.test", date);
    const [day] = await getAvailability(date, date);
    expect(day).toMatchObject({ capacity: 3, booked: 1, remaining: 2, status: "available" });
  });

  it("rejects past dates", async () => {
    await expectCode(book("admin@crm.test", "2020-01-01"), "VALIDATION");
  });
});
