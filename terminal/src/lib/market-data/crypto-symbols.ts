// Single source of truth for the crypto pairs this app knows how to chart —
// used by both the Crypto watchlist (quote display) and the Charts page's
// asset-class picker + Alpaca provider (bar fetching). Confirmed live against
// Alpaca's /v1beta3/crypto/us/bars, which takes "BTC/USD" (slash) — every
// pair here ends in "USD" so the un-slashed form ("BTCUSD") used everywhere
// else in the app converts losslessly. BNB excluded — Alpaca's crypto venue
// returns empty bars for it (not tradable there), so it can never quote.
export const CRYPTO_PAIRS: { symbol: string; label: string }[] = [
  { symbol: "BTCUSD", label: "Bitcoin" },
  { symbol: "ETHUSD", label: "Ethereum" },
  { symbol: "SOLUSD", label: "Solana" },
  { symbol: "XRPUSD", label: "XRP" },
  { symbol: "ADAUSD", label: "Cardano" },
  { symbol: "DOGEUSD", label: "Dogecoin" },
  { symbol: "AVAXUSD", label: "Avalanche" },
  { symbol: "LINKUSD", label: "Chainlink" },
  { symbol: "DOTUSD", label: "Polkadot" },
];

export const CRYPTO_SYMBOL_SET = new Set(CRYPTO_PAIRS.map((p) => p.symbol));

/** "BTCUSD" -> "BTC/USD", the format Alpaca's crypto bars endpoint expects. */
export function toAlpacaCryptoSymbol(symbol: string): string {
  return `${symbol.slice(0, -3)}/${symbol.slice(-3)}`;
}
