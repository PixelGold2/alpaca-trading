"use client";

import { useEffect, useRef, useState } from "react";
import type { SymbolSearchResult } from "@/app/api/market-data/search/route";
import { CRYPTO_PAIRS } from "@/lib/market-data/crypto-symbols";
import { ETF_PROXIES } from "@/lib/market-data/commodity-symbols";

const DEBOUNCE_MS = 250;

type ResultGroup = "stock" | "crypto" | "commodity";

interface UnifiedResult {
  symbol: string;
  name: string;
}

const GROUP_LABELS: Record<ResultGroup, string> = {
  stock: "Stocks",
  crypto: "Crypto",
  commodity: "Commodities",
};

const GROUP_ORDER: ResultGroup[] = ["stock", "crypto", "commodity"];

function matches(symbol: string, name: string, query: string): boolean {
  const q = query.toUpperCase();
  return symbol.toUpperCase().includes(q) || name.toUpperCase().includes(q);
}

export function UnifiedTickerSearch({
  initialSymbol,
  onSelect,
}: {
  initialSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  const [inputValue, setInputValue] = useState(initialSymbol);
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

  // Crypto/commodities are small, fixed, curated lists — the only symbols
  // this app can actually chart for those asset classes (see
  // alpaca-provider.ts's crypto-bars branch and commodity-symbols.ts's ETF
  // proxies) — so search them client-side and show the full list on an
  // empty query rather than requiring the user to type first.
  const cryptoResults: UnifiedResult[] = (
    query ? CRYPTO_PAIRS.filter((p) => matches(p.symbol, p.label, query)) : CRYPTO_PAIRS
  ).map((p) => ({ symbol: p.symbol, name: p.label }));
  const commodityResults: UnifiedResult[] = (
    query ? ETF_PROXIES.filter((p) => matches(p.symbol, p.label, query)) : ETF_PROXIES
  ).map((p) => ({ symbol: p.symbol, name: p.label }));

  const groups: Record<ResultGroup, UnifiedResult[]> = {
    stock: stockResults,
    crypto: cryptoResults,
    commodity: commodityResults,
  };
  const allResults = GROUP_ORDER.flatMap((g) => groups[g]);

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

  function select(symbol: string) {
    setInputValue(symbol);
    setOpen(false);
    setStockResults([]);
    onSelect(symbol.toUpperCase());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || allResults.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        const next = inputValue.trim().toUpperCase();
        if (next) select(next);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, allResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(allResults[highlighted].symbol);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  let cursor = 0;

  return (
    <div className="relative w-80" ref={containerRef}>
      <input
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        placeholder="Search stocks, crypto, commodities…"
        className="w-full rounded-md border border-border bg-bg-panel-raised px-2.5 py-1.5 text-xs uppercase text-text-primary outline-none focus:border-accent"
      />

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-border-strong bg-bg-panel-raised shadow-xl">
          {allResults.length === 0 && !stockLoading && (
            <p className="px-3 py-2 text-xs text-text-muted">
              {query ? `No matches for "${query}".` : "No results."}
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
                {g === "stock" && stockLoading && (
                  <p className="px-3 py-1.5 text-xs text-text-muted">Searching…</p>
                )}
                {items.map((r) => {
                  const i = cursor++;
                  return (
                    <button
                      key={`${g}-${r.symbol}`}
                      onClick={() => select(r.symbol)}
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
