import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { saveUser } from "@/server/modules/users/service";
import { addReply, createTicket, getAttachment, getTicket, listTickets, requesterAction, updateTicket } from "@/server/modules/support/service";
import { actor, branch, png } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}
async function category(name = "Payment / invoice") {
  return prisma.supportCategory.findFirstOrThrow({ where: { name } });
}
async function newTicket(email = "agent@crm.test", extra: Record<string, unknown> = {}) {
  const a = await actor(email);
  return createTicket(a, { title: "Commission not shown", description: "My commission for last week is missing.", categoryId: (await category()).id, priority: "HIGH", ...extra });
}

describe("support tickets", () => {
  it("lets agents, workers and staff raise tickets; managers are notified", async () => {
    const t = await newTicket("agent@crm.test", { attachments: [png("screen.png")] });
    expect(t.number).toMatch(/^SUP-\d{6}$/);
    expect(t.status).toBe("OPEN");
    await newTicket("worker1@crm.test");
    await newTicket("staff@crm.test");
    const admin = await actor("admin@crm.test");
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "support.ticket_created", link: `/support/${t.id}` } })).toBe(1);
    expect(await prisma.supportAttachment.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it("shows requesters only their own tickets", async () => {
    const t = await newTicket("agent@crm.test");
    for (const who of ["agent2@crm.test", "worker1@crm.test", "staff@crm.test"]) {
      expect(await code(getTicket(await actor(who), t.id))).toBe("NOT_FOUND");
    }
    const list = await listTickets(await actor("agent2@crm.test"), { view: "all" });
    expect(list.view).toBe("mine");
    expect(list.items.every((i) => i.submittedById === (list.items[0]?.submittedById ?? i.submittedById))).toBe(true);
    expect(list.items.find((i) => i.id === t.id)).toBeUndefined();
  });

  it("keeps internal notes and internal files away from the requester", async () => {
    const t = await newTicket();
    const admin = await actor("admin@crm.test");
    const agent = await actor("agent@crm.test");
    await addReply(admin, t.id, { body: "Checked ledger, agent was paid late.", internal: true, attachments: [png("ledger.png")] });
    await addReply(admin, t.id, { body: "We are looking into it." });
    expect(await code(addReply(agent, t.id, { body: "x", internal: true }))).toBe("FORBIDDEN");

    const mine = await getTicket(agent, t.id);
    expect(mine.ticket.comments.map((c) => c.body)).toEqual(["We are looking into it."]);
    const internalFile = await prisma.supportAttachment.findFirstOrThrow({ where: { ticketId: t.id, isInternal: true } });
    expect(await code(getAttachment(agent, internalFile.id))).toBe("NOT_FOUND");
    await expect(getAttachment(admin, internalFile.id)).resolves.toBeTruthy();

    const view = await getTicket(admin, t.id);
    expect(view.ticket.comments).toHaveLength(2);
    expect(view.ticket.status).toBe("IN_REVIEW"); // first public manager reply
  });

  it("runs assign → waiting → user reply → resolve → close, with history and notifications", async () => {
    const t = await newTicket();
    const admin = await actor("admin@crm.test");
    const sa = await actor("superadmin@crm.test");
    const agent = await actor("agent@crm.test");

    expect(await code(updateTicket(agent, t.id, { status: "CLOSED" }))).toBe("FORBIDDEN");
    expect(await code(updateTicket(admin, t.id, { assignedToId: agent.id }))).toBe("VALIDATION"); // not a manager

    await updateTicket(admin, t.id, { assignedToId: sa.id, priority: "URGENT", status: "IN_PROGRESS" });
    expect(await prisma.notification.count({ where: { userId: sa.id, type: "support.ticket_assigned", link: `/support/${t.id}` } })).toBe(1);

    await updateTicket(sa, t.id, { status: "WAITING_FOR_USER" });
    await addReply(agent, t.id, { body: "Week of 10 Nov." });
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_REVIEW");

    expect(await code(updateTicket(sa, t.id, { status: "RESOLVED" }))).toBe("VALIDATION"); // resolution required
    await updateTicket(sa, t.id, { status: "RESOLVED", resolution: "Commission approved and paid." });
    expect(await prisma.notification.count({ where: { userId: agent.id, type: "support.ticket_update", link: `/support/${t.id}` } })).toBeGreaterThan(0);

    await updateTicket(admin, t.id, { status: "CLOSED" }); // admins can close
    const done = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
    expect([done.status, done.closedById, done.resolution]).toEqual(["CLOSED", admin.id, "Commission approved and paid."]);
    expect(done.closedAt).not.toBeNull();

    expect(await code(addReply(agent, t.id, { body: "thanks" }))).toBe("INVALID_STATE");
    expect(await code(requesterAction(agent, t.id, "reopen", "again"))).toBe("INVALID_STATE");
    expect(await code(updateTicket(admin, t.id, { status: "IN_REVIEW" }))).toBe("VALIDATION"); // reason needed to reopen closed
    await updateTicket(admin, t.id, { status: "IN_REVIEW", reason: "Agent reported again" });

    const actions = (await prisma.supportTicketEvent.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["created", "assigned", "priority", "status", "resolved", "closed", "reopened"]));
  });

  it("lets the requester confirm or reopen a resolved ticket", async () => {
    const admin = await actor("admin@crm.test");
    const agent = await actor("agent@crm.test");
    const a = await newTicket();
    await updateTicket(admin, a.id, { status: "RESOLVED", resolution: "Fixed" });
    expect(await code(requesterAction(agent, a.id, "reopen", ""))).toBe("VALIDATION");
    await requesterAction(agent, a.id, "reopen", "Still missing");
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("IN_REVIEW");
    await updateTicket(admin, a.id, { status: "RESOLVED", resolution: "Fixed properly" });
    await requesterAction(agent, a.id, "close");
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CLOSED");
  });

  it("limits managers to their branches", async () => {
    const sa = await actor("superadmin@crm.test");
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
    const main = await branch("MAIN");
    const north = await branch("NORTH");
    const email = `main-admin-${Date.now()}@crm.test`;
    await saveUser(sa, { name: "Main Admin", email, roleId: adminRole.id, branchIds: [main.id], password: "Password123" });
    const mainAdmin = await actor(email);
    const w1 = await actor("worker1@crm.test"); // in both branches → must choose
    const northTicket = await createTicket(w1, { title: "North cutter broken", description: "Blade cracked today", categoryId: (await category("Equipment / material")).id, branchId: north.id });
    expect(await code(getTicket(mainAdmin, northTicket.id))).toBe("NOT_FOUND");
    expect(await code(updateTicket(mainAdmin, northTicket.id, { status: "IN_PROGRESS" }))).toBe("NOT_FOUND");
    expect(await code(updateTicket(sa, northTicket.id, { assignedToId: mainAdmin.id }))).toBe("VALIDATION"); // not in North
  });

  it("validates input", async () => {
    const agent = await actor("agent@crm.test");
    expect(await code(createTicket(agent, { title: "x", description: "too short", categoryId: (await category()).id }))).toBe("VALIDATION");
    expect(await code(createTicket(agent, { title: "Valid title", description: "Long enough text", categoryId: "nope" }))).toBe("VALIDATION");
  });
});
