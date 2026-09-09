import type { Bar } from "@/lib/market-data/types";
import type { SwingPoint } from "@/lib/patterns/types";
import type { DrawPoint } from "@/lib/charting/drawing-primitives";
import { findSwingPoints } from "@/lib/patterns/liquidity";
import { averageRange, randomId } from "@/lib/patterns/utils";

export type ChartPatternKind = "double-top" | "double-bottom" | "head-and-shoulders";

export interface ChartPatternMatch {
  id: string;
  kind: ChartPatternKind;
  points: DrawPoint[]; // polyline through the pattern's defining swing points, in order
  label: string;
}

const PEAK_EQUALITY_TOLERANCE = 0.015; // 1.5% — "approximately equal" peaks/troughs for a pattern (looser than liquidity's exact-level clustering, since this is shape matching)
const MIN_DEPTH_RATIO = 1.5; // the pull-back between peaks/troughs must be at least this many typical-candle-ranges deep to count as a real structure, not noise

function approxEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

/**
 * Collapses swing highs/lows (found independently per-type in findSwingPoints)
 * into a single chronological zigzag — consecutive swings of the same type
 * are merged, keeping only the more extreme one, so the sequence strictly
 * alternates high/low/high/low the way a real price structure does.
 */
function toZigzag(bars: Bar[]): SwingPoint[] {
  const points = findSwingPoints(bars).sort((a, b) => (a.time as number) - (b.time as number));
  const zigzag: SwingPoint[] = [];
  for (const p of points) {
    const last = zigzag[zigzag.length - 1];
    if (!last) {
      zigzag.push(p);
      continue;
    }
    if (last.type === p.type) {
      if (p.type === "high" && p.price > last.price) zigzag[zigzag.length - 1] = p;
      if (p.type === "low" && p.price < last.price) zigzag[zigzag.length - 1] = p;
    } else {
      zigzag.push(p);
    }
  }
  return zigzag;
}

function toPoint(p: SwingPoint): DrawPoint {
  return { time: p.time, price: p.price };
}

/**
 * Classic chart-pattern shapes, matched geometrically against real swing
 * points — not asked of an LLM. Double top/bottom and head-and-shoulders are
 * the few patterns with an unambiguous, checkable geometric definition
 * (roughly-equal peaks/troughs plus a meaningfully deep pull-back between
 * them); triangles/wedges/channels are left out because "roughly parallel/
 * converging trendline" is judgment-call territory this app doesn't fabricate
 * exact coordinates for.
 */
export function detectChartPatterns(bars: Bar[], maxResults = 6): ChartPatternMatch[] {
  const zigzag = toZigzag(bars);
  const minDepth = averageRange(bars) * MIN_DEPTH_RATIO;
  const matches: ChartPatternMatch[] = [];

  for (let i = 0; i < zigzag.length - 2; i++) {
    const [a, b, c] = [zigzag[i], zigzag[i + 1], zigzag[i + 2]];

    if (a.type === "high" && b.type === "low" && c.type === "high") {
      const depth = Math.min(a.price, c.price) - b.price;
      if (approxEqual(a.price, c.price, PEAK_EQUALITY_TOLERANCE) && depth >= minDepth) {
        matches.push({
          id: randomId(),
          kind: "double-top",
          points: [toPoint(a), toPoint(b), toPoint(c)],
          label: "Double Top",
        });
      }
    } else if (a.type === "low" && b.type === "high" && c.type === "low") {
      const depth = b.price - Math.max(a.price, c.price);
      if (approxEqual(a.price, c.price, PEAK_EQUALITY_TOLERANCE) && depth >= minDepth) {
        matches.push({
          id: randomId(),
          kind: "double-bottom",
          points: [toPoint(a), toPoint(b), toPoint(c)],
          label: "Double Bottom",
        });
      }
    }

    if (i < zigzag.length - 4) {
      const [s1, t1, head, t2, s2] = zigzag.slice(i, i + 5);
      if (
        s1.type === "high" &&
        t1.type === "low" &&
        head.type === "high" &&
        t2.type === "low" &&
        s2.type === "high" &&
        approxEqual(s1.price, s2.price, PEAK_EQUALITY_TOLERANCE) &&
        head.price - Math.max(s1.price, s2.price) >= minDepth &&
        head.price > s1.price &&
        head.price > s2.price
      ) {
        matches.push({
          id: randomId(),
          kind: "head-and-shoulders",
          points: [s1, t1, head, t2, s2].map(toPoint),
          label: "Head & Shoulders",
        });
      }
    }
  }

  return matches.slice(-maxResults);
}
