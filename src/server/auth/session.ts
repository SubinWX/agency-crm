/**
 * Database-backed sessions. A random 256-bit token lives in an httpOnly,
 * SameSite=Lax cookie; only its SHA-256 hash is stored, so a DB leak does not
 * expose usable tokens. Sessions can be revoked server-side (logout, password
 * change, deactivation).
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Portal } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { loadActor } from "../rbac/load-actor";
import type { Actor } from "../rbac/actor";
import type { PermissionKey } from "../rbac/permissions";
import { can } from "../rbac/actor";
import { dummyHash, verifyPassword } from "./password";
import { rateLimit, resetRateLimit } from "./rate-limit";

const COOKIE = "crm_session";
const SESSION_DAYS = 7;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const PORTAL_HOME: Record<Portal, string> = {
  ADMIN: "/admin",
  AGENT: "/agent",
  WORKER: "/worker",
  CUSTOMER: "/portal",
};
export const PORTAL_LOGIN: Record<Portal, string> = {
  ADMIN: "/login",
  AGENT: "/agent/login",
  WORKER: "/worker/login",
  CUSTOMER: "/portal/login",
};

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 300) || null,
  };
}

/**
 * Verify credentials for a specific portal. Each portal only accepts its own
 * roles (separate authentication per role group).
 */
export async function login(portal: Portal, emailRaw: string, password: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const meta = await requestMeta();
  const limitKey = `login:${meta.ip ?? "unknown"}:${email}`;
  const rl = rateLimit(limitKey, 5, 15 * 60_000);
  if (!rl.ok) {
    throw new AppError("RATE_LIMITED", `Too many attempts. Please try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`);
  }

  const user = await prisma.user.findFirst({ where: { email, deletedAt: null }, include: { role: true } });
  // Always run bcrypt to keep timing similar for unknown emails.
  const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !ok || user.status !== "ACTIVE" || user.role.portal !== portal) {
    await prisma.auditLog.create({
      data: { userId: user?.id ?? null, action: "auth.login_failed", entityType: "User", entityId: user?.id ?? null, after: { email, portal }, ip: meta.ip, userAgent: meta.userAgent },
    });
    throw new AppError("UNAUTHENTICATED", "Invalid email or password.");
  }
  resetRateLimit(limitKey);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.$transaction(async (tx) => {
    await tx.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt, ...meta } });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(tx, { id: user.id, ...meta } as Actor, { action: "auth.login", entityType: "User", entityId: user.id, after: { portal } });
  });

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
    if (s) {
      await prisma.session.delete({ where: { id: s.id } });
      await prisma.auditLog.create({ data: { userId: s.userId, action: "auth.logout", entityType: "User", entityId: s.userId } });
    }
  }
  jar.delete(COOKIE);
}

/** Current actor for this request (memoised per request). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.expiresAt < new Date()) return null;
  return loadActor(session.userId, await requestMeta());
});

/** Require a signed-in user of the given portal; otherwise redirect to that portal's login. */
export async function requirePortal(portal: Portal): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(PORTAL_LOGIN[portal]);
  if (actor.portal !== portal) redirect(PORTAL_HOME[actor.portal]);
  return actor;
}

/** For server actions: authenticated actor or a friendly error (no redirect). */
export async function actorOrThrow(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  return actor;
}

/** Page guard: portal + permission. */
export async function requirePagePermission(portal: Portal, perm: PermissionKey): Promise<Actor> {
  const actor = await requirePortal(portal);
  if (!can(actor, perm)) redirect(`${PORTAL_HOME[portal]}?denied=1`);
  return actor;
}

/** Any signed-in user (any portal) — used by the shared Support Portal. */
export async function requireUser(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/");
  return actor;
}
