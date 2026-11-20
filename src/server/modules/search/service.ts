/**
 * Global search (spec §39): customer name/phone, work ID, invoice number,
 * agent, worker, branch, product, staff, payment reference. Each section
 * respects the same permission and branch rules as its own page.
 */
import { prisma } from "../../db";
import { can, canAny, type Actor } from "../../rbac/actor";
import { canViewBilling, invoiceAccessWhere } from "../billing/invoices";
import { canViewInventory } from "../inventory/catalog";
import { workAccessWhere } from "../works/access";

export async function globalSearch(actor: Actor, raw: string) {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return null;
  const ci = { contains: q, mode: "insensitive" as const };
  const take = 8;
  const branchFilter = actor.isSuperAdmin ? {} : { id: { in: [...actor.branchIds] } };
  const [works, customers, invoices, payments, items, people, branches] = await Promise.all([
    prisma.work.findMany({
      where: { AND: [workAccessWhere(actor), { OR: [{ reference: ci }, { title: ci }, { customer: { name: ci } }, { customer: { phone: { contains: q } } }, { agent: { name: ci } }, { assignments: { some: { removedAt: null, worker: { name: ci } } } }] }] },
      select: { id: true, reference: true, title: true, status: true, customer: { select: { name: true } } },
      take,
      orderBy: { workDate: "desc" },
    }),
    can(actor, "customers.view")
      ? prisma.customer.findMany({
          where: { deletedAt: null, OR: [{ name: ci }, { phone: { contains: q } }, { altPhone: { contains: q } }, { email: ci }], ...(actor.isSuperAdmin ? {} : { AND: [{ OR: [{ branchId: null }, { branchId: { in: [...actor.branchIds] } }] }] }) },
          select: { id: true, name: true, phone: true },
          take,
        })
      : [],
    canViewBilling(actor)
      ? prisma.invoice.findMany({ where: { AND: [invoiceAccessWhere(actor), { OR: [{ number: ci }, { customer: { name: ci } }] }] }, select: { id: true, number: true, status: true, customer: { select: { name: true } } }, take })
      : [],
    can(actor, "payments.view")
      ? prisma.payment.findMany({ where: { invoice: invoiceAccessWhere(actor), OR: [{ number: ci }, { reference: ci }] }, select: { id: true, number: true, reference: true, invoiceId: true, invoice: { select: { number: true } } }, take })
      : [],
    canViewInventory(actor) ? prisma.item.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { code: ci }] }, select: { id: true, name: true, code: true, kind: true }, take }) : [],
    can(actor, "users.manage")
      ? prisma.user.findMany({
          where: { deletedAt: null, OR: [{ name: ci }, { email: ci }, { phone: { contains: q } }], ...(actor.isSuperAdmin ? {} : { branches: { some: { branchId: { in: [...actor.branchIds] } } } }) },
          select: { id: true, name: true, email: true, role: { select: { name: true } } },
          take,
        })
      : [],
    canAny(actor, "branches.manage", "works.view_all") ? prisma.branch.findMany({ where: { deletedAt: null, ...branchFilter, OR: [{ name: ci }, { code: ci }] }, select: { id: true, name: true, code: true }, take }) : [],
  ]);
  return { q, works, customers, invoices, payments, items, people, branches };
}
