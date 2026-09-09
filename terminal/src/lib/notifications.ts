import "server-only";
import { query } from "@/lib/db";

/**
 * Inserts one notification row per user — same broadcast pattern already
 * used for admin "new account request" notifications (see
 * app/actions/register.ts), just targeting every user instead of admins
 * only. The recipient's own notifications_enabled toggle is checked at read
 * time (see api/notifications/route.ts's GET), not here, so this never
 * needs to know who currently has notifications on.
 */
export async function notifyAllUsers(notification: {
  type: string;
  title: string;
  body: string;
  link?: string;
}): Promise<void> {
  const { rows } = await query<{ id: string }>(`SELECT id FROM users`);
  for (const user of rows) {
    await query(
      `INSERT INTO notifications (recipient_user_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, notification.type, notification.title, notification.body, notification.link ?? null],
    );
  }
}
