import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import { fetchEquitySnapshot } from "@/lib/market-data/equity-snapshot";

export type InstrumentCategory = "markets" | "forex" | "crypto" | "futures";

export interface TickerInstrument {
  symbol: string;
  label: string;
  category: InstrumentCategory;
  price: number;
  changePercent: number;
}

// Index/futures/commodity proxies traded as ordinary US equities/ETFs, same
// honest-proxy pattern already used for the Commodities watchlist — never
// implied to be the raw index/futures price, just the closest real,
// Alpaca-tradable instrument. VIX and the 10Y yield have no such proxy
// (a VIX futures ETF decays and doesn't track spot VIX; a bond ETF price
// isn't a yield), so those two come from FRED instead (see below).
// Labels disclose the proxy ticker in parentheses — SPY trades around $760,
// not the ~5800 S&P 500 index level, so an undisclosed "S&P 500: 762.62"
// would read as the index value when it's actually the ETF's share price.
const MARKET_ETF_PROXIES: { symbol: string; label: string; proxy: string }[] = [
  { symbol: "SPX", label: "S&P 500 (SPY)", proxy: "SPY" },
  { symbol: "NDX", label: "NASDAQ (QQQ)", proxy: "QQQ" },
  { symbol: "DJI", label: "Dow Jones (DIA)", proxy: "DIA" },
  { symbol: "RUT", label: "Russell 2000 (IWM)", proxy: "IWM" },
];

const CRYPTO_INSTRUMENTS: { symbol: string; label: string; proxy: string }[] = [
  { symbol: "BTC", label: "Bitcoin", proxy: "BTCUSD" },
  { symbol: "ETH", label: "Ethereum", proxy: "ETHUSD" },
  { symbol: "SOL", label: "Solana", proxy: "SOLUSD" },
];

const FUTURES_ETF_PROXIES: { symbol: string; label: string; proxy: string }[] = [
  { symbol: "XAU", label: "Gold (GLD)", proxy: "GLD" },
  { symbol: "XAG", label: "Silver (SLV)", proxy: "SLV" },
  { symbol: "WTI", label: "Crude Oil (USO)", proxy: "USO" },
  { symbol: "BRENT", label: "Brent (BNO)", proxy: "BNO" },
  { symbol: "NATGAS", label: "Natural Gas (UNG)", proxy: "UNG" },
];

async function fromAlpaca(
  config: { symbol: string; label: string; proxy: string }[],
  category: InstrumentCategory,
): Promise<TickerInstrument[]> {
  const snapshots = await Promise.all(config.map((c) => fetchEquitySnapshot(c.proxy)));
  const instruments: TickerInstrument[] = [];
  snapshots.forEach((snap, i) => {
    if ("error" in snap) return; // skip silently — never fabricate a missing quote
    instruments.push({
      symbol: config[i].symbol,
      label: config[i].label,
      category,
      price: snap.price,
      changePercent: snap.changePercent,
    });
  });
  return instruments;
}

/** FRED gives previous-close daily observations, not a live quote — every
 * caller that includes a FRED series must report the whole batch as
 * "delayed", not "live", to stay honest about freshness. */
async function fetchFredLatest(seriesId: string): Promise<{ value: number; changePercent: number } | null> {
  if (!env.fredApiKey) return null;
  try {
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: env.fredApiKey,
      file_type: "json",
      sort_order: "desc",
      limit: "10",
    });
    const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const rows = Array.isArray(body?.observations) ? body.observations : [];
    const numeric = rows
      .map((r: { value: string }) => Number(r.value))
      .filter((v: number) => Number.isFinite(v));
    if (numeric.length === 0) return null;
    const [latest, prior] = numeric;
    const changePercent = prior && prior !== 0 ? ((latest - prior) / prior) * 100 : 0;
    return { value: latest, changePercent };
  } catch {
    return null;
  }
}

async function getMarketsInstruments(): Promise<ProviderResult<TickerInstrument[]>> {
  const [fromEtfs, vix, dgs10] = await Promise.all([
    fromAlpaca(MARKET_ETF_PROXIES, "markets"),
    fetchFredLatest("VIXCLS"),
    fetchFredLatest("DGS10"),
  ]);

  const instruments = [...fromEtfs];
  let usedFred = false;
  if (vix) {
    instruments.push({ symbol: "VIX", label: "VIX", category: "markets", price: vix.value, changePercent: vix.changePercent });
    usedFred = true;
  }
  if (dgs10) {
    instruments.push({
      symbol: "US10Y",
      label: "10Y Treasury",
      category: "markets",
      price: dgs10.value,
      changePercent: dgs10.changePercent,
    });
    usedFred = true;
  }

  if (instruments.length === 0) {
    return {
      data: null,
      meta: { provider: "alpaca+fred", timestamp: new Date().toISOString(), status: "error", message: "No market data available." },
    };
  }
  return {
    data: instruments,
    meta: { provider: "alpaca+fred", timestamp: new Date().toISOString(), status: usedFred ? "delayed" : "live" },
  };
}

async function getEtfProxyInstruments(
  config: { symbol: string; label: string; proxy: string }[],
  category: InstrumentCategory,
): Promise<ProviderResult<TickerInstrument[]>> {
  const instruments = await fromAlpaca(config, category);
  if (instruments.length === 0) {
    return {
      data: null,
      meta: { provider: "alpaca", timestamp: new Date().toISOString(), status: "error", message: "No data available." },
    };
  }
  return { data: instruments, meta: { provider: "alpaca", timestamp: new Date().toISOString(), status: "live" } };
}

function forexUnavailable(): ProviderResult<TickerInstrument[]> {
  return {
    data: null,
    meta: {
      provider: "none",
      timestamp: new Date().toISOString(),
      status: "error",
      message: "No live forex data provider is currently configured.",
    },
  };
}

export async function getTickerInstruments(category: InstrumentCategory): Promise<ProviderResult<TickerInstrument[]>> {
  if (category === "markets") return getMarketsInstruments();
  if (category === "crypto") return getEtfProxyInstruments(CRYPTO_INSTRUMENTS, "crypto");
  if (category === "futures") return getEtfProxyInstruments(FUTURES_ETF_PROXIES, "futures");
  return forexUnavailable();
}

/** All chartable categories combined (skips forex) — used by the World
 * Tracker page's single combined ticker strip, which has no per-category tabs. */
export async function getAllTickerInstruments(): Promise<ProviderResult<TickerInstrument[]>> {
  const [markets, crypto, futures] = await Promise.all([
    getMarketsInstruments(),
    getEtfProxyInstruments(CRYPTO_INSTRUMENTS, "crypto"),
    getEtfProxyInstruments(FUTURES_ETF_PROXIES, "futures"),
  ]);

  const instruments = [...(markets.data ?? []), ...(crypto.data ?? []), ...(futures.data ?? [])];
  if (instruments.length === 0) {
    return {
      data: null,
      meta: { provider: "alpaca+fred", timestamp: new Date().toISOString(), status: "error", message: "No data available." },
    };
  }
  const anyDelayed = [markets, crypto, futures].some((r) => r.meta.status === "delayed");
  return {
    data: instruments,
    meta: { provider: "alpaca+fred", timestamp: new Date().toISOString(), status: anyDelayed ? "delayed" : "live" },
  };
}
