export interface ConflictZone {
  id: string;
  name: string;
  /** Approximate center — these are broad regions, not precise front lines. */
  latitude: number;
  longitude: number;
  /** Rough visual extent in km, for drawing an approximate circle only. */
  radiusKm: number;
  severity: "critical" | "high" | "medium";
  summary: string;
}

/**
 * A small, hand-curated list of active conflict regions — not a live feed.
 * There is no free, no-signup API for this (ACLED requires registration; see
 * ARCHITECTURE notes), so this ships as a manually-reviewed static list
 * instead of pretending to be real-time. Review and update periodically;
 * each zone is an approximate region, never a precise front line or target.
 *
 * Last reviewed: 2026-08-21.
 */
export const CONFLICT_ZONES: ConflictZone[] = [
  {
    id: "ukraine",
    name: "Ukraine",
    latitude: 48.5,
    longitude: 37.5,
    radiusKm: 250,
    severity: "critical",
    summary: "Ongoing Russia-Ukraine war, concentrated in the eastern and southern regions.",
  },
  {
    id: "gaza-israel",
    name: "Gaza / Israel",
    latitude: 31.5,
    longitude: 34.47,
    radiusKm: 60,
    severity: "critical",
    summary: "Israel-Gaza conflict and related regional tension.",
  },
  {
    id: "sudan",
    name: "Sudan",
    latitude: 15.5,
    longitude: 30.5,
    radiusKm: 300,
    severity: "critical",
    summary: "Sudanese civil war between the SAF and RSF, widespread displacement.",
  },
  {
    id: "myanmar",
    name: "Myanmar",
    latitude: 21.9,
    longitude: 95.9,
    radiusKm: 300,
    severity: "high",
    summary: "Civil conflict between the military government and resistance/ethnic armed groups.",
  },
  {
    id: "yemen",
    name: "Yemen",
    latitude: 15.5,
    longitude: 47.5,
    radiusKm: 250,
    severity: "high",
    summary: "Yemeni civil war and Red Sea-adjacent instability.",
  },
  {
    id: "sahel",
    name: "Central Sahel",
    latitude: 15.5,
    longitude: 1.0,
    radiusKm: 400,
    severity: "high",
    summary: "Insurgent violence across Mali, Burkina Faso, and Niger.",
  },
  {
    id: "eastern-drc",
    name: "Eastern DRC",
    latitude: -1.7,
    longitude: 29.2,
    radiusKm: 200,
    severity: "high",
    summary: "Armed group conflict in North and South Kivu provinces.",
  },
];
