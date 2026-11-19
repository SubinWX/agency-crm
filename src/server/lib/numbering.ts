import type { Tx } from "../db";
import { getSetting } from "../modules/settings/service";

/**
 * Atomically reserves the next number in a sequence and formats it, e.g. WRK-000001.
 * Uses INSERT … ON CONFLICT … RETURNING so concurrent callers never get duplicates.
 */
export async function nextReference(tx: Tx, key: "WRK" | "INV" | "PAY" | "SUP" | "EXP" | "STK"): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  const numbering = await getSetting("numbering", tx);
  const prefix = numbering.prefixes[key] ?? key;
  return `${prefix}-${String(rows[0].value).padStart(numbering.padLength, "0")}`;
}
