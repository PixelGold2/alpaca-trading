import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import {
  getTickerInstruments,
  getAllTickerInstruments,
  type InstrumentCategory,
} from "@/lib/market-data/ticker-instruments";

const VALID_CATEGORIES: InstrumentCategory[] = ["markets", "forex", "crypto", "futures"];

export async function GET(request: NextRequest) {
  await verifySession();

  const category = request.nextUrl.searchParams.get("category");
  if (category === "all") {
    return NextResponse.json(await getAllTickerInstruments());
  }
  if (!category || !VALID_CATEGORIES.includes(category as InstrumentCategory)) {
    return NextResponse.json({ error: "Invalid or missing 'category' parameter." }, { status: 400 });
  }

  const result = await getTickerInstruments(category as InstrumentCategory);
  return NextResponse.json(result);
}
