"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth/session";
import { transaction } from "@/server/db";
import { invalid, runAction, type ActionResult } from "@/server/lib/errors";
import type { ItemInput, TaxType } from "@/server/modules/billing/calc";
import { adjustCommission, approveCommissions, cancelCommission, markCommissionsPaid, setDefaultRates, setUserRate } from "@/server/modules/billing/commissions";
import { addCategory, createExpense, voidExpense } from "@/server/modules/billing/expenses";
import { cancelInvoice, createInvoice, recordPayment, updateInvoice, voidPayment } from "@/server/modules/billing/invoices";
import { recordSalaryPayment, setSalary, voidSalaryPayment } from "@/server/modules/billing/salary";
import { getSetting, updateSetting } from "@/server/modules/settings/service";
import { storeImage, type UploadInput } from "@/server/storage";

type R = ActionResult<unknown>;
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const file = (fd: FormData, k: string) => {
  const f = fd.get(k);
  return f && typeof f === "object" && (f as File).size > 0 ? (f as unknown as UploadInput) : null;
};

/** Items are posted as JSON from the invoice editor. */
function invoiceFromForm(fd: FormData) {
  let items: ItemInput[];
  try {
    items = JSON.parse(s(fd, "items") ?? "[]");
    if (!Array.isArray(items)) throw new Error();
  } catch {
    throw invalid("Invoice items could not be read. Please try again.");
  }
  return {
    invoiceDate: s(fd, "invoiceDate") ?? "",
    dueDate: s(fd, "dueDate") || undefined,
    taxType: (s(fd, "taxType") as TaxType) || undefined,
    notes: s(fd, "notes"),
    items,
  };
}

export async function createInvoiceAction(workId: string, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => createInvoice(await actorOrThrow(), workId, invoiceFromForm(fd)));
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  redirect(`/admin/invoices/${(res.data as { id: string }).id}?created=1`);
}

export async function updateInvoiceAction(invoiceId: string, _p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => updateInvoice(await actorOrThrow(), invoiceId, invoiceFromForm(fd), s(fd, "reason") ?? ""));
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  redirect(`/admin/invoices/${invoiceId}?updated=1`);
}

export async function cancelInvoiceAction(invoiceId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await cancelInvoice(await actorOrThrow(), invoiceId, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Invoice cancelled.");
}

export async function recordPaymentAction(invoiceId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await recordPayment(await actorOrThrow(), invoiceId, {
      amount: s(fd, "amount") ?? "",
      paidOn: s(fd, "paidOn") ?? "",
      method: s(fd, "method") ?? "",
      reference: s(fd, "reference"),
      notes: s(fd, "notes"),
    });
    revalidatePath("/", "layout");
  }, "Payment recorded.");
}

export async function voidPaymentAction(paymentId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await voidPayment(await actorOrThrow(), paymentId, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Payment voided.");
}

export async function createExpenseAction(_p: R | null, fd: FormData): Promise<R> {
  const res = await runAction(async () => {
    return createExpense(await actorOrThrow(), {
      title: s(fd, "title") ?? "",
      amount: s(fd, "amount") ?? "",
      spentOn: s(fd, "spentOn") ?? "",
      categoryId: s(fd, "categoryId") ?? "",
      branchId: s(fd, "branchId") || undefined,
      workReference: s(fd, "workReference") || undefined,
      description: s(fd, "description"),
      receipt: file(fd, "receipt"),
    });
  }, "Expense recorded.");
  if (!res.ok) return res;
  revalidatePath("/admin/expenses");
  redirect("/admin/expenses?created=1");
}

export async function voidExpenseAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await voidExpense(await actorOrThrow(), id, s(fd, "reason") ?? "");
    revalidatePath("/admin/expenses");
  }, "Expense voided.");
}

export async function addCategoryAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await addCategory(await actorOrThrow(), s(fd, "name") ?? "");
    revalidatePath("/admin/expenses");
  }, "Category added.");
}

export async function commissionBulkAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    const ids = fd.getAll("ids").map(String);
    const op = s(fd, "op");
    const n = op === "pay" ? await markCommissionsPaid(actor, ids, s(fd, "reference")) : await approveCommissions(actor, ids);
    revalidatePath("/", "layout");
    return n;
  }, "Commissions updated.");
}

export async function adjustCommissionAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await adjustCommission(await actorOrThrow(), id, { percent: s(fd, "percent"), amount: s(fd, "amount"), reason: s(fd, "reason") ?? "" });
    revalidatePath("/", "layout");
  }, "Commission adjusted.");
}

export async function cancelCommissionAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await cancelCommission(await actorOrThrow(), id, s(fd, "reason") ?? "");
    revalidatePath("/", "layout");
  }, "Commission cancelled.");
}

export async function saveDefaultRatesAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await setDefaultRates(await actorOrThrow(), {
      agentPercent: Number(s(fd, "agentPercent")),
      workerPercent: Number(s(fd, "workerPercent")),
      workerMode: s(fd, "workerMode") === "EACH" ? "EACH" : "SPLIT",
      reason: s(fd, "reason"),
    });
    revalidatePath("/admin/commissions");
  }, "Default rates saved. New approvals will use them.");
}

export async function saveUserRateAction(userId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await setUserRate(await actorOrThrow(), userId, s(fd, "percent") ?? "", s(fd, "reason"));
    revalidatePath("/admin/commissions");
  }, "Rate saved.");
}

export async function setSalaryAction(userId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await setSalary(await actorOrThrow(), userId, { amount: s(fd, "amount") ?? "", type: s(fd, "type") ?? "", reason: s(fd, "reason") });
    revalidatePath("/admin/salaries");
  }, "Salary updated.");
}

export async function paySalaryAction(userId: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await recordSalaryPayment(await actorOrThrow(), userId, {
      period: s(fd, "period") ?? "",
      amount: s(fd, "amount") ?? "",
      paidOn: s(fd, "paidOn") ?? "",
      method: s(fd, "method") ?? "",
      reference: s(fd, "reference"),
      notes: s(fd, "notes"),
    });
    revalidatePath("/admin/salaries");
  }, "Salary payment recorded.");
}

export async function voidSalaryAction(id: string, _p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    await voidSalaryPayment(await actorOrThrow(), id, s(fd, "reason") ?? "");
    revalidatePath("/admin/salaries");
  }, "Salary payment voided.");
}

export async function saveBillingSettingsAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    await transaction(async (tx) => {
      await updateSetting(actor, "tax", {
        gstEnabled: fd.get("gstEnabled") === "on",
        defaultRate: Number(s(fd, "defaultRate") ?? 18),
        defaultTaxType: (s(fd, "defaultTaxType") as TaxType) ?? "INTRA_STATE",
        roundToRupee: fd.get("roundToRupee") === "on",
        stateName: s(fd, "stateName") ?? "",
      }, tx, "billing.settings");
      await updateSetting(actor, "invoice", {
        dueDays: Number(s(fd, "dueDays") ?? 7),
        terms: s(fd, "terms") ?? "",
        bankDetails: s(fd, "bankDetails") ?? "",
      }, tx, "billing.settings");
      const numbering = await getSetting("numbering", tx);
      const prefix = (s(fd, "invoicePrefix") ?? "INV").trim().toUpperCase();
      if (!/^[A-Z0-9-]{1,10}$/.test(prefix)) throw invalid("Invoice prefix: 1–10 letters, numbers or dashes.");
      await updateSetting(actor, "numbering", { ...numbering, prefixes: { ...numbering.prefixes, INV: prefix } }, tx, "billing.settings");
    });
    revalidatePath("/admin/settings");
  }, "Billing settings saved.");
}

export async function uploadLogoAction(_p: R | null, fd: FormData): Promise<R> {
  return runAction(async () => {
    const actor = await actorOrThrow();
    const f = file(fd, "logo");
    const remove = fd.get("removeLogo") === "on";
    if (!f && !remove) throw invalid("Choose a PNG or JPG logo.");
    let logoKey: string | null = null;
    if (f) {
      const stored = await storeImage(f, "branding");
      if (!/\.(png|jpg)$/.test(stored.storageKey)) throw invalid("Logo must be PNG or JPG (used on invoice PDFs).");
      logoKey = stored.storageKey;
    }
    await transaction(async (tx) => {
      const company = await getSetting("company", tx);
      await updateSetting(actor, "company", { ...company, logoKey }, tx);
    });
    revalidatePath("/", "layout");
  }, "Logo updated.");
}
