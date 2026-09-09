import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";

const PROVIDER_NAME = "finnhub";
const REQUEST_TIMEOUT_MS = 8000;

export type EarningsSession = "bmo" | "amc" | "";

export interface EarningsEvent {
  symbol: string;
  date: string; // YYYY-MM-DD
  hour: EarningsSession;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapRows(rows: unknown[]): EarningsEvent[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      symbol: String(r.symbol ?? ""),
      date: String(r.date ?? ""),
      hour: (r.hour === "bmo" || r.hour === "amc" ? r.hour : "") as EarningsSession,
      quarter: Number(r.quarter ?? 0),
      year: Number(r.year ?? 0),
      epsEstimate: toNullableNumber(r.epsEstimate),
      epsActual: toNullableNumber(r.epsActual),
      revenueEstimate: toNullableNumber(r.revenueEstimate),
      revenueActual: toNullableNumber(r.revenueActual),
    };
  });
}

async function fetchCalendar(params: string): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?${params}&token=${env.finnhubApiKey}`, {
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      // The request URL carries the API key as a query param — never let a raw
      // fetch()/network exception propagate; every error path here throws a
      // hand-written, secret-free message instead. Same guard as finnhub-provider.ts.
      throw new Error("Network error contacting Finnhub.");
    }
    if (!res.ok) {
      throw new Error(`Finnhub earnings calendar request failed (HTTP ${res.status}).`);
    }
    const body = await res.json();
    const rows = body?.earningsCalendar;
    if (!Array.isArray(rows)) {
      throw new Error("Unexpected response shape from Finnhub.");
    }
    return rows;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Earnings calendar for a date range (inclusive), Finnhub's free-tier
 * `/calendar/earnings` endpoint. Never fabricated — a missing key or failed
 * request returns an honest error status rather than an empty/fake calendar,
 * same ProviderResult contract every provider in this app follows.
 */
export async function getEarningsCalendar(from: string, to: string): Promise<ProviderResult<EarningsEvent[]>> {
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

  try {
    const rows = await fetchCalendar(`from=${from}&to=${to}`);
    return {
      data: mapRows(rows),
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
    };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error fetching the earnings calendar.",
      },
    };
  }
}

const LOOKAHEAD_DAYS = 365;

/**
 * The soonest upcoming earnings report for a single symbol, scanning a wide
 * forward window rather than whatever week the calendar happens to be
 * showing — a ticker search should find the next report even if it's months
 * out. `data.event` is explicitly `null` (status still "live") when the
 * symbol has no scheduled report in range — distinct from a provider error.
 */
export async function getNextEarningsForSymbol(
  symbol: string,
): Promise<ProviderResult<{ event: EarningsEvent | null }>> {
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

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const rows = await fetchCalendar(`from=${from}&to=${to}&symbol=${encodeURIComponent(symbol.toUpperCase())}`);
    const events = mapRows(rows).sort((a, b) => a.date.localeCompare(b.date));
    return {
      data: { event: events[0] ?? null },
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
    };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : `Unknown error fetching earnings for ${symbol}.`,
      },
    };
  }
}
