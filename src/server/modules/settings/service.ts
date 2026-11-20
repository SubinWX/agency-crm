import { z } from "zod";
import { parseInput } from "../../lib/errors";
import { DEFAULT_TZ, isValidTimeZone, setBusinessTz } from "../../lib/dates";
import { prisma, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { requirePermission, type Actor } from "../../rbac/actor";
import type { PermissionKey } from "../../rbac/permissions";

/** Typed, validated settings stored as JSON rows in the Setting table. */
const schemas = {
  /** "system" = the server's own time zone, otherwise an IANA zone like "Asia/Kolkata". */
  dateTime: z.object({
    timeZone: z.string().trim().min(1).refine((v) => v === "system" || isValidTimeZone(v), "Choose a valid time zone."),
    clockFormat: z.enum(["12h", "24h"]).default("12h"),
  }),
  company: z.object({
    name: z.string(),
    address: z.string().default(""),
    phone: z.string().default(""),
    email: z.string().default(""),
    gstNumber: z.string().default(""),
    logoKey: z.string().nullable().default(null),
    /** PNG/JPG copy of the logo for PDFs (SVG logos are rendered to PNG). */
    logoPdfKey: z.string().nullable().default(null),
  }),
  fullSlotMessage: z.object({
    template: z.string().min(1).max(500),
  }),
  blockedDateMessage: z.object({
    template: z.string().min(1).max(500),
  }),
  loginPage: z.object({
    headline: z.string().trim().min(1).max(120),
    subtext: z.string().trim().max(300),
    imageKey: z.string().nullable(),
  }),
  tax: z.object({
    gstEnabled: z.boolean(),
    defaultRate: z.number().min(0).max(100),
    defaultTaxType: z.enum(["INTRA_STATE", "INTER_STATE", "NONE"]),
    roundToRupee: z.boolean(),
    stateName: z.string().max(60),
  }),
  invoice: z.object({
    dueDays: z.number().int().min(0).max(365),
    terms: z.string().max(1000),
    bankDetails: z.string().max(500),
  }),
  commission: z.object({
    agentPercent: z.number().min(0).max(100),
    workerPercent: z.number().min(0).max(100),
    /** SPLIT: worker % shared equally by assigned workers. EACH: every worker gets the full %. */
    workerMode: z.enum(["SPLIT", "EACH"]),
  }),
  inventory: z.object({
    transfersEnabled: z.boolean(),
  }),
  agentScore: z.object({
    completionWeight: z.number().min(0).max(100),
    onTimeWeight: z.number().min(0).max(100),
    cancellationWeight: z.number().min(0).max(100),
    revenueWeight: z.number().min(0).max(100),
    /** Days after the work date that still count as "on time". */
    graceDays: z.number().int().min(0).max(30),
    /** Fewer works than this in the period → "New" (not enough data). */
    minWorks: z.number().int().min(1).max(100),
  }),
  customerPortal: z.object({
    showCompletionImages: z.boolean(),
    showPayments: z.boolean(),
  }),
  supportPortal: z.object({
    headerCtaLabel: z.string().max(40),
    headerCtaHref: z.string().max(300),
    showBanner: z.boolean(),
    bannerImageKey: z.string().nullable(),
    bannerHeadline: z.string().max(120),
    bannerSubtext: z.string().max(300),
    bannerCtaLabel: z.string().max(40),
    bannerCtaHref: z.string().max(300),
    /** Darkness of the overlay on the banner image, 0–80 (%). */
    bannerOverlay: z.number().int().min(0).max(80),
    footerText: z.string().max(300),
    contactEmail: z.string().max(120),
    contactPhone: z.string().max(40),
    address: z.string().max(300),
    socials: z.object({
      website: z.string().max(300),
      facebook: z.string().max(300),
      instagram: z.string().max(300),
      linkedin: z.string().max(300),
      x: z.string().max(300),
      youtube: z.string().max(300),
      whatsapp: z.string().max(40),
    }),
  }),
  numbering: z.object({
    padLength: z.number().int().min(3).max(10),
    prefixes: z.record(z.string(), z.string()),
  }),
} as const;

export type SettingKey = keyof typeof schemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof schemas)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  dateTime: { timeZone: DEFAULT_TZ, clockFormat: "12h" },
  company: { name: "Agency CRM", address: "", phone: "", email: "", gstNumber: "", logoKey: null, logoPdfKey: null },
  fullSlotMessage: {
    template: "Slots are full for {date}. Next available dates: {next_available_dates}.",
  },
  blockedDateMessage: {
    template: "{date} is not available: {reason}. Next available dates: {next_available_dates}.",
  },
  loginPage: {
    headline: "Every job, every slot, every team — in one place.",
    subtext: "Schedule works, assign workers and approve completed jobs across all branches.",
    imageKey: null,
  },
  tax: { gstEnabled: true, defaultRate: 18, defaultTaxType: "INTRA_STATE", roundToRupee: true, stateName: "Kerala" },
  invoice: { dueDays: 7, terms: "Payment due within 7 days. Thank you for your business.", bankDetails: "" },
  commission: { agentPercent: 5, workerPercent: 3, workerMode: "SPLIT" },
  inventory: { transfersEnabled: true },
  agentScore: { completionWeight: 40, onTimeWeight: 25, cancellationWeight: 15, revenueWeight: 20, graceDays: 1, minWorks: 3 },
  customerPortal: { showCompletionImages: true, showPayments: true },
  supportPortal: {
    headerCtaLabel: "New request",
    headerCtaHref: "/support/new",
    showBanner: true,
    bannerImageKey: null,
    bannerHeadline: "How can we help you today?",
    bannerSubtext: "Raise a complaint or request and follow every reply here. We usually respond within one working day.",
    bannerCtaLabel: "Raise a request",
    bannerCtaHref: "/support/new",
    bannerOverlay: 50,
    footerText: "We're here to help with your works, invoices and anything else.",
    contactEmail: "",
    contactPhone: "",
    address: "",
    socials: { website: "", facebook: "", instagram: "", linkedin: "", x: "", youtube: "", whatsapp: "" },
  },
  numbering: {
    padLength: 6,
    prefixes: { WRK: "WRK", INV: "INV", PAY: "PAY", SUP: "SUP", EXP: "EXP", STK: "STK" },
  },
};

export async function getSetting<K extends SettingKey>(key: K, tx: Tx = prisma): Promise<SettingValue<K>> {
  const row = await tx.setting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  const parsed = schemas[key].safeParse(row.value);
  return (parsed.success ? parsed.data : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function updateSetting<K extends SettingKey>(
  actor: Actor,
  key: K,
  value: SettingValue<K>,
  tx: Tx,
  permission: PermissionKey = "settings.manage",
): Promise<void> {
  requirePermission(actor, permission);
  const parsed = parseInput(schemas[key], value);
  const before = await getSetting(key, tx);
  await tx.setting.upsert({
    where: { key },
    create: { key, value: parsed },
    update: { value: parsed },
  });
  await audit(tx, actor, { action: "settings.update", entityType: "Setting", entityId: key, before, after: parsed });
}

/** Replace {variables} in a template. Unknown variables are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/** Load the saved time zone into memory (startup, page renders, after saving). */
export async function loadBusinessTz(): Promise<string> {
  try {
    return setBusinessTz((await getSetting("dateTime")).timeZone);
  } catch {
    return setBusinessTz(DEFAULT_TZ);
  }
}
