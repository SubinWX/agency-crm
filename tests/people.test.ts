import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { getPerson, listPeople, savePerson } from "@/server/modules/people/service";
import { saveUser } from "@/server/modules/users/service";
import { actor, branch } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

describe("agents and workers", () => {
  it("adds a worker with branch, location and joining date and lists them", async () => {
    const admin = await actor("admin@crm.test");
    const north = await branch("NORTH");
    const email = `w-${uniq()}@example.com`;
    const w = await savePerson(admin, "WORKER", { name: "Kiran Fitter", email, phone: "+91 90000 31313", branchIds: [north.id], status: "ACTIVE", password: "Password123", address: "Ollur, Thrissur", joiningDate: "2026-11-01", emergencyContact: "Asha 9000011111" });
    const row = (await listPeople(admin, "WORKER", { q: "Ollur" })).find((r) => r.id === w.id)!;
    expect(row.staffProfile?.address).toBe("Ollur, Thrissur");
    expect(row.branches.map((b) => b.branch.name)).toEqual(["North Branch"]);
    const role = await prisma.user.findUniqueOrThrow({ where: { id: w.id }, include: { role: true } });
    expect(role.role.key).toBe("worker");
    expect((await getPerson(admin, "WORKER", w.id)).joiningDate).toBe("2026-11-01");
    // Workers don't show up in the agent list.
    expect(await code(getPerson(admin, "AGENT", w.id))).toBe("NOT_FOUND");
  });

  it("adds an agent with a personal commission rate (kept in rate history)", async () => {
    const sa = await actor("superadmin@crm.test");
    const a = await savePerson(sa, "AGENT", { name: "Biju Broker", email: `a-${uniq()}@example.com`, phone: "+91 90000 41414", branchIds: [(await branch("MAIN")).id], status: "ACTIVE", password: "Password123", address: "Aluva", commissionPercent: "6.5" });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(Number(u.commissionPercent)).toBe(6.5);
    expect(await prisma.commissionRateHistory.count({ where: { scope: `user:${a.id}` } })).toBe(1);
  });

  it("requires a branch and a phone, and respects branch access", async () => {
    const admin = await actor("admin@crm.test");
    const base = { name: "X", email: `x-${uniq()}@example.com`, phone: "+91 90000 51515", status: "ACTIVE" as const, password: "Password123" };
    expect(await code(savePerson(admin, "WORKER", { ...base, branchIds: [] }))).toBe("VALIDATION");
    expect(await code(savePerson(admin, "WORKER", { ...base, phone: "", branchIds: [(await branch("MAIN")).id] }))).toBe("VALIDATION");

    const sa = await actor("superadmin@crm.test");
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
    const email = `main-only-${uniq()}@crm.test`;
    await saveUser(sa, { name: "Main Only", email, roleId: adminRole.id, branchIds: [(await branch("MAIN")).id], password: "Password123" });
    const mainOnly = await actor(email);
    expect(await code(savePerson(mainOnly, "WORKER", { ...base, email: `y-${uniq()}@example.com`, branchIds: [(await branch("NORTH")).id] }))).toBe("FORBIDDEN");
    const staff = await actor("staff@crm.test");
    expect(await code(listPeople(staff, "AGENT"))).toBe("FORBIDDEN");
  });
});
