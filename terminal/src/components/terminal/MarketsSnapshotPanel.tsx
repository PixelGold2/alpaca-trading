import Link from "next/link";
import { getAllWatchlistCategories, categoryLabel } from "@/lib/market-data/watchlist";
import type { WatchlistCategory, WatchlistItem } from "@/lib/market-data/watchlist-types";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

const CATEGORIES: WatchlistCategory[] = ["stocks", "forex", "crypto", "futures", "commodities"];
const PREVIEW_COUNT = 4;

function TickerCard({ item }: { item: WatchlistItem }) {
  return (
    <Link
      href={`/watchlists/${item.symbol}?category=${item.category}`}
      className="block rounded-md border border-border bg-bg-panel-raised p-2.5 transition hover:border-border-strong"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs font-medium text-text-primary">{item.symbol}</span>
        <DataStatusBadge status={item.status} />
      </div>
      <div className="mb-0.5 truncate text-[10px] text-text-muted">{item.label}</div>
      {item.price !== null && item.changePercent !== null ? (
        <div className="flex items-baseline gap-1.5 font-mono">
          <span className="text-xs text-text-primary">
            {item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className={`text-[10px] ${item.changePercent >= 0 ? "text-positive" : "text-negative"}`}>
            {item.changePercent >= 0 ? "+" : ""}
            {item.changePercent.toFixed(2)}%
          </span>
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">Unavailable</div>
      )}
    </Link>
  );
}

export async function MarketsSnapshotPanel() {
  const byCategory = await getAllWatchlistCategories();

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {CATEGORIES.map((category) => (
          <div key={category}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                {categoryLabel(category)}
              </h2>
              <Link href={`/watchlists?category=${category}`} className="text-[10px] text-accent-strong hover:underline">
                See more &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {byCategory[category].slice(0, PREVIEW_COUNT).map((item) => (
                <TickerCard key={item.symbol} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
