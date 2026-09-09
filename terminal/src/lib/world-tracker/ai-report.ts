import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import type { WorldEvent } from "@/lib/world-tracker/types";

const PROVIDER_NAME = "gemini";
// gemini-2.0-flash was retired; the API's own 404 error names the current model.
const MODEL = "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = 20_000;

export type EventSummary = Pick<WorldEvent, "title" | "category" | "importance" | "tickers"> & {
  location: Pick<WorldEvent["location"], "country">;
};

function summarizeEvent(e: EventSummary): string {
  const tickers = e.tickers.length > 0 ? ` [${e.tickers.join(",")}]` : "";
  return `- (${e.importance.toUpperCase()}, ${e.category}) ${e.title} — ${e.location.country}${tickers}`;
}

/**
 * Generates a short daily intelligence brief from the current event list via
 * Gemini. Only summarizes events actually passed in — never invents events
 * or facts beyond what's provided, and returns an honest error status rather
 * than a fabricated report if the model call fails, matching the
 * never-throw/never-fake contract used by the other providers in this app.
 */
export async function generateDailyReport(events: EventSummary[]): Promise<ProviderResult<string>> {
  if (!env.geminiApiKey) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "Gemini API key is not configured." },
    };
  }
  if (events.length === 0) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "No events to summarize." },
    };
  }

  const eventList = events
    .slice(0, 60)
    .map(summarizeEvent)
    .join("\n");

  const prompt = `You are a terse financial/geopolitical intelligence analyst. Based ONLY on the
event list below (do not invent anything not implied by it), write a short daily brief with:
1. A 2-3 sentence overview of the day's key themes.
2. A "Top developments" section: 3-5 bullet points on the most market/politically significant items.
3. A one-line "Watch next" note on what to monitor.
Keep it under 200 words total, plain text, no markdown headers.

EVENTS:
${eventList}`;

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
      // See the identical guard in lib/markets/insights.ts — the request URL carries
      // the API key, so a raw fetch()/network exception must never propagate.
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
