"use client";

import { useEffect, useRef, useState } from "react";
import type { SymbolSearchResult } from "@/app/api/market-data/search/route";

const DEBOUNCE_MS = 250;

export function TickerCombobox({
  initialSymbol,
  onSelect,
}: {
  initialSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  const [inputValue, setInputValue] = useState(initialSymbol);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
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

  function handleInput(value: string) {
    setInputValue(value);
    setHighlighted(0);
    clearTimeout(debounceRef.current);

    const query = value.trim();
    if (query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetch(`/api/market-data/search?query=${encodeURIComponent(query)}`)
        .then((res) => res.json())
        .then((body: { results: SymbolSearchResult[] }) => {
          setResults(body.results ?? []);
          setOpen(true);
        })
        .catch(() => {
          setResults([]);
        });
    }, DEBOUNCE_MS);
  }

  function select(symbol: string) {
    setInputValue(symbol);
    setOpen(false);
    setResults([]);
    onSelect(symbol.toUpperCase());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        const next = inputValue.trim().toUpperCase();
        if (next) select(next);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[highlighted].symbol);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Symbol (e.g. NVDA)"
        className="w-48 rounded-md border border-border bg-bg-panel-raised px-2 py-1.5 text-xs uppercase text-text-primary outline-none focus:border-accent"
      />

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-border-strong bg-bg-panel-raised shadow-xl">
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => select(r.symbol)}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                i === highlighted ? "bg-bg-hover" : ""
              }`}
            >
              <span className="font-mono font-medium text-text-primary">{r.symbol}</span>
              <span className="ml-2 truncate text-text-muted">{r.name}</span>
              <span className="ml-2 shrink-0 text-[10px] text-text-muted">{r.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
