import type { Portal } from "@prisma/client";
import { AppError, forbidden } from "../lib/errors";
import type { PermissionKey } from "./permissions";

/**
 * The authenticated user as seen by services. Every service function takes an
 * Actor so business rules and permissions are enforced server-side, regardless
 * of which UI (or API) called it.
 */
export interface Actor {
  id: string;
  name: string;
  roleKey: string;
  portal: Portal;
  isSuperAdmin: boolean;
  permissions: ReadonlySet<string>;
  /** Branch ids the user may access. Ignored for Super Admin (all branches). */
  branchIds: readonly string[];
  ip?: string | null;
  userAgent?: string | null;
}

export function can(actor: Actor, perm: PermissionKey): boolean {
  return actor.isSuperAdmin || actor.permissions.has(perm);
}

export function canAny(actor: Actor, ...perms: PermissionKey[]): boolean {
  return perms.some((p) => can(actor, p));
}

export function requirePermission(actor: Actor, perm: PermissionKey, msg?: string): void {
  if (!can(actor, perm)) throw forbidden(msg);
}

export function canAccessBranch(actor: Actor, branchId: string): boolean {
  return actor.isSuperAdmin || actor.branchIds.includes(branchId);
}

export function requireBranch(actor: Actor, branchId: string): void {
  if (!canAccessBranch(actor, branchId)) {
    throw new AppError("FORBIDDEN", "You do not have access to this branch.");
  }
}

/** Prisma `where` fragment restricting rows to the actor's branches. */
export function branchScope(actor: Actor): { branchId?: { in: string[] } } {
  return actor.isSuperAdmin ? {} : { branchId: { in: [...actor.branchIds] } };
}
