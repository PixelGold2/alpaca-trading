import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { getRatios } from "@/lib/fundamentals/finnhub-fundamentals";
import type { MetricsPeriod } from "@/lib/fundamentals/types";

const VALID_PERIODS: MetricsPeriod[] = ["annual", "quarter", "ttm"];

export async function GET(request: NextRequest) {
  await verifySession();

  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol")?.trim();
  const period = (searchParams.get("period") ?? "ttm") as MetricsPeriod;

  if (!symbol) {
    return NextResponse.json({ error: "Missing required 'symbol' parameter." }, { status: 400 });
  }
  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json(
      { error: `Invalid 'period'. Must be one of: ${VALID_PERIODS.join(", ")}.` },
      { status: 400 }
    );
  }

  const result = await getRatios(symbol, period);
  return NextResponse.json(result);
}
