"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SymbolSearchResult } from "@/app/api/market-data/search/route";
import { CRYPTO_PAIRS } from "@/lib/market-data/crypto-symbols";
import { ETF_PROXIES } from "@/lib/market-data/commodity-symbols";
import { FUTURES_PROXIES } from "@/lib/market-data/futures-symbols";
import { FOREX_PAIRS } from "@/lib/market-data/forex-symbols";
import type { WatchlistCategory } from "@/lib/market-data/watchlist-types";

const DEBOUNCE_MS = 250;

type ResultGroup = "stock" | "crypto" | "commodity" | "futures" | "forex";

interface UnifiedResult {
  symbol: string;
  name: string;
}

const GROUP_LABELS: Record<ResultGroup, string> = {
  stock: "Stocks",
  crypto: "Crypto",
  commodity: "Commodities",
  futures: "Futures",
  forex: "Forex",
};

// The category this group's items should be looked up as on the
// fundamentals/detail page (/watchlists/[symbol]?category=...) — matches
// WatchlistCategory exactly, see watchlist-types.ts.
const GROUP_CATEGORY: Record<ResultGroup, WatchlistCategory> = {
  stock: "stocks",
  crypto: "crypto",
  commodity: "commodities",
  futures: "futures",
  forex: "forex",
};

const GROUP_ORDER: ResultGroup[] = ["stock", "crypto", "commodity", "futures", "forex"];

function matches(symbol: string, name: string, query: string): boolean {
  const q = query.toUpperCase();
  return symbol.toUpperCase().includes(q) || name.toUpperCase().includes(q);
}

/**
 * The terminal-wide top-bar search — deliberately a separate component from
 * chart/UnifiedTickerSearch.tsx (which powers the Charts page's local
 * asset-class picker and calls back into the chart instead of navigating).
 * This one spans every asset class this app has a curated list or live
 * search for (stocks live via Finnhub, crypto/commodities/futures/forex
 * from their existing curated lists — see each lib/market-data/*-symbols.ts)
 * and always navigates to that symbol's fundamentals/detail page on
 * selection, regardless of which page it's opened from.
 */
export function GlobalTickerSearch() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState("");
  const [stockResults, setStockResults] = useState<UnifiedResult[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const query = inputValue.trim();

  // Crypto/commodities/futures/forex are small, fixed, curated lists (the
  // only symbols this app knows about for those asset classes) — searched
  // client-side, showing the full list on an empty query rather than
  // requiring the user to type first. Only Stocks needs a live debounced
  // API call, since that universe is effectively the whole market.
  const cryptoResults: UnifiedResult[] = (
    query ? CRYPTO_PAIRS.filter((p) => matches(p.symbol, p.label, query)) : CRYPTO_PAIRS
  ).map((p) => ({ symbol: p.symbol, name: p.label }));
  const commodityResults: UnifiedResult[] = (
    query ? ETF_PROXIES.filter((p) => matches(p.symbol, p.label, query)) : ETF_PROXIES
  ).map((p) => ({ symbol: p.symbol, name: p.label }));
  const futuresResults: UnifiedResult[] = (
    query ? FUTURES_PROXIES.filter((p) => matches(p.symbol, p.label, query)) : FUTURES_PROXIES
  ).map((p) => ({ symbol: p.symbol, name: p.label }));
  const forexResults: UnifiedResult[] = (
    query ? FOREX_PAIRS.filter((p) => matches(p.symbol, p.label, query)) : FOREX_PAIRS
  ).map((p) => ({ symbol: p.symbol, name: p.label }));

  const groups: Record<ResultGroup, UnifiedResult[]> = {
    stock: stockResults,
    crypto: cryptoResults,
    commodity: commodityResults,
    futures: futuresResults,
    forex: forexResults,
  };
  const allResults = GROUP_ORDER.flatMap((g) => groups[g].map((r) => ({ ...r, group: g })));

  function handleInput(value: string) {
    setInputValue(value);
    setHighlighted(0);
    setOpen(true);
    clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setStockResults([]);
      setStockLoading(false);
      return;
    }

    setStockLoading(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/market-data/search?query=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((body: { results: SymbolSearchResult[] }) => {
          setStockResults((body.results ?? []).map((r) => ({ symbol: r.symbol, name: r.name })));
        })
        .catch(() => setStockResults([]))
        .finally(() => setStockLoading(false));
    }, DEBOUNCE_MS);
  }

  function select(result: UnifiedResult, group: ResultGroup) {
    setOpen(false);
    setInputValue("");
    setStockResults([]);
    const category = GROUP_CATEGORY[group];
    router.push(`/watchlists/${result.symbol}?category=${category}&name=${encodeURIComponent(result.name)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || allResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, allResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = allResults[highlighted];
      if (picked) select(picked, picked.group);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  let cursor = 0;

  return (
    <div className="relative w-full max-w-md" ref={containerRef}>
      <input
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        placeholder="Search stocks, crypto, forex, futures, commodities…"
        className="w-full rounded-md border border-border bg-bg-panel-raised px-3 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
      />

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-full min-w-[22rem] overflow-y-auto rounded-md border border-border-strong bg-bg-panel-raised shadow-xl">
          {allResults.length === 0 && !stockLoading && (
            <p className="px-3 py-2 text-xs text-text-muted">
              {query ? `No matches for "${query}".` : "Start typing, or pick from the curated lists below."}
            </p>
          )}
          {GROUP_ORDER.map((g) => {
            const items = groups[g];
            if (items.length === 0 && !(g === "stock" && stockLoading)) return null;
            return (
              <div key={g}>
                <div className="border-t border-border/50 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-text-muted first:border-t-0">
                  {GROUP_LABELS[g]}
                </div>
                {g === "stock" && stockLoading && <p className="px-3 py-1.5 text-xs text-text-muted">Searching…</p>}
                {items.map((r) => {
                  const i = cursor++;
                  return (
                    <button
                      key={`${g}-${r.symbol}`}
                      onClick={() => select(r, g)}
                      onMouseEnter={() => setHighlighted(i)}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                        i === highlighted ? "bg-bg-hover" : ""
                      }`}
                    >
                      <span className="font-mono font-medium text-text-primary">{r.symbol}</span>
                      <span className="ml-2 truncate text-text-muted">{r.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
