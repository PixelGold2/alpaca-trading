import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { getProfile } from "@/lib/fundamentals/finnhub-fundamentals";

export async function GET(request: NextRequest) {
  await verifySession();

  const symbol = request.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ error: "Missing required 'symbol' parameter." }, { status: 400 });
  }

  const result = await getProfile(symbol);
  return NextResponse.json(result);
}
