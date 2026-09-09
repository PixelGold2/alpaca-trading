"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { deleteAllSessionsForUser } from "@/lib/auth/session";
import { outranks } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

const ROLES = ["admin", "user", "viewer"] as const;

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url"); // 12 chars, URL-safe
}

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
});

export interface InviteState {
  error?: string;
  success?: { email: string; tempPassword: string };
}

export async function inviteUser(_prev: InviteState, formData: FormData): Promise<InviteState> {
  await requireRole("admin");

  const parsed = InviteSchema.safeParse({
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: "Check the fields — a valid email, display name, and role are required." };
  }

  const { email, displayName, role } = parsed.data;
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    await query(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`,
      [email, passwordHash, displayName, role]
    );
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      return { error: "A user with that email already exists." };
    }
    return { error: "Failed to create user." };
  }

  revalidatePath("/admin");
  return { success: { email, tempPassword } };
}

export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  await requireRole("admin");
  await query(`UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2`, [
    isActive,
    userId,
  ]);
  if (!isActive) {
    await deleteAllSessionsForUser(userId);
  }
  revalidatePath("/admin");
}

export async function changeUserRole(userId: string, role: (typeof ROLES)[number]): Promise<void> {
  await requireRole("admin");
  await query(`UPDATE users SET role = $1, updated_at = now() WHERE id = $2`, [role, userId]);
  revalidatePath("/admin");
}

/**
 * Delete only extends to strictly-inferior roles (outranks, not
 * hasRoleAtLeast) — an admin can delete a user/viewer but not a peer admin
 * or the founder; a founder can delete admin/user/viewer but not another
 * founder. Self-delete is blocked regardless of rank.
 */
export async function deleteUser(userId: string): Promise<void> {
  const actor = await requireRole("admin");
  if (userId === actor.id) {
    throw new Error("You can't delete your own account.");
  }

  const { rows } = await query<{ role: SessionUser["role"] }>(`SELECT role FROM users WHERE id = $1`, [userId]);
  const target = rows[0];
  if (!target) return;

  if (!outranks(actor.role, target.role)) {
    throw new Error("You don't have permission to delete this user.");
  }

  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  revalidatePath("/admin");
}

export async function approveRegistrationRequest(userId: string): Promise<void> {
  await requireRole("admin");
  await query(`UPDATE users SET approval_status = 'approved', updated_at = now() WHERE id = $1`, [userId]);
  revalidatePath("/admin");
}

export async function rejectRegistrationRequest(userId: string): Promise<void> {
  await requireRole("admin");
  await query(`UPDATE users SET approval_status = 'rejected', updated_at = now() WHERE id = $1`, [userId]);
  revalidatePath("/admin");
}
