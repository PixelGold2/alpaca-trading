import { getMarketNews, getCompanyNews, type NewsCategory } from "@/lib/news/finnhub-provider";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { NewsSymbolSearch } from "@/components/terminal/news/NewsSymbolSearch";
import { NewsFeed } from "@/components/terminal/news/NewsFeed";
import { MarketsSnapshotPanel } from "@/components/terminal/MarketsSnapshotPanel";
import Link from "next/link";

const CATEGORIES: { value: NewsCategory; label: string }[] = [
  { value: "general", label: "General" },
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
  { value: "merger", label: "Mergers" },
];

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; symbol?: string }>;
}) {
  const params = await searchParams;
  const symbol = params.symbol?.trim().toUpperCase() || null;
  const category = (CATEGORIES.some((c) => c.value === params.category) ? params.category : "general") as NewsCategory;

  const result = symbol ? await getCompanyNews(symbol) : await getMarketNews(category, 30);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-sm font-medium text-text-primary">News</h1>
        <NewsSymbolSearch initialSymbol={symbol ?? ""} />
      </div>

      <MarketsSnapshotPanel />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        {symbol ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>
              Company news for <span className="font-mono font-medium text-text-primary">{symbol}</span>
            </span>
            <Link href="/news" className="text-accent-strong hover:underline">
              Clear
            </Link>
          </div>
        ) : (
          <div className="flex gap-1">
            {CATEGORIES.map((c) => (
              <Link
                key={c.value}
                href={`/news?category=${c.value}`}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  category === c.value
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        )}
        <DataStatusBadge status={result.meta.status} />
      </div>

      {result.data && result.data.length > 0 ? (
        <NewsFeed items={result.data} symbol={symbol ?? undefined} />
      ) : (
        <p className="text-xs text-text-muted">
          {symbol ? `No recent news found for ${symbol}` : "Data unavailable"}
          {result.meta.message ? ` — ${result.meta.message}` : "."}
        </p>
      )}
    </div>
  );
}
