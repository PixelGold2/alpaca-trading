import "server-only";
import type { ProviderResult } from "@/lib/providers/types";

const PROVIDER_NAME = "adsb.lol";
const REQUEST_TIMEOUT_MS = 8000;
// adsb.lol is a free, keyless ADS-B Exchange-style community feed (same underlying
// data shape as airplanes.live, which now gates its public API behind a manual
// approval email — verified against the live endpoint before choosing this one).
const MILITARY_AIRCRAFT_URL = "https://api.adsb.lol/v2/mil";

export interface AircraftPosition {
  hex: string;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  latitude: number;
  longitude: number;
  altitudeFt: number | null;
  groundSpeedKts: number | null;
  trackDeg: number | null;
}

/**
 * Live military aircraft positions from adsb.lol's public ADS-B Exchange-derived
 * feed. No API key required. Never fabricated — an unreachable/unexpected response
 * returns an honest error status (see lib/providers/types.ts) rather than stale/fake
 * positions, same contract every other provider in this app follows.
 */
export async function getMilitaryAircraft(): Promise<ProviderResult<AircraftPosition[]>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(MILITARY_AIRCRAFT_URL, {
        signal: controller.signal,
        cache: "no-store",
        // adsb.lol rejects generic/default User-Agent strings and asks for an
        // identifying one — this is a static app label, not user-identifying data.
        headers: { "User-Agent": "AlpacaTerminal-WorldTracker/1.0 (private research dashboard)" },
      });
    } catch {
      throw new Error("Network error contacting adsb.lol.");
    }
    if (!res.ok) {
      throw new Error(`adsb.lol request failed (HTTP ${res.status}).`);
    }
    const body = await res.json();
    const rows = Array.isArray(body?.ac) ? body.ac : null;
    if (!rows) {
      throw new Error("Unexpected response shape from adsb.lol.");
    }

    const data: AircraftPosition[] = rows
      .filter((r: Record<string, unknown>) => typeof r.lat === "number" && typeof r.lon === "number")
      .map((r: Record<string, unknown>) => ({
        hex: String(r.hex ?? ""),
        callsign: typeof r.flight === "string" ? r.flight.trim() || null : null,
        registration: typeof r.r === "string" ? r.r : null,
        aircraftType: typeof r.t === "string" ? r.t : null,
        latitude: r.lat as number,
        longitude: r.lon as number,
        altitudeFt: typeof r.alt_baro === "number" ? r.alt_baro : null,
        groundSpeedKts: typeof r.gs === "number" ? r.gs : null,
        trackDeg: typeof r.track === "number" ? r.track : null,
      }));

    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error fetching aircraft positions.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
