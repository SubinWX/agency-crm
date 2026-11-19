/**
 * Notifications. Phase 1 delivers in-app only. Phase 4 adds channel adapters
 * (WhatsApp / SMS / Email) behind the same `notify()` call, queued to a
 * background worker so requests never wait on providers.
 */
import type { NotificationChannel, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../../db";
import { getSetting, renderTemplate } from "../settings/service";
import { enabledChannels, ensureTemplates } from "./config";
import { getEvent } from "./events";
import { toE164 } from "./providers";

export interface NotifyInput {
  userIds: string[];
  type: string; // event key: work.assigned, work.rejected, …
  title: string;
  body: string;
  link?: string;
  /** Event-specific template variables ({work_id}, {date}, …). */
  vars?: Record<string, string | number | null | undefined>;
  /** Work's customer — receives the message when the template allows it. */
  customerId?: string | null;
}

/**
 * Notify users in-app and queue external messages (Email / SMS / WhatsApp)
 * for every channel that has an enabled provider and an enabled template.
 * Runs inside the caller's transaction (outbox pattern): if the business
 * change rolls back, no message is sent. A background worker does the sending.
 */
export async function notify(tx: Tx, input: NotifyInput): Promise<void> {
  const ids = [...new Set(input.userIds)].filter(Boolean);
  if (ids.length) {
    await tx.notification.createMany({
      data: ids.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body, link: input.link })),
    });
  }
  await queueExternal(tx, { ...input, userIds: ids });
}

type Recipient = { userId?: string; customerId?: string; name: string; email: string | null; phone: string | null };

async function queueExternal(tx: Tx, input: NotifyInput) {
  if (!getEvent(input.type)) return; // not a configurable event
  const channels = await enabledChannels(tx);
  if (channels.size === 0) return;
  await ensureTemplates(tx);
  const templates = await tx.notificationTemplate.findMany({ where: { event: input.type, enabled: true, channel: { in: [...channels] } } });
  if (templates.length === 0) return;

  const users = input.userIds.length
    ? await tx.user.findMany({ where: { id: { in: input.userIds }, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, email: true, phone: true } })
    : [];
  const userRecipients: Recipient[] = users.map((u) => ({ userId: u.id, name: u.name, email: u.email, phone: u.phone }));
  let customer: Recipient | null = null;
  if (input.customerId && templates.some((t) => t.sendToCustomer)) {
    const c = await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true } });
    if (c) customer = { customerId: c.id, name: c.name, email: c.email, phone: c.phone };
  }

  const company = await getSetting("company", tx);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const commonVars = {
    company_name: company.name,
    link: input.link ? `${base}${input.link}` : base,
    title: input.title,
    message: input.body,
    ...Object.fromEntries(Object.entries(input.vars ?? {}).map(([k, v]) => [k, v ?? ""])),
  };

  const rows: Prisma.NotificationDeliveryCreateManyInput[] = [];
  for (const t of templates) {
    const recipients = [...userRecipients, ...(t.sendToCustomer && customer ? [customer] : [])];
    for (const r of recipients) {
      const vars = { ...commonVars, recipient_name: r.name };
      const to = addressFor(t.channel, r);
      rows.push({
        event: input.type,
        channel: t.channel,
        userId: r.userId ?? null,
        customerId: r.customerId ?? null,
        recipientName: r.name,
        to,
        subject: t.subject ? renderTemplate(t.subject, vars) : null,
        body: renderTemplate(t.body, vars),
        status: to ? "QUEUED" : "SKIPPED",
        error: to ? null : t.channel === "EMAIL" ? "No deliverable email address" : "No valid phone number",
      });
    }
  }
  if (rows.length) await tx.notificationDelivery.createMany({ data: rows });
}

function addressFor(channel: NotificationChannel, r: Recipient): string | null {
  if (channel === "EMAIL") return r.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) && !r.email.endsWith(".test") ? r.email : null;
  return toE164(r.phone);
}

/** Users who can approve completions (for "work completed" alerts). */
export async function approverIds(tx: Tx, branchId: string): Promise<string[]> {
  const users = await tx.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        { role: { isSuperAdmin: true } },
        {
          role: { permissions: { some: { permission: { key: "works.approve" } } } },
          branches: { some: { branchId } },
        },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
