// Major USD pairs — kept as a reference list even though no live quote is
// available: Alpaca doesn't offer forex data, FMP (formerly used for this
// via /stable/quote) is fully exhausted, and Finnhub's forex quotes need a
// paid plan. Revisit if a working provider gets configured. Split out from
// forex-watchlist.ts (which is server-only) so client-side symbol search
// (see GlobalTickerSearch.tsx) can list these for navigation — same
// "*-symbols.ts, no server-only guard" pattern as crypto-symbols.ts,
// commodity-symbols.ts, and futures-symbols.ts.
export const FOREX_PAIRS: { symbol: string; label: string }[] = [
  { symbol: "EURUSD", label: "Euro / US Dollar" },
  { symbol: "GBPUSD", label: "British Pound / US Dollar" },
  { symbol: "USDJPY", label: "US Dollar / Japanese Yen" },
  { symbol: "USDCHF", label: "US Dollar / Swiss Franc" },
  { symbol: "AUDUSD", label: "Australian Dollar / US Dollar" },
  { symbol: "USDCAD", label: "US Dollar / Canadian Dollar" },
  { symbol: "NZDUSD", label: "New Zealand Dollar / US Dollar" },
];
