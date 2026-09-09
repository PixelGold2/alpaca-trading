export type EventCategory = "finance" | "politics" | "geopolitics" | "aviation";

export type EventImportance = "critical" | "high" | "medium" | "low";

/**
 * How precisely `latitude`/`longitude` represent the event's real location.
 * Never presented as more precise than the source actually supports — a
 * country-level story is placed at the country centroid and labeled
 * "country", not silently rendered as if it were street-level.
 */
export type LocationPrecision = "exact" | "city" | "region" | "country";

export type FeedTag =
  | "economy"
  | "technology"
  | "energy"
  | "defense"
  | "crypto"
  | "central_banks"
  | "markets"
  | "breaking"
  | "political_speech"
  | "earnings";

export interface EventLocation {
  country: string;
  region?: string;
  city?: string;
}

/** A conflict zone or maritime blockade/restriction — see zone-scanner.ts. */
export interface RestrictedZone {
  id: string;
  name: string;
  kind: "conflict" | "maritime";
  latitude: number;
  longitude: number;
  radiusKm: number;
  severity: "critical" | "high" | "medium" | null;
  summary: string;
  sourceNote: string | null;
  createdAt: string; // ISO 8601 — when this zone was FIRST discovered, not last reconfirmed
}

export interface WorldEvent {
  id: string;
  title: string;
  description: string;
  category: EventCategory;
  subcategory: string;
  source: string;
  url: string;
  publishedAt: string; // ISO 8601
  location: EventLocation;
  latitude: number;
  longitude: number;
  locationPrecision: LocationPrecision;
  importance: EventImportance;
  sentiment: "positive" | "neutral" | "negative";
  tickers: string[];
  tags: FeedTag[];
}
