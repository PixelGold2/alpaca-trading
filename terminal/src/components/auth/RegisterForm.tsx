"use client";

import { useActionState, useState } from "react";
import { registerAccount, type RegisterState } from "@/app/actions/register";

const initialState: RegisterState = {};

const fieldClass =
  "w-full rounded-md border border-border bg-bg-panel-raised px-3 py-2 text-sm text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAccount, initialState);
  const [showPassword, setShowPassword] = useState(false);

  if (state.success) {
    return (
      <p className="rounded-md border border-positive/30 bg-positive/10 px-3 py-3 text-xs text-positive">
        Request submitted. An admin needs to approve your account before you can sign in.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="firstName" className="block text-xs font-medium text-text-secondary">
            First name
          </label>
          <input id="firstName" name="firstName" type="text" required disabled={pending} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lastName" className="block text-xs font-medium text-text-secondary">
            Last name
          </label>
          <input id="lastName" name="lastName" type="text" required disabled={pending} className={fieldClass} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-xs font-medium text-text-secondary">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className={fieldClass}
          placeholder="you@company.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="username" className="block text-xs font-medium text-text-secondary">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          disabled={pending}
          className={fieldClass}
          placeholder="At least 3 characters"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-xs font-medium text-text-secondary">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            disabled={pending}
            className={`${fieldClass} pr-16`}
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text-secondary"
            tabIndex={-1}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {state.error && (
        <p className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Submitting..." : "Request access"}
      </button>
    </form>
  );
}
