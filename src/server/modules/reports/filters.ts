import { prisma } from "../../db";
import { formatDateLabel } from "../../lib/dates";
import type { Filters, ReportDef } from "./definitions";

/** Human-readable summary of the applied filters (for PDF headers). */
export async function describeFilters(def: ReportDef, f: Filters): Promise<string> {
  const parts: string[] = [];
  if (def.filters.includes("date") && (f.from || f.to)) parts.push(`${def.dateLabel ?? "Date"}: ${f.from ? formatDateLabel(f.from) : "…"} – ${f.to ? formatDateLabel(f.to) : "today"}`);
  const name = async (id: string | undefined, kind: "branch" | "user" | "customer" | "item" | "category") => {
    if (!id) return null;
    if (kind === "branch") return (await prisma.branch.findUnique({ where: { id }, select: { name: true } }))?.name;
    if (kind === "user") return (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name;
    if (kind === "customer") return (await prisma.customer.findUnique({ where: { id }, select: { name: true } }))?.name;
    if (kind === "item") return (await prisma.item.findUnique({ where: { id }, select: { name: true } }))?.name;
    return (await prisma.expenseCategory.findUnique({ where: { id }, select: { name: true } }))?.name;
  };
  const b = await name(f.branchId, "branch");
  if (b) parts.push(`Branch: ${b}`);
  const a = await name(f.agentId, "user");
  if (a) parts.push(`Agent: ${a}`);
  const w = await name(f.workerId, "user");
  if (w) parts.push(`Worker: ${w}`);
  const c = await name(f.customerId, "customer");
  if (c) parts.push(`Customer: ${c}`);
  const i = await name(f.itemId, "item");
  if (i) parts.push(`Item: ${i}`);
  const cat = await name(f.categoryId, "category");
  if (cat) parts.push(`Category: ${cat}`);
  if (f.workStatus) parts.push(`Status: ${f.workStatus}`);
  if (f.paymentStatus) parts.push(`Payment: ${f.paymentStatus}`);
  return parts.join(" · ") || "All data you can access";
}
