import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";

export interface UserProfileResponse {
  id: string;
  displayName: string;
  role: string;
  bio: string | null;
  lastSeenAt: string | null;
  hasAvatar: boolean;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;

  const { rows } = await query<{
    id: string;
    display_name: string;
    role: string;
    bio: string | null;
    last_seen_at: string | null;
    has_avatar: boolean;
  }>(
    `SELECT id, display_name, role, bio, last_seen_at, (avatar_data IS NOT NULL) AS has_avatar
     FROM users WHERE id = $1`,
    [id]
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const profile: UserProfileResponse = {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    bio: row.bio,
    lastSeenAt: row.last_seen_at,
    hasAvatar: row.has_avatar,
  };
  return NextResponse.json(profile);
}
