/**
 * Support portal look & feel: header button, banner (image + text + button),
 * footer text, contact details and social links. Managed with `branding.manage`.
 */
import { transaction } from "../../db";
import { invalid } from "../../lib/errors";
import { requirePermission, type Actor } from "../../rbac/actor";
import { storeImage, type UploadInput } from "../../storage";
import { getSetting, updateSetting, type SettingValue } from "../settings/service";

export type SupportPortalSettings = SettingValue<"supportPortal">;

/** Allowed button links: in-app paths, https URLs, mailto: and tel:. */
export function cleanLink(v: string, field: string): string {
  const s = v.trim();
  if (!s) return "";
  if (/^\/(?!\/)[\w\-./?=&%#]*$/.test(s)) return s;
  if (/^https:\/\/[^\s<>"']+$/i.test(s)) return s;
  if (/^mailto:[^\s@<>"']+@[^\s@<>"']+$/i.test(s)) return s;
  if (/^tel:\+?[\d\s\-()]{6,20}$/i.test(s)) return s.replace(/\s/g, "");
  throw invalid(`${field}: use a page like /support/new, a full https:// link, mailto: or tel:.`);
}

function cleanSocial(v: string, field: string, host: RegExp): string {
  const s = v.trim();
  if (!s) return "";
  if (!/^https:\/\/[^\s<>"']+$/i.test(s)) throw invalid(`${field}: enter the full https:// link.`);
  if (!host.test(new URL(s).hostname)) throw invalid(`${field}: that doesn't look like a ${field} link.`);
  return s;
}

/** WhatsApp number → https://wa.me/<digits>. */
export function whatsappLink(n: string) {
  const d = n.replace(/[^\d]/g, "");
  return d.length >= 8 ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : "";
}

export async function saveSupportPortal(
  actor: Actor,
  input: Omit<SupportPortalSettings, "bannerImageKey">,
  banner?: { file?: UploadInput | null; remove?: boolean },
) {
  requirePermission(actor, "branding.manage");
  const current = await getSetting("supportPortal");
  let bannerImageKey = banner?.remove ? null : current.bannerImageKey;
  if (banner?.file && banner.file.size > 0) bannerImageKey = (await storeImage(banner.file, "branding", { maxEdge: 2400 })).storageKey;
  const email = input.contactEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Contact email is not valid.");
  const wa = input.socials.whatsapp.trim();
  if (wa && !whatsappLink(wa)) throw invalid("WhatsApp: enter a phone number with country code.");
  const value: SupportPortalSettings = {
    headerCtaLabel: input.headerCtaLabel.trim(),
    headerCtaHref: cleanLink(input.headerCtaHref, "Header button link"),
    showBanner: input.showBanner,
    bannerImageKey,
    bannerHeadline: input.bannerHeadline.trim(),
    bannerSubtext: input.bannerSubtext.trim(),
    bannerCtaLabel: input.bannerCtaLabel.trim(),
    bannerCtaHref: cleanLink(input.bannerCtaHref, "Banner button link"),
    bannerOverlay: Math.max(0, Math.min(80, Math.round(input.bannerOverlay))),
    footerText: input.footerText.trim(),
    contactEmail: email,
    contactPhone: input.contactPhone.trim(),
    address: input.address.trim(),
    socials: {
      website: cleanSocial(input.socials.website, "Website", /./),
      facebook: cleanSocial(input.socials.facebook, "Facebook", /(^|\.)facebook\.com$|(^|\.)fb\.com$/i),
      instagram: cleanSocial(input.socials.instagram, "Instagram", /(^|\.)instagram\.com$/i),
      linkedin: cleanSocial(input.socials.linkedin, "LinkedIn", /(^|\.)linkedin\.com$/i),
      x: cleanSocial(input.socials.x, "X (Twitter)", /(^|\.)(x|twitter)\.com$/i),
      youtube: cleanSocial(input.socials.youtube, "YouTube", /(^|\.)(youtube\.com|youtu\.be)$/i),
      whatsapp: wa,
    },
  };
  if (value.headerCtaLabel && !value.headerCtaHref) throw invalid("Add a link for the header button (or clear its label).");
  if (value.bannerCtaLabel && !value.bannerCtaHref) throw invalid("Add a link for the banner button (or clear its label).");
  await transaction((tx) => updateSetting(actor, "supportPortal", value, tx, "branding.manage"));
}
