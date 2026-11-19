import { Prisma, type CustomField, type CustomFieldType } from "@prisma/client";
import { z } from "zod";
import { prisma, transaction } from "../../db";
import { audit } from "../../lib/audit";
import { isIsoDate } from "../../lib/dates";
import { invalid, parseInput } from "../../lib/errors";
import { requirePermission, type Actor } from "../../rbac/actor";

export async function listActiveFields() {
  return prisma.customField.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

export async function listAllFields() {
  return prisma.customField.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

const fieldInput = z.object({
  label: z.string().trim().min(1, "Label is required").max(80),
  type: z.enum(["TEXT", "NUMBER", "DECIMAL", "DROPDOWN", "DATE", "CHECKBOX", "RADIO", "TEXTAREA", "IMAGE"]),
  required: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  helpText: z.string().trim().max(200).optional(),
});
export type FieldInput = z.input<typeof fieldInput>;

function slugKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}

export async function saveField(actor: Actor, input: FieldInput, id?: string): Promise<CustomField> {
  requirePermission(actor, "custom_fields.manage");
  const data = parseInput(fieldInput, input);
  if ((data.type === "DROPDOWN" || data.type === "RADIO") && !data.options?.length) {
    throw invalid("Dropdown and radio fields need at least one option.");
  }
  if (data.type === "IMAGE") {
    throw invalid("Image fields are not supported yet — use the work images section.");
  }
  const options = data.type === "DROPDOWN" || data.type === "RADIO" ? (data.options as Prisma.InputJsonValue) : undefined;
  return transaction(async (tx) => {
    if (id) {
      const before = await tx.customField.findUniqueOrThrow({ where: { id } });
      const field = await tx.customField.update({
        where: { id },
        data: { ...data, options: options ?? Prisma.DbNull, helpText: data.helpText || null },
      });
      await audit(tx, actor, { action: "custom_field.update", entityType: "CustomField", entityId: id, before, after: field });
      return field;
    }
    let key = slugKey(data.label);
    if (await tx.customField.findUnique({ where: { key } })) key = `${key}_${Date.now().toString(36)}`;
    const field = await tx.customField.create({
      data: { ...data, key, options, helpText: data.helpText || null },
    });
    await audit(tx, actor, { action: "custom_field.create", entityType: "CustomField", entityId: field.id, after: field });
    return field;
  });
}

export type CustomValue = string | number | boolean;

/**
 * Validate raw form values (strings from FormData) against active field
 * definitions and convert them to typed values. Returns only fields that have a value.
 */
export function parseCustomValues(
  fields: Pick<CustomField, "id" | "key" | "label" | "type" | "required" | "options">[],
  raw: Record<string, string | undefined>,
): Map<string, CustomValue> {
  const out = new Map<string, CustomValue>();
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (raw[f.key] ?? "").trim();
    const type = f.type as CustomFieldType;
    if (type === "CHECKBOX") {
      const checked = v === "on" || v === "true";
      if (f.required && !checked) errors[f.key] = `${f.label} must be checked.`;
      out.set(f.id, checked);
      continue;
    }
    if (!v) {
      if (f.required) errors[f.key] = `${f.label} is required.`;
      continue;
    }
    switch (type) {
      case "NUMBER": {
        if (!/^-?\d+$/.test(v)) errors[f.key] = `${f.label} must be a whole number.`;
        else out.set(f.id, Number(v));
        break;
      }
      case "DECIMAL": {
        if (!/^-?\d+(\.\d+)?$/.test(v)) errors[f.key] = `${f.label} must be a number.`;
        else out.set(f.id, Number(v));
        break;
      }
      case "DATE": {
        if (!isIsoDate(v)) errors[f.key] = `${f.label} must be a valid date.`;
        else out.set(f.id, v);
        break;
      }
      case "DROPDOWN":
      case "RADIO": {
        const opts = Array.isArray(f.options) ? (f.options as string[]) : [];
        if (!opts.includes(v)) errors[f.key] = `Please choose a valid ${f.label}.`;
        else out.set(f.id, v);
        break;
      }
      default:
        out.set(f.id, v.slice(0, type === "TEXTAREA" ? 4000 : 500));
    }
  }
  if (Object.keys(errors).length) throw invalid("Please fix the highlighted fields.", { fieldErrors: errors });
  return out;
}
