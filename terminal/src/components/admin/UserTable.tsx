"use client";

import { useState, useTransition } from "react";
import { setUserActive, changeUserRole, deleteUser } from "@/app/actions/admin";
import { outranks } from "@/lib/auth/roles";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import type { SessionUser } from "@/lib/auth/session";

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "user" | "viewer" | "founder";
  isActive: boolean;
  createdAt: string;
}

export function UserTable({
  users,
  currentUserId,
  currentUserRole,
}: {
  users: AdminUserRow[];
  currentUserId: string;
  currentUserRole: SessionUser["role"];
}) {
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filtered = query
    ? users.filter(
        (u) => u.email.toLowerCase().includes(query) || u.displayName.toLowerCase().includes(query)
      )
    : users;

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or name…"
        className="mb-3 w-full max-w-xs rounded-md border border-border bg-bg-panel-raised px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
      />

      {filtered.length === 0 ? (
        <p className="text-xs text-text-muted">No users match &quot;{search}&quot;.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-border/50">
                <td className="py-2 text-text-primary">{u.email}</td>
                <td className="py-2 text-text-secondary">{u.displayName}</td>
                <td className="py-2">
                  {u.role === "founder" ? (
                    <span
                      className="font-medium text-warning"
                      title="Founder is not reassignable from this table."
                    >
                      Founder
                    </span>
                  ) : (
                    <select
                      value={u.role}
                      disabled={isPending || u.id === currentUserId}
                      onChange={(e) =>
                        startTransition(() =>
                          changeUserRole(u.id, e.target.value as "admin" | "user" | "viewer")
                        )
                      }
                      className="rounded border border-border bg-bg-panel-raised px-1.5 py-1 text-text-primary disabled:opacity-50"
                    >
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </td>
                <td className="py-2">
                  <span className={u.isActive ? "text-positive" : "text-negative"}>
                    {u.isActive ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="py-2 text-text-muted">
                  {new Date(u.createdAt).toLocaleDateString("en-US")}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={isPending || u.id === currentUserId}
                      onClick={() => startTransition(() => setUserActive(u.id, !u.isActive))}
                      className="rounded border border-border px-2 py-1 text-text-secondary hover:bg-bg-hover disabled:opacity-50"
                    >
                      {u.isActive ? "Disable" : "Enable"}
                    </button>
                    {u.id !== currentUserId && outranks(currentUserRole, u.role) && (
                      <ConfirmButton
                        label="Delete"
                        variant="danger"
                        confirmText={`Permanently delete ${u.displayName} (${u.email})? This can't be undone.`}
                        disabled={isPending}
                        onConfirm={() => startTransition(() => deleteUser(u.id))}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
