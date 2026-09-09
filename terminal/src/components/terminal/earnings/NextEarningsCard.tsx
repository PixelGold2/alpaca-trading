import Link from "next/link";
import type { EarningsEvent } from "@/lib/earnings/finnhub-earnings";
import { SESSION_LABELS, formatEps, formatRevenue, EstimateVsActual } from "@/components/terminal/earnings/shared";

function formatFullDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function NextEarningsCard({ symbol, event }: { symbol: string; event: EarningsEvent | null }) {
  if (!event) {
    return (
      <p className="text-xs text-text-muted">
        No upcoming earnings found for <span className="font-mono font-medium">{symbol}</span> in the next 12 months.
      </p>
    );
  }

  return (
    <Link
      href={`/watchlists/${event.symbol}`}
      className="block max-w-sm rounded-lg border border-border bg-bg-panel p-4 transition hover:border-border-strong"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-sm font-medium text-text-primary">{event.symbol}</span>
        <span className="text-[10px] text-text-muted">
          Q{event.quarter} &apos;{String(event.year).slice(2)}
        </span>
      </div>
      <div className="mb-3 text-xs text-text-secondary">
        {formatFullDate(event.date)} &middot; {SESSION_LABELS[event.hour]}
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <EstimateVsActual label="EPS" estimate={event.epsEstimate} actual={event.epsActual} format={formatEps} />
        <EstimateVsActual
          label="Revenue"
          estimate={event.revenueEstimate}
          actual={event.revenueActual}
          format={formatRevenue}
        />
      </div>
    </Link>
  );
}
