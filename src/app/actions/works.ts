"use server";

/**
 * Thin server-action layer: parse FormData → call service with the session
 * actor → revalidate. All rules live in the services.
 * (Next.js server actions are POST-only and origin-checked, which provides CSRF protection.)
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow, PORTAL_HOME } from "@/server/auth/session";
import { invalid, runAction, type ActionResult } from "@/server/lib/errors";
import { addWorkImage, removeWorkImage, replaceWorkImage } from "@/server/modules/works/images";
import {
  addComment, approveWork, assignWorkers, cancelWork, changeWorkDate, createWork, editWork,
  rejectWork, removeWorker, startWork, submitCompletion,
} from "@/server/modules/works/service";
import type { UploadInput } from "@/server/storage";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const files = (fd: FormData, k: string) => fd.getAll(k).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0) as unknown as UploadInput[];
const customValues = (fd: FormData) => {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("cf_") && typeof v === "string") out[k.slice(3)] = v;
  return out;
};
const detailFields = (fd: FormData) => ({
  title: s(fd, "title"),
  description: s(fd, "description"),
  locationAddress: s(fd, "locationAddress"),
  locationNotes: s(fd, "locationNotes"),
  latitude: s(fd, "latitude"),
  longitude: s(fd, "longitude"),
});

export async function createWorkAction(_p: R | null, fd: FormData): Promise<R> {
  const actor = await actorOrThrow().catch(() => null);
  if (!actor) return { ok: false, error: "Your session has expired. Please sign in again." };
  const mode = s(fd, "customerMode");
  const res = await runAction(() =>
    createWork(actor, {
      branchId: s(fd, "branchId") ?? "",
      workDate: s(fd, "workDate") ?? "",
      customerId: mode === "existing" ? s(fd, "customerId") : undefined,
      newCustomer:
        mode === "new"
          ? { name: s(fd, "customerName") ?? "", phone: s(fd, "customerPhone") ?? "", altPhone: s(fd, "customerAltPhone"), email: s(fd, "customerEmail"), address: s(fd, "customerAddress") }
          : undefined,
      agentId: s(fd, "agentId"),
      ...detailFields(fd),
      customValues: customValues(fd),
      images: files(fd, "images"),
    }),
  );
  if (!res.ok) return res;
  const work = res.data as { id: string };
  revalidatePath("/", "layout");
  if (actor.portal === "ADMIN" && fd.get("thenInvoice") === "on") redirect(`/admin/invoices/new?workId=${work.id}`);
  redirect(`${PORTAL_HOME[actor.portal]}/works/${work.id}?created=1`);
}

export async function changeDateAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await changeWorkDate(await actorOrThrow(), workId, s(fd, "newDate") ?? "", s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Work date changed.");
}

export async function editWorkAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const n = await editWork(await actorOrThrow(), workId, { ...detailFields(fd), customValues: customValues(fd), reason: s(fd, "reason") ?? "" });
    revalidatePath("/", "layout");
    return n;
  }, "Changes saved.");
}

export async function assignWorkersAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await assignWorkers(await actorOrThrow(), workId, fd.getAll("workerIds").map(String));
    revalidatePath("/", "layout");
  }, "Workers assigned.");
}

export async function removeWorkerAction(workId: string, workerId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await removeWorker(await actorOrThrow(), workId, workerId, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Worker removed.");
}

export async function startWorkAction(workId: string): Promise<R> {
  return runAction(async () => {
    await startWork(await actorOrThrow(), workId);
    revalidatePath("/", "layout");
  }, "Work started.");
}

export async function completeWorkAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await submitCompletion(await actorOrThrow(), workId, { message: s(fd, "message"), description: s(fd, "description"), images: files(fd, "images") });
    revalidatePath("/", "layout");
  }, "Completion submitted for approval.");
}

export async function approveWorkAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await approveWork(await actorOrThrow(), workId, s(fd, "comment"));
    revalidatePath("/", "layout");
  }, "Work approved.");
}

export async function rejectWorkAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await rejectWork(await actorOrThrow(), workId, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Correction requested. The workers have been notified.");
}

export async function cancelWorkAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await cancelWork(await actorOrThrow(), workId, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Work cancelled.");
}

export async function commentAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await addComment(await actorOrThrow(), workId, s(fd, "body") ?? "");
    revalidatePath("/", "layout");
  });
}

export async function addImageAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    const list = files(fd, "images");
    if (list.length === 0) throw invalid("Please choose an image.");
    for (const f of list.slice(0, 10)) await addWorkImage(actor, workId, f, s(fd, "caption"));
    revalidatePath("/", "layout");
  }, "Image added.");
}

export async function replaceImageAction(imageId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const [file] = files(fd, "image");
    if (!file) throw invalid("Please choose the new image.");
    await replaceWorkImage(await actorOrThrow(), imageId, file, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Image replaced. The previous image was kept in history.");
}

export async function removeImageAction(imageId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await removeWorkImage(await actorOrThrow(), imageId, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Image removed (kept in history).");
}
