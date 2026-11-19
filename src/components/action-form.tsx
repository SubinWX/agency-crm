"use client";

import { createContext, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/server/lib/errors";

type Action = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

const FieldErrorsCtx = createContext<Record<string, string>>({});

/**
 * Form wrapper for server actions: shows friendly errors/success, per-field
 * errors, an optional confirmation prompt, and resets on success if asked.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
  confirm,
  resetOnSuccess = false,
  encType,
  id,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
  encType?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  const fieldErrors = (state && !state.ok && (state.details?.fieldErrors as Record<string, string>)) || {};
  const nextDates = state && !state.ok ? (state.details?.nextAvailableDates as string[] | undefined) : undefined;

  return (
    <form
      ref={ref}
      id={id}
      action={formAction}
      encType={encType}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {state && !state.ok && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
          {nextDates && nextDates.length > 0 && (
            <NextDates dates={nextDates} />
          )}
        </div>
      )}
      {state?.ok && state.message && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </div>
      )}
      <FieldErrorsCtx.Provider value={fieldErrors}>{children}</FieldErrorsCtx.Provider>
    </form>
  );
}

/** Clickable next-available-date chips; picks the date in a sibling date input named workDate/newDate. */
function NextDates({ dates }: { dates: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-red-700">Pick another date:</span>
      {dates.map((d) => (
        <button
          key={d}
          type="button"
          className="rounded-full border border-red-300 bg-white px-2.5 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100"
          onClick={(e) => {
            const form = (e.target as HTMLElement).closest("form");
            const input = form?.querySelector<HTMLInputElement>('input[name="workDate"], input[name="newDate"]');
            if (input) {
              input.value = d;
              input.dispatchEvent(new Event("change", { bubbles: true }));
              form?.dispatchEvent(new CustomEvent("crm:date-picked", { detail: d }));
            }
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

export function FieldError({ name }: { name: string }) {
  const errs = useContext(FieldErrorsCtx);
  return errs[name] ? <p className="mt-1 text-xs text-red-600">{errs[name]}</p> : null;
}

export function SubmitButton({ children, className = "btn-primary", pendingText = "Saving…" }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
