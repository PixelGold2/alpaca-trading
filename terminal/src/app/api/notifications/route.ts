import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";

const MAX_NOTIFICATIONS = 30;

export async function GET() {
  const user = await verifySession();

  const { rows: prefRows } = await query<{ notifications_enabled: boolean }>(
    `SELECT notifications_enabled FROM users WHERE id = $1`,
    [user.id],
  );
  if (!prefRows[0]?.notifications_enabled) {
    return NextResponse.json({ notifications: [], enabled: false });
  }

  const { rows } = await query<{
    id: string;
    type: string;
    title: string;
    body: string;
    link: string | null;
    read_at: string | null;
    created_at: string;
  }>(
    `SELECT id, type, title, body, link, read_at, created_at FROM notifications
     WHERE recipient_user_id = $1 ORDER BY read_at IS NOT NULL, created_at DESC LIMIT $2`,
    [user.id, MAX_NOTIFICATIONS],
  );

  return NextResponse.json({
    enabled: true,
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      read: r.read_at !== null,
      createdAt: r.created_at,
    })),
  });
}

const PatchSchema = z.object({
  id: z.string().uuid().optional(),
  markAll: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const user = await verifySession();
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (parsed.data.markAll) {
    await query(
      `UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [user.id],
    );
  } else if (parsed.data.id) {
    await query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND recipient_user_id = $2`,
      [parsed.data.id, user.id],
    );
  } else {
    return NextResponse.json({ error: "Provide 'id' or 'markAll'." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
