"use server";

import { z } from "zod";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB — shared avatar image, not general file storage

const UpdateProfileSchema = z.object({
  bio: z.string().trim().max(280, "Bio must be 280 characters or fewer.").optional(),
  removeAvatar: z.literal("true").optional(),
});

export interface UpdateProfileState {
  error?: string;
  success?: boolean;
  avatarChanged?: "set" | "removed";
}

export async function updateProfile(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const user = await verifySession();

  const parsed = UpdateProfileSchema.safeParse({
    bio: formData.get("bio") || undefined,
    removeAvatar: formData.get("removeAvatar") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const image = formData.get("avatar");
  let avatarBuffer: Buffer | null = null;
  let avatarMimeType: string | null = null;

  if (image instanceof File && image.size > 0) {
    if (!image.type.startsWith("image/")) {
      return { error: "Profile picture must be an image." };
    }
    if (image.size > MAX_AVATAR_BYTES) {
      return { error: "Image is too large (5MB max)." };
    }
    avatarBuffer = Buffer.from(await image.arrayBuffer());
    avatarMimeType = image.type;
  }

  const bio = parsed.data.bio ?? null;

  if (avatarBuffer) {
    await query(`UPDATE users SET bio = $1, avatar_data = $2, avatar_mime_type = $3 WHERE id = $4`, [
      bio,
      avatarBuffer,
      avatarMimeType,
      user.id,
    ]);
    return { success: true, avatarChanged: "set" };
  }

  if (parsed.data.removeAvatar === "true") {
    await query(`UPDATE users SET bio = $1, avatar_data = NULL, avatar_mime_type = NULL WHERE id = $2`, [
      bio,
      user.id,
    ]);
    return { success: true, avatarChanged: "removed" };
  }

  await query(`UPDATE users SET bio = $1 WHERE id = $2`, [bio, user.id]);
  return { success: true };
}
