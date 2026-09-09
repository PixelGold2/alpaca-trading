import type { UTCTimestamp } from "lightweight-charts";
import type { Bar } from "@/lib/market-data/types";
import type { Zone, SwingPoint } from "@/lib/patterns/types";
import { toUnixTime, randomId } from "@/lib/patterns/utils";

const SWING_LOOKBACK = 3;
const EQUAL_LEVEL_TOLERANCE = 0.001; // 0.1% — "approximately equal" highs/lows
const MIN_TOUCHES = 2;

/**
 * Fractal-style swing points: a bar is a swing high/low if its high/low is
 * the most extreme within `lookback` bars on both sides. Shared by liquidity
 * detection here and by chart-patterns.ts, which zigzags these into
 * double-top/bottom and head-and-shoulders candidates.
 */
export function findSwingPoints(bars: Bar[], lookback = SWING_LOOKBACK): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const window = bars.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((b) => b.high <= bars[i].high);
    const isLow = window.every((b) => b.low >= bars[i].low);
    if (isHigh) points.push({ time: toUnixTime(bars[i].time), price: bars[i].high, type: "high" });
    if (isLow) points.push({ time: toUnixTime(bars[i].time), price: bars[i].low, type: "low" });
  }
  return points;
}

/**
 * Liquidity zones: clusters of at least MIN_TOUCHES swing highs (or lows)
 * sitting within EQUAL_LEVEL_TOLERANCE of each other — the classic "equal
 * highs/lows" resting-stop pattern. Mechanical clustering by tolerance, not a
 * judgment call. Capped to the most recently-touched clusters (not
 * insertion order) so a handful of stale, no-longer-relevant levels from the
 * start of the loaded range don't crowd out current ones.
 */
export function detectLiquidityZones(bars: Bar[], maxResults = 8): Zone[] {
  const swings = findSwingPoints(bars);
  const zones: (Zone & { latestTime: number })[] = [];

  for (const type of ["high", "low"] as const) {
    const points = swings.filter((p) => p.type === type).sort((a, b) => a.price - b.price);
    const used = new Set<number>();

    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      const cluster = [points[i]];
      used.add(i);
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        const ref = points[i].price;
        if (Math.abs(points[j].price - ref) / ref <= EQUAL_LEVEL_TOLERANCE) {
          cluster.push(points[j]);
          used.add(j);
        }
      }
      if (cluster.length >= MIN_TOUCHES) {
        const prices = cluster.map((p) => p.price);
        const times = cluster.map((p) => p.time as unknown as number);
        zones.push({
          id: randomId(),
          kind: type === "high" ? "liquidity-high" : "liquidity-low",
          startTime: Math.min(...times) as UTCTimestamp,
          topPrice: Math.max(...prices),
          bottomPrice: Math.min(...prices),
          label: `Liquidity (${cluster.length}x)`,
          latestTime: Math.max(...times),
        });
      }
    }
  }

  return zones
    .sort((a, b) => b.latestTime - a.latestTime)
    .slice(0, maxResults)
    .map(({ latestTime: _latestTime, ...zone }) => zone);
}
