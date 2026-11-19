import { z } from "zod";
import { parseInput } from "../../lib/errors";
import { prisma, type Tx } from "../../db";
import { audit } from "../../lib/audit";
import { requirePermission, type Actor } from "../../rbac/actor";
import type { PermissionKey } from "../../rbac/permissions";

/** Typed, validated settings stored as JSON rows in the Setting table. */
const schemas = {
  company: z.object({
    name: z.string(),
    address: z.string().default(""),
    phone: z.string().default(""),
    email: z.string().default(""),
    gstNumber: z.string().default(""),
    logoKey: z.string().nullable().default(null),
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
  numbering: z.object({
    padLength: z.number().int().min(3).max(10),
    prefixes: z.record(z.string(), z.string()),
  }),
} as const;

export type SettingKey = keyof typeof schemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof schemas)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  company: { name: "My Workshop", address: "", phone: "", email: "", gstNumber: "", logoKey: null },
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
