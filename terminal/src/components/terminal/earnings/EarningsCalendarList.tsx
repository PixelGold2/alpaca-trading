"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { EarningsEvent, EarningsSession } from "@/lib/earnings/finnhub-earnings";
import { SESSION_LABELS, formatEps, formatRevenue, formatDateHeading, EstimateVsActual } from "@/components/terminal/earnings/shared";

const SESSION_ORDER: EarningsSession[] = ["bmo", "amc", ""];

// Reported actuals rank ahead of mere estimates when both would sort the same
// way; events with no revenue figure at all sink to the bottom.
function revenueRank(e: EarningsEvent): number {
  return e.revenueActual ?? e.revenueEstimate ?? -Infinity;
}

export function EarningsCalendarList({ events }: { events: EarningsEvent[] }) {
  const byDate = useMemo(() => {
    const groups = new Map<string, EarningsEvent[]>();
    for (const e of events) {
      const list = groups.get(e.date) ?? [];
      list.push(e);
      groups.set(e.date, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => revenueRank(b) - revenueRank(a));
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (byDate.length === 0) {
    return <p className="text-xs text-text-muted">No earnings scheduled in this range.</p>;
  }

  return (
    <div className="space-y-4">
      {byDate.map(([date, dayEvents]) => (
        <div key={date} className="rounded-lg border border-border bg-bg-panel">
          <h2 className="border-b border-border px-4 py-2 text-xs font-medium text-text-primary">
            {formatDateHeading(date)}
          </h2>
          <div className="divide-y divide-border/50">
            {SESSION_ORDER.filter((s) => dayEvents.some((e) => e.hour === s)).map((session) => (
              <div key={session} className="px-4 py-2">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  {SESSION_LABELS[session]}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {dayEvents
                    .filter((e) => e.hour === session)
                    .map((e) => (
                      <Link
                        key={`${e.symbol}-${e.date}`}
                        href={`/watchlists/${e.symbol}`}
                        className="rounded-md border border-border bg-bg-panel-raised p-2.5 text-[11px] transition hover:border-border-strong"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-mono text-xs font-medium text-text-primary">{e.symbol}</span>
                          <span className="text-[9px] text-text-muted">
                            Q{e.quarter} &apos;{String(e.year).slice(2)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <EstimateVsActual
                            label="EPS"
                            estimate={e.epsEstimate}
                            actual={e.epsActual}
                            format={formatEps}
                          />
                          <EstimateVsActual
                            label="Revenue"
                            estimate={e.revenueEstimate}
                            actual={e.revenueActual}
                            format={formatRevenue}
                          />
                        </div>
                      </Link>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
