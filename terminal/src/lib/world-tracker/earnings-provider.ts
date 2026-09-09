import "server-only";
import type { ProviderResult } from "@/lib/providers/types";
import type { WorldEvent } from "@/lib/world-tracker/types";
import { resolveHqLocation } from "@/lib/world-tracker/geocode";
import { getEarningsCalendar, type EarningsEvent } from "@/lib/earnings/finnhub-earnings";
import { getCompanyOverview } from "@/lib/market-data/company-overview";

const PROVIDER_NAME = "finnhub-earnings";
const MAX_EVENTS = 15;

function importanceFromMarketCap(marketCap: number | null): WorldEvent["importance"] {
  if (!marketCap) return "low";
  if (marketCap >= 200e9) return "high";
  if (marketCap >= 20e9) return "medium";
  return "low";
}

function describeEarnings(row: EarningsEvent): { description: string; sentiment: WorldEvent["sentiment"] } {
  const fmtMoney = (n: number) => `$${(n / 1e9).toFixed(2)}B`;
  const fmtEps = (n: number) => `$${n.toFixed(2)}`;

  if (row.epsActual !== null) {
    const beat = row.epsEstimate !== null ? row.epsActual - row.epsEstimate : 0;
    const sentiment: WorldEvent["sentiment"] = beat > 0 ? "positive" : beat < 0 ? "negative" : "neutral";
    const vs = row.epsEstimate !== null ? ` vs. ${fmtEps(row.epsEstimate)} estimated` : "";
    return { description: `Reported EPS of ${fmtEps(row.epsActual)}${vs}.`, sentiment };
  }

  const parts: string[] = [];
  if (row.epsEstimate !== null) parts.push(`EPS estimate ${fmtEps(row.epsEstimate)}`);
  if (row.revenueEstimate !== null) parts.push(`revenue estimate ${fmtMoney(row.revenueEstimate)}`);
  return {
    description: parts.length > 0 ? `Upcoming earnings — ${parts.join(", ")}.` : "Upcoming earnings report.",
    sentiment: "neutral",
  };
}

/**
 * Real upcoming/recent earnings, converted into WorldEvent map markers.
 * Migrated from FMP's earnings-calendar/profile endpoints (dead — FMP's
 * quota is exhausted) to the same Finnhub-backed pieces already built for
 * the Earnings Calendar page (Phase 10) and the ticker page's overview card.
 * Never fabricates a location: if a company's HQ country can't be resolved
 * (see resolveHqLocation), that row is skipped rather than guessed. Follows
 * the same never-throw, honest-status contract as MarketDataProvider.
 */
export async function getUpcomingEarningsEvents(): Promise<ProviderResult<WorldEvent[]>> {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const calendar = await getEarningsCalendar(from, to);

  if (!calendar.data) {
    return { data: null, meta: { ...calendar.meta, provider: PROVIDER_NAME } };
  }
  if (calendar.data.length === 0) {
    return { data: [], meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  }

  // Finnhub's calendar occasionally lists the same symbol+date twice (e.g.
  // a preliminary and a confirmed entry) — deduped here since that pair is
  // exactly what this app's id is built from, and a duplicate id crashes
  // React's list-key uniqueness assumption downstream (confirmed via a real
  // "two children with the same key" console error before this existed).
  const seenIds = new Set<string>();
  const rows = calendar.data
    .filter((row) => {
      const id = `earnings_${row.symbol}_${row.date}`;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    })
    .slice(0, MAX_EVENTS);
  const overviews = await Promise.allSettled(rows.map((row) => getCompanyOverview(row.symbol)));

  const events: WorldEvent[] = [];
  rows.forEach((row, i) => {
    const settled = overviews[i];
    const overview = settled.status === "fulfilled" ? settled.value.data : null;
    if (!overview) return;

    const location = resolveHqLocation(overview.country ?? undefined, undefined);
    if (!location) return;

    const { description, sentiment } = describeEarnings(row);

    events.push({
      id: `earnings_${row.symbol}_${row.date}`,
      title: `${overview.name} reports earnings`,
      description,
      category: "finance",
      subcategory: "Earnings",
      source: "Finnhub earnings calendar",
      url: `https://finnhub.io/quote/${row.symbol}`,
      publishedAt: new Date(row.date).toISOString(),
      location: { country: location.country, region: location.region },
      latitude: location.latitude,
      longitude: location.longitude,
      locationPrecision: location.precision,
      importance: importanceFromMarketCap(overview.marketCap),
      sentiment,
      tickers: [row.symbol],
      tags: ["earnings", "markets"],
    });
  });

  return {
    data: events,
    meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
  };
}
