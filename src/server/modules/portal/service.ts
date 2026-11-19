/**
 * Customer Portal (spec §43). Customers sign in at /portal/login with a login
 * created by the office, and see ONLY their own works, invoices, payments,
 * outstanding balance, completion photos (if allowed) and support requests.
 *
 * Queries here are written separately from the staff ones on purpose: they
 * select only customer-safe fields (no agent commission, internal comments,
 * worker phone numbers, image history, audit data…).
 */
import type { WorkStatus } from "@prisma/client";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { forbidden, invalid, notFound } from "../../lib/errors";
import { hashPassword, passwordPolicyError } from "../../auth/password";
import { requirePermission, type Actor } from "../../rbac/actor";
import { toPaise } from "../billing/calc";
import { getSetting } from "../settings/service";

/** Customer-friendly status wording. */
export const CUSTOMER_STATUS: Record<WorkStatus, string> = {
  DRAFT: "Received",
  SUBMITTED: "Received",
  SCHEDULED: "Scheduled",
  ASSIGNED: "Scheduled",
  IN_PROGRESS: "In progress",
  WORKER_COMPLETED: "Completed — under review",
  PENDING_APPROVAL: "Completed — under review",
  APPROVED: "Completed",
  INVOICED: "Completed",
  PAYMENT_PENDING: "Completed",
  PAID: "Completed",
  CLOSED: "Completed",
  CANCELLED: "Cancelled",
};
const COMPLETED: WorkStatus[] = ["APPROVED", "INVOICED", "PAYMENT_PENDING", "PAID", "CLOSED"];

export async function currentCustomer(actor: Actor) {
  if (actor.portal !== "CUSTOMER") throw forbidden();
  const c = await prisma.customer.findFirst({ where: { userId: actor.id, deletedAt: null }, select: { id: true, name: true, phone: true, email: true, address: true } });
  if (!c) throw forbidden("Your login is not linked to a customer record.");
  return c;
}

export async function portalOverview(actor: Actor) {
  const customer = await currentCustomer(actor);
  const settings = await getSetting("customerPortal");
  const [works, invoices, payments] = await Promise.all([
    prisma.work.findMany({
      where: { customerId: customer.id, deletedAt: null },
      orderBy: { workDate: "desc" },
      take: 100,
      select: { id: true, reference: true, title: true, workDate: true, status: true, locationAddress: true },
    }),
    prisma.invoice.findMany({
      where: { customerId: customer.id, status: { not: "CANCELLED" } },
      orderBy: { invoiceDate: "desc" },
      take: 100,
      select: { id: true, number: true, invoiceDate: true, dueDate: true, grandTotal: true, amountPaid: true, balanceDue: true, status: true, work: { select: { reference: true } } },
    }),
    settings.showPayments
      ? prisma.payment.findMany({
          where: { voidedAt: null, invoice: { customerId: customer.id } },
          orderBy: { paidOn: "desc" },
          take: 100,
          select: { id: true, number: true, paidOn: true, amount: true, method: true, invoice: { select: { number: true } } },
        })
      : Promise.resolve([]),
  ]);
  const outstanding = invoices.reduce((a, i) => a + toPaise(i.balanceDue.toString()), 0);
  return { customer, works, invoices, payments, outstanding, settings };
}

export async function portalWork(actor: Actor, workId: string) {
  const customer = await currentCustomer(actor);
  const settings = await getSetting("customerPortal");
  const w = await prisma.work.findFirst({
    where: { id: workId, customerId: customer.id, deletedAt: null },
    select: {
      id: true,
      reference: true,
      title: true,
      description: true,
      workDate: true,
      status: true,
      locationAddress: true,
      approvedAt: true,
      branch: { select: { name: true, phone: true } },
      invoices: { where: { status: { not: "CANCELLED" } }, select: { id: true, number: true, grandTotal: true, balanceDue: true, status: true } },
      images: {
        where: { kind: "COMPLETION", status: "ACTIVE" },
        select: { versions: { where: { isCurrent: true }, select: { id: true, createdAt: true } } },
      },
    },
  });
  if (!w) throw notFound("Work");
  const completed = COMPLETED.includes(w.status);
  // Completion photos only after the office approved the work, and only if enabled.
  const photos = settings.showCompletionImages && completed ? w.images.flatMap((i) => i.versions) : [];
  return { work: { ...w, images: undefined }, photos, completed };
}

/** File access for a customer: current completion photo of their approved work. */
export async function portalPhoto(actor: Actor, versionId: string) {
  const customer = await currentCustomer(actor);
  const settings = await getSetting("customerPortal");
  if (!settings.showCompletionImages) throw notFound("File");
  const v = await prisma.workImageVersion.findFirst({
    where: { id: versionId, isCurrent: true, image: { kind: "COMPLETION", status: "ACTIVE", work: { customerId: customer.id, deletedAt: null, status: { in: COMPLETED } } } },
  });
  if (!v) throw notFound("File");
  return v;
}

/** Invoice for PDF download — own, non-cancelled only. */
export async function portalInvoiceId(actor: Actor, invoiceId: string) {
  const customer = await currentCustomer(actor);
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, customerId: customer.id, status: { not: "CANCELLED" } }, select: { id: true } });
  if (!inv) throw notFound("Invoice");
  return inv.id;
}

// ───────────────────────────── Office: manage portal access ─────────────────────────────

export async function portalAccessFor(customerId: string) {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { user: { select: { id: true, email: true, status: true, lastLoginAt: true } } } });
  return c?.user ?? null;
}

/** Create (or re-enable with a new password) a customer's portal login. */
export async function grantPortalAccess(actor: Actor, customerId: string, input: { email: string; password: string }) {
  requirePermission(actor, "customers.edit");
  requirePermission(actor, "users.manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid("Enter a valid email for the customer's login.");
  const err = passwordPolicyError(input.password);
  if (err) throw invalid(err);
  return transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!c) throw notFound("Customer");
    if (c.branchId && !actor.isSuperAdmin && !actor.branchIds.includes(c.branchId)) throw forbidden();
    const role = await tx.role.findUniqueOrThrow({ where: { key: "customer" } });
    const clash = await tx.user.findFirst({ where: { email, NOT: c.userId ? { id: c.userId } : undefined } });
    if (clash) throw invalid("Another login already uses this email.");
    const passwordHash = await hashPassword(input.password);
    if (c.userId) {
      await tx.user.update({ where: { id: c.userId }, data: { email, passwordHash, status: "ACTIVE", name: c.name, phone: c.phone } });
      await tx.session.deleteMany({ where: { userId: c.userId } });
    } else {
      const u = await tx.user.create({ data: { email, passwordHash, name: c.name, phone: c.phone, roleId: role.id } });
      await tx.customer.update({ where: { id: c.id }, data: { userId: u.id } });
    }
    await audit(tx, actor, { action: "customer.portal_grant", entityType: "Customer", entityId: c.id, after: { email } });
  });
}

export async function revokePortalAccess(actor: Actor, customerId: string) {
  requirePermission(actor, "customers.edit");
  requirePermission(actor, "users.manage");
  await transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId } });
    if (!c?.userId) throw notFound("Portal login");
    await tx.user.update({ where: { id: c.userId }, data: { status: "INACTIVE" } });
    await tx.session.deleteMany({ where: { userId: c.userId } });
    await audit(tx, actor, { action: "customer.portal_revoke", entityType: "Customer", entityId: c.id });
  });
}
