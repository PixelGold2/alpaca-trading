import Link from "next/link";
import { getEarningsCalendar, type EarningsEvent } from "@/lib/earnings/finnhub-earnings";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { SESSION_LABELS, formatRevenue } from "@/components/terminal/earnings/shared";

const MAX_ITEMS = 6;

// Weekends have no earnings — roll forward to the next business day rather
// than showing an always-empty Saturday/Sunday panel.
function nextBusinessDay(from: Date): Date {
  const d = new Date(from);
  const day = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function revenueRank(e: EarningsEvent): number {
  return e.revenueActual ?? e.revenueEstimate ?? -Infinity;
}

export async function TodaysEarningsPanel() {
  const today = new Date();
  const todayMidnightUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const targetDate = nextBusinessDay(todayMidnightUtc);
  const iso = toISODate(targetDate);
  const isToday = iso === toISODate(todayMidnightUtc);

  const result = await getEarningsCalendar(iso, iso);
  const events = result.data ? [...result.data].sort((a, b) => revenueRank(b) - revenueRank(a)) : [];

  const dayLabel = targetDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Earnings {isToday ? "Today" : `— ${dayLabel}`}
        </h2>
        <DataStatusBadge status={result.meta.status} />
      </div>

      {!result.data ? (
        <p className="text-xs text-text-muted">
          Data unavailable{result.meta.message ? ` — ${result.meta.message}` : "."}
        </p>
      ) : events.length === 0 ? (
        <p className="text-xs text-text-muted">No earnings scheduled {isToday ? "today" : `for ${dayLabel}`}.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {events.slice(0, MAX_ITEMS).map((e) => (
              <li key={e.symbol}>
                <Link
                  href={`/watchlists/${e.symbol}`}
                  className="flex items-center justify-between gap-2 py-1.5 text-xs first:pt-0 last:pb-0 hover:text-accent-strong"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono font-medium text-text-primary">{e.symbol}</span>
                    <span className="text-[9px] uppercase tracking-wide text-text-muted">{SESSION_LABELS[e.hour]}</span>
                  </span>
                  <span className="text-[10px] text-text-muted">Rev est {formatRevenue(e.revenueEstimate)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {events.length > MAX_ITEMS && (
            <p className="mt-1 text-[10px] text-text-muted">+{events.length - MAX_ITEMS} more</p>
          )}
        </>
      )}

      <Link href={`/earnings?from=${iso}`} className="mt-3 inline-block text-[11px] text-accent-strong hover:underline">
        View full calendar →
      </Link>
    </div>
  );
}
