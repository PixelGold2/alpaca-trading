import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { alpacaProvider } from "@/lib/market-data/alpaca-provider";
import type { BarTimeframe } from "@/lib/market-data/types";

const VALID_TIMEFRAMES: BarTimeframe[] = [
  "1Min",
  "5Min",
  "15Min",
  "30Min",
  "1Hour",
  "4Hour",
  "1Day",
  "1Week",
  "1Month",
];

export async function GET(request: NextRequest) {
  // Every authenticated role can reach this — bars are generic market data,
  // not personal account/portfolio info.
  await verifySession();

  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol")?.trim();
  const timeframe = searchParams.get("timeframe") as BarTimeframe | null;
  const start = searchParams.get("start");

  if (!symbol) {
    return NextResponse.json({ error: "Missing required 'symbol' parameter." }, { status: 400 });
  }
  if (!timeframe || !VALID_TIMEFRAMES.includes(timeframe)) {
    return NextResponse.json(
      { error: `Invalid 'timeframe'. Must be one of: ${VALID_TIMEFRAMES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (!start) {
    return NextResponse.json({ error: "Missing required 'start' parameter." }, { status: 400 });
  }

  const result = await alpacaProvider.getBars({
    symbol,
    timeframe,
    start,
    end: searchParams.get("end") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });

  return NextResponse.json(result);
}
