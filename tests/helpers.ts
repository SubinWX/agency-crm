import { prisma } from "@/server/db";
import { loadActor } from "@/server/rbac/load-actor";
import { setStorageProvider, type UploadInput } from "@/server/storage";
import type { Actor } from "@/server/rbac/actor";

// In-memory storage so tests don't write files.
const files = new Map<string, Buffer>();
setStorageProvider({
  async put(key, data) { files.set(key, data); },
  async get(key) { const f = files.get(key); if (!f) throw new Error("missing"); return f; },
});

export async function actor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  const a = await loadActor(u.id);
  if (!a) throw new Error("no actor");
  return a;
}

export async function branch(code: "MAIN" | "NORTH") {
  return prisma.branch.findUniqueOrThrow({ where: { code } });
}

/** A minimal valid PNG-signature upload. */
export function png(name = "photo.png"): UploadInput {
  const buf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  return { name, type: "image/png", size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer };
}

export const requiredCustom = { width: "10", height: "4.5" };

// Random base per run (years 2031–2080) so repeated runs never share dates.
let dayCounter = Math.floor(Math.random() * 18_000);
/** A unique future date per call so tests never share capacity. */
export function freshDate(): string {
  dayCounter += 1;
  const d = new Date(Date.UTC(2031, 0, 1) + dayCounter * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function setCapacity(n: number) {
  await prisma.capacitySetting.update({ where: { id: 1 }, data: { maxPerDay: n } });
}
