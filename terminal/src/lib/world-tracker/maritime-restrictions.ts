export interface MaritimeRestriction {
  id: string;
  name: string;
  /** Approximate center — these are broad chokepoint regions, not precise boundaries. */
  latitude: number;
  longitude: number;
  /** Rough visual extent in km, for drawing an approximate circle only. */
  radiusKm: number;
  summary: string;
  /** Where this was sourced from, shown in the popup so it's checkable, not just asserted. */
  source: string;
}

/**
 * A small, hand-curated list of active maritime blockades/restricted waters —
 * not a live feed. Same situation as conflict-zones.ts: there is no free,
 * keyless API for this. UKMTO/JMIC (the UK Maritime Trade Operations' Joint
 * Maritime Information Center — a real Royal Navy-run advisory service used
 * by the shipping industry) publishes real advisories, but only as PDF
 * documents updated periodically, not a queryable feed
 * (ukmto.org/partner-products/jmic-products/jmic-advisories). This ships as
 * a manually-reviewed static list sourced from those advisories instead of
 * pretending to be real-time. Review and update periodically; each entry is
 * an approximate region, never a precise boundary.
 *
 * Last reviewed: 2026-08-25.
 */
export const MARITIME_RESTRICTIONS: MaritimeRestriction[] = [
  {
    id: "hormuz-iran-blockade",
    name: "Strait of Hormuz — Iran blockade",
    latitude: 26.5,
    longitude: 56.3,
    radiusKm: 250,
    summary:
      "US CENTCOM began a naval blockade of all Iranian ports and coastal waters at 2000Z on 14 Jul 2026. JMIC assesses SEVERE risk in the Strait itself. Vessels assisting others in evading the blockade (e.g. ship-to-ship transfers) are themselves treated as violators.",
    source: "https://www.ukmto.org/partner-products/jmic-products/jmic-advisories/2026",
  },
  {
    id: "bab-el-mandeb-houthi-blockade",
    name: "Bab el-Mandeb / Gulf of Aden — Houthi blockade",
    latitude: 12.6,
    longitude: 43.4,
    radiusKm: 300,
    summary:
      "Houthi forces declared a blockade on 20 Jul 2026 targeting Saudi-flagged and Saudi-affiliated vessels; enforcement is reported as selective rather than blanket. JMIC assesses SUBSTANTIAL risk across the Gulf of Aden and Bab el-Mandeb.",
    source: "https://www.ukmto.org/partner-products/jmic-products/jmic-advisories/2026",
  },
];
