import type { Bar } from "@/lib/market-data/types";

export interface FiftyTwoWeekRange {
  high: number;
  highDate: string;
  low: number;
  lowDate: string;
  /** True only if the loaded bars actually span ~1 year — otherwise this is honestly labeled as a shorter-period range instead of claimed as "52-week." */
  isFullYear: boolean;
  daysSpanned: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Deterministic 52-week (or, honestly, however-much-is-loaded) high/low —
 * a plain min/max over the bars already on the chart, no AI involved. If the
 * loaded range covers less than ~a year (e.g. on intraday timeframes, which
 * only load a few weeks by design — see defaultStartFor in PriceChart.tsx),
 * this is reported as a shorter-period range rather than mislabeled "52W."
 */
export function compute52WeekRange(bars: Bar[]): FiftyTwoWeekRange | null {
  if (bars.length === 0) return null;

  const now = new Date(bars[bars.length - 1].time).getTime();
  const cutoff = now - YEAR_MS;
  const windowBars = bars.filter((b) => new Date(b.time).getTime() >= cutoff);
  const relevant = windowBars.length > 0 ? windowBars : bars;

  let high = relevant[0];
  let low = relevant[0];
  for (const bar of relevant) {
    if (bar.high > high.high) high = bar;
    if (bar.low < low.low) low = bar;
  }

  const daysSpanned = Math.round((now - new Date(relevant[0].time).getTime()) / (24 * 60 * 60 * 1000));

  return {
    high: high.high,
    highDate: high.time,
    low: low.low,
    lowDate: low.time,
    isFullYear: daysSpanned >= 350,
    daysSpanned,
  };
}
