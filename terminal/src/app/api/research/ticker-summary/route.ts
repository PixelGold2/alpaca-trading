import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { generateTickerSummary } from "@/lib/research/ticker-summary";

export async function GET(request: NextRequest) {
  await verifySession();

  const symbol = request.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json(
      { data: null, meta: { provider: "gemini", timestamp: new Date().toISOString(), status: "error", message: "No symbol provided." } },
      { status: 400 },
    );
  }

  const result = await generateTickerSummary(symbol.toUpperCase());
  return NextResponse.json(result);
}
