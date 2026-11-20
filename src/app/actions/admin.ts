"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow, getActor } from "@/server/auth/session";
import { transaction } from "@/server/db";
import { runAction, type ActionResult } from "@/server/lib/errors";
import { saveBranch } from "@/server/modules/branches/service";
import { updateLoginBranding } from "@/server/modules/branding/service";
import type { UploadInput } from "@/server/storage";
import { changeCapacity, setDateBlocked } from "@/server/modules/capacity/service";
import { saveField } from "@/server/modules/custom-fields/service";
import { archiveCustomer, createCustomer, updateCustomer } from "@/server/modules/customers/service";
import { markAllRead } from "@/server/modules/notifications/service";
import { updateSetting } from "@/server/modules/settings/service";
import { saveUser, setRolePermissions } from "@/server/modules/users/service";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function changeCapacityAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await changeCapacity(await actorOrThrow(), Number(s(fd, "maxPerDay")), s(fd, "reason"));
    revalidatePath("/", "layout");
  }, "Daily capacity updated.");
}

export async function blockDateAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const block = s(fd, "mode") !== "unblock";
    await setDateBlocked(await actorOrThrow(), s(fd, "date") ?? "", block, s(fd, "reason"));
    revalidatePath("/", "layout");
  }, "Calendar updated.");
}

export async function saveMessagesAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    await transaction(async (tx) => {
      await updateSetting(actor, "fullSlotMessage", { template: s(fd, "fullSlotMessage") ?? "" }, tx);
      await updateSetting(actor, "blockedDateMessage", { template: s(fd, "blockedDateMessage") ?? "" }, tx);
    });
    revalidatePath("/admin/settings");
  }, "Messages saved.");
}

export async function saveCompanyAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    await transaction(async (tx) => {
      await updateSetting(actor, "company", {
        name: s(fd, "name") ?? "",
        address: s(fd, "address") ?? "",
        phone: s(fd, "phone") ?? "",
        email: s(fd, "email") ?? "",
        gstNumber: s(fd, "gstNumber") ?? "",
        logoKey: null,
      }, tx);
    });
    revalidatePath("/admin/settings");
  }, "Company details saved.");
}

export async function saveFieldAction(id: string | null, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await saveField(
      await actorOrThrow(),
      {
        label: s(fd, "label") ?? "",
        type: (s(fd, "type") ?? "TEXT") as "TEXT",
        required: fd.get("required") === "on",
        active: fd.get("active") === "on",
        sortOrder: Number(s(fd, "sortOrder") || 0),
        options: (s(fd, "options") ?? "").split("\n").map((o) => o.trim()).filter(Boolean),
        helpText: s(fd, "helpText"),
      },
      id ?? undefined,
    );
    revalidatePath("/admin/settings");
  }, "Field saved.");
}

const customerFromForm = (fd: FormData) => ({
  name: s(fd, "name") ?? "",
  phone: s(fd, "phone") ?? "",
  altPhone: s(fd, "altPhone"),
  email: s(fd, "email"),
  address: s(fd, "address"),
  location: s(fd, "location"),
  notes: s(fd, "notes"),
  branchId: s(fd, "branchId"),
});

export async function createCustomerAction(_p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => createCustomer(await actorOrThrow(), customerFromForm(fd)));
  if (!res.ok) return res;
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${(res.data as { id: string }).id}?created=1`);
}

export async function updateCustomerAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await updateCustomer(await actorOrThrow(), id, customerFromForm(fd));
    revalidatePath("/admin/customers");
  }, "Customer updated.");
}

export async function archiveCustomerAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => archiveCustomer(await actorOrThrow(), id, s(fd, "reason") ?? ""));
  if (!res.ok) return res;
  revalidatePath("/admin/customers");
  redirect("/admin/customers?archived=1");
}

export async function saveUserAction(id: string | null, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => {
    return saveUser(
      await actorOrThrow(),
      {
        name: s(fd, "name") ?? "",
        email: s(fd, "email") ?? "",
        phone: s(fd, "phone"),
        roleId: s(fd, "roleId") ?? "",
        branchIds: fd.getAll("branchIds").map(String),
        status: (s(fd, "status") as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
        password: s(fd, "password") || undefined,
      },
      id ?? undefined,
    );
  }, "User saved.");
  if (res.ok) revalidatePath("/admin/users");
  if (res.ok && !id) redirect(`/admin/users/${(res.data as { id: string }).id}?created=1`);
  return res;
}

export async function setRolePermissionsAction(roleId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await setRolePermissions(await actorOrThrow(), roleId, fd.getAll("perm").map(String));
    revalidatePath("/admin/roles");
  }, "Permissions updated.");
}

export async function saveBranchAction(id: string | null, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => {
    return saveBranch(
      await actorOrThrow(),
      {
        name: s(fd, "name") ?? "",
        code: s(fd, "code") ?? "",
        address: s(fd, "address"),
        phone: s(fd, "phone"),
        email: s(fd, "email"),
        status: (s(fd, "status") as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
      },
      id ?? undefined,
    );
  }, "Branch saved.");
  if (res.ok) revalidatePath("/admin/branches");
  if (res.ok && !id) redirect("/admin/branches?created=1");
  return res;
}

export async function markNotificationsReadAction() {
  const actor = await getActor();
  if (actor) await markAllRead(actor.id);
  revalidatePath("/", "layout");
}

export async function saveLoginBrandingAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const image = fd.get("image");
    await updateLoginBranding(await actorOrThrow(), {
      headline: s(fd, "headline") ?? "",
      subtext: s(fd, "subtext") ?? "",
      image: image && typeof image === "object" && (image as File).size > 0 ? (image as unknown as UploadInput) : null,
      removeImage: fd.get("removeImage") === "on",
    });
    revalidatePath("/", "layout");
  }, "Login page updated.");
}
