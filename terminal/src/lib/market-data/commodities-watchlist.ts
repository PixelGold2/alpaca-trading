import "server-only";
import { fetchEquitySnapshot } from "@/lib/market-data/equity-snapshot";
import { ETF_PROXIES } from "@/lib/market-data/commodity-symbols";
import type { WatchlistItem } from "@/lib/market-data/watchlist-types";

export async function getCommoditiesWatchlist(): Promise<WatchlistItem[]> {
  return Promise.all(
    ETF_PROXIES.map(async ({ symbol, label }) => {
      const result = await fetchEquitySnapshot(symbol);
      if ("error" in result) {
        return {
          symbol,
          label,
          category: "commodities" as const,
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
        category: "commodities" as const,
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
