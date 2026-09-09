import {
  sma,
  ema,
  wma,
  rsi,
  macd,
  bollingerbands,
  atr,
  vwap,
  psar,
  stochastic,
  cci,
  adx,
  williamsr,
  obv,
  roc,
} from "technicalindicators";
import type { Bar } from "@/lib/market-data/types";

export interface TimedValue {
  time: string; // ISO 8601, matches the source Bar's time
  value: number;
}

export interface MacdPoint {
  time: string;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerPoint {
  time: string;
  upper: number;
  middle: number;
  lower: number;
}

export interface StochasticPoint {
  time: string;
  k: number;
  d: number;
}

export interface AdxPoint {
  time: string;
  adx: number;
  pdi: number;
  mdi: number;
}

/**
 * technicalindicators' functions return arrays shorter than the input (the
 * first `period - 1` values have no result yet) and don't carry timestamps.
 * This right-aligns a result array back onto the source bars' times, since
 * result[i] always corresponds to bars[bars.length - result.length + i].
 */
function alignToEnd<T>(bars: Bar[], result: T[]): { time: string; value: T }[] {
  const offset = bars.length - result.length;
  if (offset < 0) return [];
  return result.map((value, i) => ({ time: bars[i + offset].time, value }));
}

export function calculateSMA(bars: Bar[], period: number): TimedValue[] {
  const closes = bars.map((b) => b.close);
  const result = sma({ period, values: closes });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateEMA(bars: Bar[], period: number): TimedValue[] {
  const closes = bars.map((b) => b.close);
  const result = ema({ period, values: closes });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateRSI(bars: Bar[], period: number): TimedValue[] {
  const closes = bars.map((b) => b.close);
  const result = rsi({ period, values: closes });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateMACD(
  bars: Bar[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): MacdPoint[] {
  const closes = bars.map((b) => b.close);
  const result = macd({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  return alignToEnd(bars, result)
    .filter(({ value }) => value.MACD !== undefined && value.signal !== undefined)
    .map(({ time, value }) => ({
      time,
      macd: value.MACD!,
      signal: value.signal!,
      histogram: value.histogram ?? 0,
    }));
}

export function calculateBollingerBands(
  bars: Bar[],
  period: number,
  stdDev: number
): BollingerPoint[] {
  const closes = bars.map((b) => b.close);
  const result = bollingerbands({ period, stdDev, values: closes });
  return alignToEnd(bars, result).map(({ time, value }) => ({
    time,
    upper: value.upper,
    middle: value.middle,
    lower: value.lower,
  }));
}

export function calculateATR(bars: Bar[], period: number): TimedValue[] {
  const result = atr({
    period,
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateWMA(bars: Bar[], period: number): TimedValue[] {
  const closes = bars.map((b) => b.close);
  const result = wma({ period, values: closes });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

// Cumulative from the start of the loaded range, not a rolling window — like
// most VWAP implementations, it resets meaning any time the visible range changes.
export function calculateVWAP(bars: Bar[]): TimedValue[] {
  const result = vwap({
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculatePSAR(bars: Bar[], step = 0.02, max = 0.2): TimedValue[] {
  const result = psar({
    step,
    max,
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateStochastic(
  bars: Bar[],
  period: number,
  signalPeriod: number,
): StochasticPoint[] {
  const result = stochastic({
    period,
    signalPeriod,
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, k: value.k, d: value.d }));
}

export function calculateCCI(bars: Bar[], period: number): TimedValue[] {
  const result = cci({
    period,
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateADX(bars: Bar[], period: number): AdxPoint[] {
  const result = adx({
    period,
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({
    time,
    adx: value.adx,
    pdi: value.pdi,
    mdi: value.mdi,
  }));
}

export function calculateWilliamsR(bars: Bar[], period: number): TimedValue[] {
  const result = williamsr({
    period,
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateOBV(bars: Bar[]): TimedValue[] {
  const result = obv({
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
  });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}

export function calculateROC(bars: Bar[], period: number): TimedValue[] {
  const closes = bars.map((b) => b.close);
  const result = roc({ period, values: closes });
  return alignToEnd(bars, result).map(({ time, value }) => ({ time, value }));
}
