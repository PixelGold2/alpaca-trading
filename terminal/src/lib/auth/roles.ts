import type { SessionUser } from "@/lib/auth/session";

// "founder" ranks above "admin" — every check gated at "admin" (requireRole,
// the .role === "admin" UI gates, etc.) must automatically also permit
// founder, without every current and future call site remembering to list
// founder explicitly. hasRoleAtLeast is the single source of truth for that
// ordering; requireRole in dal.ts uses it instead of exact allowlist matching.
const ROLE_RANK: Record<SessionUser["role"], number> = {
  viewer: 0,
  user: 1,
  admin: 2,
  founder: 3,
};

export function hasRoleAtLeast(role: SessionUser["role"], minimum: SessionUser["role"]): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Strictly-greater-than comparison — used for "can X manage/delete Y" checks,
 * where peers (e.g. admin-on-admin, founder-on-founder) must NOT qualify. */
export function outranks(role: SessionUser["role"], other: SessionUser["role"]): boolean {
  return ROLE_RANK[role] > ROLE_RANK[other];
}
