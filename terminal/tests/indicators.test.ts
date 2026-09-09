import { describe, it, expect } from "vitest";
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
} from "@/lib/indicators/calculate";
import type { Bar } from "@/lib/market-data/types";

function makeBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time: new Date(2026, 0, i + 1).toISOString(),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  }));
}

describe("calculateSMA", () => {
  it("computes a known 3-period SMA and aligns it to the correct bar times", () => {
    const bars = makeBars([10, 20, 30, 40, 50]);
    const result = calculateSMA(bars, 3);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.value)).toEqual([20, 30, 40]);
    // First SMA value (window [10,20,30]) belongs at the 3rd bar (index 2), not the 1st.
    expect(result[0].time).toBe(bars[2].time);
    expect(result[1].time).toBe(bars[3].time);
    expect(result[2].time).toBe(bars[4].time);
  });

  it("returns nothing when there isn't enough data for the period", () => {
    const bars = makeBars([10, 20]);
    expect(calculateSMA(bars, 5)).toHaveLength(0);
  });
});

describe("calculateEMA", () => {
  it("weights recent values more than a simple average would", () => {
    // 6 points so EMA has moved past its SMA-seeded first value and can actually
    // react to the spike faster than a trailing simple average would.
    const bars = makeBars([10, 10, 10, 10, 10, 100]);
    const sma = calculateSMA(bars, 5);
    const ema = calculateEMA(bars, 5);
    expect(ema.at(-1)!.value).toBeGreaterThan(sma.at(-1)!.value);
  });
});

describe("calculateRSI", () => {
  it("stays within the 0-100 bound and aligns times to real bars", () => {
    const bars = makeBars([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 22, 21, 23, 25]);
    const result = calculateRSI(bars, 14);

    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(100);
      expect(bars.some((b) => b.time === point.time)).toBe(true);
    }
  });
});

describe("calculateMACD", () => {
  it("produces MACD/signal/histogram triples aligned to real bar times", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const bars = makeBars(closes);
    const result = calculateMACD(bars, 12, 26, 9);

    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(point.histogram).toBeCloseTo(point.macd - point.signal, 5);
      expect(bars.some((b) => b.time === point.time)).toBe(true);
    }
  });
});

describe("calculateBollingerBands", () => {
  it("keeps upper >= middle >= lower at every point", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 5) * 2);
    const bars = makeBars(closes);
    const result = calculateBollingerBands(bars, 20, 2);

    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(point.upper).toBeGreaterThanOrEqual(point.middle);
      expect(point.middle).toBeGreaterThanOrEqual(point.lower);
    }
  });
});

describe("calculateATR", () => {
  it("returns non-negative volatility values", () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 100 + i));
    const result = calculateATR(bars, 14);

    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
  });
});
