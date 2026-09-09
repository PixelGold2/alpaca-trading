"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { query } from "@/lib/db";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — illustrative screenshots, not general file storage

const WhatsNewSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  body: z.string().trim().min(1, "Body is required.").max(4000),
});

export interface WhatsNewState {
  error?: string;
  success?: boolean;
}

export async function createWhatsNewPost(_prev: WhatsNewState, formData: FormData): Promise<WhatsNewState> {
  const admin = await requireRole("admin");

  const parsed = WhatsNewSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const image = formData.get("image");
  let imageBuffer: Buffer | null = null;
  let imageMimeType: string | null = null;

  if (image instanceof File && image.size > 0) {
    if (!image.type.startsWith("image/")) {
      return { error: "Attachment must be an image." };
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return { error: "Image is too large (5MB max)." };
    }
    imageBuffer = Buffer.from(await image.arrayBuffer());
    imageMimeType = image.type;
  }

  await query(
    `INSERT INTO whats_new_posts (title, body, image_data, image_mime_type, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [parsed.data.title, parsed.data.body, imageBuffer, imageMimeType, admin.id],
  );

  revalidatePath("/whats-new");
  revalidatePath("/admin");
  return { success: true };
}

export async function deleteWhatsNewPost(id: string): Promise<void> {
  await requireRole("admin");
  await query(`DELETE FROM whats_new_posts WHERE id = $1`, [id]);
  revalidatePath("/whats-new");
  revalidatePath("/admin");
}
