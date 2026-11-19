"use server";

import type { NotificationChannel } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { actorOrThrow } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/lib/errors";
import { requirePermission } from "@/server/rbac/actor";
import { resetTemplate, saveProvider, saveTemplate } from "@/server/modules/notifications/config";
import { processQueue, retryDelivery, sendTestMessage } from "@/server/modules/notifications/dispatch";
import { PROVIDERS } from "@/server/modules/notifications/providers";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function saveProviderAction(channel: NotificationChannel, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const provider = s(fd, "provider");
    const def = PROVIDERS[provider];
    const values: Record<string, string> = {};
    for (const f of def?.fields ?? []) values[f.key] = s(fd, `f_${f.key}`);
    await saveProvider(await actorOrThrow(), channel, { provider, enabled: fd.get("enabled") === "on", values });
    revalidatePath("/admin/notifications");
  }, "Provider saved.");
}

export async function sendTestAction(channel: NotificationChannel, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await sendTestMessage(await actorOrThrow(), channel, s(fd, "to"));
    revalidatePath("/admin/notifications", "layout");
  }, "Test message sent. Check the delivery log.");
}

export async function saveTemplateAction(event: string, channel: NotificationChannel, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await saveTemplate(await actorOrThrow(), event, channel, {
      enabled: fd.get("enabled") === "on",
      sendToCustomer: fd.get("sendToCustomer") === "on",
      subject: s(fd, "subject"),
      body: s(fd, "body"),
    });
    revalidatePath("/admin/notifications/templates");
  }, "Template saved.");
}

export async function resetTemplateAction(event: string, channel: NotificationChannel): Promise<R> {
  return runAction(async () => {
    await resetTemplate(await actorOrThrow(), event, channel);
    revalidatePath("/admin/notifications/templates");
  }, "Template reset to default.");
}

export async function retryDeliveryAction(id: string): Promise<R> {
  return runAction(async () => {
    await retryDelivery(await actorOrThrow(), id);
    revalidatePath("/admin/notifications/log");
  }, "Queued again.");
}

/** Send queued messages now (handy in development when the worker isn't running). */
export async function processQueueNowAction(): Promise<R> {
  return runAction(async () => {
    requirePermission(await actorOrThrow(), "notifications.manage");
    const r = await processQueue({ limit: 50 });
    revalidatePath("/admin/notifications/log");
    return r;
  }, "Queue processed.");
}
