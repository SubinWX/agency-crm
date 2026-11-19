/**
 * Versioned work images (spec §13). Replacing an image never deletes the old
 * file: the previous version is kept and marked not-current; the new version
 * records who changed it, when, and why. Removal hides the image but keeps
 * every version for Super Admin / permitted users.
 */
import { prisma, transaction, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalid, notFound } from "../../lib/errors";
import { can, requireBranch, type Actor } from "../../rbac/actor";
import { storeImage, type UploadInput } from "../../storage";
import { AGENT_EDITABLE_STATUSES, isOwnWork, loadWorkForUpdate, workAccessWhere } from "./access";

async function requireImageEdit(tx: Tx, actor: Actor, workId: string) {
  const work = await loadWorkForUpdate(tx, actor, workId);
  if (can(actor, "works.edit")) {
    requireBranch(actor, work.branchId);
    return work;
  }
  if (!(can(actor, "works.edit_own") && isOwnWork(actor, work))) throw forbidden();
  if (!AGENT_EDITABLE_STATUSES.includes(work.status)) throw new AppError("INVALID_STATE", "Images can no longer be changed on this work.");
  return work;
}

export async function addWorkImage(actor: Actor, workId: string, file: UploadInput, caption?: string) {
  const stored = await storeImage(file, "works");
  return transaction(async (tx) => {
    await requireImageEdit(tx, actor, workId);
    const img = await tx.workImage.create({
      data: {
        workId,
        kind: "AGENT",
        caption: caption?.trim().slice(0, 200) || null,
        versions: { create: { version: 1, isCurrent: true, uploadedById: actor.id, ...stored } },
      },
    });
    await audit(tx, actor, { action: "work.image_add", entityType: "WorkImage", entityId: img.id, after: { workId, storageKey: stored.storageKey } });
    return img;
  });
}

export async function replaceWorkImage(actor: Actor, imageId: string, file: UploadInput, reason: string) {
  if (!reason?.trim()) throw invalid("Please give a reason for replacing this image.");
  const stored = await storeImage(file, "works");
  return transaction(async (tx) => {
    const image = await tx.workImage.findUnique({ where: { id: imageId } });
    if (!image || image.status !== "ACTIVE" || image.kind !== "AGENT") throw notFound("Image");
    await requireImageEdit(tx, actor, image.workId);

    const current = await tx.workImageVersion.findFirst({ where: { imageId, isCurrent: true } });
    const last = await tx.workImageVersion.aggregate({ where: { imageId }, _max: { version: true } });
    if (current) await tx.workImageVersion.update({ where: { id: current.id }, data: { isCurrent: false } });
    const v = await tx.workImageVersion.create({
      data: { imageId, version: (last._max.version ?? 0) + 1, isCurrent: true, uploadedById: actor.id, reason: reason.trim(), ...stored },
    });
    await tx.workFieldChange.create({
      data: { workId: image.workId, field: "image", oldValue: current?.id ?? undefined, newValue: v.id, reason: reason.trim(), changedById: actor.id },
    });
    await audit(tx, actor, {
      action: "work.image_replace",
      entityType: "WorkImage",
      entityId: imageId,
      before: current ? { versionId: current.id, version: current.version } : null,
      after: { versionId: v.id, version: v.version },
      reason,
    });
    return v;
  });
}

export async function removeWorkImage(actor: Actor, imageId: string, reason: string) {
  if (!reason?.trim()) throw invalid("Please give a reason for removing this image.");
  return transaction(async (tx) => {
    const image = await tx.workImage.findUnique({ where: { id: imageId } });
    if (!image || image.status !== "ACTIVE" || image.kind !== "AGENT") throw notFound("Image");
    await requireImageEdit(tx, actor, image.workId);
    await tx.workImage.update({ where: { id: imageId }, data: { status: "REMOVED", removedAt: new Date(), removedById: actor.id, removeReason: reason.trim() } });
    await tx.workFieldChange.create({ data: { workId: image.workId, field: "image_removed", oldValue: imageId, reason: reason.trim(), changedById: actor.id } });
    await audit(tx, actor, { action: "work.image_remove", entityType: "WorkImage", entityId: imageId, reason });
  });
}

/**
 * Authorise a file download. Current versions of active images are visible to
 * anyone who can see the work; previous/removed versions need
 * `works.view_image_history` (Super Admin has it implicitly).
 */
export async function getImageVersionForDownload(actor: Actor, versionId: string) {
  const v = await prisma.workImageVersion.findUnique({ where: { id: versionId }, include: { image: true } });
  if (!v) throw notFound("File");
  const work = await prisma.work.findFirst({ where: { id: v.image.workId, AND: [workAccessWhere(actor)] }, select: { id: true } });
  if (!work) throw notFound("File");
  const isHistory = !v.isCurrent || v.image.status === "REMOVED";
  if (isHistory && !can(actor, "works.view_image_history")) throw notFound("File");
  return v;
}
