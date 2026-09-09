"use client";

import { useState } from "react";
import type { WorldEvent } from "@/lib/world-tracker/types";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

export function AIReportPanel({ events }: { events: WorldEvent[] }) {
  const [report, setReport] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coveredCount, setCoveredCount] = useState(0);

  const hasNewEvents = events.length > coveredCount;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const summaries = events.map((e) => ({
        title: e.title,
        category: e.category,
        importance: e.importance,
        location: { country: e.location.country },
        tickers: e.tickers,
      }));
      const res = await fetch("/api/world-tracker/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: summaries }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Report generation failed.");
      setReport(body.report);
      setGeneratedAt(body.generatedAt);
      setCoveredCount(events.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-text-primary">AI Daily Analysis</span>
        <div className="flex items-center gap-2">
          {hasNewEvents && report && (
            <span className="text-[10px] text-attention">New events uncovered</span>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {loading ? "Generating..." : report ? "Refresh" : "Generate report"}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs leading-relaxed text-text-secondary">
        {error && <div className="text-negative">{error}</div>}
        {!error && !report && !loading && (
          <div className="text-text-muted">No report generated yet — click &ldquo;Generate report&rdquo;.</div>
        )}
        {report && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <DataStatusBadge status="live" />
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
