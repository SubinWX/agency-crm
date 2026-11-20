"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/lib/errors";
import { KIND_LABEL, savePerson, type PersonKind } from "@/server/modules/people/service";
import { setUserPhoto } from "@/server/modules/users/service";
import type { UploadInput } from "@/server/storage";

type R = ActionResult<unknown>;

/** Photo field on the person form: upload, or tick "Remove photo". */
async function applyPhoto(userId: string, fd: FormData) {
  const f = fd.get("photo");
  if (f && typeof f === "object" && (f as File).size > 0) await setUserPhoto(await actorOrThrow(), userId, f as unknown as UploadInput);
  else if (fd.get("removePhoto") === "on") await setUserPhoto(await actorOrThrow(), userId, null, true);
}
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function savePersonAction(kind: PersonKind, id: string | null, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () =>
    savePerson(
      await actorOrThrow(),
      kind,
      {
        name: s(fd, "name"),
        email: s(fd, "email"),
        phone: s(fd, "phone"),
        branchIds: fd.getAll("branchIds").map(String),
        status: s(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        password: s(fd, "password"),
        address: s(fd, "address"),
        joiningDate: s(fd, "joiningDate"),
        emergencyContact: s(fd, "emergencyContact"),
        commissionPercent: fd.has("commissionPercent") ? s(fd, "commissionPercent") : undefined,
        gender: (s(fd, "gender") ?? "") as "MALE" | "FEMALE" | "",
      },
      id ?? undefined,
    ).then(async (u) => {
      await applyPhoto(u.id, fd);
      return u;
    }),
    "Saved.",
  );
  if (!res.ok) return res;
  const base = KIND_LABEL[kind].base;
  revalidatePath(base, "layout");
  if (!id) redirect(`${base}/${(res.data as { id: string }).id}?created=1`);
  return res;
}
