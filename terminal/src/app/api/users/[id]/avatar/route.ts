import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;

  const { rows } = await query<{ avatar_data: Buffer | null; avatar_mime_type: string | null }>(
    `SELECT avatar_data, avatar_mime_type FROM users WHERE id = $1`,
    [id]
  );

  const row = rows[0];
  if (!row?.avatar_data) {
    return NextResponse.json({ error: "No avatar." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(row.avatar_data), {
    headers: {
      "Content-Type": row.avatar_mime_type ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
