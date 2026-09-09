import { alpacaProvider } from "@/lib/market-data/alpaca-provider";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

export async function StatusBar() {
  const clock = await alpacaProvider.getMarketClock();

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-bg-panel px-3 text-[11px] text-text-muted">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-positive" />
        Database connected
      </div>
      <div className="flex items-center gap-1.5">
        Alpaca market data
        <DataStatusBadge status={clock.meta.status} />
        {clock.data && (
          <span>{clock.data.isOpen ? "Market open" : "Market closed"}</span>
        )}
        {!clock.data && clock.meta.message && <span>{clock.meta.message}</span>}
      </div>
    </footer>
  );
}
