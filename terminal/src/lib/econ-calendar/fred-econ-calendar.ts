import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";

const PROVIDER_NAME = "fred";
const REQUEST_TIMEOUT_MS = 8000;
// fetchAllReleaseDates asks for every release's dates unfiltered (limit=1000)
// so it can cover all curated releases in one call. In isolation this
// returns in 3-5s, but this app also runs a GDELT news collector and a
// zone-scanner check-in every 5 minutes in the same process — under that
// contention this call has been observed taking 15-30s (not hanging, just
// competing for the same event loop/network). Generous headroom here so a
// slow moment doesn't read as "the page is broken."
const BULK_REQUEST_TIMEOUT_MS = 25000;
const BASE_URL = "https://api.stlouisfed.org/fred";

export type EconCategory = "inflation" | "employment" | "growth" | "housing" | "trade" | "fed" | "consumer";

export interface EconEvent {
  releaseId: number;
  seriesId: string;
  name: string;
  category: EconCategory;
  date: string; // YYYY-MM-DD
  actual: number | null;
  previous: number | null;
  unit: string;
}

interface CuratedRelease {
  releaseId: number;
  seriesId: string;
  name: string;
  category: EconCategory;
  unit: string;
}

// Confirmed real release_ids via a live `fred/releases` list lookup, not
// guessed — see the Phase 11 plan for the full lookup. FRED is a data
// warehouse, not a forecast aggregator, so there's deliberately no
// "consensus estimate" field anywhere in this file — never fabricate one.
// ISM PMI and Michigan Consumer Sentiment were searched for and have no
// matching FRED release entity under those names, so they're left out
// rather than guessed at.
const CURATED_RELEASES: CuratedRelease[] = [
  { releaseId: 10, seriesId: "CPIAUCSL", name: "Consumer Price Index", category: "inflation", unit: "index" },
  { releaseId: 10, seriesId: "CPILFESL", name: "Core CPI (ex. food & energy)", category: "inflation", unit: "index" },
  { releaseId: 46, seriesId: "PPIACO", name: "Producer Price Index", category: "inflation", unit: "index" },
  { releaseId: 54, seriesId: "PCEPI", name: "PCE Price Index", category: "inflation", unit: "index" },
  { releaseId: 50, seriesId: "PAYEMS", name: "Nonfarm Payrolls", category: "employment", unit: "K jobs" },
  { releaseId: 50, seriesId: "UNRATE", name: "Unemployment Rate", category: "employment", unit: "%" },
  { releaseId: 192, seriesId: "JTSJOL", name: "Job Openings (JOLTS)", category: "employment", unit: "K" },
  { releaseId: 180, seriesId: "ICSA", name: "Initial Jobless Claims", category: "employment", unit: "claims" },
  { releaseId: 53, seriesId: "GDP", name: "Gross Domestic Product", category: "growth", unit: "$B" },
  { releaseId: 53, seriesId: "GDPC1", name: "Real GDP", category: "growth", unit: "$B" },
  { releaseId: 13, seriesId: "INDPRO", name: "Industrial Production", category: "growth", unit: "index" },
  { releaseId: 9, seriesId: "RSXFS", name: "Retail Sales", category: "consumer", unit: "$M" },
  { releaseId: 27, seriesId: "HOUST", name: "Housing Starts", category: "housing", unit: "K units (SAAR)" },
  { releaseId: 291, seriesId: "EXHOSLUSM495S", name: "Existing Home Sales", category: "housing", unit: "K units (SAAR)" },
  { releaseId: 97, seriesId: "HSN1F", name: "New Home Sales", category: "housing", unit: "K units (SAAR)" },
  { releaseId: 51, seriesId: "BOPGSTB", name: "Trade Balance", category: "trade", unit: "$M" },
  { releaseId: 101, seriesId: "FEDFUNDS", name: "Federal Funds Rate", category: "fed", unit: "%" },
];

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fredFetchOnce(path: string, params: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({ ...params, api_key: env.fredApiKey ?? "", file_type: "json" });
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${path}?${query}`, { signal: controller.signal, cache: "no-store" });
    } catch {
      // The request URL carries the API key as a query param — never let a raw
      // fetch()/network exception propagate; same guard as finnhub-earnings.ts.
      throw new Error("Network error contacting FRED.");
    }
    if (!res.ok) {
      throw new Error(`FRED request failed (HTTP ${res.status}).`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// FRED occasionally times out or 502s on an individual call even under
// modest concurrency (confirmed empirically) — a couple of quick retries
// smooths over that transient flakiness rather than blanking the whole
// calendar for one bad request. Same retry-with-backoff shape as
// gdelt-provider.ts's fetchGdeltQuery.
async function fredFetch(
  path: string,
  params: Record<string, string>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  attempt = 1,
): Promise<unknown> {
  try {
    return await fredFetchOnce(path, params, timeoutMs);
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    await sleep(RETRY_DELAY_MS * attempt);
    return fredFetch(path, params, timeoutMs, attempt + 1);
  }
}

// One unfiltered `releases/dates` call returns EVERY release's dates in the
// window (hundreds of them) in a single request — calling it once per
// curated release (17 separate requests) was the actual cause of the
// page taking 33-42s to load (confirmed via server request-timing logs).
// Fetching once and filtering client-side to the curated release_ids cuts
// this phase from 17 requests to 1.
async function fetchAllReleaseDates(from: string, to: string): Promise<Map<number, string>> {
  const body = (await fredFetch(
    "releases/dates",
    { realtime_start: from, realtime_end: to, include_release_dates_with_no_data: "true", limit: "1000" },
    BULK_REQUEST_TIMEOUT_MS,
  )) as { release_dates?: { release_id: number; date: string }[] };

  const wanted = new Set(CURATED_RELEASES.map((r) => r.releaseId));
  const earliestByRelease = new Map<number, string>();
  for (const row of body.release_dates ?? []) {
    if (!wanted.has(row.release_id)) continue;
    const existing = earliestByRelease.get(row.release_id);
    if (!existing || row.date < existing) earliestByRelease.set(row.release_id, row.date);
  }
  return earliestByRelease;
}

/** Latest two observations for a series — [actual, previous]. FRED represents a not-yet-published value as ".", which Number() turns into NaN and this filters out rather than showing as 0. */
async function fetchLatestTwo(seriesId: string): Promise<{ actual: number | null; previous: number | null }> {
  const body = (await fredFetch("series/observations", {
    series_id: seriesId,
    sort_order: "desc",
    limit: "2",
  })) as { observations?: { value: string }[] };
  const numeric = (body.observations ?? []).map((o) => Number(o.value)).filter((v) => Number.isFinite(v));
  return { actual: numeric[0] ?? null, previous: numeric[1] ?? null };
}

// FRED chokes on high concurrency — confirmed empirically (firing 14
// concurrent requests produced several timeouts and a 502, even though the
// exact same calls succeed one at a time). The date-lookup phase is now a
// single batched call (see fetchAllReleaseDates), so this only caps the
// observations phase — typically 8-12 concurrent calls, not the ~34 this
// used to fire before batching.
const MAX_CONCURRENT_RELEASES = 4;

async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Real economic-release schedule + actual/previous values from FRED — the
 * only free source confirmed working (FMP and Finnhub's economic-calendar
 * endpoints are both dead/paid-only, see the Phase 11 plan). No forecast
 * field exists anywhere here: FRED doesn't have consensus estimates, and
 * this never invents one.
 */
export async function getEconomicCalendar(from: string, to: string): Promise<ProviderResult<EconEvent[]>> {
  if (!env.fredApiKey) {
    return {
      data: null,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message: "FRED API key is not configured." },
    };
  }

  let datesByRelease: Map<number, string>;
  try {
    datesByRelease = await fetchAllReleaseDates(from, to);
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error fetching the economic calendar.",
      },
    };
  }

  // Only the releases actually due in this window need an observations call
  // — typically 8-12 of the 17 curated ones for a given week, not all 17.
  const dueReleases = CURATED_RELEASES.filter((r) => datesByRelease.has(r.releaseId));

  const settled = await mapWithConcurrencyLimit(dueReleases, MAX_CONCURRENT_RELEASES, async (release) => {
    const { actual, previous } = await fetchLatestTwo(release.seriesId);
    const event: EconEvent = {
      releaseId: release.releaseId,
      seriesId: release.seriesId,
      name: release.name,
      category: release.category,
      date: datesByRelease.get(release.releaseId)!,
      actual,
      previous,
      unit: release.unit,
    };
    return event;
  });

  const events = settled
    .filter((r): r is PromiseFulfilledResult<EconEvent> => r.status === "fulfilled")
    .map((r) => r.value);

  // Releases were genuinely due (dueReleases.length > 0) but every single
  // observations call failed — that's a real outage, not "nothing scheduled
  // this week." Reporting it live with 0 events would be misleading.
  if (dueReleases.length > 0 && events.length === 0) {
    const firstError = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: firstError?.reason instanceof Error ? firstError.reason.message : "Unable to fetch indicator values from FRED.",
      },
    };
  }

  return { data: events, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
}
