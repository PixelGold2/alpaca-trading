import "server-only";
import { env } from "@/lib/env";

const REQUEST_TIMEOUT_MS = 5000;

export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

/**
 * Shared Finnhub /search lookup, used by both the plain stock-symbol search
 * (Charts/News/Earnings) and the Watchlists Stocks tab search. Migrated from
 * FMP's /stable/search-symbol after that endpoint's quota was confirmed
 * exhausted long-term. Scoped to exchange=US since Alpaca, this app's only
 * bars provider, only charts US-listed symbols.
 */
export async function searchStockSymbols(query: string): Promise<{ results: StockSearchResult[]; error?: string }> {
  if (!env.finnhubApiKey) {
    return { results: [], error: "Symbol search is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ q: query, exchange: "US", token: env.finnhubApiKey });
    let res: Response;
    try {
      res = await fetch(`https://finnhub.io/api/v1/search?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      // The request URL carries the API key — never let a raw fetch()/network
      // exception propagate. Same guard as every other Finnhub-backed route.
      return { results: [], error: "Network error contacting the search provider." };
    }
    if (!res.ok) {
      return { results: [], error: `Search failed (HTTP ${res.status}).` };
    }
    const body = await res.json();
    const rows = Array.isArray(body?.result) ? body.result : [];
    const results: StockSearchResult[] = rows.slice(0, 10).map((r: unknown) => {
      const row = r as Record<string, unknown>;
      return {
        symbol: String(row.symbol ?? ""),
        name: String(row.description ?? ""),
        exchange: String(row.type ?? ""),
      };
    });
    return { results };
  } catch {
    return { results: [], error: "Unexpected error during search." };
  } finally {
    clearTimeout(timeout);
  }
}
