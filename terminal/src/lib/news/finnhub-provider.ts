import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";

const PROVIDER_NAME = "finnhub";
const REQUEST_TIMEOUT_MS = 8000;

export type NewsCategory = "general" | "forex" | "crypto" | "merger";

export interface NewsItem {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string; // ISO 8601
  imageUrl: string | null;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// Finnhub's "general" category returns plain-text summaries, but forex/crypto/merger
// summaries come back as raw HTML (often a bulleted list of links) — strip markup and
// decode entities so every category renders as clean text, not visible tag soup.
function cleanSummary(raw: string): string {
  const withoutTags = raw.replace(/<[^>]*>/g, " ");
  const decoded = withoutTags.replace(/&[a-z]+;|&#\d+;/gi, (entity) => HTML_ENTITIES[entity] ?? " ");
  return decoded.replace(/\s+/g, " ").trim();
}

function mapNewsRows(rows: unknown[], limit: number): NewsItem[] {
  return rows.slice(0, limit).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      headline: String(r.headline ?? ""),
      summary: cleanSummary(String(r.summary ?? "")),
      source: String(r.source ?? ""),
      url: String(r.url ?? ""),
      publishedAt: new Date(Number(r.datetime) * 1000).toISOString(),
      imageUrl: typeof r.image === "string" && r.image ? r.image : null,
    };
  });
}

/**
 * Category-wide market news from Finnhub's free tier. Never fabricated — a missing
 * key or a failed request returns an honest error status (see
 * lib/market-data/types.ts's MarketDataProvider contract, which every
 * provider in this app follows) rather than empty/fake headlines.
 */
export async function getMarketNews(
  category: NewsCategory = "general",
  limit = 12,
): Promise<ProviderResult<NewsItem[]>> {
  if (!env.finnhubApiKey) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: "Finnhub API key is not configured.",
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${env.finnhubApiKey}`, {
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      // The request URL carries the API key as a query param — never let a raw
      // fetch()/network exception (whose message shape isn't ours to control)
      // propagate; every other error path here throws a hand-written, secret-free
      // message instead. Same guard as lib/markets/insights.ts and the FMP providers.
      throw new Error("Network error contacting Finnhub.");
    }
    if (!res.ok) {
      throw new Error(`Finnhub news request failed (HTTP ${res.status}).`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) {
      throw new Error("Unexpected response shape from Finnhub.");
    }

    return {
      data: mapNewsRows(rows, limit),
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
    };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error fetching news.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Company-specific news (last `days` days) for the News page's symbol filter. */
export async function getCompanyNews(symbol: string, days = 14, limit = 30): Promise<ProviderResult<NewsItem[]>> {
  if (!env.finnhubApiKey) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: "Finnhub API key is not configured.",
      },
    };
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${env.finnhubApiKey}`,
        { signal: controller.signal, cache: "no-store" },
      );
    } catch {
      throw new Error("Network error contacting Finnhub.");
    }
    if (!res.ok) {
      throw new Error(`Finnhub company news request failed (HTTP ${res.status}).`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) {
      throw new Error("Unexpected response shape from Finnhub.");
    }

    const sorted = mapNewsRows(rows, rows.length).sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    return {
      data: sorted.slice(0, limit),
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
    };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : `Unknown error fetching news for ${symbol}.`,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
