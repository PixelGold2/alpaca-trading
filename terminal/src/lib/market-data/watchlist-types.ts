import type { DataStatus } from "@/lib/providers/types";

export type WatchlistCategory = "stocks" | "forex" | "crypto" | "futures" | "commodities";

export interface WatchlistItem {
  symbol: string;
  label: string;
  category: WatchlistCategory;
  // True when Alpaca can actually chart this symbol — stocks and crypto
  // directly, commodities/futures via honest ETF proxies. Always false for
  // forex, which has no live data source of any kind right now.
  chartable: boolean;
  price: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  status: DataStatus;
  message?: string;
}
