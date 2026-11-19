/**
 * Notification events (spec §40, §56). Each event lists the {variables} its
 * templates may use and default wording per channel. Admins edit the wording
 * in Settings → Notifications → Templates; these are only the starting point.
 */
import type { NotificationChannel } from "@prisma/client";

export const COMMON_VARS = ["recipient_name", "company_name", "link", "title", "message"] as const;

type Defaults = { subject: string; body: string; enabled: boolean };
export interface EventDef {
  key: string;
  label: string;
  vars: string[];
  /** Offer "also send to customer" for this event. */
  customerFacing?: boolean;
  defaultSendToCustomer?: boolean;
  defaults: Record<NotificationChannel, Defaults>;
}

const std = (subject: string, body: string, short = body, on: Partial<Record<NotificationChannel, boolean>> = {}): Record<NotificationChannel, Defaults> => ({
  EMAIL: { subject, body: `Hello {recipient_name},\n\n${body}\n\nOpen: {link}\n\n— {company_name}`, enabled: on.EMAIL ?? true },
  SMS: { subject: "", body: `${short} - {company_name}`, enabled: on.SMS ?? false },
  WHATSAPP: { subject: "", body: `Hello {recipient_name}, ${short}`, enabled: on.WHATSAPP ?? true },
});

export const EVENTS: EventDef[] = [
  {
    key: "work.created",
    label: "New work added",
    vars: ["work_id", "date", "customer_name", "agent_name", "branch"],
    defaults: std("New work {work_id} for {date}", "{agent_name} added work {work_id} for {customer_name} on {date} ({branch})."),
  },
  {
    key: "work.assigned",
    label: "Work assigned to worker",
    vars: ["work_id", "date", "customer_name", "location"],
    defaults: std("Work {work_id} assigned to you", "Work {work_id} has been assigned to you for {date}. Location: {location}."),
  },
  {
    key: "work.unassigned",
    label: "Worker removed from work",
    vars: ["work_id", "reason"],
    defaults: std("Removed from {work_id}", "You have been removed from work {work_id}. Reason: {reason}.", undefined, { WHATSAPP: false }),
  },
  {
    key: "work.date_changed",
    label: "Work date changed",
    vars: ["work_id", "old_date", "new_date", "reason", "customer_name"],
    customerFacing: true,
    defaults: std("{work_id} moved to {new_date}", "Work {work_id} has been moved from {old_date} to {new_date}. Reason: {reason}."),
  },
  {
    key: "work.updated",
    label: "Work details updated",
    vars: ["work_id", "changes", "reason", "editor_name"],
    defaults: std("{work_id} was updated", "{editor_name} updated {changes} on work {work_id}. Reason: {reason}.", undefined, { WHATSAPP: false }),
  },
  {
    key: "slot.full",
    label: "Date is fully booked",
    vars: ["date", "capacity"],
    defaults: std("{date} is fully booked", "All {capacity} slots for {date} are now booked. New works must use another date.", undefined, { WHATSAPP: false }),
  },
  {
    key: "work.completed",
    label: "Worker marked work completed",
    vars: ["work_id", "worker_name"],
    defaults: std("{work_id} is waiting for approval", "{worker_name} marked work {work_id} as completed. Please review and approve."),
  },
  {
    key: "work.approved",
    label: "Completion approved",
    vars: ["work_id", "comment", "customer_name"],
    customerFacing: true,
    defaults: std("{work_id} approved", "Work {work_id} has been approved. {comment}"),
  },
  {
    key: "work.rejected",
    label: "Completion rejected / correction needed",
    vars: ["work_id", "reason"],
    defaults: std("Correction needed on {work_id}", "Work {work_id} needs correction: {reason}"),
  },
  {
    key: "work.cancelled",
    label: "Work cancelled",
    vars: ["work_id", "reason"],
    defaults: std("{work_id} cancelled", "Work {work_id} has been cancelled. Reason: {reason}."),
  },
  {
    key: "invoice.generated",
    label: "Invoice generated",
    vars: ["invoice_number", "amount", "work_id", "due_date", "customer_name"],
    customerFacing: true,
    defaultSendToCustomer: true,
    defaults: std("Invoice {invoice_number}", "Invoice {invoice_number} for {amount} has been generated for work {work_id}. Due by {due_date}."),
  },
  {
    key: "payment.received",
    label: "Payment received",
    vars: ["amount", "invoice_number", "work_id", "method", "balance", "customer_name"],
    customerFacing: true,
    defaultSendToCustomer: true,
    defaults: std("Payment received for {invoice_number}", "Payment of {amount} received for invoice {invoice_number}. Balance due: {balance}."),
  },
  {
    key: "commission.updated",
    label: "Commission approved / paid",
    vars: ["work_id", "amount", "status"],
    defaults: std("Commission {status} for {work_id}", "Your commission of {amount} for work {work_id} is now {status}."),
  },
  {
    key: "support.ticket_created",
    label: "New support ticket",
    vars: ["ticket_id", "title", "priority", "submitter_name", "category"],
    defaults: std("New ticket {ticket_id}: {title}", "{submitter_name} raised {priority} ticket {ticket_id} ({category}): {title}", undefined, { WHATSAPP: false }),
  },
  {
    key: "support.ticket_assigned",
    label: "Support ticket assigned",
    vars: ["ticket_id", "title", "priority"],
    defaults: std("Ticket {ticket_id} assigned to you", "Support ticket {ticket_id} ({priority}) has been assigned to you: {title}"),
  },
  {
    key: "support.ticket_update",
    label: "Support ticket update",
    vars: ["ticket_id", "status", "update"],
    defaults: std("Ticket {ticket_id}: {status}", "Your support ticket {ticket_id} is now {status}. {update}"),
  },
];

export const EVENT_KEYS = EVENTS.map((e) => e.key);
export const getEvent = (key: string) => EVENTS.find((e) => e.key === key);
export const CHANNELS: NotificationChannel[] = ["EMAIL", "SMS", "WHATSAPP"];
export const CHANNEL_LABELS: Record<NotificationChannel, string> = { EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp" };
