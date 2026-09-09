import Link from "next/link";
import { getWatchlistCategory, categoryLabel } from "@/lib/market-data/watchlist";
import type { WatchlistCategory } from "@/lib/market-data/watchlist-types";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { CategoryTickerSearch } from "@/components/terminal/watchlists/CategoryTickerSearch";

const CATEGORIES: WatchlistCategory[] = ["stocks", "forex", "crypto", "futures", "commodities"];

export default async function WatchlistsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const category = (CATEGORIES.includes(params.category as WatchlistCategory) ? params.category : "stocks") as WatchlistCategory;
  const items = await getWatchlistCategory(category);

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-medium text-text-primary">Watchlists</h1>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <div className="flex gap-1">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/watchlists?category=${c}`}
              className={`rounded-md px-2.5 py-1 text-xs ${
                category === c ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {categoryLabel(c)}
            </Link>
          ))}
        </div>
        <CategoryTickerSearch category={category} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.symbol}
            href={`/watchlists/${item.symbol}?category=${item.category}`}
            className="block rounded-md border border-border bg-bg-panel-raised p-3 transition hover:border-border-strong"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs font-medium text-text-primary">{item.symbol}</span>
              <DataStatusBadge status={item.status} />
            </div>
            <div className="mb-1 truncate text-[10px] text-text-muted">{item.label}</div>
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
          </Link>
        ))}
      </div>
    </div>
  );
}
