// Honest ETF proxies for the classic futures contracts (gold, silver, crude,
// Brent, natural gas) traded via Alpaca — same pattern as
// commodity-symbols.ts, and deliberately overlapping with some of the same
// underlying ETFs, since no real futures data source is available and these
// are the closest real, Alpaca-tradable instruments. Used by the Watchlists
// Futures tab; the ticker strip keeps its own small local copy (it needs
// synthetic display symbols like "WTI"/"BRENT" rather than the ETF ticker
// itself, so isn't a clean fit for this shared shape).
export const FUTURES_PROXIES: { symbol: string; label: string }[] = [
  { symbol: "GLD", label: "Gold" },
  { symbol: "SLV", label: "Silver" },
  { symbol: "USO", label: "Crude Oil (WTI)" },
  { symbol: "BNO", label: "Brent Crude" },
  { symbol: "UNG", label: "Natural Gas" },
];
