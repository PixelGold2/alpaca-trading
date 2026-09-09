import type { Bar } from "@/lib/market-data/types";
import type { Zone } from "@/lib/patterns/types";
import { toUnixTime, randomId, averageRange } from "@/lib/patterns/utils";

const MIN_BREAK_RATIO = 0.5; // how far past the candle's high/low the next close must reach, as a fraction of typical candle range

/**
 * Order block: the last opposing-color candle before a move that breaks
 * structure through it — bullish OB is the last down-close candle before a
 * candle closes above its high; bearish OB is the last up-close candle
 * before a candle closes below its low. Standard SMC/ICT definition, applied
 * mechanically (no discretionary judgment). Only kept when the breakout
 * candle clears the level by a meaningful margin (MIN_BREAK_RATIO × the
 * loaded series' typical candle range) — a 1-cent breakout technically
 * qualifies but isn't a credible order block, and this threshold scales with
 * whatever timeframe is loaded rather than a fixed price amount.
 */
export function detectOrderBlockZones(bars: Bar[], maxResults = 8): Zone[] {
  const minBreak = averageRange(bars) * MIN_BREAK_RATIO;
  const zones: Zone[] = [];

  for (let i = 0; i < bars.length - 1; i++) {
    const candle = bars[i];
    const next = bars[i + 1];
    const isBearishCandle = candle.close < candle.open;
    const isBullishCandle = candle.close > candle.open;

    if (isBearishCandle && next.close - candle.high >= minBreak) {
      zones.push({
        id: randomId(),
        kind: "orderblock-bullish",
        startTime: toUnixTime(candle.time),
        topPrice: candle.high,
        bottomPrice: candle.low,
        label: "OB",
      });
    } else if (isBullishCandle && candle.low - next.close >= minBreak) {
      zones.push({
        id: randomId(),
        kind: "orderblock-bearish",
        startTime: toUnixTime(candle.time),
        topPrice: candle.high,
        bottomPrice: candle.low,
        label: "OB",
      });
    }
  }
  return zones.slice(-maxResults);
}
