import type { Prisma } from "@prisma/client";
import type { Tx } from "../db";
import type { Actor } from "../rbac/actor";

export interface AuditEntry {
  action: string; // e.g. work.create, capacity.change
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const json = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Append-only audit log. Always call inside the same transaction as the change. */
export async function audit(tx: Tx, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason ?? null,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent ?? null,
    },
  });
}
