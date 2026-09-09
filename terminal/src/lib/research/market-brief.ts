import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import { getMarketNews } from "@/lib/news/finnhub-provider";
import { getEarningsCalendar } from "@/lib/earnings/finnhub-earnings";

const PROVIDER_NAME = "gemini";
const MODEL = "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = 20_000;

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * On-demand whole-market brief — same spirit as World Tracker's
 * ai-report.ts (daily geopolitical brief) but grounded in general market
 * news headlines and today's earnings calendar instead of World Tracker
 * events. Only summarizes what was actually fetched; a genuinely quiet news
 * day still produces a report (the model is told when a section is empty
 * rather than being fed nothing and asked to fill the gap itself).
 */
export async function generateMarketBrief(): Promise<ProviderResult<string>> {
  if (!env.geminiApiKey) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "Gemini API key is not configured." },
    };
  }

  const today = toISODate(new Date());
  const [news, earnings] = await Promise.all([
    getMarketNews("general", 30),
    getEarningsCalendar(today, today),
  ]);

  if (!news.data || news.data.length === 0) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: news.meta.message ?? "No market news available to summarize right now.",
      },
    };
  }

  const headlines = news.data.slice(0, 30).map((n) => `- ${n.headline} (${n.source})`).join("\n");
  const earningsList =
    earnings.data && earnings.data.length > 0
      ? earnings.data.slice(0, 15).map((e) => `- ${e.symbol} (${e.hour === "bmo" ? "before open" : e.hour === "amc" ? "after close" : "time TBD"})`).join("\n")
      : "(none scheduled today, or data unavailable)";

  const prompt = `You are a terse financial market analyst, not an advisor. Based ONLY on the headlines
and earnings list below (do not invent anything not implied by them, and do not use outside/training
knowledge of what "usually" happens), write a short market brief with:
1. A 2-3 sentence overview of today's key market themes from the headlines.
2. A "Top developments" section: 3-5 bullet points on the most significant items.
3. An "Earnings today" line noting how many companies report and 2-3 notable tickers, or state none are scheduled.
4. A one-line "Watch next" note on what to monitor.
Do NOT give a buy/sell/hold recommendation or any investment advice. Keep it under 220 words total,
plain text, no markdown headers.

HEADLINES:
${headlines}

EARNINGS TODAY:
${earningsList}`;

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
