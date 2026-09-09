export interface Indicators {
  sma: boolean;
  ema: boolean;
  wma: boolean;
  bb: boolean;
  vwap: boolean;
  psar: boolean;
  rsi: boolean;
  macd: boolean;
  atr: boolean;
  stochastic: boolean;
  cci: boolean;
  adx: boolean;
  williamsr: boolean;
  obv: boolean;
  roc: boolean;
}

export const DEFAULT_INDICATORS: Indicators = {
  sma: false,
  ema: false,
  wma: false,
  bb: false,
  vwap: false,
  psar: false,
  rsi: false,
  macd: false,
  atr: false,
  stochastic: false,
  cci: false,
  adx: false,
  williamsr: false,
  obv: false,
  roc: false,
};

interface IndicatorMeta {
  key: keyof Indicators;
  label: string;
}

// Overlays draw on the main price pane; oscillators/volume indicators get
// their own pane below (same split PriceChart.tsx already used for RSI/MACD/ATR).
export const OVERLAY_INDICATORS: IndicatorMeta[] = [
  { key: "sma", label: "SMA 20" },
  { key: "ema", label: "EMA 20" },
  { key: "wma", label: "WMA 20" },
  { key: "bb", label: "Bollinger Bands" },
  { key: "vwap", label: "VWAP" },
  { key: "psar", label: "Parabolic SAR" },
];

export const OSCILLATOR_INDICATORS: IndicatorMeta[] = [
  { key: "rsi", label: "RSI 14" },
  { key: "macd", label: "MACD" },
  { key: "atr", label: "ATR 14" },
  { key: "stochastic", label: "Stochastic" },
  { key: "cci", label: "CCI 20" },
  { key: "adx", label: "ADX 14" },
  { key: "williamsr", label: "Williams %R" },
  { key: "obv", label: "OBV" },
  { key: "roc", label: "ROC 12" },
];
