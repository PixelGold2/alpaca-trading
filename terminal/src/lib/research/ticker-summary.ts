import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import { getCompanyOverview } from "@/lib/market-data/company-overview";
import { getRatios } from "@/lib/fundamentals/finnhub-fundamentals";
import { getCompanyNews } from "@/lib/news/finnhub-provider";

const PROVIDER_NAME = "gemini";
const MODEL = "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = 20_000;

function formatRatio(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "not available";
}

/**
 * Short AI research summary for one ticker — grounded only in this app's own
 * already-fetched company overview, TTM ratios, and recent headlines (never
 * outside/training knowledge about the company), same "only use what's
 * provided" contract as lib/markets/insights.ts and
 * lib/world-tracker/ai-report.ts. Any of the three source fetches can come
 * back null (e.g. no ratio coverage for a name) — that's stated honestly in
 * the prompt as "not available" rather than silently omitted, so the model
 * doesn't have room to guess a number that wasn't actually looked up.
 */
export async function generateTickerSummary(symbol: string): Promise<ProviderResult<string>> {
  if (!env.geminiApiKey) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "Gemini API key is not configured." },
    };
  }

  const [overview, ratios, news] = await Promise.all([
    getCompanyOverview(symbol),
    getRatios(symbol, "ttm"),
    getCompanyNews(symbol, 14, 8),
  ]);

  if (!overview.data) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: overview.meta.message ?? `No company data available for ${symbol}.`,
      },
    };
  }
  const o = overview.data;
  const r = ratios.data;

  const facts = [
    `Name: ${o.name}`,
    `Industry: ${o.industry ?? "not available"}`,
    `Exchange: ${o.exchange ?? "not available"}`,
    `Country: ${o.country ?? "not available"}`,
    `Price: ${o.price !== null ? `$${o.price.toFixed(2)}` : "not available"}`,
    `Market cap: ${o.marketCap !== null ? `$${(o.marketCap / 1e9).toFixed(2)}B` : "not available"}`,
    `P/E (TTM): ${r ? formatRatio(r.peRatio) : "not available"}`,
    `P/B: ${r ? formatRatio(r.priceToBookRatio) : "not available"}`,
    `P/S: ${r ? formatRatio(r.priceToSalesRatio) : "not available"}`,
  ].join("\n");

  const headlines =
    news.data && news.data.length > 0
      ? news.data.slice(0, 8).map((n) => `- ${n.headline} (${n.source})`).join("\n")
      : "(no recent headlines available)";

  const prompt = `You are a terse equity research assistant, not a financial advisor. Based ONLY on the
facts and headlines below for ${symbol} (${o.name}) — do not use any outside/training knowledge about
this company, and do not invent any number not listed here; where a fact says "not available", say so
rather than guessing:

COMPANY FACTS:
${facts}

RECENT HEADLINES (last 14 days):
${headlines}

Write a short research summary with:
1. A 2-3 sentence overview of what can be said about the company's current size/valuation from the facts above.
2. A "Recent developments" section: 2-4 bullet points drawn from the headlines above (say "No notable recent headlines" if none were given).
Do NOT give a buy/sell/hold recommendation or any investment advice — describe what the facts show, not what to do about it.
Keep it under 180 words total, plain text, no markdown headers.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal,
        },
      );
    } catch {
      // The request URL carries the API key — never let a raw fetch()/network
      // exception propagate. Same guard as every other Gemini-calling file.
      throw new Error("Network error contacting Gemini.");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    if (!text) throw new Error("Gemini returned no text content.");

    return { data: text.trim(), meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error calling Gemini.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
