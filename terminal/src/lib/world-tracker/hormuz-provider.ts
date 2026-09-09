import "server-only";
import type { ProviderResult } from "@/lib/providers/types";
import type { ShipTypeGroup, VesselPosition } from "@/lib/world-tracker/vessel-tracker";

const PROVIDER_NAME = "hormuz-data-tracking";
const API_URL = "https://hormuz.data-tracking.net/api/ships";
const REQUEST_TIMEOUT_MS = 15_000;

// The upstream service polls AIS transponders and republishes every 30
// minutes (confirmed via its own /llms.txt docs and by observing repeated
// identical `timestamp` values across ships in one response). Caching for 5
// minutes keeps this app's own 8s-interval client poll (see WorldMap.tsx)
// from hammering a free, unauthenticated third-party API for data that
// hasn't actually changed — same in-memory TTL-cache pattern as
// lib/market-data/quote-cache.ts, just with its own longer TTL since this
// source refreshes far less often than a quote.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface HormuzShip {
  mmsi: string;
  name: string | null;
  ship_category: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  timestamp: string;
}

interface CacheEntry {
  result: ProviderResult<VesselPosition[]>;
  fetchedAt: number;
}

declare global {
  var __terminalHormuzCache: CacheEntry | undefined;
}

// Maps the site's ~29 free-text ship categories onto this app's existing
// coarse ShipTypeGroup so Hormuz vessels render with the same color legend
// as the AISStream-sourced ones instead of needing a second legend.
// Everything not explicitly a tanker/cargo/fishing/passenger hull falls back
// to "other" (survey/offshore/service/leisure craft, aids to navigation,
// unknown) rather than guessing.
function toShipTypeGroup(category: string): ShipTypeGroup {
  switch (category) {
    case "Crude Oil Tanker":
    case "LNG Tanker":
    case "LPG/LNG Tanker":
    case "Product/Chem Tanker":
    case "Tanker":
    case "VLCC/ULCC":
      return "tanker";
    case "Barge":
    case "Bulk Carrier":
    case "Cargo":
    case "Container Ship":
    case "General Cargo":
    case "Ro-Ro/Container":
      return "cargo";
    case "Fishing":
      return "fishing";
    case "Passenger":
    case "HSC":
      return "passenger";
    default:
      return "other";
  }
}

async function fetchHormuzShips(): Promise<VesselPosition[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Hormuz ships request failed (HTTP ${res.status}).`);
    const ships = (await res.json()) as HormuzShip[];

    return ships
      .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
      .map((s) => ({
        mmsi: Number(s.mmsi),
        latitude: s.latitude,
        longitude: s.longitude,
        speedKnots: s.speed ?? null,
        courseDeg: s.course ?? null,
        name: s.name?.trim() || null,
        shipTypeGroup: toShipTypeGroup(s.ship_category),
        lastUpdate: s.timestamp,
      }));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Live vessel positions in and around the Strait of Hormuz from a free,
 * keyless third-party AIS aggregator — specifically to fill the coverage
 * gap the app's primary AISStream feed already discloses ("sparse-to-absent
 * ... the Middle East"). Merged into the same vessel layer by
 * vessel-tracker.ts rather than shown as a separate toggle, since its whole
 * purpose is closing that one gap, not adding a new data source to reason
 * about. Never fabricates positions: an unreachable API returns an honest
 * error, same ProviderResult contract as every other provider here.
 */
export async function getHormuzVessels(): Promise<ProviderResult<VesselPosition[]>> {
  const cached = globalThis.__terminalHormuzCache;
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const data = await fetchHormuzShips();
    const result: ProviderResult<VesselPosition[]> = {
      data,
      meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
    };
    globalThis.__terminalHormuzCache = { result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    const result: ProviderResult<VesselPosition[]> = {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: `Hormuz vessel feed unreachable: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
    // Cache the failure too, same TTL — same reasoning as quote-cache.ts: an
    // outage shouldn't get hammered every 8s with requests that would only
    // fail again.
    globalThis.__terminalHormuzCache = { result, fetchedAt: Date.now() };
    return result;
  }
}
