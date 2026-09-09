import {
  doji,
  bullishengulfingpattern,
  bearishengulfingpattern,
  bullishharami,
  bearishharami,
  morningstar,
  eveningstar,
  threewhitesoldiers,
  threeblackcrows,
  bullishhammerstick,
  shootingstar,
} from "technicalindicators";
import type { Bar } from "@/lib/market-data/types";

export interface CandlestickHit {
  time: string; // ISO, matches the source Bar's time
  pattern: string;
  direction: "bullish" | "bearish" | "neutral";
}

interface PatternDef {
  label: string;
  direction: CandlestickHit["direction"];
  // technicalindicators' plain exported functions (e.g. ti.doji) check only
  // the LAST candle(s) of whatever slice they're given — so scanning the
  // whole series means sliding a window and testing at each position. This
  // is the package's public API (not an internal/undocumented detail): the
  // per-pattern class's getAllPatternIndex() does exactly this same slide
  // internally, we're just doing it through the exported functions since the
  // pattern classes themselves aren't part of the package's public exports.
  fn: (data: { open: number[]; high: number[]; low: number[]; close: number[] }) => boolean;
}

const WINDOW = 5; // covers every bundled pattern's required candle count (max 3)

const PATTERNS: PatternDef[] = [
  { label: "Doji", direction: "neutral", fn: doji },
  { label: "Bullish Engulfing", direction: "bullish", fn: bullishengulfingpattern },
  { label: "Bearish Engulfing", direction: "bearish", fn: bearishengulfingpattern },
  { label: "Bullish Harami", direction: "bullish", fn: bullishharami },
  { label: "Bearish Harami", direction: "bearish", fn: bearishharami },
  { label: "Morning Star", direction: "bullish", fn: morningstar },
  { label: "Evening Star", direction: "bearish", fn: eveningstar },
  { label: "Three White Soldiers", direction: "bullish", fn: threewhitesoldiers },
  { label: "Three Black Crows", direction: "bearish", fn: threeblackcrows },
  { label: "Hammer", direction: "bullish", fn: bullishhammerstick },
  { label: "Shooting Star", direction: "bearish", fn: shootingstar },
];

export function detectCandlestickPatterns(bars: Bar[], maxResults = 12): CandlestickHit[] {
  const hits: CandlestickHit[] = [];

  for (let i = WINDOW - 1; i < bars.length; i++) {
    const slice = bars.slice(i - WINDOW + 1, i + 1);
    const data = {
      open: slice.map((b) => b.open),
      high: slice.map((b) => b.high),
      low: slice.map((b) => b.low),
      close: slice.map((b) => b.close),
    };
    for (const pattern of PATTERNS) {
      if (pattern.fn(data)) {
        hits.push({ time: bars[i].time, pattern: pattern.label, direction: pattern.direction });
      }
    }
  }

  return hits.slice(-maxResults);
}
