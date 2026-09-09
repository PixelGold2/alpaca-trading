"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WatchlistCategory } from "@/lib/market-data/watchlist-types";
import type { WatchlistSearchResult } from "@/app/api/market-data/watchlist-search/route";

const DEBOUNCE_MS = 250;

const PLACEHOLDERS: Record<WatchlistCategory, string> = {
  stocks: "Search stocks (e.g. PYPL)",
  forex: "No live forex data provider is configured",
  crypto: "Search crypto (e.g. SOL)",
  futures: "Search futures (e.g. gold)",
  commodities: "Search commodity ETFs (e.g. GLD)",
};

export function CategoryTickerSearch({ category }: { category: WatchlistCategory }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const router = useRouter();

  // Reset the search box when the active category tab changes, rather than
  // leaving a stale query/result set from the previous category visible.
  // "Adjust state during render" (react.dev) instead of an effect — avoids the
  // extra render/flash a useEffect-based reset would cause.
  const [prevCategory, setPrevCategory] = useState(category);
  if (category !== prevCategory) {
    setPrevCategory(category);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    setHighlighted(0);
    clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetch(`/api/market-data/watchlist-search?category=${category}&query=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((body: { results: WatchlistSearchResult[] }) => {
          setResults(body.results ?? []);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, DEBOUNCE_MS);
  }

  function select(result: WatchlistSearchResult) {
    setOpen(false);
    setResults([]);
    setQuery("");
    router.push(`/watchlists/${result.symbol}?category=${category}&name=${encodeURIComponent(result.name)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative w-64" ref={containerRef}>
      <input
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={PLACEHOLDERS[category]}
        className="w-full rounded-md border border-border bg-bg-panel-raised px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
      />

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border-strong bg-bg-panel-raised shadow-xl">
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => select(r)}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                i === highlighted ? "bg-bg-hover" : ""
              }`}
            >
              <span className="font-mono font-medium text-text-primary">{r.symbol}</span>
              <span className="ml-2 truncate text-text-muted">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
