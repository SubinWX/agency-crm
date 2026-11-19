"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/lib/errors";
import { addReply, createTicket, requesterAction, saveCategory, updateTicket } from "@/server/modules/support/service";
import type { UploadInput } from "@/server/storage";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const files = (fd: FormData, k: string) =>
  fd.getAll(k).filter((f) => typeof f === "object" && f !== null && (f as File).size > 0) as unknown as UploadInput[];

export async function createTicketAction(_p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () =>
    createTicket(await actorOrThrow(), {
      title: s(fd, "title") ?? "",
      description: s(fd, "description") ?? "",
      categoryId: s(fd, "categoryId") ?? "",
      priority: (s(fd, "priority") as "MEDIUM") || "MEDIUM",
      branchId: s(fd, "branchId") || undefined,
      workReference: s(fd, "workReference") || undefined,
      attachments: files(fd, "attachments"),
    }),
  );
  if (!res.ok) return res;
  revalidatePath("/support");
  redirect(`/support/${(res.data as { id: string }).id}?created=1`);
}

export async function replyAction(ticketId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await addReply(await actorOrThrow(), ticketId, { body: s(fd, "body") ?? "", internal: fd.get("internal") === "on", attachments: files(fd, "attachments") });
    revalidatePath(`/support/${ticketId}`);
  }, "Sent.");
}

export async function updateTicketAction(ticketId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const assigned = fd.get("assignedToId");
    await updateTicket(await actorOrThrow(), ticketId, {
      status: s(fd, "status") || undefined,
      priority: s(fd, "priority") || undefined,
      categoryId: s(fd, "categoryId") || undefined,
      assignedToId: typeof assigned === "string" ? assigned || null : undefined,
      resolution: s(fd, "resolution"),
      reason: s(fd, "reason"),
    });
    revalidatePath(`/support/${ticketId}`);
    revalidatePath("/support");
  }, "Ticket updated.");
}

export async function requesterAction_(ticketId: string, action: "close" | "reopen", _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await requesterAction(await actorOrThrow(), ticketId, action, s(fd, "note"));
    revalidatePath(`/support/${ticketId}`);
  }, action === "close" ? "Ticket closed. Thank you!" : "Ticket reopened.");
}

export async function saveCategoryAction(id: string | null, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await saveCategory(await actorOrThrow(), { name: s(fd, "name") ?? "", active: fd.get("active") === "on", sortOrder: Number(s(fd, "sortOrder") || 0) }, id ?? undefined);
    revalidatePath("/support/settings");
  }, "Category saved.");
}
