import "server-only";
import type { WatchlistItem } from "@/lib/market-data/watchlist-types";
import { FOREX_PAIRS } from "@/lib/market-data/forex-symbols";

const NO_PROVIDER_MESSAGE = "No live forex data provider is currently configured.";

export async function getForexWatchlist(): Promise<WatchlistItem[]> {
  return FOREX_PAIRS.map(({ symbol, label }) => ({
    symbol,
    label,
    category: "forex" as const,
    chartable: false,
    price: null,
    changePercent: null,
    dayHigh: null,
    dayLow: null,
    volume: null,
    status: "error" as const,
    message: NO_PROVIDER_MESSAGE,
  }));
}
