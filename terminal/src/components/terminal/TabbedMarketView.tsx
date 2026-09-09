"use client";

import { useEffect, useState } from "react";
import { PriceChart } from "@/components/terminal/PriceChart";
import { FundamentalsPanel } from "@/components/terminal/FundamentalsPanel";
import { UnifiedTickerSearch } from "@/components/terminal/chart/UnifiedTickerSearch";
import type { BarTimeframe } from "@/lib/market-data/types";

type Tab = "chart" | "fundamentals";

export function TabbedMarketView({
  initialSymbol,
  initialTimeframe,
}: {
  initialSymbol: string;
  initialTimeframe: BarTimeframe;
}) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [tab, setTab] = useState<Tab>("chart");

  // Keep the URL shareable: /markets?symbol=NVDA&timeframe=1D (timeframe is synced by PriceChart itself)
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("symbol", symbol);
    window.history.replaceState({}, "", url);
  }, [symbol]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <UnifiedTickerSearch initialSymbol={symbol} onSelect={setSymbol} />
          <p className="mt-1 text-[10px] text-text-muted">
            Forex and futures charting isn&apos;t available with current data providers — quotes only, in Watchlists.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          <button
            onClick={() => setTab("chart")}
            className={`rounded px-3 py-1.5 text-xs ${
              tab === "chart" ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            Chart
          </button>
          <button
            onClick={() => setTab("fundamentals")}
            className={`rounded px-3 py-1.5 text-xs ${
              tab === "fundamentals" ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            Fundamentals
          </button>
        </div>
      </div>

      {tab === "chart" ? (
        <PriceChart symbol={symbol} initialTimeframe={initialTimeframe} />
      ) : (
        <FundamentalsPanel symbol={symbol} />
      )}
    </div>
  );
}
