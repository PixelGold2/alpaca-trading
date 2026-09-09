import { TabbedMarketView } from "@/components/terminal/TabbedMarketView";
import type { BarTimeframe } from "@/lib/market-data/types";

const VALID_TIMEFRAMES = new Set<string>([
  "1Min",
  "5Min",
  "15Min",
  "30Min",
  "1Hour",
  "4Hour",
  "1Day",
  "1Week",
  "1Month",
]);

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; timeframe?: string }>;
}) {
  const params = await searchParams;
  const symbol = (params.symbol ?? "AAPL").toUpperCase();
  const timeframe = (
    VALID_TIMEFRAMES.has(params.timeframe ?? "") ? params.timeframe! : "1Day"
  ) as BarTimeframe;

  return (
    <div className="space-y-3">
      <h1 className="text-sm font-medium text-text-primary">Charts</h1>
      <TabbedMarketView initialSymbol={symbol} initialTimeframe={timeframe} />
    </div>
  );
}
