import { z } from "zod";
import { transaction } from "../../db";
import { parseInput } from "../../lib/errors";
import { requirePermission, type Actor } from "../../rbac/actor";
import { storeImage, type UploadInput } from "../../storage";
import { getSetting, updateSetting } from "../settings/service";

const input = z.object({
  headline: z.string().trim().min(1, "Headline is required").max(120),
  subtext: z.string().trim().max(300),
});

/**
 * Login page branding (image + text). Controlled by `branding.manage`
 * (granted to Super Admin; not to Admin by default). The image is public by
 * design because it is shown before sign-in.
 */
export async function updateLoginBranding(
  actor: Actor,
  data: { headline: string; subtext: string; image?: UploadInput | null; removeImage?: boolean },
) {
  requirePermission(actor, "branding.manage");
  const text = parseInput(input, data);
  const current = await getSetting("loginPage");
  let imageKey = data.removeImage ? null : current.imageKey;
  if (data.image && data.image.size > 0) imageKey = (await storeImage(data.image, "branding", { maxEdge: 2400 })).storageKey;
  await transaction((tx) => updateSetting(actor, "loginPage", { ...text, imageKey }, tx, "branding.manage"));
}
