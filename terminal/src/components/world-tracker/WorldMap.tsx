"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RestrictedZone, WorldEvent } from "@/lib/world-tracker/types";
import { SHIPPING_ROUTES } from "@/lib/world-tracker/shipping-routes";
import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import type { ShipTypeGroup, VesselPosition } from "@/lib/world-tracker/vessel-tracker";
import type { AircraftPosition } from "@/lib/world-tracker/aircraft-provider";
import type { ProviderMeta, ProviderResult } from "@/lib/providers/types";

const MAP_STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// maplibre-gl resolves its tile-processing worker via `new URL("./maplibre-gl-worker.mjs",
// import.meta.url)`, which depends on the bundler rewriting import.meta.url correctly.
// Under Next.js/Turbopack that resolves to a non-http(s) value, so maplibre silently falls
// back to loading the worker from an empty URL (the current page's own HTML) and every tile
// request hangs forever with no error. Pointing it at a copy of the same file served from
// public/ (see terminal/public/maplibre-gl-worker.mjs) sidesteps the broken auto-detection.
// That worker file itself imports "./maplibre-gl-shared.mjs" as a sibling — that chunk is
// also copied into public/ so the relative import resolves. Re-copy both files from
// node_modules/maplibre-gl/dist/ if the maplibre-gl version changes.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

// Marker color now encodes importance (not category) — critical=red,
// high=orange, medium=yellow, low=grey — so severity reads at a glance
// regardless of which category a story is in. Category is still shown via
// the letter label on top of each dot (see CATEGORY_LETTER), just no
// longer via color.
const IMPORTANCE_COLORS: Record<WorldEvent["importance"], string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#9ca3af",
};

// Bumped up from the original 4-10px range so a marker is a comfortable
// hover/click target even at a zoomed-out view, not just when zoomed in.
const IMPORTANCE_RADIUS: Record<WorldEvent["importance"], number> = {
  critical: 16,
  high: 13,
  medium: 10,
  low: 7,
};

const CATEGORY_LETTER: Record<WorldEvent["category"], string> = {
  finance: "F",
  politics: "P",
  geopolitics: "G",
  aviation: "A",
};

const CONFLICT_SEVERITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#eab308",
};

const SHIP_TYPE_COLORS: Record<VesselPosition["shipTypeGroup"], string> = {
  cargo: "#38bdf8",
  tanker: "#f97316",
  passenger: "#a78bfa",
  fishing: "#22c55e",
  military: "#ef4444",
  other: "#8b93a3",
};

// Same red as SHIP_TYPE_COLORS.military — every tracked aircraft here is
// military (see aircraft-provider.ts), so it should read as this app's one
// consistent "military" color, not its own separate yellow.
const AIRCRAFT_COLOR = SHIP_TYPE_COLORS.military;

const VESSEL_TYPES: ShipTypeGroup[] = ["cargo", "tanker", "passenger", "fishing", "military", "other"];
const VESSEL_TYPE_LABELS: Record<ShipTypeGroup, string> = {
  cargo: "Cargo",
  tanker: "Tanker",
  passenger: "Passenger",
  fishing: "Fishing",
  military: "Military",
  other: "Other",
};

const VESSEL_POLL_MS = 8000;
const AIRCRAFT_POLL_MS = 20_000;

// How long a marker stays on the map after its story's publish time, keyed
// by importance — a critical/high story stays visible far longer than a low
// one, so the map doesn't stay cluttered with day-old routine headlines
// while still surfacing genuinely major ones for a while. This governs only
// what WorldMap renders; the underlying events list (and the Live Feed,
// which reuses it) is untouched — a "map-expired" event is still in the
// feed and still flies-to correctly if clicked there.
const IMPORTANCE_TTL_MS: Record<WorldEvent["importance"], number> = {
  critical: 24 * 60 * 60 * 1000, // 24h — whole-day retention for the most significant stories
  high: 12 * 60 * 60 * 1000, // 12h
  medium: 6 * 60 * 60 * 1000, // 6h
  low: 3 * 60 * 60 * 1000, // 3h
};
// The last quarter of a marker's lifetime ramps opacity from 1 down to
// near-0 instead of it just vanishing at the TTL boundary.
const FADE_FRACTION = 0.25;
const MIN_FADE_OPACITY = 0.05;

/** Null means expired — caller drops the marker entirely. */
function eventOpacity(event: WorldEvent, now: number): number | null {
  const ttl = IMPORTANCE_TTL_MS[event.importance];
  const age = now - new Date(event.publishedAt).getTime();
  if (age < 0) return 1; // clock skew — treat as fresh rather than guess
  if (age >= ttl) return null;
  const fadeStart = ttl * (1 - FADE_FRACTION);
  if (age < fadeStart) return 1;
  const fadeProgress = (age - fadeStart) / (ttl - fadeStart);
  return Math.max(MIN_FADE_OPACITY, 1 - fadeProgress);
}

// A shorter, fixed window (unlike the importance-scaled TTL above) — this
// only decides how long the red "NEW" badge shows in a popup, a quick way
// to spot which markers just appeared.
const EVENT_NEW_HIGHLIGHT_MS = 60 * 60 * 1000;

function isRecentlyPublished(event: WorldEvent, now: number): boolean {
  const age = now - new Date(event.publishedAt).getTime();
  return age >= 0 && age < EVENT_NEW_HIGHLIGHT_MS;
}

// Multiple events resolved to the same country-level centroid (the common
// case — geocoding lands on a country centroid, not an exact address) would
// otherwise stack exactly on top of each other until zoomed in to the max.
// Spread them into an expanding spiral instead (golden-angle stepping, the
// standard trick for evenly distributing points around a center) so they're
// individually visible/clickable well before that.
//
// A flat spread radius looks fine for a small country but leaves a big one
// (Russia, the US, Canada, ...) with every marker still bunched into one
// small corner near the centroid — visually "stuck in one province" instead
// of using the country's actual footprint. These are hand-picked
// approximate half-extents (how far markers can radiate from the centroid
// before plausibly leaving the country), not surveyed borders, same
// "approximate reference, never precise" framing as the centroids
// themselves — only the ~40 largest/most newsworthy countries are worth the
// override; everything else falls back to DEFAULT_SPREAD_RADIUS_KM, which
// is already reasonable for a small-to-mid-sized country.
const DEFAULT_SPREAD_RADIUS_KM = 60;
const COUNTRY_SPREAD_RADIUS_KM: Partial<Record<string, number>> = {
  Russia: 1500,
  Canada: 1200,
  China: 900,
  "United States": 900,
  Brazil: 1000,
  Australia: 900,
  India: 700,
  Argentina: 500,
  Kazakhstan: 600,
  Algeria: 600,
  "Democratic Republic of the Congo": 500,
  "Saudi Arabia": 500,
  Mexico: 500,
  Indonesia: 600,
  Sudan: 500,
  Libya: 500,
  Iran: 450,
  Mongolia: 500,
  Peru: 400,
  Chad: 450,
  Niger: 450,
  Angola: 450,
  Mali: 450,
  "South Africa": 450,
  Colombia: 400,
  Ethiopia: 400,
  Bolivia: 400,
  Mauritania: 400,
  Egypt: 350,
  Tanzania: 350,
  Nigeria: 350,
  Venezuela: 350,
  Namibia: 350,
  Pakistan: 350,
  Mozambique: 350,
  Turkey: 350,
  Chile: 250,
  Zambia: 300,
  Myanmar: 300,
  Afghanistan: 300,
  Ukraine: 300,
  Kenya: 300,
  France: 250,
  Sweden: 250,
  Japan: 200,
  Germany: 200,
  "United Kingdom": 200,
  Spain: 250,
  "New Zealand": 250,
  Poland: 200,
  Norway: 250,
  Italy: 200,
  Philippines: 250,
  Ecuador: 250,
  Vietnam: 250,
  Finland: 250,
  Yemen: 250,
  Thailand: 250,
};

function spreadRadiusForCountry(country: string): number {
  return COUNTRY_SPREAD_RADIUS_KM[country] ?? DEFAULT_SPREAD_RADIUS_KM;
}

const GOLDEN_ANGLE_RAD = 137.5 * (Math.PI / 180);
// The point index at which the spiral's radius reaches the country's full
// spread radius. Growth is sqrt-shaped up to that point (fast at first, the
// classic "expanding spiral" look), then flattens — additional markers
// beyond it keep circling at that same outer radius (different angle each
// time, via the golden angle) rather than continuing to grow past the
// country's edge. That flattening is the "turns compact once there are
// more headlines" behavior: the spread stops expanding outward and starts
// packing the boundary instead.
const SPREAD_SATURATION_COUNT = 12;

interface PlacedEvent {
  event: WorldEvent;
  lat: number;
  lng: number;
}

// Events resolved to the same country centroid share this key — the
// grouping unit for both jitter-spreading and "related headline" linking
// (see computeConnections).
function countryGroupKey(event: WorldEvent): string {
  return `${event.latitude.toFixed(2)},${event.longitude.toFixed(2)}`;
}

interface PlacementGroup {
  centerLat: number;
  centerLng: number;
  maxRadiusKm: number;
  events: WorldEvent[];
}

/** Groups events by country-level centroid for spiral spreading (see spreadWithinGroup). */
function buildPlacementGroups(events: WorldEvent[]): PlacementGroup[] {
  const groups = new Map<string, PlacementGroup>();
  for (const event of events) {
    const key = countryGroupKey(event);
    let group = groups.get(key);
    if (!group) {
      group = {
        centerLat: event.latitude,
        centerLng: event.longitude,
        maxRadiusKm: spreadRadiusForCountry(event.location.country),
        events: [],
      };
      groups.set(key, group);
    }
    group.events.push(event);
  }
  return [...groups.values()];
}

/** Expanding golden-angle spiral within one group — see spreadRadiusForCountry's comment for why sqrt-shaped growth. */
function spreadWithinGroup(group: PlacementGroup): PlacedEvent[] {
  return group.events.map((event, i) => {
    if (i === 0) return { event, lat: group.centerLat, lng: group.centerLng };
    const radiusKm = group.maxRadiusKm * Math.min(1, Math.sqrt(i / SPREAD_SATURATION_COUNT));
    const angle = i * GOLDEN_ANGLE_RAD;
    const dLat = (radiusKm / 110.574) * Math.sin(angle);
    const dLng = (radiusKm / (111.32 * Math.cos((group.centerLat * Math.PI) / 180))) * Math.cos(angle);
    return { event, lat: group.centerLat + dLat, lng: group.centerLng + dLng };
  });
}

function placeEvents(events: WorldEvent[]): PlacedEvent[] {
  return buildPlacementGroups(events).flatMap(spreadWithinGroup);
}

// Plain English stopwords stripped before comparing two headlines' word
// sets — without this, nearly every pair of headlines would share "the",
// "to", "new", etc. and look spuriously related.
const RELATION_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "by", "at", "is", "are", "was", "were", "be", "been", "new", "after",
  "before", "over", "amid", "its", "his", "her", "their", "from", "into",
  "than", "that", "this", "it", "he", "she", "they", "says", "say", "said",
  "will", "would", "could", "should", "about", "against", "up", "down",
  "out", "off", "not", "all", "more", "than", "who", "what", "how", "why",
]);

function significantWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !RELATION_STOPWORDS.has(w));
  return new Set(words);
}

function sharedWordCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const w of a) if (b.has(w)) count++;
  return count;
}

// Two headlines are "related" once they share at least this many
// significant (non-stopword) words — simple, free, and good enough to link
// the common case of the same story reprinted by several outlets, or two
// distinct but clearly connected headlines (e.g. a sanctions announcement
// and a retaliation-warning story that both mention "sanctions" and the
// country involved).
const RELATION_MIN_SHARED_WORDS = 2;

interface ConnectionEdge {
  a: PlacedEvent;
  b: PlacedEvent;
  opacity: number;
}

/**
 * Links related headlines with a line, strictly within one placement group
 * (see buildPlacementGroups — a country's cluster) — never across groups, so
 * relatedness never implies "these two countries are connected," only
 * "these two headlines about the same one are." Only considers events that
 * are still visible (not map-expired); an edge fades with the dimmer of its
 * two endpoints so a connection never outlives the marker it points at.
 */
function computeConnections(events: WorldEvent[], now: number): ConnectionEdge[] {
  const groups = buildPlacementGroups(events);

  const placedById = new Map<string, PlacedEvent>();
  for (const group of groups) {
    for (const placed of spreadWithinGroup(group)) placedById.set(placed.event.id, placed);
  }

  const opacityById = new Map<string, number>();
  for (const event of events) {
    const opacity = eventOpacity(event, now);
    if (opacity !== null) opacityById.set(event.id, opacity);
  }

  const wordsById = new Map<string, Set<string>>();
  const edges: ConnectionEdge[] = [];

  for (const group of groups) {
    const visible = group.events.filter((e) => opacityById.has(e.id));
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const eventA = visible[i];
        const eventB = visible[j];
        if (!wordsById.has(eventA.id)) wordsById.set(eventA.id, significantWords(eventA.title));
        if (!wordsById.has(eventB.id)) wordsById.set(eventB.id, significantWords(eventB.title));
        const shared = sharedWordCount(wordsById.get(eventA.id)!, wordsById.get(eventB.id)!);
        if (shared < RELATION_MIN_SHARED_WORDS) continue;

        edges.push({
          a: placedById.get(eventA.id)!,
          b: placedById.get(eventB.id)!,
          opacity: Math.min(opacityById.get(eventA.id)!, opacityById.get(eventB.id)!),
        });
      }
    }
  }
  return edges;
}

function connectionsFeatureCollection(edges: ConnectionEdge[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: edges.map((edge) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [edge.a.lng, edge.a.lat],
          [edge.b.lng, edge.b.lat],
        ],
      },
      properties: { opacity: edge.opacity },
    })),
  };
}

function toFeatureCollection(events: WorldEvent[], now: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const { event, lat, lng } of placeEvents(events)) {
    const opacity = eventOpacity(event, now);
    if (opacity === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        id: event.id,
        category: event.category,
        importance: event.importance,
        letter: CATEGORY_LETTER[event.category],
        title: event.title,
        source: event.source,
        precision: event.locationPrecision,
        opacity,
        isNew: isRecentlyPublished(event, now),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Approximate circle polygon around a center point — a reference visual, not a survey. */
function circlePolygon(lat: number, lng: number, radiusKm: number, points = 48): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const distanceX = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const distanceY = radiusKm / 110.574;
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    coords.push([lng + distanceX * Math.cos(theta), lat + distanceY * Math.sin(theta)]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

// How long a zone keeps its "just discovered" highlighted outline after
// zone-scan-cycle.ts first inserts it (see created_at, never touched by
// later reconfirm-upserts) — this is the "mark it on the map instantly"
// behavior for a brand-new war/blockade, distinct from the routine
// styling every other zone already has.
const ZONE_NEW_HIGHLIGHT_MS = 24 * 60 * 60 * 1000;

function isNewZone(zone: RestrictedZone, now: number): boolean {
  return now - new Date(zone.createdAt).getTime() < ZONE_NEW_HIGHLIGHT_MS;
}

function conflictZonesFeatureCollection(zones: RestrictedZone[], now: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones
      .filter((zone) => zone.kind === "conflict")
      .map((zone) => ({
        type: "Feature",
        geometry: circlePolygon(zone.latitude, zone.longitude, zone.radiusKm),
        properties: {
          id: zone.id,
          name: zone.name,
          severity: zone.severity ?? "medium",
          summary: zone.summary,
          isNew: isNewZone(zone, now),
        },
      })),
  };
}

function maritimeRestrictionsFeatureCollection(zones: RestrictedZone[], now: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones
      .filter((zone) => zone.kind === "maritime")
      .map((zone) => ({
        type: "Feature",
        geometry: circlePolygon(zone.latitude, zone.longitude, zone.radiusKm),
        properties: { id: zone.id, name: zone.name, summary: zone.summary, isNew: isNewZone(zone, now) },
      })),
  };
}

function shippingRoutesFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: SHIPPING_ROUTES.map((route) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.path },
      properties: { id: route.id, name: route.name },
    })),
  };
}

function vesselsFeatureCollection(vessels: VesselPosition[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vessels.map((v) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.longitude, v.latitude] },
      properties: {
        mmsi: v.mmsi,
        name: v.name ?? "Unknown vessel",
        typeGroup: v.shipTypeGroup,
        speedKnots: v.speedKnots,
        courseDeg: v.courseDeg,
      },
    })),
  };
}

function aircraftFeatureCollection(aircraft: AircraftPosition[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: aircraft.map((a) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.longitude, a.latitude] },
      properties: {
        hex: a.hex,
        callsign: a.callsign ?? a.hex,
        aircraftType: a.aircraftType ?? "Unknown type",
        altitudeFt: a.altitudeFt,
        groundSpeedKts: a.groundSpeedKts,
        trackDeg: a.trackDeg,
      },
    })),
  };
}

// Pulse markers are plain HTML (maplibregl.Marker), not part of the
// clustered GL circle layer — they always render at their real position
// regardless of zoom or clustering, which is what makes them the
// "noticeable at the whole-world view" treatment critical/high stories
// need. Medium/low stay as ordinary clustered dots.
function isPulseWorthy(event: WorldEvent): boolean {
  return event.importance === "critical" || event.importance === "high" || event.tags.includes("breaking");
}

function pulseColorFor(event: WorldEvent): string {
  return event.importance === "high" ? IMPORTANCE_COLORS.high : IMPORTANCE_COLORS.critical;
}

function createPulseElement(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "wt-pulse-marker";
  const ring = document.createElement("span");
  ring.className = "wt-pulse-ring";
  ring.style.borderColor = color;
  const dot = document.createElement("span");
  dot.className = "wt-pulse-dot";
  dot.style.background = color;
  el.appendChild(ring);
  el.appendChild(dot);
  return el;
}

export function WorldMap({
  events,
  selectedEventId,
  onSelectEvent,
}: {
  events: WorldEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const eventsRef = useRef(events);
  const onSelectRef = useRef(onSelectEvent);
  const pulseMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const showConnectionsRef = useRef(true);
  const zonesRef = useRef<RestrictedZone[]>([]);
  const showConflictZonesRef = useRef(true);
  const showMaritimeRestrictionsRef = useRef(true);

  const [zones, setZones] = useState<RestrictedZone[]>([]);
  const [showConflictZones, setShowConflictZones] = useState(true);
  const [showMaritimeRestrictions, setShowMaritimeRestrictions] = useState(true);
  const [showConnections, setShowConnections] = useState(true);
  const [showShippingRoutes, setShowShippingRoutes] = useState(false);
  const [showVessels, setShowVessels] = useState(false);
  const [vessels, setVessels] = useState<VesselPosition[]>([]);
  const [vesselMeta, setVesselMeta] = useState<ProviderMeta | null>(null);
  const [activeVesselTypes, setActiveVesselTypes] = useState<Set<ShipTypeGroup>>(new Set());
  const [showMilitaryAircraft, setShowMilitaryAircraft] = useState(false);
  const [aircraft, setAircraft] = useState<AircraftPosition[]>([]);
  const [aircraftMeta, setAircraftMeta] = useState<ProviderMeta | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const [vesselFilterOpen, setVesselFilterOpen] = useState(true);
  const [ttlReferenceOpen, setTtlReferenceOpen] = useState(false);
  const { theme } = usePreferences();
  const initialTheme = useRef(theme);
  const isFirstThemeRun = useRef(true);

  // Ticks periodically so event markers' importance-based fade/expiry (see
  // IMPORTANCE_TTL_MS above) recomputes over time even when no new data has
  // arrived — otherwise an old marker would just sit at full opacity forever
  // until the next unrelated re-render happened to touch it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Keep these refs current for closures set up once in the mount effect
  // below (map click/hover handlers), without re-running that effect.
  useEffect(() => {
    eventsRef.current = events;
    onSelectRef.current = onSelectEvent;
    showConnectionsRef.current = showConnections;
    zonesRef.current = zones;
    showConflictZonesRef.current = showConflictZones;
    showMaritimeRestrictionsRef.current = showMaritimeRestrictions;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const pulseMarkers = pulseMarkersRef.current;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL[initialTheme.current],
      center: [10, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Fullscreens the map's own container (maplibre's default target), not the
    // whole page — the toolbar/feed panel stay out of the way automatically.
    map.addControl(new maplibregl.FullscreenControl(), "bottom-right");

    // Add markers as soon as the style itself (sources/layers/sprite/glyphs)
    // is parsed, rather than waiting for "load" (which also waits for the
    // initial viewport's base-map tiles to finish rendering). This way event
    // markers still appear promptly even if the basemap tile CDN is slow.
    map.on("style.load", () => {
      // --- Shipping routes (below conflict zones and events) ---
      map.addSource("shipping-routes", { type: "geojson", data: shippingRoutesFeatureCollection() });
      map.addLayer({
        id: "shipping-routes",
        type: "line",
        source: "shipping-routes",
        layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#38bdf8", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 },
      });

      // --- Live vessels (AIS) ---
      // A vessel with a known heading is shown as a single rotated triangle
      // (not a dot with a tiny arrow drawn on top of it, which read as a
      // busy "circle with a triangle inside" — the triangle IS the marker).
      // Only vessels with no reported course fall back to a plain dot, since
      // there's no honest direction to draw for those.
      const VESSEL_TYPE_COLOR_MATCH: maplibregl.ExpressionSpecification = [
        "match",
        ["get", "typeGroup"],
        "cargo",
        SHIP_TYPE_COLORS.cargo,
        "tanker",
        SHIP_TYPE_COLORS.tanker,
        "passenger",
        SHIP_TYPE_COLORS.passenger,
        "fishing",
        SHIP_TYPE_COLORS.fishing,
        "military",
        SHIP_TYPE_COLORS.military,
        SHIP_TYPE_COLORS.other,
      ];
      map.addSource("vessels", { type: "geojson", data: vesselsFeatureCollection([]) });
      map.addLayer({
        id: "vessels-triangle",
        type: "symbol",
        source: "vessels",
        filter: ["!=", ["get", "courseDeg"], null],
        layout: {
          visibility: "none",
          "text-field": "▲",
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 8, 6, 12, 12, 16],
          "text-rotate": ["get", "courseDeg"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": VESSEL_TYPE_COLOR_MATCH,
          "text-halo-color": "#0a0d12",
          "text-halo-width": 0.8,
        },
      });
      map.addLayer({
        id: "vessels-dot",
        type: "circle",
        source: "vessels",
        filter: ["==", ["get", "courseDeg"], null],
        layout: { visibility: "none" },
        paint: {
          "circle-color": VESSEL_TYPE_COLOR_MATCH,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 6, 3, 12, 5.5],
          "circle-opacity": 0.85,
        },
      });

      const vesselPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      const onVesselEnter = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const { name, typeGroup, speedKnots, courseDeg } = feature.properties as {
          name: string;
          typeGroup: string;
          speedKnots: number | null;
          courseDeg: number | null;
        };
        const speed = speedKnots !== null ? `${speedKnots.toFixed(1)} kn` : "speed unknown";
        const course = courseDeg !== null ? `${Math.round(courseDeg)}°` : "course unknown";
        vesselPopup
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="font:11px sans-serif;color:#0a0d12;max-width:200px"><strong>${name}</strong> <span style="text-transform:uppercase;font-size:9px">(${typeGroup})</span><br/>${speed} &middot; ${course}</div>`,
          )
          .addTo(map);
      };
      const onVesselLeave = () => {
        map.getCanvas().style.cursor = "";
        vesselPopup.remove();
      };
      for (const layerId of ["vessels-triangle", "vessels-dot"]) {
        map.on("mouseenter", layerId, onVesselEnter);
        map.on("mouseleave", layerId, onVesselLeave);
      }

      // --- Live military aircraft (ADS-B) ---
      // Red to match this app's existing military color (see
      // SHIP_TYPE_COLORS.military above) — every aircraft this layer tracks
      // is military, so it should read as consistently "military red," not
      // its own unrelated yellow.
      map.addSource("aircraft", { type: "geojson", data: aircraftFeatureCollection([]) });
      map.addLayer({
        id: "aircraft-triangle",
        type: "symbol",
        source: "aircraft",
        filter: ["!=", ["get", "trackDeg"], null],
        layout: {
          visibility: "none",
          "text-field": "▲",
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9, 6, 13, 12, 17],
          "text-rotate": ["get", "trackDeg"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": AIRCRAFT_COLOR,
          "text-halo-color": "#0a0d12",
          "text-halo-width": 0.8,
        },
      });
      map.addLayer({
        id: "aircraft-dot",
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "trackDeg"], null],
        layout: { visibility: "none" },
        paint: {
          "circle-color": AIRCRAFT_COLOR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2, 6, 3.5, 12, 6],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0a0d12",
        },
      });

      const aircraftPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      const onAircraftEnter = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const { callsign, aircraftType, altitudeFt, groundSpeedKts } = feature.properties as {
          callsign: string;
          aircraftType: string;
          altitudeFt: number | null;
          groundSpeedKts: number | null;
        };
        const altitude = altitudeFt !== null ? `${altitudeFt.toLocaleString()} ft` : "altitude unknown";
        const speed = groundSpeedKts !== null ? `${Math.round(groundSpeedKts)} kn` : "speed unknown";
        aircraftPopup
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="font:11px sans-serif;color:#0a0d12;max-width:200px"><strong>${callsign}</strong> <span style="font-size:9px">(${aircraftType})</span><br/>${altitude} &middot; ${speed}</div>`,
          )
          .addTo(map);
      };
      const onAircraftLeave = () => {
        map.getCanvas().style.cursor = "";
        aircraftPopup.remove();
      };
      for (const layerId of ["aircraft-triangle", "aircraft-dot"]) {
        map.on("mouseenter", layerId, onAircraftEnter);
        map.on("mouseleave", layerId, onAircraftLeave);
      }

      // --- Conflict zones ---
      map.addSource("conflict-zones", {
        type: "geojson",
        data: conflictZonesFeatureCollection(zonesRef.current, Date.now()),
      });
      map.addLayer({
        id: "conflict-zones-fill",
        type: "fill",
        source: "conflict-zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "severity"],
            "critical",
            CONFLICT_SEVERITY_COLOR.critical,
            "high",
            CONFLICT_SEVERITY_COLOR.high,
            CONFLICT_SEVERITY_COLOR.medium,
          ],
          // Zones discovered in the last 24h (see ZONE_NEW_HIGHLIGHT_MS) get
          // a visibly bolder fill/outline — the "mark it on the map
          // instantly" treatment for e.g. a brand-new war.
          "fill-opacity": ["case", ["get", "isNew"], 0.4, 0.15],
        },
      });
      map.addLayer({
        id: "conflict-zones-outline",
        type: "line",
        source: "conflict-zones",
        paint: {
          "line-color": [
            "match",
            ["get", "severity"],
            "critical",
            CONFLICT_SEVERITY_COLOR.critical,
            "high",
            CONFLICT_SEVERITY_COLOR.high,
            CONFLICT_SEVERITY_COLOR.medium,
          ],
          "line-width": ["case", ["get", "isNew"], 3, 1.5],
          "line-opacity": ["case", ["get", "isNew"], 1, 0.6],
        },
      });

      const zonePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      map.on("mouseenter", "conflict-zones-fill", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature) return;
        const { name, severity, summary, isNew } = feature.properties as {
          name: string;
          severity: string;
          summary: string;
          isNew: boolean;
        };
        const newBadge = isNew ? ` <span style="color:#ef4444;font-size:9px;font-weight:700">NEW</span>` : "";
        zonePopup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:11px sans-serif;color:#0a0d12;max-width:220px"><strong>${name}</strong> <span style="text-transform:uppercase;font-size:9px">(${severity})</span>${newBadge}<br/>${summary}</div>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "conflict-zones-fill", () => {
        map.getCanvas().style.cursor = "";
        zonePopup.remove();
      });

      // --- Maritime blockades / restricted waters ---
      // Blue + dashed outline to read as "restricted shipping," visually
      // distinct from Conflict Zones' solid red/orange/yellow so the two
      // don't get confused at a glance.
      map.addSource("maritime-restrictions", {
        type: "geojson",
        data: maritimeRestrictionsFeatureCollection(zonesRef.current, Date.now()),
      });
      map.addLayer({
        id: "maritime-restrictions-fill",
        type: "fill",
        source: "maritime-restrictions",
        paint: { "fill-color": "#0ea5e9", "fill-opacity": ["case", ["get", "isNew"], 0.35, 0.12] },
      });
      map.addLayer({
        id: "maritime-restrictions-outline",
        type: "line",
        source: "maritime-restrictions",
        paint: {
          "line-color": "#0ea5e9",
          "line-width": ["case", ["get", "isNew"], 3, 1.5],
          "line-dasharray": [3, 2],
          "line-opacity": ["case", ["get", "isNew"], 1, 0.75],
        },
      });

      const maritimePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      map.on("mouseenter", "maritime-restrictions-fill", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature) return;
        const { name, summary, isNew } = feature.properties as { name: string; summary: string; isNew: boolean };
        const newBadge = isNew ? ` <span style="color:#ef4444;font-size:9px;font-weight:700">NEW</span>` : "";
        maritimePopup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:11px sans-serif;color:#0a0d12;max-width:240px"><strong>${name}</strong>${newBadge}<br/>${summary}</div>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "maritime-restrictions-fill", () => {
        map.getCanvas().style.cursor = "";
        maritimePopup.remove();
      });

      // --- Related-headline connections (drawn under the event dots) ---
      map.addSource("event-connections", {
        type: "geojson",
        data: connectionsFeatureCollection(computeConnections(eventsRef.current, Date.now())),
      });
      map.addLayer({
        id: "event-connections-line",
        type: "line",
        source: "event-connections",
        layout: { visibility: showConnectionsRef.current ? "visible" : "none", "line-join": "round" },
        paint: {
          "line-color": "#8b93a3",
          "line-width": 1,
          "line-dasharray": [1, 1.5],
          "line-opacity": ["get", "opacity"],
        },
      });

      // --- Event markers (clustered) ---
      map.addSource("events", {
        type: "geojson",
        data: toFeatureCollection(eventsRef.current, Date.now()),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 9,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "events",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#3b82f6",
          "circle-opacity": 0.75,
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 25, 24],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0a0d12",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "events",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: { "text-color": "#e6e9ef" },
      });

      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "events",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "importance"],
            "critical",
            IMPORTANCE_COLORS.critical,
            "high",
            IMPORTANCE_COLORS.high,
            "medium",
            IMPORTANCE_COLORS.medium,
            "low",
            IMPORTANCE_COLORS.low,
            IMPORTANCE_COLORS.low,
          ],
          "circle-radius": [
            "match",
            ["get", "importance"],
            "critical",
            IMPORTANCE_RADIUS.critical,
            "high",
            IMPORTANCE_RADIUS.high,
            "medium",
            IMPORTANCE_RADIUS.medium,
            "low",
            IMPORTANCE_RADIUS.low,
            5,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0a0d12",
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-opacity": ["get", "opacity"],
        },
      });

      map.addLayer({
        id: "unclustered-label",
        type: "symbol",
        source: "events",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "letter"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 9,
        },
        paint: { "text-color": "#0a0d12", "text-opacity": ["get", "opacity"] },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

      map.on("mouseenter", "unclustered-point", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const { title, source, precision, isNew } = feature.properties as {
          title: string;
          source: string;
          precision: string;
          isNew: boolean;
        };
        const newBadge = isNew
          ? `<span style="color:#ef4444;font-size:9px;font-weight:700">NEW</span> `
          : "";
        popup
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="font:11px sans-serif;color:#0a0d12;max-width:220px">${newBadge}<strong>${title}</strong><br/>${source} &middot; location: ${precision}</div>`,
          )
          .addTo(map);
      });

      map.on("mouseleave", "unclustered-point", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      map.on("click", "unclustered-point", (e) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });

      map.on("click", "clusters", async (e) => {
        const feature = e.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (clusterId === undefined || feature?.geometry.type !== "Point") return;
        const source = map.getSource("events") as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
      });

      map.on("mouseenter", "clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters", () => {
        map.getCanvas().style.cursor = "";
      });

      readyRef.current = true;
    });

    return () => {
      pulseMarkers.forEach((marker) => marker.remove());
      pulseMarkers.clear();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Conflict zones / maritime restrictions now come from the AI scan (see
  // zone-scan-cycle.ts) instead of a static import, so they need fetching
  // like every other live layer. The underlying data only changes on a
  // ~daily scan cadence, so polling every 30 min is already far more often
  // than necessary — just frequent enough that a scan landing mid-session
  // shows up without a full page reload.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/world-tracker/zones");
        const body: { data: RestrictedZone[] } = await res.json();
        if (!cancelled) setZones(body.data ?? []);
      } catch {
        // Leave whatever zones are already showing — a fetch hiccup
        // shouldn't blank out real data that's still valid.
      }
    }
    poll();
    const interval = setInterval(poll, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const conflictSource = map.getSource("conflict-zones") as maplibregl.GeoJSONSource | undefined;
    conflictSource?.setData(conflictZonesFeatureCollection(zones, now));
    const maritimeSource = map.getSource("maritime-restrictions") as maplibregl.GeoJSONSource | undefined;
    maritimeSource?.setData(maritimeRestrictionsFeatureCollection(zones, now));
  }, [zones, now]);

  // Keep the map's data in sync with filtered events without re-creating the map.
  // Depends on `now` too — the same events list renders differently over time
  // as markers fade toward their importance-based expiry (see IMPORTANCE_TTL_MS).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource("events") as maplibregl.GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(events, now));

    const connectionsSource = map.getSource("event-connections") as maplibregl.GeoJSONSource | undefined;
    connectionsSource?.setData(connectionsFeatureCollection(computeConnections(events, now)));
  }, [events, now]);

  // Radar-pulse HTML markers layered on top of the GL circle for critical/breaking
  // events — a plain GL paint animation can't easily do an expanding-ring effect,
  // so this uses maplibregl.Marker (CSS-animated, see .wt-pulse-* in globals.css).
  // Positioned from the same placement as the GL dots (via placeEvents) so the
  // pulse ring always sits exactly on top of its marker; faded and expired on
  // the same schedule as everything else rather than lingering indefinitely.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const current = pulseMarkersRef.current;
    const placed = placeEvents(events.filter(isPulseWorthy));
    const nextIds = new Set(placed.map((p) => p.event.id));

    for (const [id, marker] of current) {
      if (!nextIds.has(id)) {
        marker.remove();
        current.delete(id);
      }
    }

    for (const { event, lat, lng } of placed) {
      const opacity = eventOpacity(event, now);
      if (opacity === null) continue; // expired — treat same as not pulse-worthy
      let marker = current.get(event.id);
      if (!marker) {
        marker = new maplibregl.Marker({ element: createPulseElement(pulseColorFor(event)) }).setLngLat([lng, lat]).addTo(map);
        current.set(event.id, marker);
      }
      marker.getElement().style.opacity = String(opacity);
    }
  }, [events, now]);

  // Fly to and highlight the selected event, e.g. when a feed card is clicked
  // — uses the same jittered position the marker actually renders at, so the
  // map centers where the dot visually is rather than its pre-jitter centroid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !selectedEventId) return;
    const placed = placeEvents(events).find((p) => p.event.id === selectedEventId);
    if (!placed) return;
    map.flyTo({ center: [placed.lng, placed.lat], zoom: Math.max(map.getZoom(), 5), speed: 1.2 });
  }, [selectedEventId, events]);

  // Swap the CARTO base style when the theme toggles. maplibre treats a
  // different base style as a full reload, so the existing "style.load"
  // handler above re-adds the events/conflict-zones/shipping-routes
  // sources+layers from scratch afterward — nothing else needed here.
  useEffect(() => {
    const map = mapRef.current;
    if (isFirstThemeRun.current) {
      isFirstThemeRun.current = false;
      return;
    }
    if (!map || !readyRef.current) return;
    readyRef.current = false;
    map.setStyle(MAP_STYLE_URL[theme]);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("conflict-zones-fill")) return;
    const visibility = showConflictZones ? "visible" : "none";
    map.setLayoutProperty("conflict-zones-fill", "visibility", visibility);
    map.setLayoutProperty("conflict-zones-outline", "visibility", visibility);
  }, [showConflictZones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("maritime-restrictions-fill")) return;
    const visibility = showMaritimeRestrictions ? "visible" : "none";
    map.setLayoutProperty("maritime-restrictions-fill", "visibility", visibility);
    map.setLayoutProperty("maritime-restrictions-outline", "visibility", visibility);
  }, [showMaritimeRestrictions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("event-connections-line")) return;
    map.setLayoutProperty("event-connections-line", "visibility", showConnections ? "visible" : "none");
  }, [showConnections]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("shipping-routes")) return;
    map.setLayoutProperty("shipping-routes", "visibility", showShippingRoutes ? "visible" : "none");
  }, [showShippingRoutes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("vessels-triangle")) return;
    const visibility = showVessels ? "visible" : "none";
    map.setLayoutProperty("vessels-triangle", "visibility", visibility);
    map.setLayoutProperty("vessels-dot", "visibility", visibility);
  }, [showVessels]);

  // Restricts both vessel layers to the selected ship-type categories — same
  // "empty set = show everything" convention as FilterBar's category/tag
  // filters elsewhere in this app. Each layer keeps its own structural
  // courseDeg condition ANDed in rather than replaced, so type filtering
  // never blurs the triangle/dot split (heading vs. no heading data).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("vessels-triangle")) return;
    const typeFilter: maplibregl.FilterSpecification | null =
      activeVesselTypes.size > 0 ? ["in", ["get", "typeGroup"], ["literal", [...activeVesselTypes]]] : null;
    const hasCourse: maplibregl.FilterSpecification = ["!=", ["get", "courseDeg"], null];
    const noCourse: maplibregl.FilterSpecification = ["==", ["get", "courseDeg"], null];
    map.setFilter("vessels-triangle", typeFilter ? ["all", hasCourse, typeFilter] : hasCourse);
    map.setFilter("vessels-dot", typeFilter ? ["all", noCourse, typeFilter] : noCourse);
  }, [activeVesselTypes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("aircraft-triangle")) return;
    const visibility = showMilitaryAircraft ? "visible" : "none";
    map.setLayoutProperty("aircraft-triangle", "visibility", visibility);
    map.setLayoutProperty("aircraft-dot", "visibility", visibility);
  }, [showMilitaryAircraft]);

  // Only poll while the layer is switched on — an unchecked layer costs nothing.
  useEffect(() => {
    if (!showVessels) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/world-tracker/vessels");
        const body: ProviderResult<VesselPosition[]> = await res.json();
        if (cancelled) return;
        setVessels(body.data ?? []);
        setVesselMeta(body.meta);
      } catch {
        // Transient fetch failure — the next tick retries.
      }
    }

    poll();
    const interval = setInterval(poll, VESSEL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showVessels]);

  useEffect(() => {
    if (!showMilitaryAircraft) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/world-tracker/aircraft");
        const body: ProviderResult<AircraftPosition[]> = await res.json();
        if (cancelled) return;
        setAircraft(body.data ?? []);
        setAircraftMeta(body.meta);
      } catch {
        // Transient fetch failure — the next tick retries.
      }
    }

    poll();
    const interval = setInterval(poll, AIRCRAFT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showMilitaryAircraft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource("vessels") as maplibregl.GeoJSONSource | undefined;
    source?.setData(vesselsFeatureCollection(vessels));
  }, [vessels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource("aircraft") as maplibregl.GeoJSONSource | undefined;
    source?.setData(aircraftFeatureCollection(aircraft));
  }, [aircraft]);

  function toggleVesselType(type: ShipTypeGroup) {
    setActiveVesselTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-lg border border-border" />
      <div className="absolute left-2 top-2 flex flex-col gap-1 rounded-md border border-border bg-bg-panel/90 p-2 text-[10px] text-text-secondary">
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          className="flex items-center gap-1.5 text-left font-medium text-text-primary"
        >
          <span className="w-3 shrink-0">{legendOpen ? "▾" : "▸"}</span>
          Layers
        </button>
        {legendOpen && (
          <>
            <label className="flex items-center gap-1.5 pl-5">
              <input
                type="checkbox"
                checked={showConflictZones}
                onChange={(e) => setShowConflictZones(e.target.checked)}
              />
              Conflict zones
            </label>
            <label className="flex items-center gap-1.5 pl-5">
              <input
                type="checkbox"
                checked={showMaritimeRestrictions}
                onChange={(e) => setShowMaritimeRestrictions(e.target.checked)}
              />
              Maritime blockades
            </label>
            <label className="flex items-center gap-1.5 pl-5">
              <input
                type="checkbox"
                checked={showConnections}
                onChange={(e) => setShowConnections(e.target.checked)}
              />
              Related headlines
            </label>
            <label className="flex items-center gap-1.5 pl-5">
              <input
                type="checkbox"
                checked={showShippingRoutes}
                onChange={(e) => setShowShippingRoutes(e.target.checked)}
              />
              Shipping lanes
            </label>
            <label className="flex items-center gap-1.5 pl-5">
              <input type="checkbox" checked={showVessels} onChange={(e) => setShowVessels(e.target.checked)} />
              Live vessels{showVessels && vesselMeta?.status === "live" ? ` (${vessels.length})` : ""}
            </label>
            {showVessels && vesselMeta && vesselMeta.status !== "live" && (
              <>
                <p className="max-w-[180px] pl-6 text-[9px] leading-tight text-text-muted">
                  AIS data comes from volunteer receiver stations, not satellites — coverage is dense in Europe/North
                  America and sparse-to-absent elsewhere (e.g. the Middle East). Empty water doesn&apos;t mean no
                  ships.
                </p>
                <p className="max-w-[180px] pl-6 text-[9px] leading-tight text-text-muted">{vesselMeta.message}</p>
              </>
            )}
            <label className="flex items-center gap-1.5 pl-5">
              <input
                type="checkbox"
                checked={showMilitaryAircraft}
                onChange={(e) => setShowMilitaryAircraft(e.target.checked)}
              />
              Military aircraft{showMilitaryAircraft && aircraftMeta?.status === "live" ? ` (${aircraft.length})` : ""}
            </label>
            {showMilitaryAircraft && aircraftMeta && aircraftMeta.status !== "live" && (
              <p className="max-w-[180px] pl-6 text-[9px] leading-tight text-text-muted">{aircraftMeta.message}</p>
            )}
          </>
        )}
      </div>

      {showVessels && (
        <div className="absolute right-2 top-20 flex flex-col gap-1 rounded-md border border-border bg-bg-panel/90 p-2 text-[10px] text-text-secondary">
          <button
            type="button"
            onClick={() => setVesselFilterOpen((v) => !v)}
            className="flex items-center gap-1.5 text-left font-medium text-text-primary"
          >
            <span className="w-3 shrink-0">{vesselFilterOpen ? "▾" : "▸"}</span>
            Vessel types
          </button>
          {vesselFilterOpen && (
            <div className="flex flex-col gap-1 pl-5">
              {VESSEL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleVesselType(type)}
                  className={`flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-left transition ${
                    activeVesselTypes.has(type)
                      ? "border-accent bg-accent/15 text-accent-strong"
                      : "border-border text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  <span style={{ color: SHIP_TYPE_COLORS[type] }}>●</span>
                  {VESSEL_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="absolute bottom-2 left-2 flex flex-col-reverse items-start gap-1">
        <button
          type="button"
          onClick={() => setTtlReferenceOpen((v) => !v)}
          title="Marker lifetime reference"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg-panel/90 text-[10px] font-medium text-text-secondary hover:bg-bg-hover"
        >
          i
        </button>
        {ttlReferenceOpen && (
          <div className="rounded-md border border-border bg-bg-panel/90 p-2 text-[9px] leading-tight text-text-secondary">
            <div className="mb-1 font-medium text-text-primary">Marker lifetime on map</div>
            <div>Critical — 24h</div>
            <div>High — 12h</div>
            <div>Medium — 6h</div>
            <div>Low — 3h</div>
          </div>
        )}
      </div>
    </div>
  );
}
