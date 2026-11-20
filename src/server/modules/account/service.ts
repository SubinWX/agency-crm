/** A signed-in user's own profile: details, password and picture. */
import { z } from "zod";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { invalid, parseInput } from "../../lib/errors";
import { hashPassword, passwordPolicyError, verifyPassword } from "../../auth/password";
import type { Actor } from "../../rbac/actor";
import { storeImage, type UploadInput } from "../../storage";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(20).regex(/^[0-9+\-\s()]*$/, "Enter a valid phone number").optional(),
  gender: z.enum(["MALE", "FEMALE"]).or(z.literal("")).optional(),
});

export async function getOwnProfile(actor: Actor) {
  return prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { id: true, name: true, email: true, phone: true, photoUrl: true, gender: true, updatedAt: true, lastLoginAt: true, createdAt: true, role: { select: { name: true } }, branches: { select: { branch: { select: { name: true } } } } },
  });
}

export async function updateOwnProfile(actor: Actor, input: { name: string; phone?: string; gender?: string }) {
  const d = parseInput(profileSchema, input);
  await transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true, phone: true } });
    await tx.user.update({ where: { id: actor.id }, data: { name: d.name, phone: d.phone || null, ...(d.gender !== undefined ? { gender: d.gender || null } : {}) } });
    await audit(tx, actor, { action: "account.profile_update", entityType: "User", entityId: actor.id, before, after: { name: d.name, phone: d.phone || null } });
  });
}

/** Requires the current password; signs out every other session. */
export async function changeOwnPassword(actor: Actor, input: { current: string; next: string; confirm: string }, keepSessionId?: string) {
  if (input.next !== input.confirm) throw invalid("The new passwords don't match.");
  const err = passwordPolicyError(input.next);
  if (err) throw invalid(err);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(input.current, u.passwordHash))) throw invalid("Your current password is not correct.");
  if (input.current === input.next) throw invalid("Choose a password different from the current one.");
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(input.next) } });
    await tx.session.deleteMany({ where: { userId: actor.id, ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}) } });
    await audit(tx, actor, { action: "account.password_change", entityType: "User", entityId: actor.id });
  });
}

export async function setOwnPhoto(actor: Actor, file: UploadInput | null, remove = false) {
  let key: string | null = null;
  if (!remove) {
    if (!file || file.size === 0) throw invalid("Choose a picture.");
    if (file.size > 5 * 1024 * 1024) throw invalid("Picture is too large (max 5 MB).");
    key = (await storeImage(file, "avatars", { maxEdge: 512, square: true })).storageKey;
  }
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { photoUrl: key } });
    await audit(tx, actor, { action: remove ? "account.photo_remove" : "account.photo_change", entityType: "User", entityId: actor.id });
  });
}
