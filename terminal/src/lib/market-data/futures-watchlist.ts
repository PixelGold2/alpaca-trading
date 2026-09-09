import "server-only";
import { fetchEquitySnapshot } from "@/lib/market-data/equity-snapshot";
import { FUTURES_PROXIES } from "@/lib/market-data/futures-symbols";
import type { WatchlistItem } from "@/lib/market-data/watchlist-types";

export async function getFuturesWatchlist(): Promise<WatchlistItem[]> {
  return Promise.all(
    FUTURES_PROXIES.map(async ({ symbol, label }) => {
      const result = await fetchEquitySnapshot(symbol);
      if ("error" in result) {
        return {
          symbol,
          label,
          category: "futures" as const,
          chartable: true,
          price: null,
          changePercent: null,
          dayHigh: null,
          dayLow: null,
          volume: null,
          status: "error" as const,
          message: result.error,
        };
      }
      return {
        symbol,
        label,
        category: "futures" as const,
        chartable: true,
        price: result.price,
        changePercent: result.changePercent,
        dayHigh: result.dayHigh,
        dayLow: result.dayLow,
        volume: result.volume,
        status: "live" as const,
      };
    }),
  );
}
