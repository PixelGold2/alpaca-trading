"use client";

import { useState } from "react";
import type { NewsItem } from "@/lib/news/finnhub-provider";
import type { HeadlineClassification, HeadlineTier } from "@/lib/news/news-ai-summarizer";
import { NewsThumbnail } from "@/components/terminal/news/NewsThumbnail";

const TIER_STYLES: Record<HeadlineTier, string> = {
  major: "bg-negative/15 text-negative border-negative/30",
  notable: "bg-warning/15 text-warning border-warning/30",
  minor: "bg-bg-hover text-text-muted border-border",
};

const TIER_LABELS: Record<HeadlineTier, string> = {
  major: "MAJOR",
  notable: "NOTABLE",
  minor: "MINOR",
};

const TIER_RANK: Record<HeadlineTier, number> = { major: 0, notable: 1, minor: 2 };

interface Ranked {
  item: NewsItem;
  classification?: HeadlineClassification;
}

function TierBadge({ tier }: { tier: HeadlineTier }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide ${TIER_STYLES[tier]}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Big lead story — the Yahoo Finance-style "hero" at the top of the main column.
function HeroCard({ item, classification }: Ranked) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-lg border border-border bg-bg-panel-raised transition hover:border-border-strong"
    >
      {item.imageUrl && <NewsThumbnail src={item.imageUrl} className="h-56 w-full object-cover sm:h-64" />}
      <div className="p-4">
        <div className="mb-1.5 flex items-center gap-2">
          {classification && <TierBadge tier={classification.tier} />}
          <span className="text-[10px] text-text-muted">
            {item.source} &middot; {timeAgo(item.publishedAt)}
          </span>
        </div>
        <h2 className="text-lg font-semibold leading-snug text-text-primary">{item.headline}</h2>
        {item.summary && <p className="mt-1.5 text-xs text-text-secondary">{item.summary}</p>}
        {classification?.impact && (
          <p className="mt-2 rounded-md border border-negative/30 bg-negative/5 p-2 text-[11px] text-text-secondary">
            <span className="font-medium text-negative">Likely impact: </span>
            {classification.impact}
          </p>
        )}
      </div>
    </a>
  );
}

// Secondary story cards — the grid below the hero, mirroring a financial news
// homepage's "more headlines" card row.
function GridCard({ item, classification }: Ranked) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-lg border border-border bg-bg-panel-raised transition hover:border-border-strong"
    >
      {item.imageUrl && <NewsThumbnail src={item.imageUrl} className="h-28 w-full object-cover" />}
      <div className="p-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          {classification && <TierBadge tier={classification.tier} />}
          <span className="text-[9px] text-text-muted">
            {item.source} &middot; {timeAgo(item.publishedAt)}
          </span>
        </div>
        <h3 className="text-xs font-medium leading-snug text-text-primary">{item.headline}</h3>
        {classification?.impact && <p className="mt-1 text-[10px] text-warning">{classification.impact}</p>}
      </div>
    </a>
  );
}

// Text-only right-rail row — the compact "latest headlines" list alongside the
// main column, same spot Yahoo Finance's news page keeps its running list.
function SidebarRow({ item, classification }: Ranked) {
  return (
    <li className="py-2">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="block text-xs font-medium text-text-primary hover:text-accent-strong"
      >
        {item.headline}
      </a>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted">
        {classification && <TierBadge tier={classification.tier} />}
        <span>{item.source}</span>
        <span>&middot;</span>
        <span>{timeAgo(item.publishedAt)}</span>
      </div>
    </li>
  );
}

function rankItems(items: NewsItem[], classifications: HeadlineClassification[] | null): Ranked[] {
  const byIndex = classifications ? new Map(classifications.map((c) => [c.index, c])) : null;
  const ranked = items.map((item, index) => ({ item, classification: byIndex?.get(index) }));
  if (!byIndex) return ranked;
  // Stable sort: major first, then notable, then minor/unclassified — original
  // order preserved within each tier.
  return [...ranked].sort((a, b) => {
    const rankA = a.classification ? TIER_RANK[a.classification.tier] : 3;
    const rankB = b.classification ? TIER_RANK[b.classification.tier] : 3;
    return rankA - rankB;
  });
}

export function NewsFeed({ items, symbol }: { items: NewsItem[]; symbol?: string }) {
  const [classifications, setClassifications] = useState<HeadlineClassification[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function summarize() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/news/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Summarization failed.");
        return;
      }
      setClassifications(body.classifications);
    } catch {
      setError("Network error reaching the summarizer.");
    } finally {
      setLoading(false);
    }
  }

  const ranked = rankItems(items, classifications);
  const [hero, ...rest] = ranked;
  const gridItems = rest.slice(0, 4);
  const sidebarItems = rest.slice(4);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="max-w-md text-[11px] text-text-muted">
          {classifications
            ? `AI-ranked importance and likely impact for ${symbol ?? "these"} headlines — an interpretation, not financial advice or fact.`
            : "Sorted by most recent. Ask AI to rank by importance instead."}
        </p>
        <button
          onClick={summarize}
          disabled={loading || items.length === 0}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {loading ? "Summarizing..." : classifications ? "Re-summarize" : "Summarize with AI"}
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-negative">{error}</p>}

      {hero && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          <div>
            <HeroCard item={hero.item} classification={hero.classification} />
            {gridItems.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {gridItems.map((r) => (
                  <GridCard key={r.item.id} item={r.item} classification={r.classification} />
                ))}
              </div>
            )}
          </div>

          {sidebarItems.length > 0 && (
            <div className="rounded-lg border border-border bg-bg-panel p-3 lg:max-h-[720px] lg:overflow-y-auto">
              <h2 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                More headlines
              </h2>
              <ul className="divide-y divide-border">
                {sidebarItems.map((r) => (
                  <SidebarRow key={r.item.id} item={r.item} classification={r.classification} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
