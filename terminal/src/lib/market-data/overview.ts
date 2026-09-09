import "server-only";
import { alpacaProvider } from "@/lib/market-data/alpaca-provider";
import type { DataStatus } from "@/lib/providers/types";

export interface IndexOverviewItem {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
  status: DataStatus;
  message?: string;
}

// Liquid ETFs used as index proxies — Alpaca's bars endpoint is stocks/ETFs
// only (no raw index tickers), so these are the honest way to show "the
// market" without a data source that doesn't exist for this account. Labeled
// as ETFs, not "the index," so the price shown is never implied to be an
// index level it isn't.
const INDEX_PROXIES: { symbol: string; label: string }[] = [
  { symbol: "SPY", label: "S&P 500 ETF" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF" },
  { symbol: "DIA", label: "Dow Jones ETF" },
  { symbol: "IWM", label: "Russell 2000 ETF" },
];

function startDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

export async function getIndexOverview(): Promise<IndexOverviewItem[]> {
  return Promise.all(
    INDEX_PROXIES.map(async ({ symbol, label }) => {
      const result = await alpacaProvider.getBars({
        symbol,
        timeframe: "1Day",
        start: startDate(10),
        limit: 5,
      });

      if (!result.data || result.data.length === 0) {
        return {
          symbol,
          label,
          price: null,
          changePercent: null,
          status: result.meta.status,
          message: result.meta.message,
        };
      }

      const bars = result.data;
      const latest = bars[bars.length - 1];
      const prior = bars.length > 1 ? bars[bars.length - 2] : latest;
      const changePercent = prior.close ? ((latest.close - prior.close) / prior.close) * 100 : 0;

      return {
        symbol,
        label,
        price: latest.close,
        changePercent,
        status: result.meta.status,
      };
    }),
  );
}
