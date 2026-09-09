import { getIndexOverview } from "@/lib/market-data/overview";
import { alpacaProvider } from "@/lib/market-data/alpaca-provider";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

export async function MarketOverviewStrip() {
  const [items, clock] = await Promise.all([getIndexOverview(), alpacaProvider.getMarketClock()]);

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Market Overview</h2>
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          {clock.data ? (
            <>
              <span className={`h-1.5 w-1.5 rounded-full ${clock.data.isOpen ? "bg-positive" : "bg-text-muted"}`} />
              {clock.data.isOpen ? "Market open" : "Market closed"}
            </>
          ) : (
            <DataStatusBadge status={clock.meta.status} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.symbol} className="rounded-md border border-border bg-bg-panel-raised p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs font-medium text-text-primary">{item.symbol}</span>
              <DataStatusBadge status={item.status} />
            </div>
            <div className="mb-0.5 text-[10px] text-text-muted">{item.label}</div>
            {item.price !== null && item.changePercent !== null ? (
              <div className="flex items-baseline gap-2 font-mono">
                <span className="text-sm text-text-primary">
                  {item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className={`text-xs ${item.changePercent >= 0 ? "text-positive" : "text-negative"}`}>
                  {item.changePercent >= 0 ? "+" : ""}
                  {item.changePercent.toFixed(2)}%
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-text-muted">
                Data unavailable{item.message ? ` — ${item.message}` : "."}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
