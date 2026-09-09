"use client";

import { useActionState } from "react";
import { inviteUser, type InviteState } from "@/app/actions/admin";

const initialState: InviteState = {};

export function InviteUserForm() {
  const [state, formAction, pending] = useActionState(inviteUser, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label className="block text-[10px] text-text-secondary">Email</label>
        <input
          name="email"
          type="email"
          required
          disabled={pending}
          className="rounded-md border border-border bg-bg-panel-raised px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
          placeholder="user@company.com"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[10px] text-text-secondary">Display name</label>
        <input
          name="displayName"
          type="text"
          required
          disabled={pending}
          className="rounded-md border border-border bg-bg-panel-raised px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
          placeholder="Jane Trader"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[10px] text-text-secondary">Role</label>
        <select
          name="role"
          defaultValue="user"
          disabled={pending}
          className="rounded-md border border-border bg-bg-panel-raised px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        >
          <option value="admin">Admin</option>
          <option value="user">User</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Inviting..." : "Invite"}
      </button>

      {state.error && <p className="w-full text-xs text-negative">{state.error}</p>}
      {state.success && (
        <p className="w-full rounded-md border border-positive/30 bg-positive/10 px-3 py-2 text-xs text-positive">
          Created {state.success.email}. Temporary password (share this out-of-band, it won&apos;t
          be shown again):{" "}
          <span className="font-mono font-semibold">{state.success.tempPassword}</span>
        </p>
      )}
    </form>
  );
}
