import "server-only";
import { env } from "@/lib/env";

const PROVIDER_NAME = "gemini";
// Matches lib/news/news-ai-summarizer.ts's model — retest if Gemini retires it again.
const MODEL = "gemini-3.6-flash";
// gemini-3.6-flash always thinks before answering (no thinkingBudget:0 escape
// hatch like 2.5-flash had — tried it, the API 400s) and a full-size batch of
// headlines routinely takes 15-30s to finish, occasionally longer. This runs
// in the background collection cycle with nothing waiting on it synchronously,
// so it can afford to be patient — a short timeout here was silently forcing
// every real cycle onto the sourcecountry fallback (confirmed via server logs
// showing repeated AbortErrors), which is what caused the wrong-country rows
// the user found (Iran headline -> Finland, India markets story -> Pakistan,
// etc. -- all just the publisher's registered country, never Gemini's answer).
const REQUEST_TIMEOUT_MS = 45_000;

export interface ExtractedCountry {
  index: number;
  country: string | null;
}

// GDELT titles frequently carry a trailing outlet name after a pipe, e.g.
// "... | Newsradio 970 KFBX - AM" — safe to strip (pipes essentially never
// appear in real headline prose). An em-dash suffix ("... – The Indian
// Awaaz") is riskier to strip blindly since em-dashes do appear in real
// headlines, so that case is instead handled by an explicit instruction in
// the prompt below. This exists because an early test showed the model
// picking "India" for an Iran story whose title ended in "– The Indian
// Awaaz" — the outlet name, not the story's subject.
function stripTrailingOutlet(title: string): string {
  return title.split(" | ")[0].trim();
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseExtractions(text: string, count: number): ExtractedCountry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const result: ExtractedCountry[] = [];
  for (const row of parsed) {
    const r = row as Record<string, unknown>;
    if (typeof r.index !== "number" || r.index < 0 || r.index >= count) continue;
    const country = typeof r.country === "string" && r.country.trim() ? r.country.trim() : null;
    result.push({ index: r.index, country });
  }
  return result.length > 0 ? result : null;
}

/**
 * Refines which country a batch of GDELT headlines is actually ABOUT, as
 * opposed to gdelt-provider.ts's sourcecountry fallback (the publishing
 * outlet's country, which is frequently wrong for foreign coverage — a US
 * outlet covering a Canadian tariff story still reports sourcecountry
 * "United States"). One batched call per collection cycle, not one per
 * article — same batching approach as classifyHeadlines in
 * lib/news/news-ai-summarizer.ts, to keep this to a handful of requests/day.
 *
 * Returns null on any failure (missing key, network error, bad response) —
 * the caller falls back to sourcecountry, exactly as if this module didn't
 * exist. Never guesses: the prompt explicitly requires returning null for
 * any headline without a clearly-stated or clearly-implied country, and
 * unparseable/out-of-range rows are dropped rather than guessed at here too.
 */
export async function extractCountries(titles: string[]): Promise<ExtractedCountry[] | null> {
  if (!env.worldTrackerGeminiApiKey || titles.length === 0) return null;

  const list = titles.map((t, i) => `${i}. ${stripTrailingOutlet(t)}`).join("\n");
  const prompt = `Below is a numbered list of news headlines. For EACH headline, determine which
single country the story is primarily ABOUT — not which country published it, and not the
publication/outlet's own name if one appears in the title (headlines sometimes end with a
trailing " - Outlet Name" or similar — that is the publisher, never treat it as the story's
country). Only answer when the headline's actual subject clearly states or strongly implies a
specific country. If it's ambiguous, generic, or you're not reasonably confident, return null for
that headline — never guess a country.

Use full English country names (e.g. "United States", "United Kingdom", "South Korea"), not
codes or adjectives.

Return ONLY a JSON array, no markdown code fences, no commentary before or after — one object per
headline, in the same order, shaped exactly as:
[{"index": <number>, "country": "<full English country name>" | null}]

HEADLINES:
${list}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.worldTrackerGeminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal,
        },
      );
    } catch (fetchErr) {
      // The request URL carries the API key — never let the raw error object
      // (which could echo the URL) propagate, but its name/cause are safe and
      // worth keeping for diagnosis (e.g. "AbortError" means the timeout
      // fired, not a real connectivity failure).
      const name = fetchErr instanceof Error ? fetchErr.name : "UnknownError";
      const cause = fetchErr instanceof Error && fetchErr.cause ? String(fetchErr.cause) : "";
      throw new Error(`Network error contacting Gemini (${name}${cause ? `: ${cause}` : ""}).`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    if (!text) throw new Error("Gemini returned no text content.");

    return parseExtractions(text, titles.length);
  } catch (err) {
    console.warn(`[${PROVIDER_NAME}-geo] country extraction failed, falling back to sourcecountry:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
