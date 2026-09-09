import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { CHAT_CATEGORIES, type ChatCategory } from "@/lib/chat/categories";

const MESSAGE_LIMIT = 100;

export interface ChatMessageRow {
  id: string;
  category: ChatCategory;
  body: string | null;
  imageDataUrl: string | null;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderHasAvatar: boolean;
  createdAt: string;
}

export async function GET(request: NextRequest) {
  await verifySession();

  const category = request.nextUrl.searchParams.get("category");
  if (!category || !CHAT_CATEGORIES.includes(category as ChatCategory)) {
    return NextResponse.json({ error: "Invalid or missing 'category' parameter." }, { status: 400 });
  }

  const { rows } = await query<{
    id: string;
    category: ChatCategory;
    body: string | null;
    image_data: Buffer | null;
    image_mime_type: string | null;
    sender_id: string;
    sender_name: string;
    sender_role: string;
    sender_has_avatar: boolean;
    created_at: string;
  }>(
    `SELECT m.id, m.category, m.body, m.image_data, m.image_mime_type,
            m.sender_id, u.display_name AS sender_name, u.role AS sender_role,
            (u.avatar_data IS NOT NULL) AS sender_has_avatar, m.created_at
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.category = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [category, MESSAGE_LIMIT],
  );

  const messages: ChatMessageRow[] = rows
    .map((r) => ({
      id: r.id,
      category: r.category,
      body: r.body,
      imageDataUrl: r.image_data ? `data:${r.image_mime_type};base64,${r.image_data.toString("base64")}` : null,
      senderId: r.sender_id,
      senderName: r.sender_name,
      senderRole: r.sender_role,
      senderHasAvatar: r.sender_has_avatar,
      createdAt: r.created_at,
    }))
    .reverse(); // oldest -> newest for chronological chat rendering

  return NextResponse.json({ messages });
}
