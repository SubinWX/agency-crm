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

type FooterCompany = { name: string; logoKey: string | null };
type FooterPage = { footerText: string; contactEmail: string; contactPhone: string; address: string; socials: Record<keyof typeof SOCIAL_ICONS, string> };

/** Public footer (support portal, product catalogue): logo, text, contact, social icons. */
export function SiteFooter({ company, page }: { company: FooterCompany; page: FooterPage }) {
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof typeof SOCIAL_ICONS)[])
    .map((k) => ({ k, href: k === "whatsapp" ? waLink(page.socials.whatsapp) : page.socials[k] }))
    .filter((s): s is { k: keyof typeof SOCIAL_ICONS; href: string } => !!s.href);
  const year = new Date().getFullYear();
  return (
    <footer className="mt-10 bg-[#0f1b3d] text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <SupportLogo name={company.name} hasLogo={!!company.logoKey} version={company.logoKey} dark />
            <span className="font-semibold text-white">{company.name}</span>
          </div>
          {page.footerText && <p className="max-w-sm text-sm leading-relaxed text-slate-400">{page.footerText}</p>}
        </div>
        {(page.contactEmail || page.contactPhone || page.address) && (
          <div className="space-y-2 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Contact us</p>
            {page.contactEmail && <a href={`mailto:${page.contactEmail}`} className="flex items-center gap-2 hover:text-white"><ContactIcons.Mail className="h-4 w-4" /> {page.contactEmail}</a>}
            {page.contactPhone && <a href={`tel:${page.contactPhone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 hover:text-white"><ContactIcons.Phone className="h-4 w-4" /> {page.contactPhone}</a>}
            {page.address && <p className="flex items-start gap-2"><ContactIcons.MapPin className="mt-0.5 h-4 w-4 shrink-0" /> <span className="whitespace-pre-line">{page.address}</span></p>}
          </div>
        )}
        {socials.length > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Follow us</p>
            <div className="flex flex-wrap gap-2">
              {socials.map(({ k, href }) => {
                const Icon = SOCIAL_ICONS[k];
                return (
                  <a key={k} href={href} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABELS[k]} title={SOCIAL_LABELS[k]} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white hover:text-[#0f1b3d]">
                    <Icon className="h-4 w-4" />
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">© {year} {company.name}. All rights reserved.</p>
      </div>
    </footer>
  );
}

/** wa.me link from a phone number (adds 91 for 10-digit Indian numbers). */
export function waLink(n: string, text?: string) {
  const d = n.replace(/\D/g, "");
  if (d.length < 8) return null;
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
