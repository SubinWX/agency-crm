import Link from "next/link";
import { redirect } from "next/navigation";
import { saveSupportPortalAction } from "@/app/actions/support";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ImageInput } from "@/components/image-input";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { getSetting } from "@/server/modules/settings/service";
import { can } from "@/server/rbac/actor";

export const metadata = { title: "Customise support page" };

export default async function CustomizeSupportPage() {
  const actor = await requireUser();
  if (!can(actor, "branding.manage")) redirect("/support");
  const c = await getSetting("supportPortal");
  const field = (name: string, label: string, value: string, placeholder?: string, help?: string) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={value} placeholder={placeholder} className="input" />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
  return (
    <>
      <PageHeader title="Customise support page" subtitle="Header button, banner, footer and social links. Everyone who opens the Support portal sees this." actions={<Link href="/support" target="_blank" className="btn-secondary">Preview ↗</Link>} />
      <ActionForm action={saveSupportPortalAction} className="space-y-5">
        <Card title="Header button">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("headerCtaLabel", "Button text", c.headerCtaLabel, "New request", "Leave empty to hide the button.")}
            {field("headerCtaHref", "Button link", c.headerCtaHref, "/support/new", "A page (/support/new), https:// link, mailto: or tel:+91…")}
          </div>
        </Card>

        <Card title="Top banner">
          <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="showBanner" defaultChecked={c.showBanner} className="h-4 w-4" /> Show the banner on the support home page</label>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <span className="label">Banner image</span>
                <div className="mb-2 h-32 overflow-hidden rounded-lg bg-gradient-to-br from-[#0f1b3d] to-indigo-700">
                  {c.bannerImageKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/branding/support-banner?v=${encodeURIComponent(c.bannerImageKey)}`} alt="Current banner" className="h-full w-full object-cover" />
                  )}
                </div>
                <ImageInput name="bannerImage" accept="image/jpeg,image/png,image/webp" maxEdge={2400} label={c.bannerImageKey ? "Change image" : "Choose image"} hint="Wide photo, at least 1600px. Crop to 16:9." />
                {c.bannerImageKey && <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="removeBanner" /> Use the default colour instead of an image</label>}
              </div>
              <div>
                <label className="label" htmlFor="bannerOverlay">Darken image for readable text ({c.bannerOverlay}%)</label>
                <input id="bannerOverlay" name="bannerOverlay" type="range" min={0} max={80} step={5} defaultValue={c.bannerOverlay} className="w-full" />
              </div>
            </div>
            <div className="space-y-3">
              {field("bannerHeadline", "Headline", c.bannerHeadline, "How can we help you today?")}
              <div><label className="label" htmlFor="bannerSubtext">Text under the headline</label><textarea id="bannerSubtext" name="bannerSubtext" rows={3} defaultValue={c.bannerSubtext} className="input" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                {field("bannerCtaLabel", "Banner button text", c.bannerCtaLabel, "Raise a request")}
                {field("bannerCtaHref", "Banner button link", c.bannerCtaHref, "/support/new")}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Footer & contact">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3"><label className="label" htmlFor="footerText">Footer text</label><textarea id="footerText" name="footerText" rows={2} defaultValue={c.footerText} className="input" /></div>
            {field("contactEmail", "Support email", c.contactEmail, "support@yourcompany.com")}
            {field("contactPhone", "Support phone", c.contactPhone, "+91 9xxxx xxxxx")}
            {field("address", "Address", c.address)}
          </div>
          <p className="mt-3 text-xs text-slate-500">The footer also shows your company logo and name from Settings → Company details.</p>
        </Card>

        <Card title="Social media">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field("website", "Website", c.socials.website, "https://yourcompany.com")}
            {field("facebook", "Facebook", c.socials.facebook, "https://facebook.com/…")}
            {field("instagram", "Instagram", c.socials.instagram, "https://instagram.com/…")}
            {field("linkedin", "LinkedIn", c.socials.linkedin, "https://linkedin.com/company/…")}
            {field("x", "X (Twitter)", c.socials.x, "https://x.com/…")}
            {field("youtube", "YouTube", c.socials.youtube, "https://youtube.com/@…")}
            {field("whatsapp", "WhatsApp number", c.socials.whatsapp, "+91 9xxxx xxxxx", "Opens a WhatsApp chat.")}
          </div>
          <p className="mt-3 text-xs text-slate-500">Only filled-in links are shown.</p>
        </Card>

        <div className="flex gap-2">
          <SubmitButton>Save support page</SubmitButton>
          <Link href="/support" target="_blank" className="btn-secondary">Preview ↗</Link>
        </div>
      </ActionForm>
    </>
  );
}
