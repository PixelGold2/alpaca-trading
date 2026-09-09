import Link from "next/link";
import { getEarningsCalendar, getNextEarningsForSymbol } from "@/lib/earnings/finnhub-earnings";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { EarningsCalendarList } from "@/components/terminal/earnings/EarningsCalendarList";
import { EarningsSymbolSearch } from "@/components/terminal/earnings/EarningsSymbolSearch";
import { NextEarningsCard } from "@/components/terminal/earnings/NextEarningsCard";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS = 7;

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseFrom(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

function formatRangeLabel(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${from.toLocaleDateString("en-US", opts)} – ${to.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; symbol?: string }>;
}) {
  const { from: rawFrom, symbol: rawSymbol } = await searchParams;
  const symbol = rawSymbol?.trim().toUpperCase() || null;

  const from = parseFrom(rawFrom);
  const to = new Date(from.getTime() + (RANGE_DAYS - 1) * DAY_MS);
  const prevFrom = toISODate(new Date(from.getTime() - RANGE_DAYS * DAY_MS));
  const nextFrom = toISODate(new Date(from.getTime() + RANGE_DAYS * DAY_MS));

  const result = symbol
    ? await getNextEarningsForSymbol(symbol)
    : await getEarningsCalendar(toISODate(from), toISODate(to));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-medium text-text-primary">Earnings Calendar</h1>
          <p className="text-xs text-text-muted">Upcoming and recently reported earnings, by date.</p>
        </div>
        <EarningsSymbolSearch initialSymbol={symbol ?? ""} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        {symbol ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>
              Next upcoming earnings for <span className="font-mono font-medium text-text-primary">{symbol}</span>
            </span>
            <Link href="/earnings" className="text-accent-strong hover:underline">
              Clear
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href={`/earnings?from=${prevFrom}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-hover"
            >
              ← Prev week
            </Link>
            <Link href="/earnings" className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-hover">
              This week
            </Link>
            <Link
              href={`/earnings?from=${nextFrom}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-hover"
            >
              Next week →
            </Link>
          </div>
        )}
        <div className="flex items-center gap-3">
          {!symbol && <span className="text-xs text-text-secondary">{formatRangeLabel(from, to)}</span>}
          <DataStatusBadge status={result.meta.status} />
        </div>
      </div>

      {!result.data ? (
        <p className="text-xs text-text-muted">
          Data unavailable{result.meta.message ? ` — ${result.meta.message}` : "."}
        </p>
      ) : symbol ? (
        <NextEarningsCard symbol={symbol} event={"event" in result.data ? result.data.event : null} />
      ) : (
        <EarningsCalendarList events={Array.isArray(result.data) ? result.data : []} />
      )}
    </div>
  );
}
