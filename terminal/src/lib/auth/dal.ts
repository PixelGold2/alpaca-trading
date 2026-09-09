import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { hasRoleAtLeast } from "@/lib/auth/roles";

/**
 * The single source of truth for "is this request authenticated." Every Server
 * Component, Server Action, and Route Handler that needs the current user should
 * go through this — never trust proxy.ts alone (see Next.js auth guide: proxy is
 * optimistic-only, real checks belong next to the data).
 */
export const verifySession = cache(async (): Promise<SessionUser> => {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
});

export const getOptionalSession = cache(async (): Promise<SessionUser | null> => {
  return getSessionUser();
});

/**
 * Passes if the user's role meets or exceeds ANY of the given minimum roles
 * (hierarchical, not exact-match) — e.g. requireRole("admin") also permits
 * "founder", since founder ranks above admin. See lib/auth/roles.ts.
 */
export async function requireRole(...roles: SessionUser["role"][]): Promise<SessionUser> {
  const user = await verifySession();
  if (!roles.some((minimum) => hasRoleAtLeast(user.role, minimum))) {
    redirect("/forbidden");
  }
  return user;
}
