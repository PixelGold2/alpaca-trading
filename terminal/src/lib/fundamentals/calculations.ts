/**
 * Percent change between two reported values for the same line item across periods
 * (YoY when comparing annual periods, QoQ when comparing quarterly ones). This is a
 * calculated figure, not something FMP reports — always label it as such in the UI.
 * Returns null when it can't be meaningfully computed (missing/zero prior value).
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}
