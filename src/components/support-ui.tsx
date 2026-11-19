import type { TicketPriority, TicketStatus } from "@prisma/client";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/server/modules/support/service";

const STATUS: Record<TicketStatus, string> = {
  OPEN: "bg-sky-100 text-sky-800",
  IN_REVIEW: "bg-indigo-100 text-indigo-800",
  IN_PROGRESS: "bg-amber-100 text-amber-800",
  WAITING_FOR_USER: "bg-orange-100 text-orange-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-700",
};
const PRIORITY: Record<TicketPriority, string> = {
  LOW: "text-slate-500",
  MEDIUM: "text-sky-700",
  HIGH: "text-orange-700",
  URGENT: "text-red-700 font-semibold",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[status]}`}>{STATUS_LABELS[status]}</span>;
}
export function PriorityLabel({ priority }: { priority: TicketPriority }) {
  return <span className={`text-xs ${PRIORITY[priority]}`}>● {PRIORITY_LABELS[priority]}</span>;
}
