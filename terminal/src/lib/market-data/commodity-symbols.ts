// Liquid commodity ETFs traded via Alpaca — honest ETF proxies, never implied
// to be the raw futures price (see commodities-watchlist.ts for the quote
// provider). Single source of truth, also used by the Charts page's
// asset-class picker for both quick-pick symbols and bar fetching, since
// these are regular equities Alpaca's stock-bars endpoint already handles.
// JO (coffee ETN) excluded — its latest Alpaca bar is from 2023, effectively
// delisted, so it can't honestly be shown as live.
export const ETF_PROXIES: { symbol: string; label: string }[] = [
  { symbol: "GLD", label: "Gold" },
  { symbol: "SLV", label: "Silver" },
  { symbol: "CPER", label: "Copper" },
  { symbol: "PPLT", label: "Platinum" },
  { symbol: "PALL", label: "Palladium" },
  { symbol: "USO", label: "Crude Oil (WTI)" },
  { symbol: "UNG", label: "Natural Gas" },
  { symbol: "CORN", label: "Corn" },
  { symbol: "WEAT", label: "Wheat" },
  { symbol: "SOYB", label: "Soybeans" },
];
