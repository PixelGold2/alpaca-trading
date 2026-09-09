// Re-exported for backward compatibility — the envelope moved to lib/providers/types.ts
// since it's shared by every provider category (market data, fundamentals, ...), not
// specific to market data.
import type { ProviderResult } from "@/lib/providers/types";
export type { DataStatus, ProviderMeta, ProviderResult } from "@/lib/providers/types";

export interface AccountSnapshot {
  accountId: string;
  equity: number;
  cash: number;
  buyingPower: number;
  currency: string;
  paper: boolean;
}

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string; // ISO 8601
  nextClose: string; // ISO 8601
}

export type BarTimeframe =
  | "1Min"
  | "5Min"
  | "15Min"
  | "30Min"
  | "1Hour"
  | "4Hour"
  | "1Day"
  | "1Week"
  | "1Month";

export interface Bar {
  time: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GetBarsParams {
  symbol: string;
  timeframe: BarTimeframe;
  start: string; // ISO 8601
  end?: string; // ISO 8601
  limit?: number;
}

/**
 * Every market-data source (Alpaca today, others later) implements this so
 * callers never depend on a specific provider's API shape. Every response
 * carries status metadata — callers must render LIVE/DELAYED/STALE/ERROR,
 * never silently substitute fabricated data.
 */
export interface MarketDataProvider {
  readonly name: string;
  getAccountSnapshot(): Promise<ProviderResult<AccountSnapshot>>;
  getMarketClock(): Promise<ProviderResult<MarketClock>>;
  getBars(params: GetBarsParams): Promise<ProviderResult<Bar[]>>;
}
