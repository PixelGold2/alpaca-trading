import Link from "next/link";
import { findWatchlistItem, categoryLabel } from "@/lib/market-data/watchlist";
import type { WatchlistCategory } from "@/lib/market-data/watchlist-types";
import { getCompanyOverview } from "@/lib/market-data/company-overview";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { FundamentalsPanel } from "@/components/terminal/FundamentalsPanel";

const CATEGORIES: WatchlistCategory[] = ["stocks", "forex", "crypto", "futures", "commodities"];

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-panel-raised p-3">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="font-mono text-sm text-text-primary">{value}</div>
    </div>
  );
}

function formatLargeNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toLocaleString();
}

export default async function TickerOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ category?: string; name?: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const { category: rawCategory, name } = await searchParams;
  const category = (CATEGORIES.includes(rawCategory as WatchlistCategory) ? rawCategory : "stocks") as WatchlistCategory;

  // Not just the curated ~10 items per category — a symbol found via the
  // category search box resolves here too, fetched live on the fly.
  const item = await findWatchlistItem(category, symbol, name);
  const overview = category === "stocks" ? await getCompanyOverview(symbol) : null;

  return (
    <div className="space-y-4">
      <Link href={`/watchlists?category=${category}`} className="text-xs text-accent-strong hover:underline">
        &larr; Back to {categoryLabel(category)}
      </Link>

      <div className="rounded-lg border border-border bg-bg-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg font-semibold text-text-primary">{item.symbol}</h1>
              <DataStatusBadge status={item.status} />
            </div>
            <p className="text-xs text-text-muted">
              {overview?.data?.name ?? item.label} &middot; {categoryLabel(category)}
            </p>
          </div>

          {item.chartable ? (
            <Link
              href={`/markets?symbol=${item.symbol}`}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
            >
              Go to charts &rarr;
            </Link>
          ) : (
            <span
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted"
              title="This asset type isn't chartable in this app's data provider."
            >
              Charting unavailable for {categoryLabel(category)}
            </span>
          )}
        </div>

        {item.price !== null && item.changePercent !== null ? (
          <div className="mb-4 flex items-baseline gap-3 font-mono">
            <span className="text-2xl text-text-primary">
              {item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            <span className={`text-sm ${item.changePercent >= 0 ? "text-positive" : "text-negative"}`}>
              {item.changePercent >= 0 ? "+" : ""}
              {item.changePercent.toFixed(2)}%
            </span>
          </div>
        ) : (
          <p className="mb-4 text-xs text-text-muted">
            Data unavailable{item.message ? ` — ${item.message}` : "."}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricBox label="Day High" value={item.dayHigh !== null ? item.dayHigh.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"} />
          <MetricBox label="Day Low" value={item.dayLow !== null ? item.dayLow.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"} />
          <MetricBox label="Volume" value={item.volume !== null ? item.volume.toLocaleString() : "—"} />
        </div>
      </div>

      {category === "stocks" && overview && (
        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Stock Overview</h2>
            <DataStatusBadge status={overview.meta.status} />
          </div>
          {overview.data ? (
            <div className="flex items-start gap-4">
              {overview.data.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- external company logo from Finnhub, not a static/optimizable asset
                <img src={overview.data.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded bg-white object-contain p-1" />
              )}
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricBox label="Industry" value={overview.data.industry ?? "—"} />
                <MetricBox label="Exchange" value={overview.data.exchange ?? "—"} />
                <MetricBox label="Country" value={overview.data.country ?? "—"} />
                <MetricBox
                  label="Market Cap"
                  value={overview.data.marketCap !== null ? `$${formatLargeNumber(overview.data.marketCap)}` : "—"}
                />
                <MetricBox
                  label="Shares Outstanding"
                  value={overview.data.sharesOutstanding !== null ? formatLargeNumber(overview.data.sharesOutstanding) : "—"}
                />
                <MetricBox label="IPO Date" value={overview.data.ipoDate ?? "—"} />
                <MetricBox label="Currency" value={overview.data.currency ?? "—"} />
                <MetricBox
                  label="Website"
                  value={overview.data.website ? overview.data.website.replace(/^https?:\/\//, "") : "—"}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Data unavailable{overview.meta.message ? ` — ${overview.meta.message}` : "."}
            </p>
          )}
        </div>
      )}

      {category === "stocks" && (
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">Fundamentals</h2>
          <FundamentalsPanel symbol={item.symbol} />
        </div>
      )}
    </div>
  );
}
