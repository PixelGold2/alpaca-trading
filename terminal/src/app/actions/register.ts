"use server";

import { z } from "zod";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

const RegisterSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, and _ . - only."),
  password: z.string().min(8, "At least 8 characters."),
});

export interface RegisterState {
  error?: string;
  success?: boolean;
}

export async function registerAccount(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const parsed = RegisterSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const { firstName, lastName, email, username, password } = parsed.data;
  const displayName = `${firstName} ${lastName}`;
  const passwordHash = await hashPassword(password);

  try {
    await query(
      `INSERT INTO users (email, password_hash, display_name, first_name, last_name, username, role, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'user', 'pending')`,
      [email, passwordHash, displayName, firstName, lastName, username],
    );

    const admins = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`);
    for (const admin of admins.rows) {
      await query(
        `INSERT INTO notifications (recipient_user_id, type, title, body, link)
         VALUES ($1, 'registration_request', 'New account request', $2, '/admin')`,
        [admin.id, `${displayName} (${email}) requested access.`],
      );
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      return { error: "That email or username is already taken." };
    }
    return { error: "Registration failed. Try again." };
  }

  return { success: true };
}
