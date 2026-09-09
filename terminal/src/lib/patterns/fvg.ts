import type { Bar } from "@/lib/market-data/types";
import type { Zone } from "@/lib/patterns/types";
import { toUnixTime, randomId, averageRange } from "@/lib/patterns/utils";

const MIN_GAP_RATIO = 0.35; // gap must be at least this fraction of the typical candle range to count as "credible"

/**
 * Fair Value Gap: a 3-candle imbalance where the wick of candle 1 doesn't
 * overlap the wick of candle 3, leaving a gap candle 2 "jumped over." This is
 * the standard, mechanical ICT/SMC definition — a pure comparison of highs
 * and lows, not a judgment call, so it's computed exactly rather than asked
 * of an LLM. Only gaps at least MIN_GAP_RATIO of the loaded series' typical
 * candle range are kept — filters out the many tiny/insignificant gaps that
 * technically qualify but aren't what anyone means by "a credible FVG,"
 * and the "typical range" baseline auto-adapts to whatever timeframe is loaded.
 */
export function detectFvgZones(bars: Bar[], maxResults = 10): Zone[] {
  const minGapSize = averageRange(bars) * MIN_GAP_RATIO;
  const zones: Zone[] = [];

  for (let i = 1; i < bars.length - 1; i++) {
    const prev = bars[i - 1];
    const next = bars[i + 1];

    if (prev.high < next.low && next.low - prev.high >= minGapSize) {
      zones.push({
        id: randomId(),
        kind: "fvg-bullish",
        startTime: toUnixTime(bars[i].time),
        topPrice: next.low,
        bottomPrice: prev.high,
        label: "FVG",
      });
    } else if (prev.low > next.high && prev.low - next.high >= minGapSize) {
      zones.push({
        id: randomId(),
        kind: "fvg-bearish",
        startTime: toUnixTime(bars[i].time),
        topPrice: prev.low,
        bottomPrice: next.high,
        label: "FVG",
      });
    }
  }

  // Zones are already in chronological order (bars are scanned in order), so
  // the most recent ones — generally the most relevant — are the tail.
  return zones.slice(-maxResults);
}
