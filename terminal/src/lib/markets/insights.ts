import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";

const PROVIDER_NAME = "gemini";
const MODEL = "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = 20_000;

export interface TickerSummary {
  symbol: string;
  timeframe: string;
  barCount: number;
  latestClose: number;
  changePercent: number;
  periodHigh: number;
  periodLow: number;
  latestVolume: number;
  averageVolume: number;
}

/**
 * Short, factual commentary on a ticker's recent price/volume action —
 * generated only from the numbers passed in (the bars already loaded on the
 * chart), never from outside knowledge. Explicitly not investment advice:
 * the prompt forbids buy/sell/hold language, and the UI shows a disclaimer
 * alongside this text. Mirrors world-tracker/ai-report.ts's honest-status
 * contract (real Gemini call, error status on failure — never fabricated).
 */
export async function generateTickerInsight(summary: TickerSummary): Promise<ProviderResult<string>> {
  if (!env.geminiApiKey) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "Gemini API key is not configured." },
    };
  }

  const direction = summary.changePercent >= 0 ? "up" : "down";
  const prompt = `You are a terse market-data narrator, not an advisor. Based ONLY on the numbers
below for ${summary.symbol} over the loaded ${summary.timeframe} range (${summary.barCount} bars) —
do not use any outside knowledge about this company or add speculation beyond what these numbers show:

Latest close: $${summary.latestClose.toFixed(2)}
Change over this range: ${summary.changePercent.toFixed(2)}% (${direction})
Range high: $${summary.periodHigh.toFixed(2)}
Range low: $${summary.periodLow.toFixed(2)}
Latest bar volume: ${summary.latestVolume.toLocaleString()}
Average volume over range: ${Math.round(summary.averageVolume).toLocaleString()}

Write 2-4 plain-text sentences describing this price/volume action factually. Do NOT give a
buy/sell/hold recommendation or any investment advice — describe the data, not what to do about it.`;

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
      // The request URL carries the API key as a query param (Gemini has no header-auth
      // option for this endpoint) — never let a raw fetch()/network exception, whose
      // message shape isn't ours to control, reach the caller. Every other error path
      // below throws a hand-written, secret-free message instead — the !res.ok branch's
      // response body is Google's own error description, verified to never echo the key.
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
