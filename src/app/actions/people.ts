"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/lib/errors";
import { KIND_LABEL, savePerson, type PersonKind } from "@/server/modules/people/service";

type R = ActionResult<unknown>;
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
      },
      id ?? undefined,
    ),
    "Saved.",
  );
  if (!res.ok) return res;
  const base = KIND_LABEL[kind].base;
  revalidatePath(base, "layout");
  if (!id) redirect(`${base}/${(res.data as { id: string }).id}?created=1`);
  return res;
}
