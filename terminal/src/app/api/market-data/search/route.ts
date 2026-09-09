import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { searchStockSymbols, type StockSearchResult } from "@/lib/market-data/stock-search";

export type SymbolSearchResult = StockSearchResult;

export async function GET(request: NextRequest) {
  await verifySession();

  const query = request.nextUrl.searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const { results, error } = await searchStockSymbols(query);
  return NextResponse.json(error ? { results, error } : { results });
}
