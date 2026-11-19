import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { updateCustomer } from "@/server/modules/customers/service";
import { getImageVersionForDownload, replaceWorkImage } from "@/server/modules/works/images";
import { getWorkDetail, listWorks } from "@/server/modules/works/queries";
import {
  addComment, approveWork, assignWorkers, createWork, editWork, rejectWork, removeWorker, submitCompletion,
} from "@/server/modules/works/service";
import { saveUser } from "@/server/modules/users/service";
import { actor, branch, freshDate, png, requiredCustom } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

async function newAgentWork(branchCode: "MAIN" | "NORTH" = "MAIN") {
  const agent = await actor("agent@crm.test");
  const b = await branch(branchCode);
  return createWork(agent, {
    branchId: b.id,
    workDate: freshDate(),
    newCustomer: { name: "Test Customer", phone: "+91 99999 00000" },
    locationAddress: "Location A",
    customValues: { ...requiredCustom, slab_color: "White" },
    images: [png("site.png")],
  });
}

describe("agent work creation & editing", () => {
  it("creates a work with reference, custom values, image and SUBMITTED status", async () => {
    const w = await newAgentWork();
    expect(w.reference).toMatch(/^WRK-\d{6}$/);
    expect(w.status).toBe("SUBMITTED");
    const values = await prisma.customFieldValue.findMany({ where: { workId: w.id }, include: { field: true } });
    expect(Object.fromEntries(values.map((v) => [v.field.key, v.value]))).toMatchObject({ width: 10, height: 4.5, slab_color: "White" });
  });

  it("validates required and dropdown custom fields", async () => {
    const agent = await actor("agent@crm.test");
    const b = await branch("MAIN");
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Ravi Kumar" } });
    const e = await createWork(agent, { branchId: b.id, workDate: freshDate(), customerId: c.id, customValues: { width: "1", slab_color: "Pink" } }).catch((x) => x);
    expect(e.code).toBe("VALIDATION");
    expect(e.details.fieldErrors).toHaveProperty("height");
    expect(e.details.fieldErrors).toHaveProperty("slab_color");
  });

  it("records location changes with previous value, new value and reason", async () => {
    const w = await newAgentWork();
    const agent = await actor("agent@crm.test");
    await editWork(agent, w.id, { locationAddress: "Location B", reason: "Customer moved site" });
    const ch = await prisma.workFieldChange.findFirstOrThrow({ where: { workId: w.id, field: "locationAddress" } });
    expect(ch).toMatchObject({ oldValue: "Location A", newValue: "Location B", reason: "Customer moved site", changedById: agent.id });
    expect(await code(editWork(agent, w.id, { locationAddress: "C", reason: "" }))).toBe("VALIDATION");
  });

  it("stops agents editing protected customer info and other agents' works", async () => {
    const w = await newAgentWork();
    const agent = await actor("agent@crm.test");
    expect(await code(updateCustomer(agent, w.customerId, { name: "Renamed", phone: "+91 99999 00000" }))).toBe("FORBIDDEN");
    const agent2 = await actor("agent2@crm.test");
    expect(await code(editWork(agent2, w.id, { locationAddress: "X", reason: "r" }))).toBe("NOT_FOUND");
  });

  it("keeps previous images on replacement and hides them from agents", async () => {
    const w = await newAgentWork();
    const agent = await actor("agent@crm.test");
    const img = await prisma.workImage.findFirstOrThrow({ where: { workId: w.id }, include: { versions: true } });
    const v1 = img.versions[0];

    expect(await code(replaceWorkImage(agent, img.id, png("v2.png"), ""))).toBe("VALIDATION");
    const v2 = await replaceWorkImage(agent, img.id, png("v2.png"), "Customer requested a clearer location image");

    const versions = await prisma.workImageVersion.findMany({ where: { imageId: img.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.isCurrent])).toEqual([[1, false], [2, true]]);
    expect(versions[1]).toMatchObject({ reason: "Customer requested a clearer location image", uploadedById: agent.id });

    // Agent sees current only; super admin can open the previous version.
    expect(await code(getImageVersionForDownload(agent, v1.id))).toBe("NOT_FOUND");
    await expect(getImageVersionForDownload(agent, v2.id)).resolves.toBeTruthy();
    const sa = await actor("superadmin@crm.test");
    await expect(getImageVersionForDownload(sa, v1.id)).resolves.toBeTruthy();
    const detail = await getWorkDetail(sa, w.id);
    expect(detail.images[0].previous).toHaveLength(1);
  });
});

describe("workers, completion and approval", () => {
  it("runs assign (multiple) → complete → reject → re-complete → approve", async () => {
    const w = await newAgentWork();
    const admin = await actor("admin@crm.test");
    const w1 = await actor("worker1@crm.test");
    const w2 = await actor("worker2@crm.test");

    // Workers can't see it before assignment.
    expect(await code(getWorkDetail(w1, w.id))).toBe("NOT_FOUND");

    await assignWorkers(admin, w.id, [w1.id, w2.id]);
    expect((await prisma.work.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ASSIGNED");
    expect(await prisma.notification.count({ where: { userId: w1.id, type: "work.assigned" } })).toBeGreaterThan(0);

    // Completion needs a photo; worker can't approve.
    expect(await code(submitCompletion(w1, w.id, { images: [] }))).toBe("VALIDATION");
    await submitCompletion(w1, w.id, { message: "Done", description: "Fitted slab", images: [png()] });
    expect((await prisma.work.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("PENDING_APPROVAL");
    expect(await code(approveWork(w1, w.id))).toBe("FORBIDDEN");

    await rejectWork(admin, w.id, "Edge polishing incomplete");
    expect((await prisma.work.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("IN_PROGRESS");
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: w2.id, type: "work.rejected" } });
    expect(note.body).toBe("Edge polishing incomplete");

    await submitCompletion(w2, w.id, { message: "Polished", images: [png()] });
    await approveWork(admin, w.id, "Looks good");
    const done = await prisma.work.findUniqueOrThrow({ where: { id: w.id } });
    expect(done.status).toBe("APPROVED");
    expect(done.approvedById).toBe(admin.id);

    const detail = await getWorkDetail(admin, w.id);
    expect(detail.timeline.some((t) => t.kind === "review" && t.detail === "Edge polishing incomplete")).toBe(true);
  });

  it("keeps assignment history when a worker is removed", async () => {
    const w = await newAgentWork();
    const admin = await actor("admin@crm.test");
    const w1 = await actor("worker1@crm.test");
    await assignWorkers(admin, w.id, [w1.id]);
    await removeWorker(admin, w.id, w1.id, "Reassigned");
    const rows = await prisma.workAssignment.findMany({ where: { workId: w.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].removeReason).toBe("Reassigned");
    expect(await code(submitCompletion(w1, w.id, { images: [png()] }))).not.toBe(undefined);
  });

  it("only assigns workers who belong to the work's branch", async () => {
    const w = await newAgentWork("NORTH");
    const admin = await actor("admin@crm.test");
    const w2 = await actor("worker2@crm.test"); // MAIN only
    expect(await code(assignWorkers(admin, w.id, [w2.id]))).toBe("VALIDATION");
  });
});

describe("access control", () => {
  it("isolates branches: MAIN staff cannot see NORTH works", async () => {
    const w = await newAgentWork("NORTH");
    const staff = await actor("staff@crm.test");
    expect(await code(getWorkDetail(staff, w.id))).toBe("NOT_FOUND");
    const list = await listWorks(staff, { pageSize: 100 });
    expect(list.items.find((i) => i.id === w.id)).toBeUndefined();
  });

  it("agents only see their own works", async () => {
    const w = await newAgentWork();
    const agent2 = await actor("agent2@crm.test");
    expect(await code(getWorkDetail(agent2, w.id))).toBe("NOT_FOUND");
    expect(await code(addComment(agent2, w.id, "hi"))).toBe("NOT_FOUND");
  });

  it("prevents admins escalating anyone to Super Admin", async () => {
    const admin = await actor("admin@crm.test");
    const sa = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
    expect(
      await code(saveUser(admin, { name: "X", email: "x@crm.test", roleId: sa.id, password: "Password123", branchIds: [] })),
    ).toBe("FORBIDDEN");
  });

  it("writes an audit trail for work creation", async () => {
    const w = await newAgentWork();
    expect(await prisma.auditLog.count({ where: { entityId: w.id, action: "work.create" } })).toBe(1);
  });
});
