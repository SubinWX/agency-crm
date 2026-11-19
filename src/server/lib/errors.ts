/**
 * Application error with a human-readable message safe to show end users.
 * Technical detail goes in `cause` and is only logged server-side.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CAPACITY_FULL"
  | "DATE_BLOCKED"
  | "INVALID_STATE"
  | "RATE_LIMITED";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "You do not have permission to do this.") =>
  new AppError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const invalid = (msg: string, details?: Record<string, unknown>) =>
  new AppError("VALIDATION", msg, details);

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code?: ErrorCode; details?: Record<string, unknown> };

/** Wrap a server-action body so AppErrors become friendly results and anything else is logged. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    // Next.js redirect()/notFound() throw special errors that must propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw err;
    }
    if (err instanceof AppError) {
      return { ok: false, error: err.message, code: err.code, details: err.details };
    }
    if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown[] }).issues)) {
      const issue = (err as { issues: { message?: string }[] }).issues[0];
      return { ok: false, error: issue?.message || "Please check the form.", code: "VALIDATION" };
    }
    console.error("[action error]", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Validate with a Zod schema and turn failures into a friendly VALIDATION
 * AppError (first message as the summary, plus per-field messages).
 */
export function parseInput<S extends { safeParse(d: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }>(
  schema: S,
  data: unknown,
): Extract<ReturnType<S["safeParse"]>, { success: true }>["data"] {
  const r = schema.safeParse(data);
  if (r.success) return r.data as Extract<ReturnType<S["safeParse"]>, { success: true }>["data"];
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.map(String).join(".") || "_";
    fieldErrors[k] ??= i.message;
  }
  const first = r.error.issues[0];
  throw new AppError("VALIDATION", first?.message || "Please check the form.", { fieldErrors });
}
