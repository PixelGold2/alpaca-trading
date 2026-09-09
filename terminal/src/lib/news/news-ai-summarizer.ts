import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import type { NewsItem } from "@/lib/news/finnhub-provider";

const PROVIDER_NAME = "gemini";
// gemini-2.0-flash was retired; the API's own 404 error names the current model.
const MODEL = "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = 20_000;

export type HeadlineTier = "major" | "notable" | "minor";

export interface HeadlineClassification {
  index: number;
  tier: HeadlineTier;
  impact: string;
}

const VALID_TIERS: HeadlineTier[] = ["major", "notable", "minor"];

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseClassifications(text: string, count: number): HeadlineClassification[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const result: HeadlineClassification[] = [];
  for (const row of parsed) {
    const r = row as Record<string, unknown>;
    if (
      typeof r.index !== "number" ||
      r.index < 0 ||
      r.index >= count ||
      typeof r.tier !== "string" ||
      !VALID_TIERS.includes(r.tier as HeadlineTier) ||
      typeof r.impact !== "string"
    ) {
      continue;
    }
    result.push({ index: r.index, tier: r.tier as HeadlineTier, impact: r.impact });
  }
  return result.length > 0 ? result : null;
}

/**
 * Ranks headline significance and drafts a one-line "what this affects" note via
 * Gemini — an interpretation of the headlines actually passed in, never invented
 * beyond them. Never phrased as investment advice. Returns an honest error status
 * rather than a fabricated ranking if the model call or parsing fails, matching
 * the never-throw/never-fake contract used by every other provider in this app.
 */
export async function classifyHeadlines(items: NewsItem[]): Promise<ProviderResult<HeadlineClassification[]>> {
  if (!env.geminiApiKey) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: "Gemini API key is not configured.",
      },
    };
  }
  if (items.length === 0) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "No headlines to summarize." },
    };
  }

  const capped = items.slice(0, 40);
  const list = capped
    .map((item, i) => `${i}. [${item.source}] ${item.headline}${item.summary ? ` — ${item.summary}` : ""}`)
    .join("\n");

  const prompt = `You are a terse financial news analyst. Below is a numbered list of current
headlines with their source. For EACH headline, judge how significant it is to markets, a
specific company/sector, or major real-world events — based ONLY on the headline/summary/
source given below, never invented information beyond it.

Classify each headline's significance as exactly one of: "major", "notable", "minor".
For "major" and "notable" headlines, write ONE short sentence on what it's likely to affect
(a company, sector, asset class, currency, region, etc.) — this is your interpretation, not a
fact, and must never be phrased as investment advice or a buy/sell/hold recommendation. For
"minor" headlines, leave impact as an empty string.

Return ONLY a JSON array, no markdown code fences, no commentary before or after — one object
per headline, in the same order, shaped exactly as:
[{"index": <number>, "tier": "major"|"notable"|"minor", "impact": "<one sentence, or empty string>"}]

HEADLINES:
${list}`;

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
      // exception propagate. Same guard as lib/world-tracker/ai-report.ts.
      throw new Error("Network error contacting Gemini.");
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    if (!text) throw new Error("Gemini returned no text content.");

    const classifications = parseClassifications(text, capped.length);
    if (!classifications) throw new Error("Gemini returned an unexpected response shape.");

    return { data: classifications, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
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
