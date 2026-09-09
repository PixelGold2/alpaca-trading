import "server-only";
import { getStocksWatchlist } from "@/lib/market-data/stocks-watchlist";
import { getForexWatchlist } from "@/lib/market-data/forex-watchlist";
import { getCryptoWatchlist } from "@/lib/market-data/crypto-watchlist";
import { getFuturesWatchlist } from "@/lib/market-data/futures-watchlist";
import { getCommoditiesWatchlist } from "@/lib/market-data/commodities-watchlist";
import { fetchEquitySnapshot } from "@/lib/market-data/equity-snapshot";
import type { WatchlistCategory, WatchlistItem } from "@/lib/market-data/watchlist-types";

const CATEGORY_LABELS: Record<WatchlistCategory, string> = {
  stocks: "Stocks",
  forex: "Forex",
  crypto: "Crypto",
  futures: "Futures",
  commodities: "Commodities",
};

// Everything except forex now runs on Alpaca — stocks directly, commodities
// and futures via honest ETF proxies, crypto via Alpaca's crypto-bars
// endpoint. Forex has no live provider at all (FMP's quote endpoint, the
// only one that ever worked for it, is now fully exhausted).
const CHARTABLE_CATEGORIES: WatchlistCategory[] = ["stocks", "commodities", "crypto", "futures"];

export function categoryLabel(category: WatchlistCategory): string {
  return CATEGORY_LABELS[category];
}

export async function getWatchlistCategory(category: WatchlistCategory): Promise<WatchlistItem[]> {
  switch (category) {
    case "stocks":
      return getStocksWatchlist();
    case "forex":
      return getForexWatchlist();
    case "crypto":
      return getCryptoWatchlist();
    case "futures":
      return getFuturesWatchlist();
    case "commodities":
      return getCommoditiesWatchlist();
  }
}

export async function getAllWatchlistCategories(): Promise<Record<WatchlistCategory, WatchlistItem[]>> {
  const [stocks, forex, crypto, futures, commodities] = await Promise.all([
    getStocksWatchlist(),
    getForexWatchlist(),
    getCryptoWatchlist(),
    getFuturesWatchlist(),
    getCommoditiesWatchlist(),
  ]);
  return { stocks, forex, crypto, futures, commodities };
}

/**
 * Looks up a symbol within the curated per-category list first; if it's not
 * there (e.g. found via free-text search rather than the fixed watchlist),
 * fetches it live instead of reporting "not found" — search results outside
 * the curated ~10 items per category still resolve to a real quote.
 */
export async function findWatchlistItem(
  category: WatchlistCategory,
  symbol: string,
  fallbackLabel?: string,
): Promise<WatchlistItem> {
  const items = await getWatchlistCategory(category);
  const curated = items.find((item) => item.symbol.toUpperCase() === symbol.toUpperCase());
  if (curated) return curated;

  const chartable = CHARTABLE_CATEGORIES.includes(category);
  const label = fallbackLabel ?? symbol;

  if (!chartable) {
    // Only forex lands here now — no live provider exists for it at all.
    return {
      symbol,
      label,
      category,
      chartable,
      price: null,
      changePercent: null,
      dayHigh: null,
      dayLow: null,
      volume: null,
      status: "error",
      message: "No live forex data provider is currently configured.",
    };
  }

  const result = await fetchEquitySnapshot(symbol);

  if ("error" in result) {
    return { symbol, label, category, chartable, price: null, changePercent: null, dayHigh: null, dayLow: null, volume: null, status: "error", message: result.error };
  }
  return {
    symbol,
    label,
    category,
    chartable,
    price: result.price,
    changePercent: result.changePercent,
    dayHigh: result.dayHigh,
    dayLow: result.dayLow,
    volume: result.volume,
    status: "live",
  };
}
