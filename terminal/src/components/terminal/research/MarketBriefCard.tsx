"use client";

import { useState } from "react";
import type { DataStatus } from "@/lib/providers/types";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

export function MarketBriefCard() {
  const [report, setReport] = useState<string | null>(null);
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/research/market-brief");
      const body: { data: string | null; meta: { status: DataStatus; timestamp: string; message?: string } } = await res.json();
      if (!body.data) {
        setError(body.meta.message ?? "Report generation failed.");
        setReport(null);
        return;
      }
      setReport(body.data);
      setStatus(body.meta.status);
      setGeneratedAt(body.meta.timestamp);
    } catch {
      setError("Report generation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <span className="text-xs font-medium text-text-primary">Market Brief</span>
          <p className="text-[10px] text-text-muted">AI summary of today&apos;s market news and earnings — not investment advice.</p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="shrink-0 rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {loading ? "Generating…" : report ? "Refresh" : "Generate brief"}
        </button>
      </div>
      <div className="p-3 text-xs leading-relaxed text-text-secondary">
        {error && <div className="text-negative">{error}</div>}
        {!error && !report && !loading && (
          <div className="text-text-muted">No brief generated yet — click &ldquo;Generate brief&rdquo;.</div>
        )}
        {report && (
          <>
            <div className="mb-2 flex items-center gap-2">
              {status && <DataStatusBadge status={status} />}
              {generatedAt && (
                <span className="text-[10px] text-text-muted">as of {new Date(generatedAt).toLocaleTimeString()}</span>
              )}
            </div>
            <div className="whitespace-pre-wrap">{report}</div>
          </>
        )}
      </div>
    </div>
  );
}
