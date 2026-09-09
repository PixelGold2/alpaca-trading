import "server-only";
import { fetchEquitySnapshot } from "@/lib/market-data/equity-snapshot";
import { CRYPTO_PAIRS } from "@/lib/market-data/crypto-symbols";
import type { WatchlistItem } from "@/lib/market-data/watchlist-types";

// fetchEquitySnapshot already routes these symbols to Alpaca's crypto-bars
// endpoint (see alpaca-provider.ts's CRYPTO_SYMBOL_SET check) — migrated off
// FMP's quote endpoint once that was confirmed fully exhausted alongside
// its search/historical endpoints.
export async function getCryptoWatchlist(): Promise<WatchlistItem[]> {
  return Promise.all(
    CRYPTO_PAIRS.map(async ({ symbol, label }) => {
      const result = await fetchEquitySnapshot(symbol);
      if ("error" in result) {
        return {
          symbol,
          label,
          category: "crypto" as const,
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
        category: "crypto" as const,
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
