import "server-only";
import { query } from "@/lib/db";
import type { ScannedZone } from "@/lib/world-tracker/zone-scanner";
import type { RestrictedZone } from "@/lib/world-tracker/types";

// A zone the AI stops reporting for this many days is considered resolved
// and pruned — long enough that one failed/empty scan cycle (network error,
// quota hit) doesn't wipe a real zone, short enough that a genuinely
// resolved blockade doesn't linger on the map for weeks.
const STALE_AFTER_DAYS = 3;

/** Normalizes a zone name into a stable id — only used as a fallback when a scanned zone doesn't geographically match any existing zone (see upsertZones). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Flat-earth approximation, consistent with the same math WorldMap.tsx uses to draw/contain zones — good enough over the few-hundred-km scale these zones span. */
function approxDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const yKm = (lat1 - lat2) * 110.574;
  const xKm = (lng1 - lng2) * 111.32 * Math.cos((lat2 * Math.PI) / 180);
  return Math.sqrt(xKm * xKm + yKm * yKm);
}

// The AI scanner names the same real-world situation slightly differently
// almost every scan ("Red Sea and Bab-el-Mandeb Strait" vs "Southern Red Sea
// and Bab al-Mandab Strait" vs "Bab el-Mandeb / Gulf of Aden — Houthi
// blockade", etc.) — matching by exact slugified name therefore inserted a
// fresh duplicate row nearly every cycle instead of updating the same one,
// which is what produced a pile of near-identical overlapping circles on
// the map. Matching by geography instead: two zones of the same kind whose
// centers are close relative to their radii are almost certainly the same
// real-world situation restated, so a scan update targets the existing row.
// 0.5 = the two circles must overlap by at least half their average radius
// — tight enough that genuinely distinct nearby chokepoints (e.g. Gulf of
// Aden vs. Bab-el-Mandeb, ~500km apart) stay separate, loose enough that
// every confirmed duplicate seen in production data merges.
const MERGE_OVERLAP_FRACTION = 0.5;

interface ExistingZoneRef {
  id: string;
  kind: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

function findMergeTarget(zone: ScannedZone, candidates: ExistingZoneRef[]): ExistingZoneRef | null {
  for (const candidate of candidates) {
    if (candidate.kind !== zone.kind) continue;
    const distance = approxDistanceKm(zone.latitude, zone.longitude, candidate.latitude, candidate.longitude);
    if (distance <= (candidate.radiusKm + zone.radiusKm) * MERGE_OVERLAP_FRACTION) return candidate;
  }
  return null;
}

/**
 * Upserts one scan's worth of zones — each scanned zone is matched against
 * existing rows (and against zones already processed earlier in this same
 * batch) by geographic proximity, not by name (see findMergeTarget above).
 * A match gets its fields refreshed and last_confirmed_at bumped under its
 * existing id; no match gets inserted as a new row, keyed by its slugified
 * name. Never deletes here — that's pruneStaleZones's job, run separately
 * so a zone survives one bad/partial scan rather than disappearing the
 * moment the AI omits it once.
 */
export async function upsertZones(zones: ScannedZone[]): Promise<number> {
  const known: ExistingZoneRef[] = (await getAllZones()).map((z) => ({
    id: z.id,
    kind: z.kind,
    latitude: z.latitude,
    longitude: z.longitude,
    radiusKm: z.radiusKm,
  }));

  let written = 0;
  for (const zone of zones) {
    const match = findMergeTarget(zone, known);
    const id = match?.id ?? slugify(zone.name);
    if (!id) continue;
    const result = await query(
      `INSERT INTO restricted_zones
         (id, name, kind, latitude, longitude, radius_km, severity, summary, source_note, last_confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         radius_km = EXCLUDED.radius_km,
         severity = EXCLUDED.severity,
         summary = EXCLUDED.summary,
         source_note = EXCLUDED.source_note,
         last_confirmed_at = now()`,
      [id, zone.name, zone.kind, zone.latitude, zone.longitude, zone.radiusKm, zone.severity, zone.summary, zone.sourceNote],
    );
    written += result.rowCount ?? 0;
    if (!match) {
      known.push({ id, kind: zone.kind, latitude: zone.latitude, longitude: zone.longitude, radiusKm: zone.radiusKm });
    }
  }
  return written;
}

/**
 * Backdates created_at for the given ids — used only right after the
 * one-time bootstrap seed (see zone-scan-cycle.ts's seedIfEmpty), so
 * pre-existing seed data doesn't falsely read as "just discovered" under
 * the map's new-zone highlight (see WorldMap.tsx's ZONE_NEW_HIGHLIGHT_MS).
 * Real AI-discovered zones always get a genuine now() from upsertZones.
 */
export async function backdateZones(ids: string[], hoursAgo: number): Promise<void> {
  if (ids.length === 0) return;
  await query(`UPDATE restricted_zones SET created_at = now() - interval '${hoursAgo} hours' WHERE id = ANY($1)`, [
    ids,
  ]);
}

/** Zones the AI hasn't reconfirmed in a while — presumed resolved/no longer applicable. */
export async function pruneStaleZones(): Promise<number> {
  const result = await query(
    `DELETE FROM restricted_zones WHERE last_confirmed_at < now() - interval '${STALE_AFTER_DAYS} days'`,
  );
  return result.rowCount ?? 0;
}

function rowToZone(row: {
  id: string;
  name: string;
  kind: string;
  latitude: string | number;
  longitude: string | number;
  radius_km: string | number;
  severity: string | null;
  summary: string;
  source_note: string | null;
  created_at: string;
}): RestrictedZone {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as RestrictedZone["kind"],
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusKm: Number(row.radius_km),
    severity: row.severity as RestrictedZone["severity"],
    summary: row.summary,
    sourceNote: row.source_note,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getAllZones(): Promise<RestrictedZone[]> {
  const { rows } = await query<Parameters<typeof rowToZone>[0]>(
    `SELECT id, name, kind, latitude, longitude, radius_km, severity, summary, source_note, created_at
     FROM restricted_zones
     ORDER BY name ASC`,
  );
  return rows.map(rowToZone);
}

/** True once at least one row exists — used to decide whether the bootstrap seed still needs to run. */
export async function hasAnyZones(): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM restricted_zones) AS exists`);
  return rows[0]?.exists ?? false;
}
