"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession, requireRole } from "@/lib/auth/dal";
import { query } from "@/lib/db";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — evidence screenshots, not general file storage

const FeedbackSchema = z.object({
  type: z.enum(["feedback", "bug"]),
  description: z.string().trim().min(1, "Description is required.").max(4000),
  pageUrl: z.string().trim().max(500).optional(),
});

export interface FeedbackState {
  error?: string;
  success?: boolean;
}

export async function submitFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const user = await verifySession();

  const parsed = FeedbackSchema.safeParse({
    type: formData.get("type"),
    description: formData.get("description"),
    pageUrl: formData.get("pageUrl") || undefined,
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
    `INSERT INTO feedback_reports (submitted_by, type, description, page_url, image_data, image_mime_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, parsed.data.type, parsed.data.description, parsed.data.pageUrl ?? null, imageBuffer, imageMimeType],
  );

  revalidatePath("/admin");
  return { success: true };
}

export async function updateFeedbackStatus(
  id: string,
  status: "open" | "reviewed" | "resolved",
): Promise<void> {
  await requireRole("admin");
  await query(`UPDATE feedback_reports SET status = $1 WHERE id = $2`, [status, id]);
  revalidatePath("/admin");
}
