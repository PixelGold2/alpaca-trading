import type { UTCTimestamp } from "lightweight-charts";
import type { Bar } from "@/lib/market-data/types";

export function toUnixTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Typical candle range for the loaded series — the baseline every detector
 * measures "significant" against. Using a multiple of this (rather than a
 * fixed dollar/point amount) is what makes a zone's size threshold adapt to
 * the timeframe automatically: a 1-minute chart's candles are naturally
 * tiny, a weekly chart's are naturally large, and this scales with whichever
 * is loaded instead of over- or under-flagging one relative to the other.
 */
export function averageRange(bars: Bar[]): number {
  if (bars.length === 0) return 0;
  const total = bars.reduce((sum, b) => sum + (b.high - b.low), 0);
  return total / bars.length;
}
