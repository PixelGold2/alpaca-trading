"use client";

import { useState } from "react";
import type { DataStatus } from "@/lib/providers/types";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { TickerCombobox } from "@/components/terminal/chart/TickerCombobox";

export function TickerResearchCard() {
  const [symbol, setSymbol] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(target: string) {
    setSymbol(target);
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/research/ticker-summary?symbol=${encodeURIComponent(target)}`);
      const body: { data: string | null; meta: { status: DataStatus; timestamp: string; message?: string } } = await res.json();
      if (!body.data) {
        setError(body.meta.message ?? `No summary available for ${target}.`);
        return;
      }
      setSummary(body.data);
      setStatus(body.meta.status);
      setGeneratedAt(body.meta.timestamp);
    } catch {
      setError(`No summary available for ${target}.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-panel">
      <div className="border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-text-primary">Ticker Research</span>
        <p className="text-[10px] text-text-muted">AI summary of a stock&apos;s overview, ratios, and recent headlines — not investment advice.</p>
      </div>
      <div className="p-3">
        <div className="mb-3 flex items-center gap-2">
          <TickerCombobox initialSymbol={symbol} onSelect={generate} />
          {loading && <span className="text-[10px] text-text-muted">Researching {symbol}…</span>}
        </div>

        <div className="text-xs leading-relaxed text-text-secondary">
          {error && <div className="text-negative">{error}</div>}
          {!error && !summary && !loading && (
            <div className="text-text-muted">Pick a ticker above to generate a research summary.</div>
          )}
          {summary && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-xs font-medium text-text-primary">{symbol}</span>
                {status && <DataStatusBadge status={status} />}
                {generatedAt && (
                  <span className="text-[10px] text-text-muted">as of {new Date(generatedAt).toLocaleTimeString()}</span>
                )}
              </div>
              <div className="whitespace-pre-wrap">{summary}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
