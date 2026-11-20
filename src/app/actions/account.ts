"use server";

import { revalidatePath } from "next/cache";
import { actorOrThrow, currentSessionId } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/lib/errors";
import { changeOwnPassword, setOwnPhoto, updateOwnProfile } from "@/server/modules/account/service";
import type { UploadInput } from "@/server/storage";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function updateProfileAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await updateOwnProfile(await actorOrThrow(), { name: s(fd, "name"), phone: s(fd, "phone"), gender: fd.has("gender") ? s(fd, "gender") ?? "" : undefined });
    revalidatePath("/", "layout");
  }, "Profile saved.");
}

export async function changePasswordAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await changeOwnPassword(await actorOrThrow(), { current: s(fd, "current"), next: s(fd, "next"), confirm: s(fd, "confirm") }, await currentSessionId());
  }, "Password changed. Other devices have been signed out.");
}

export async function changePhotoAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const f = fd.get("photo");
    const remove = fd.get("remove") === "1";
    await setOwnPhoto(await actorOrThrow(), !remove && f && typeof f === "object" ? (f as unknown as UploadInput) : null, remove);
    revalidatePath("/", "layout");
  }, "Picture updated.");
}
