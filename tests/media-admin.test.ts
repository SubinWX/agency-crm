import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { saveBranch } from "@/server/modules/branches/service";
import { listWorks } from "@/server/modules/works/queries";
import { saveUser } from "@/server/modules/users/service";
import { assertSafeSvg, optimizeImage, storeFile, storeLogo, type UploadInput } from "@/server/storage";
import { actor } from "./helpers";

const upload = (buf: Buffer, name: string, type = "image/jpeg"): UploadInput => ({
  name,
  type,
  size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer,
});

async function bigPhoto() {
  // 4000×3000 noisy JPEG with EXIF-like metadata — a typical phone photo.
  const raw = Buffer.alloc(400 * 300 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 255;
  return sharp(raw, { raw: { width: 400, height: 300, channels: 3 } }).resize(4000, 3000).jpeg({ quality: 95 }).withMetadata().toBuffer();
}

describe("image optimisation", () => {
  it("shrinks big photos to WebP within the size limit and strips metadata", async () => {
    const jpg = await bigPhoto();
    const o = await optimizeImage(jpg, "image/jpeg", { maxEdge: 2000 });
    const meta = await sharp(o.buf).metadata();
    expect(o.mime).toBe("image/webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    expect(o.buf.length).toBeLessThan(jpg.length / 2);
    expect(meta.exif).toBeUndefined();
  });

  it("makes square avatars and keeps the original when it can't be decoded", async () => {
    const o = await optimizeImage(await bigPhoto(), "image/jpeg", { maxEdge: 512, square: true });
    const meta = await sharp(o.buf).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50)]);
    expect((await optimizeImage(broken, "image/jpeg")).buf).toBe(broken);
  });

  it("stores uploads optimised with a matching file name", async () => {
    const f = await storeFile(upload(await bigPhoto(), "site photo.JPG"), "test");
    expect(f.mimeType).toBe("image/webp");
    expect(f.originalName).toBe("site photo.webp");
  });
});

describe("SVG logos", () => {
  const good = Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#0f1b3d"/><text x="10" y="26" fill="#fff">AC</text></svg>`);

  it("accepts a clean SVG and creates a PNG copy for PDFs", async () => {
    const keys = await storeLogo(upload(good, "logo.svg", "image/svg+xml"));
    expect(keys.logoKey).toMatch(/^branding\/.+\.svg$/);
    expect(keys.logoPdfKey).toMatch(/^branding\/.+\.png$/);
  });

  it("rejects SVGs that could run code or load external content", () => {
    const bad = [
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>`,
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>`,
    ];
    for (const b of bad) expect(() => assertSafeSvg(Buffer.from(b)), b).toThrow(AppError);
    expect(() => assertSafeSvg(good)).not.toThrow();
  });
});

describe("Super Admin full access", () => {
  it("links Super Admins to every branch, including new ones", async () => {
    const sa = await actor("superadmin@crm.test");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
    const email = `sa-${Date.now()}@crm.test`;
    const u = await saveUser(sa, { name: "Second SA", email, roleId: role.id, branchIds: [], password: "Password123" });
    const all = await prisma.branch.count({ where: { deletedAt: null } });
    expect(await prisma.userBranch.count({ where: { userId: u.id } })).toBe(all);

    const b = await saveBranch(sa, { name: `Branch ${Date.now()}`, code: `B${Date.now().toString(36).slice(-6).toUpperCase()}` });
    expect(await prisma.userBranch.count({ where: { userId: u.id, branchId: b.id } })).toBe(1);
  });
});

describe("works list filters", () => {
  it("filters by agent and worker and sorts by date", async () => {
    const sa = await actor("superadmin@crm.test");
    const agent = await actor("agent@crm.test");
    const all = await listWorks(sa, { agentId: agent.id, pageSize: 100, sort: "date_asc" });
    expect(all.items.every((w) => w.agent?.name === "Anil Agent")).toBe(true);
    const dates = all.items.map((w) => w.workDate.getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    const w1 = await actor("worker1@crm.test");
    const byWorker = await listWorks(sa, { workerId: w1.id, pageSize: 100 });
    expect(byWorker.items.every((w) => w.assignments.some((a) => a.worker.name === "Wasim Worker"))).toBe(true);
  });
});
