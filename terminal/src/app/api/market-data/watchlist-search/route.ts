import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import type { WatchlistCategory } from "@/lib/market-data/watchlist-types";
import { searchStockSymbols } from "@/lib/market-data/stock-search";
import { CRYPTO_PAIRS } from "@/lib/market-data/crypto-symbols";
import { ETF_PROXIES } from "@/lib/market-data/commodity-symbols";
import { FUTURES_PROXIES } from "@/lib/market-data/futures-symbols";

export interface WatchlistSearchResult {
  symbol: string;
  name: string;
}

const VALID_CATEGORIES: WatchlistCategory[] = ["stocks", "commodities", "forex", "crypto", "futures"];

/**
 * Crypto/commodities/futures are small, fixed, curated lists — the only
 * symbols this app can actually quote for those categories (see
 * crypto-symbols.ts / commodity-symbols.ts / futures-symbols.ts) — so search
 * them client-independent, in-memory, rather than hitting an external API
 * that (a) wouldn't know about this app's specific proxy tickers anyway and
 * (b) for FMP, is dead.
 */
function filterCurated(list: { symbol: string; label: string }[], query: string): WatchlistSearchResult[] {
  const q = query.toUpperCase();
  return list
    .filter((item) => item.symbol.toUpperCase().includes(q) || item.label.toUpperCase().includes(q))
    .map((item) => ({ symbol: item.symbol, name: item.label }));
}

export async function GET(request: NextRequest) {
  await verifySession();

  const query = request.nextUrl.searchParams.get("query")?.trim();
  const category = request.nextUrl.searchParams.get("category") as WatchlistCategory | null;
  if (!query || !category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ results: [] });
  }

  if (category === "forex") {
    return NextResponse.json({ results: [], error: "No live forex data provider is currently configured." });
  }
  if (category === "crypto") {
    return NextResponse.json({ results: filterCurated(CRYPTO_PAIRS, query) });
  }
  if (category === "commodities") {
    return NextResponse.json({ results: filterCurated(ETF_PROXIES, query) });
  }
  if (category === "futures") {
    return NextResponse.json({ results: filterCurated(FUTURES_PROXIES, query) });
  }

  // stocks — migrated from FMP's dead /stable/search-symbol to the same
  // Finnhub search the plain /api/market-data/search route uses.
  const { results, error } = await searchStockSymbols(query);
  return NextResponse.json({
    results: results.slice(0, 10).map((r) => ({ symbol: r.symbol, name: r.name })),
    error,
  });
}
