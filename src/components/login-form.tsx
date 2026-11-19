"use client";

import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, SubmitButton } from "./action-form";

export function LoginForm({ action }: { action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>> }) {
  return (
    <ActionForm action={action}>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </ActionForm>
  );
}
