import type { Time } from "lightweight-charts";

export type ZoneKind =
  | "fvg-bullish"
  | "fvg-bearish"
  | "orderblock-bullish"
  | "orderblock-bearish"
  | "liquidity-high"
  | "liquidity-low";

export interface Zone {
  id: string;
  kind: ZoneKind;
  startTime: Time;
  topPrice: number;
  bottomPrice: number;
  label: string;
}

export interface SwingPoint {
  time: Time;
  price: number;
  type: "high" | "low";
}
