"use client";

import { useActionState } from "react";
import { changeOwnPassword, type ChangePasswordState } from "@/app/actions/settings";

const initialState: ChangePasswordState = {};

const fieldClass =
  "w-full max-w-sm rounded-md border border-border bg-bg-panel-raised px-3 py-2 text-sm text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeOwnPassword, initialState);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="currentPassword" className="block text-xs font-medium text-text-secondary">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          className={fieldClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="block text-xs font-medium text-text-secondary">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
          className={fieldClass}
          placeholder="At least 8 characters"
        />
      </div>

      {state.error && (
        <p className="max-w-sm rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="max-w-sm rounded-md border border-positive/30 bg-positive/10 px-3 py-2 text-xs text-positive">
          Password updated.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
