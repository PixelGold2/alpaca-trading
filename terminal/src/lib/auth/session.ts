import "server-only";
import { cookies, headers } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { query } from "@/lib/db";
import { env } from "@/lib/env";

const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "user" | "viewer" | "founder";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax" as const,
    expires: expiresAt,
    path: "/",
  };
}

export async function createSession(
  userId: string,
  opts: { rememberMe: boolean }
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const ttl = opts.rememberMe ? REMEMBER_ME_TTL_MS : DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  const hdrs = await headers();
  const userAgent = hdrs.get("user-agent") ?? null;

  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, remember_me, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt, opts.rememberMe, userAgent]
  );

  const cookieStore = await cookies();
  cookieStore.set(env.sessionCookieName, token, await cookieOptions(expiresAt));
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const { rows } = await query<{
    id: string;
    email: string;
    display_name: string;
    role: "admin" | "user" | "viewer" | "founder";
    is_active: boolean;
  }>(
    `SELECT u.id, u.email, u.display_name, u.role, u.is_active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row || !row.is_active) return null;

  // Best-effort presence heartbeat, throttled to once/minute per user so an
  // authenticated request on every page/poll doesn't turn into a write every
  // time. Read back through lib/presence.ts's online/away/offline thresholds.
  try {
    await query(
      `UPDATE users SET last_seen_at = now()
       WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '60 seconds')`,
      [row.id]
    );
  } catch {
    // Never let a heartbeat failure break auth — just delays the next "Online" read.
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

export async function deleteCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;
  if (token) {
    await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  }
  cookieStore.delete(env.sessionCookieName);
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}
