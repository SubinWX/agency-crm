"use server";

import type { Portal } from "@prisma/client";
import { redirect } from "next/navigation";
import { login, logout, PORTAL_HOME, PORTAL_LOGIN, getActor } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/lib/errors";

const PORTALS: Portal[] = ["ADMIN", "AGENT", "WORKER", "CUSTOMER"];

export async function loginAction(portal: Portal, _prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  if (!PORTALS.includes(portal)) return { ok: false, error: "Invalid portal." };
  const res = await runAction(() => login(portal, String(fd.get("email") ?? ""), String(fd.get("password") ?? "")));
  if (!res.ok) return res;
  redirect(PORTAL_HOME[portal]);
}

export async function logoutAction() {
  const actor = await getActor();
  await logout();
  redirect(actor ? PORTAL_LOGIN[actor.portal] : "/");
}
