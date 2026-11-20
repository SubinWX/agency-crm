import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { getSetting } from "@/server/modules/settings/service";
import { saveSupportPortal, whatsappLink, type SupportPortalSettings } from "@/server/modules/support/page-settings";
import { createTicket, rateTicket, ratingSummary, updateTicket } from "@/server/modules/support/service";
import type { UploadInput } from "@/server/storage";
import { actor } from "./helpers";

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

describe("support page customisation", () => {
  let original: SupportPortalSettings | undefined;
  afterAll(async () => {
    if (original) await prisma.setting.update({ where: { key: "supportPortal" }, data: { value: original } });
  });

  const base = async () => {
    original ??= await getSetting("supportPortal");
    const { bannerImageKey: _k, ...rest } = original;
    return structuredClone(rest);
  };

  it("saves the banner, footer and social links", async () => {
    const sa = await actor("superadmin@crm.test");
    const input = await base();
    input.bannerHeadline = "We're here to help";
    input.contactEmail = "help@agency.test";
    input.socials.instagram = "https://www.instagram.com/agency";
    input.socials.whatsapp = "98765 43210";
    const img = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    const file: UploadInput = { name: "banner.jpg", type: "image/jpeg", size: img.length, arrayBuffer: async () => img.buffer.slice(img.byteOffset, img.byteOffset + img.length) as ArrayBuffer };
    await saveSupportPortal(sa, input, { file });
    const saved = await getSetting("supportPortal");
    expect(saved.bannerHeadline).toBe("We're here to help");
    expect(saved.bannerImageKey).toMatch(/^branding\//);
    expect(whatsappLink(saved.socials.whatsapp)).toBe("https://wa.me/919876543210");

    await saveSupportPortal(sa, input, { remove: true });
    expect((await getSetting("supportPortal")).bannerImageKey).toBeNull();
  });

  it("rejects unsafe or wrong links and users without branding access", async () => {
    const sa = await actor("superadmin@crm.test");
    const bad = async (patch: (i: Awaited<ReturnType<typeof base>>) => void) => {
      const i = await base();
      patch(i);
      return code(saveSupportPortal(sa, i));
    };
    expect(await bad((i) => (i.headerCtaHref = "javascript:alert(1)"))).toBe("VALIDATION");
    expect(await bad((i) => (i.socials.facebook = "https://evil.example/facebook.com"))).toBe("VALIDATION");
    expect(await bad((i) => (i.socials.website = "http://insecure.example"))).toBe("VALIDATION");
    expect(await bad((i) => (i.contactEmail = "not-an-email"))).toBe("VALIDATION");
    expect(await code(saveSupportPortal(await actor("agent@crm.test"), await base()))).toBe("FORBIDDEN");
  });
});

describe("support reviews", () => {
  it("lets only the requester rate, and only once resolved", async () => {
    const agent = await actor("agent@crm.test");
    const admin = await actor("admin@crm.test");
    const category = await prisma.supportCategory.findFirstOrThrow({ where: { name: "Payment / invoice" } });
    const t = await createTicket(agent, { title: "Rate me", description: "Testing reviews end to end.", categoryId: category.id, priority: "LOW" });

    expect(await code(rateTicket(agent, t.id, { rating: 5 }))).toBe("INVALID_STATE");
    await updateTicket(admin, t.id, { status: "RESOLVED", resolution: "Done" });
    expect(await code(rateTicket(admin, t.id, { rating: 5 }))).toBe("FORBIDDEN");
    expect(await code(rateTicket(agent, t.id, { rating: 9 }))).toBe("VALIDATION");

    await rateTicket(agent, t.id, { rating: 4, comment: "Quick fix, thanks" });
    await rateTicket(agent, t.id, { rating: 5 }); // can update
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
    expect([row.rating, row.ratingComment]).toEqual([5, null]);
    expect(await prisma.supportTicketEvent.count({ where: { ticketId: t.id, action: "reviewed" } })).toBe(2);
    expect(await prisma.notification.count({ where: { type: "support.ticket_reviewed", link: `/support/${t.id}` } })).toBeGreaterThan(0);

    const sum = await ratingSummary(await actor("superadmin@crm.test"));
    expect(sum!.count).toBeGreaterThan(0);
    expect(sum!.average).toBeGreaterThanOrEqual(1);
  });
});
