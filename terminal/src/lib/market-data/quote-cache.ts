import "server-only";

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// Reuse across hot reloads in dev / across requests in prod, same globalThis
// singleton pattern as the pg Pool in lib/db.ts and the AIS tracker.
declare global {
  var __terminalQuoteCache: Map<string, CacheEntry<unknown>> | undefined;
}

function getCache(): Map<string, CacheEntry<unknown>> {
  if (!globalThis.__terminalQuoteCache) globalThis.__terminalQuoteCache = new Map();
  return globalThis.__terminalQuoteCache;
}

/**
 * Wraps a per-symbol quote fetch with a short in-memory TTL cache. Without
 * this, every render of the markets snapshot panel or a watchlist page fired
 * one fresh network request per symbol (~20+ per load, no batching available
 * on this FMP plan) — cheap to burn through a daily quota in normal browsing,
 * not just heavy testing. A 60s default cache is well within what most of
 * this app's UI needs (nothing here is a sub-minute trading decision), and
 * both success and error results are cached so a quota outage doesn't get
 * hammered with repeat requests that would only fail again. `ttlMs` lets a
 * caller opt into a longer window for inherently slower-moving data (e.g.
 * the Stock Screener's valuation metrics — see screener-provider.ts) without
 * changing the default for everyone else.
 */
export async function withQuoteCache<T>(key: string, fetcher: () => Promise<T>, ttlMs: number = CACHE_TTL_MS): Promise<T> {
  const cache = getCache();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.fetchedAt < ttlMs) {
    return entry.data;
  }
  const data = await fetcher();
  cache.set(key, { data, fetchedAt: Date.now() });
  return data;
}
