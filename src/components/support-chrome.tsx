import { Facebook, Globe, Instagram, Linkedin, Mail, MapPin, MessageCircle, Phone, Twitter, Youtube } from "lucide-react";

/** Company logo (or initials) used in the support header and footer. */
export function SupportLogo({ name, hasLogo, version, dark = false }: { name: string; hasLogo: boolean; version?: string | null; dark?: boolean }) {
  if (hasLogo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/branding/logo?v=${encodeURIComponent(version ?? "")}`} alt={name} className={`h-9 w-auto max-w-[9rem] object-contain ${dark ? "rounded bg-white p-1" : ""}`} />;
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "S";
  return <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold ${dark ? "bg-white text-slate-900" : "bg-[#0f1b3d] text-white"}`}>{initials}</span>;
}

/** Internal links use the same tab; outside links open in a new one. */
export function SmartLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const external = /^https?:/.test(href);
  return <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
}

export const SOCIAL_ICONS = { website: Globe, facebook: Facebook, instagram: Instagram, linkedin: Linkedin, x: Twitter, youtube: Youtube, whatsapp: MessageCircle } as const;
export const SOCIAL_LABELS = { website: "Website", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X (Twitter)", youtube: "YouTube", whatsapp: "WhatsApp" } as const;
export const ContactIcons = { Mail, Phone, MapPin };
