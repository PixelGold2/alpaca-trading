import type { EconCategory } from "@/lib/econ-calendar/fred-econ-calendar";

export const CATEGORY_LABELS: Record<EconCategory, string> = {
  inflation: "Inflation",
  employment: "Employment",
  growth: "Growth",
  housing: "Housing",
  trade: "Trade",
  fed: "Fed",
  consumer: "Consumer",
};

export const CATEGORY_ORDER: EconCategory[] = ["fed", "inflation", "employment", "growth", "consumer", "housing", "trade"];

export function formatIndicatorValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "index") return value.toFixed(1);
  if (unit === "claims") return value.toLocaleString();
  // "K jobs" / "K" / "K units (SAAR)" / "$B" / "$M" — value is already in
  // those units per the series (e.g. PAYEMS is thousands of jobs, GDP is
  // billions of dollars) — just format the number, keep the unit suffix.
  const prefix = unit.startsWith("$") ? "$" : "";
  const suffix = unit.startsWith("$") ? unit.slice(1) : unit;
  return `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${suffix}`;
}

export function formatDateHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * FRED has no forecast/consensus field — this compares actual to the
 * previous reading instead of to an estimate (the Earnings Calendar's
 * EstimateVsActual compares to a forecast, which doesn't exist here).
 */
export function ActualVsPrevious({
  actual,
  previous,
  unit,
}: {
  actual: number | null;
  previous: number | null;
  unit: string;
}) {
  const up = actual !== null && previous !== null ? actual > previous : null;
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className={up === true ? "text-positive" : up === false ? "text-negative" : "text-text-primary"}>
        {formatIndicatorValue(actual, unit)}
      </span>
      <span className="text-text-muted">prev {formatIndicatorValue(previous, unit)}</span>
    </div>
  );
}
