import "server-only";
import { alpacaProvider } from "@/lib/market-data/alpaca-provider";
import { withQuoteCache } from "@/lib/market-data/quote-cache";

export interface EquitySnapshot {
  price: number;
  changePercent: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
}

function startDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/**
 * Shared latest-daily-bar snapshot via Alpaca, used by index/stock/ETF-proxy
 * watchlist providers — they all just want "latest close vs prior close" plus
 * the bar's own high/low/volume. Never throws; an honest error string comes
 * back instead of a fabricated price on failure. Cached for 60s per symbol
 * (see quote-cache.ts) to cut down on redundant requests across page loads.
 */
export function fetchEquitySnapshot(symbol: string): Promise<EquitySnapshot | { error: string }> {
  return withQuoteCache(`alpaca:${symbol}`, () => fetchEquitySnapshotUncached(symbol));
}

async function fetchEquitySnapshotUncached(symbol: string): Promise<EquitySnapshot | { error: string }> {
  const result = await alpacaProvider.getBars({ symbol, timeframe: "1Day", start: startDate(10), limit: 5 });
  if (!result.data || result.data.length === 0) {
    return { error: result.meta.message ?? "Data unavailable." };
  }
  const bars = result.data;
  const latest = bars[bars.length - 1];
  const prior = bars.length > 1 ? bars[bars.length - 2] : latest;
  const changePercent = prior.close ? ((latest.close - prior.close) / prior.close) * 100 : 0;
  return { price: latest.close, changePercent, dayHigh: latest.high, dayLow: latest.low, volume: latest.volume };
}
