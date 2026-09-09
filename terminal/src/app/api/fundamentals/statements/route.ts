import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { getIncomeStatement, getBalanceSheet, getCashFlow } from "@/lib/fundamentals/finnhub-fundamentals";
import type { StatementPeriod } from "@/lib/fundamentals/types";

const VALID_TYPES = ["income", "balance", "cashflow"] as const;
const VALID_PERIODS: StatementPeriod[] = ["annual", "quarter"];

export async function GET(request: NextRequest) {
  await verifySession();

  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol")?.trim();
  const type = searchParams.get("type") as (typeof VALID_TYPES)[number] | null;
  const period = (searchParams.get("period") ?? "annual") as StatementPeriod;
  const limit = Number(searchParams.get("limit") ?? "5");

  if (!symbol) {
    return NextResponse.json({ error: "Missing required 'symbol' parameter." }, { status: 400 });
  }
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `Invalid 'type'. Must be one of: ${VALID_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json(
      { error: `Invalid 'period'. Must be one of: ${VALID_PERIODS.join(", ")}.` },
      { status: 400 }
    );
  }

  const result =
    type === "income"
      ? await getIncomeStatement(symbol, period, limit)
      : type === "balance"
        ? await getBalanceSheet(symbol, period, limit)
        : await getCashFlow(symbol, period, limit);

  return NextResponse.json(result);
}
