"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, deleteCurrentSession } from "@/lib/auth/session";
import { checkRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  rememberMe: z.boolean(),
});

export interface LoginState {
  error?: string;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    rememberMe: formData.get("rememberMe") === "on",
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const { email, password, rememberMe } = parsed.data;

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rateLimitKey = `${ip}:${email}`;

  const rateLimit = checkRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const { rows } = await query<{
    id: string;
    password_hash: string;
    is_active: boolean;
    approval_status: "pending" | "approved" | "rejected";
  }>(`SELECT id, password_hash, is_active, approval_status FROM users WHERE email = $1`, [email]);

  const user = rows[0];
  // Always compare against a hash, even on a miss, so login timing doesn't reveal
  // whether the email exists in the system.
  const passwordHash = user?.password_hash ?? "$2a$12$invalidsaltinvalidsaltinvalidsa.";
  const validPassword = await verifyPassword(password, passwordHash);

  if (!user || !validPassword || !user.is_active) {
    return { error: "Invalid email or password." };
  }

  // Only reachable once credentials are already confirmed correct, so this
  // doesn't leak account existence to a guesser — only to someone who already
  // knows the password.
  if (user.approval_status === "pending") {
    return { error: "Your account is awaiting admin approval." };
  }
  if (user.approval_status === "rejected") {
    return { error: "Your registration was not approved." };
  }

  resetRateLimit(rateLimitKey);
  await createSession(user.id, { rememberMe });
  redirect("/");
}

export async function logout(): Promise<void> {
  await deleteCurrentSession();
  redirect("/login");
}
