"use server";

import { revalidatePath } from "next/cache";
import { actorOrThrow } from "@/server/auth/session";
import { transaction } from "@/server/db";
import { invalid, runAction, type ActionResult } from "@/server/lib/errors";
import { grantPortalAccess, revokePortalAccess } from "@/server/modules/portal/service";
import { updateSetting } from "@/server/modules/settings/service";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function grantPortalAction(customerId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await grantPortalAccess(await actorOrThrow(), customerId, { email: s(fd, "email"), password: s(fd, "password") });
    revalidatePath("/admin/customers");
  }, "Portal login saved. Share the email and password with the customer.");
}

export async function revokePortalAction(customerId: string): Promise<R> {
  return runAction(async () => {
    await revokePortalAccess(await actorOrThrow(), customerId);
    revalidatePath("/admin/customers");
  }, "Portal access turned off.");
}

export async function savePhase6SettingsAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    const n = (k: string) => {
      const v = Number(s(fd, k));
      if (!Number.isFinite(v)) throw invalid("Please enter numbers only.");
      return v;
    };
    await transaction(async (tx) => {
      await updateSetting(actor, "agentScore", {
        completionWeight: n("completionWeight"),
        onTimeWeight: n("onTimeWeight"),
        cancellationWeight: n("cancellationWeight"),
        revenueWeight: n("revenueWeight"),
        graceDays: Math.round(n("graceDays")),
        minWorks: Math.round(n("minWorks")),
      }, tx);
      await updateSetting(actor, "customerPortal", { showCompletionImages: fd.get("showCompletionImages") === "on", showPayments: fd.get("showPayments") === "on" }, tx);
    });
    revalidatePath("/admin/settings");
  }, "Saved.");
}
