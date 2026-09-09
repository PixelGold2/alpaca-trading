import "server-only";
import { fetchEquitySnapshot } from "@/lib/market-data/equity-snapshot";
import type { WatchlistItem } from "@/lib/market-data/watchlist-types";

// Large, liquid names across sectors — Alpaca can chart every one of these.
const STOCKS: { symbol: string; label: string }[] = [
  { symbol: "AAPL", label: "Apple" },
  { symbol: "MSFT", label: "Microsoft" },
  { symbol: "NVDA", label: "Nvidia" },
  { symbol: "GOOGL", label: "Alphabet" },
  { symbol: "AMZN", label: "Amazon" },
  { symbol: "META", label: "Meta Platforms" },
  { symbol: "TSLA", label: "Tesla" },
  { symbol: "JPM", label: "JPMorgan Chase" },
  { symbol: "V", label: "Visa" },
  { symbol: "WMT", label: "Walmart" },
  { symbol: "XOM", label: "Exxon Mobil" },
  { symbol: "JNJ", label: "Johnson & Johnson" },
  { symbol: "HD", label: "Home Depot" },
  { symbol: "DIS", label: "Disney" },
  { symbol: "NFLX", label: "Netflix" },
  { symbol: "AMD", label: "AMD" },
];

export async function getStocksWatchlist(): Promise<WatchlistItem[]> {
  return Promise.all(
    STOCKS.map(async ({ symbol, label }) => {
      const result = await fetchEquitySnapshot(symbol);
      if ("error" in result) {
        return {
          symbol,
          label,
          category: "stocks" as const,
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
        category: "stocks" as const,
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
