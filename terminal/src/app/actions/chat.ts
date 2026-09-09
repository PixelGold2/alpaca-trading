"use server";

import { z } from "zod";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { CHAT_CATEGORIES } from "@/lib/chat/categories";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — shared chat attachments, not general file storage

const SendMessageSchema = z.object({
  category: z.enum(CHAT_CATEGORIES),
  body: z.string().trim().max(4000).optional(),
});

export interface SendMessageState {
  error?: string;
  success?: boolean;
}

export async function sendChatMessage(_prev: SendMessageState, formData: FormData): Promise<SendMessageState> {
  const user = await verifySession();

  const parsed = SendMessageSchema.safeParse({
    category: formData.get("category"),
    body: formData.get("body") || undefined,
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

  if (!parsed.data.body && !imageBuffer) {
    return { error: "Message needs text, an image, or both." };
  }

  await query(
    `INSERT INTO chat_messages (category, sender_id, body, image_data, image_mime_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [parsed.data.category, user.id, parsed.data.body ?? null, imageBuffer, imageMimeType],
  );

  return { success: true };
}
