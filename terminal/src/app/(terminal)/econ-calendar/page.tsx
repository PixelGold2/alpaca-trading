import Link from "next/link";
import { getEconomicCalendar } from "@/lib/econ-calendar/fred-econ-calendar";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { EconCalendarList } from "@/components/terminal/econ-calendar/EconCalendarList";

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

export default async function EconCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from: rawFrom } = await searchParams;

  const from = parseFrom(rawFrom);
  const to = new Date(from.getTime() + (RANGE_DAYS - 1) * DAY_MS);
  const prevFrom = toISODate(new Date(from.getTime() - RANGE_DAYS * DAY_MS));
  const nextFrom = toISODate(new Date(from.getTime() + RANGE_DAYS * DAY_MS));

  const result = await getEconomicCalendar(toISODate(from), toISODate(to));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-medium text-text-primary">Economic Calendar</h1>
          <p className="text-xs text-text-muted">
            Real release dates and actual/previous values from FRED. No forecast/consensus figures — FRED doesn&apos;t
            publish them, so none are shown here.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <Link
            href={`/econ-calendar?from=${prevFrom}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-hover"
          >
            ← Prev week
          </Link>
          <Link
            href="/econ-calendar"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-hover"
          >
            This week
          </Link>
          <Link
            href={`/econ-calendar?from=${nextFrom}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-hover"
          >
            Next week →
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">{formatRangeLabel(from, to)}</span>
          <DataStatusBadge status={result.meta.status} />
        </div>
      </div>

      {!result.data ? (
        <p className="text-xs text-text-muted">
          Data unavailable{result.meta.message ? ` — ${result.meta.message}` : "."}
        </p>
      ) : (
        <EconCalendarList events={result.data} />
      )}
    </div>
  );
}
