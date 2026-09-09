"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "At least 8 characters."),
});

export interface ChangePasswordState {
  error?: string;
  success?: boolean;
}

export async function changeOwnPassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await verifySession();

  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const { rows } = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [
    user.id,
  ]);
  const valid = rows[0] && (await verifyPassword(parsed.data.currentPassword, rows[0].password_hash));
  if (!valid) {
    return { error: "Current password is incorrect." };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [newHash, user.id]);

  return { success: true };
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  const user = await verifySession();
  await query(`UPDATE users SET notifications_enabled = $1, updated_at = now() WHERE id = $2`, [
    enabled,
    user.id,
  ]);
  revalidatePath("/settings");
}
