import "server-only";
import { WebSocket } from "ws";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import { getHormuzVessels } from "@/lib/world-tracker/hormuz-provider";

const PROVIDER_NAME = "aisstream+hormuz";
const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const STALE_VESSEL_MS = 20 * 60 * 1000; // drop a ship if no update in 20 minutes
const MAX_TRACKED_VESSELS = 4000; // bounds memory + render cost; oldest updates evicted first
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30_000;

export type ShipTypeGroup = "cargo" | "tanker" | "passenger" | "fishing" | "military" | "other";

export interface VesselPosition {
  mmsi: number;
  latitude: number;
  longitude: number;
  speedKnots: number | null;
  courseDeg: number | null;
  name: string | null;
  shipTypeGroup: ShipTypeGroup;
  lastUpdate: string; // ISO 8601
}

interface TrackerState {
  socket: WebSocket | null;
  vessels: Map<number, VesselPosition>;
  shipTypes: Map<number, ShipTypeGroup>;
  connected: boolean;
  lastMessageAt: number | null;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  started: boolean;
}

// Reuse the same connection + in-memory cache across hot reloads in dev and across
// concurrent requests in prod, mirroring the pg Pool singleton pattern in lib/db.ts.
// One shared upstream AIS connection serves every client instead of opening a new
// websocket per browser tab.
declare global {
  var __terminalVesselTracker: TrackerState | undefined;
}

function getState(): TrackerState {
  if (!globalThis.__terminalVesselTracker) {
    globalThis.__terminalVesselTracker = {
      socket: null,
      vessels: new Map(),
      shipTypes: new Map(),
      connected: false,
      lastMessageAt: null,
      reconnectAttempt: 0,
      reconnectTimer: null,
      started: false,
    };
  }
  return globalThis.__terminalVesselTracker;
}

function classifyShipType(type: number | undefined): ShipTypeGroup {
  if (type === undefined) return "other";
  if (type === 30) return "fishing";
  if (type === 35) return "military";
  if (type >= 60 && type <= 69) return "passenger";
  if (type >= 70 && type <= 79) return "cargo";
  if (type >= 80 && type <= 89) return "tanker";
  return "other";
}

function pruneStale(state: TrackerState) {
  const cutoff = Date.now() - STALE_VESSEL_MS;
  for (const [mmsi, vessel] of state.vessels) {
    if (new Date(vessel.lastUpdate).getTime() < cutoff) {
      state.vessels.delete(mmsi);
      state.shipTypes.delete(mmsi);
    }
  }
  if (state.vessels.size > MAX_TRACKED_VESSELS) {
    const oldestFirst = [...state.vessels.entries()].sort(
      (a, b) => new Date(a[1].lastUpdate).getTime() - new Date(b[1].lastUpdate).getTime(),
    );
    for (const [mmsi] of oldestFirst.slice(0, state.vessels.size - MAX_TRACKED_VESSELS)) {
      state.vessels.delete(mmsi);
      state.shipTypes.delete(mmsi);
    }
  }
}

function handleMessage(state: TrackerState, raw: string) {
  let parsed: {
    MessageType?: string;
    MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number };
    Message?: {
      PositionReport?: { Sog?: number; Cog?: number; Latitude?: number; Longitude?: number };
      ShipStaticData?: { Type?: number; Name?: string };
    };
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const mmsi = parsed.MetaData?.MMSI;
  if (mmsi === undefined) return;
  state.lastMessageAt = Date.now();

  if (parsed.MessageType === "ShipStaticData") {
    const type = parsed.Message?.ShipStaticData?.Type;
    if (type !== undefined) state.shipTypes.set(mmsi, classifyShipType(type));
    const existing = state.vessels.get(mmsi);
    const name = parsed.Message?.ShipStaticData?.Name?.trim() || parsed.MetaData?.ShipName?.trim();
    if (existing && name) existing.name = name;
    return;
  }

  if (parsed.MessageType !== "PositionReport") return;
  const pos = parsed.Message?.PositionReport;
  const latitude = pos?.Latitude ?? parsed.MetaData?.latitude;
  const longitude = pos?.Longitude ?? parsed.MetaData?.longitude;
  if (latitude === undefined || longitude === undefined) return;

  state.vessels.set(mmsi, {
    mmsi,
    latitude,
    longitude,
    speedKnots: pos?.Sog ?? null,
    courseDeg: pos?.Cog ?? null,
    name: parsed.MetaData?.ShipName?.trim() || state.vessels.get(mmsi)?.name || null,
    shipTypeGroup: state.shipTypes.get(mmsi) ?? "other",
    lastUpdate: new Date().toISOString(),
  });

  pruneStale(state);
}

function scheduleReconnect(state: TrackerState) {
  if (state.reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** state.reconnectAttempt, RECONNECT_MAX_MS);
  state.reconnectAttempt += 1;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect(state);
  }, delay);
}

function connect(state: TrackerState) {
  if (!env.aisstreamApiKey) return;
  const socket = new WebSocket(AISSTREAM_URL);
  state.socket = socket;

  socket.on("open", () => {
    state.connected = true;
    state.reconnectAttempt = 0;
    socket.send(
      JSON.stringify({
        APIKey: env.aisstreamApiKey,
        BoundingBoxes: [
          [
            [-90, -180],
            [90, 180],
          ],
        ],
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      }),
    );
  });

  socket.on("message", (data) => {
    try {
      handleMessage(state, data.toString());
    } catch {
      // Never let a malformed AIS message take down the connection.
    }
  });

  socket.on("close", () => {
    state.connected = false;
    state.socket = null;
    scheduleReconnect(state);
  });

  socket.on("error", () => {
    // "close" fires right after — reconnect is scheduled there.
  });
}

/** Lazily opens the shared AIS connection on first use. No-ops without a key or if already running. */
export function ensureVesselTrackerStarted(): void {
  const state = getState();
  if (state.started || !env.aisstreamApiKey) return;
  state.started = true;
  connect(state);
}

function getAisStreamSnapshot(): ProviderResult<VesselPosition[]> {
  if (!env.aisstreamApiKey) {
    return {
      data: null,
      meta: {
        provider: "aisstream",
        timestamp: new Date().toISOString(),
        status: "error",
        message: "AISStream API key is not configured.",
      },
    };
  }

  const state = getState();
  pruneStale(state);
  const data = [...state.vessels.values()];

  if (state.connected) {
    return { data, meta: { provider: "aisstream", timestamp: new Date().toISOString(), status: "live" } };
  }
  if (data.length > 0) {
    return {
      data,
      meta: {
        provider: "aisstream",
        timestamp: new Date().toISOString(),
        status: "stale",
        message: "AIS connection dropped — showing last known positions while it reconnects.",
      },
    };
  }
  return {
    data: [],
    meta: {
      provider: "aisstream",
      timestamp: new Date().toISOString(),
      status: "delayed",
      message: "Connecting to AIS feed — positions will appear shortly.",
    },
  };
}

/**
 * Merges the global AISStream feed with the Strait of Hormuz-focused feed
 * (see hormuz-provider.ts) into one vessel layer, rather than exposing two
 * separate toggles — the Hormuz source exists specifically to fill the gap
 * AISStream's own coverage disclaimer already calls out for the Middle
 * East, not to be a second thing the user has to reason about. On an mmsi
 * collision AISStream wins (its positions are pushed in real time; Hormuz's
 * upstream only refreshes every 30 minutes), but that's expected to be rare
 * since the two sources' real-world coverage barely overlaps.
 *
 * Status is "live" as long as at least one source produced fresh data —
 * either source being down doesn't make the merged result an error, since
 * there's genuinely no missing data from the caller's point of view when
 * the other source is covering.
 */
export async function getVesselSnapshot(): Promise<ProviderResult<VesselPosition[]>> {
  const aisResult = getAisStreamSnapshot();
  const hormuzResult = await getHormuzVessels();

  const merged = new Map<number, VesselPosition>();
  for (const v of hormuzResult.data ?? []) merged.set(v.mmsi, v);
  for (const v of aisResult.data ?? []) merged.set(v.mmsi, v);
  const data = [...merged.values()];

  if (data.length === 0) {
    // Neither source has anything to show — surface whichever explains why
    // (AISStream's "connecting" message is more actionable than a bare
    // Hormuz error when both are effectively empty).
    return aisResult.meta.status === "delayed" ? aisResult : hormuzResult;
  }

  if (aisResult.meta.status === "live" || hormuzResult.meta.status === "live") {
    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  }

  return {
    data,
    meta: {
      provider: PROVIDER_NAME,
      timestamp: new Date().toISOString(),
      status: "stale",
      message: aisResult.meta.message ?? hormuzResult.meta.message,
    },
  };
}
