import { getMarketNews } from "@/lib/news/finnhub-provider";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function QuickNewsList() {
  const result = await getMarketNews("general", 10);

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Quick News</h2>
        <DataStatusBadge status={result.meta.status} />
      </div>

      {result.data && result.data.length > 0 ? (
        <ul className="divide-y divide-border">
          {result.data.map((item) => (
            <li key={item.id} className="py-2 first:pt-0 last:pb-0">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs font-medium text-text-primary hover:text-accent-strong"
              >
                {item.headline}
              </a>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted">
                <span>{item.source}</span>
                <span>&middot;</span>
                <span>{timeAgo(item.publishedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">
          Data unavailable{result.meta.message ? ` — ${result.meta.message}` : "."}
        </p>
      )}
    </div>
  );
}
