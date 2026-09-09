"use client";

import { useState } from "react";
import type { Bar } from "@/lib/market-data/types";
import type { Zone } from "@/lib/patterns/types";
import { detectFvgZones } from "@/lib/patterns/fvg";
import { detectOrderBlockZones } from "@/lib/patterns/orderblocks";
import { detectLiquidityZones } from "@/lib/patterns/liquidity";
import { detectCandlestickPatterns } from "@/lib/patterns/candlesticks";
import { detectChartPatterns, type ChartPatternMatch } from "@/lib/patterns/chart-patterns";
import { compute52WeekRange } from "@/lib/patterns/fifty-two-week";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

type OptionKey =
  | "fvg"
  | "liquidity"
  | "orderblocks"
  | "chart-patterns"
  | "candlesticks"
  | "fifty-two-week"
  | "insight";

interface OptionDef {
  key: OptionKey;
  label: string;
  group: "draw" | "text";
}

const OPTIONS: OptionDef[] = [
  { key: "fvg", label: "FVG", group: "draw" },
  { key: "liquidity", label: "Liquidity Zones", group: "draw" },
  { key: "orderblocks", label: "Order Blocks", group: "draw" },
  { key: "chart-patterns", label: "Chart Patterns", group: "draw" },
  { key: "candlesticks", label: "Candlestick Patterns", group: "text" },
  { key: "fifty-two-week", label: "52W High/Low", group: "text" },
  { key: "insight", label: "Price/Volume Insight", group: "text" },
];

interface LogEntry {
  id: string;
  question: string;
  answer: string;
  at: string;
  failed?: boolean;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function summarizeBars(symbol: string, timeframe: string, bars: Bar[]) {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);
  const first = closes[0];
  const last = closes[closes.length - 1];
  return {
    symbol,
    timeframe,
    barCount: bars.length,
    latestClose: last,
    changePercent: first ? ((last - first) / first) * 100 : 0,
    periodHigh: Math.max(...highs),
    periodLow: Math.min(...lows),
    latestVolume: volumes[volumes.length - 1] ?? 0,
    averageVolume: volumes.reduce((sum, v) => sum + v, 0) / (volumes.length || 1),
  };
}

async function fetchInsight(symbol: string, timeframe: string, bars: Bar[]): Promise<string> {
  const res = await fetch("/api/market-data/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summarizeBars(symbol, timeframe, bars)),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Insight generation failed.");
  return body.insight;
}

function formatCandlestickHits(bars: Bar[]): string {
  const hits = detectCandlestickPatterns(bars);
  if (hits.length === 0) return "No credible candlestick patterns in the loaded range.";
  return hits
    .map((h) => `${new Date(h.time).toLocaleDateString()}: ${h.pattern} (${h.direction})`)
    .join("\n");
}

function formatFiftyTwoWeek(bars: Bar[]): string {
  const range = compute52WeekRange(bars);
  if (!range) return "Not enough data loaded.";
  const label = range.isFullYear ? "52-week" : `${range.daysSpanned}-day (less than a year loaded)`;
  return `${label} high: $${range.high.toFixed(2)} on ${new Date(range.highDate).toLocaleDateString()}\n${label} low: $${range.low.toFixed(2)} on ${new Date(range.lowDate).toLocaleDateString()}`;
}

export function AIAnalysisPanel({
  symbol,
  timeframe,
  bars,
  aiZoneCount,
  onAddZones,
  onAddPatterns,
  onClearAiZones,
}: {
  symbol: string;
  timeframe: string;
  bars: Bar[] | null;
  aiZoneCount: number;
  onAddZones: (zones: Zone[]) => void;
  onAddPatterns: (patterns: ChartPatternMatch[]) => void;
  onClearAiZones: () => void;
}) {
  const [selected, setSelected] = useState<Set<OptionKey>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  function toggle(key: OptionKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function askAI() {
    if (!bars || bars.length === 0 || selected.size === 0) return;
    setLoading(true);

    const askedLabels = OPTIONS.filter((o) => selected.has(o.key)).map((o) => o.label);
    const answerParts: string[] = [];
    let failed = false;

    for (const option of OPTIONS) {
      if (!selected.has(option.key)) continue;
      try {
        if (option.key === "fvg") {
          const zones = detectFvgZones(bars);
          onAddZones(zones);
          answerParts.push(`FVG: drew ${zones.length} credible zone(s).`);
        } else if (option.key === "liquidity") {
          const zones = detectLiquidityZones(bars);
          onAddZones(zones);
          answerParts.push(`Liquidity Zones: drew ${zones.length} credible zone(s).`);
        } else if (option.key === "orderblocks") {
          const zones = detectOrderBlockZones(bars);
          onAddZones(zones);
          answerParts.push(`Order Blocks: drew ${zones.length} credible zone(s).`);
        } else if (option.key === "chart-patterns") {
          const patterns = detectChartPatterns(bars);
          onAddPatterns(patterns);
          answerParts.push(
            patterns.length > 0
              ? `Chart Patterns: drew ${patterns.length} (${patterns.map((p) => p.label).join(", ")}).`
              : "Chart Patterns: no double top/bottom or head-and-shoulders structure found in the loaded range.",
          );
        } else if (option.key === "candlesticks") {
          answerParts.push(`Candlestick Patterns:\n${formatCandlestickHits(bars)}`);
        } else if (option.key === "fifty-two-week") {
          answerParts.push(formatFiftyTwoWeek(bars));
        } else if (option.key === "insight") {
          const text = await fetchInsight(symbol, timeframe, bars);
          answerParts.push(`Price/Volume Insight (AI):\n${text}`);
        }
      } catch (err) {
        failed = true;
        answerParts.push(`${option.label}: ${err instanceof Error ? err.message : "failed."}`);
      }
    }

    setLog((prev) => [
      ...prev,
      {
        id: randomId(),
        question: askedLabels.join(", "),
        answer: answerParts.join("\n\n"),
        at: new Date().toISOString(),
        failed,
      },
    ]);
    setLoading(false);
  }

  const drawOptions = OPTIONS.filter((o) => o.group === "draw");
  const textOptions = OPTIONS.filter((o) => o.group === "text");

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">AI Chart Analysis — {symbol}</span>
        <div className="flex items-center gap-2">
          {aiZoneCount > 0 && (
            <>
              <span className="text-[10px] text-text-muted">{aiZoneCount} AI marking(s) on chart</span>
              <button
                onClick={onClearAiZones}
                className="rounded border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:border-negative/40 hover:text-negative"
              >
                Clear AI markings
              </button>
            </>
          )}
          <DataStatusBadge status="live" />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Draw:</span>
        {drawOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => toggle(option.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              selected.has(option.key)
                ? "border-accent bg-accent/15 text-accent-strong"
                : "border-border text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">Explain:</span>
        {textOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => toggle(option.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              selected.has(option.key)
                ? "border-accent bg-accent/15 text-accent-strong"
                : "border-border text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button
        onClick={askAI}
        disabled={loading || selected.size === 0 || !bars || bars.length === 0}
        className="mb-3 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
      >
        {loading ? "Asking AI..." : "Ask AI"}
      </button>

      <div className="max-h-64 space-y-3 overflow-y-auto text-xs leading-relaxed text-text-secondary">
        {log.length === 0 && (
          <div className="text-text-muted">Pick one or more options above, then &ldquo;Ask AI.&rdquo;</div>
        )}
        {log.map((entry) => (
          <div key={entry.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
            <div className="mb-1 flex items-center gap-2 text-[10px] text-text-muted">
              <span className="font-medium text-text-primary">You asked:</span> {entry.question}
              <span>&middot;</span>
              <span>{new Date(entry.at).toLocaleTimeString()}</span>
            </div>
            <p className={`whitespace-pre-wrap ${entry.failed ? "text-negative" : ""}`}>{entry.answer}</p>
          </div>
        ))}
      </div>

      <p className="mt-2 border-t border-border pt-2 text-[10px] text-text-muted">
        Everything under &ldquo;Draw&rdquo; plus 52W High/Low is computed exactly from price data
        and filtered to credible/significant results for the loaded timeframe — never AI-guessed.
        Only the price/volume insight is AI commentary, and it&apos;s not financial advice.
      </p>
    </div>
  );
}
