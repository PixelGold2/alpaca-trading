import type { EarningsSession } from "@/lib/earnings/finnhub-earnings";

export const SESSION_LABELS: Record<EarningsSession, string> = {
  bmo: "Before Open",
  amc: "After Close",
  "": "Time TBD",
};

export function formatEps(value: number | null): string {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

export function formatRevenue(value: number | null): string {
  if (typeof value !== "number") return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

export function formatDateHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

export function EstimateVsActual({
  label,
  estimate,
  actual,
  format,
}: {
  label: string;
  estimate: number | null;
  actual: number | null;
  format: (v: number | null) => string;
}) {
  const beat = actual !== null && estimate !== null ? actual >= estimate : null;
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-text-secondary">
        Est {format(estimate)}
        {actual !== null && (
          <>
            {" · Act "}
            <span className={beat === true ? "text-positive" : beat === false ? "text-negative" : "text-text-primary"}>
              {format(actual)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
