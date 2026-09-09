import "server-only";
import { query } from "@/lib/db";
import type { WorldEvent } from "@/lib/world-tracker/types";

const RETENTION_DAYS = 7;
const STREAM_BATCH_SIZE = 200;

interface NewEventRow {
  url: string;
  title: string;
  description: string;
  category: string;
  subcategory: string;
  source: string;
  publishedAt: string;
  country: string;
  latitude: number;
  longitude: number;
  locationPrecision: string;
  importance: string;
  importanceScore: number;
  tags: string[];
}

export interface InsertNewEventsResult {
  count: number;
  // URLs that were genuinely inserted this call (not already-seen dupes) —
  // lets a caller (e.g. gdelt-provider.ts's critical-news notification
  // trigger) act only on truly new rows instead of re-acting on the same
  // headline every cycle it happens to still be within GDELT's 1h timespan
  // window.
  newUrls: Set<string>;
}

/**
 * Bulk insert with per-row dedup via the url unique constraint — safe to call
 * with articles the collector has already stored (ON CONFLICT DO NOTHING),
 * which is what makes overlapping collector runs (the instrumentation.ts
 * interval and an external cron hitting /api/world-tracker/collect at the
 * same time) harmless rather than a race condition.
 */
export async function insertNewEvents(rows: NewEventRow[]): Promise<InsertNewEventsResult> {
  const newUrls = new Set<string>();
  for (const row of rows) {
    const result = await query(
      `INSERT INTO world_events
         (url, title, description, category, subcategory, source, published_at,
          country, latitude, longitude, location_precision, importance, importance_score, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (url) DO NOTHING`,
      [
        row.url,
        row.title,
        row.description,
        row.category,
        row.subcategory,
        row.source,
        row.publishedAt,
        row.country,
        row.latitude,
        row.longitude,
        row.locationPrecision,
        row.importance,
        row.importanceScore,
        row.tags,
      ],
    );
    if ((result.rowCount ?? 0) > 0) newUrls.add(row.url);
  }
  return { count: newUrls.size, newUrls };
}

function rowToWorldEvent(row: {
  id: string;
  url: string;
  title: string;
  description: string;
  category: string;
  subcategory: string;
  source: string;
  published_at: string;
  country: string;
  latitude: string | number;
  longitude: string | number;
  location_precision: string;
  importance: string;
  tags: string[];
}): WorldEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as WorldEvent["category"],
    subcategory: row.subcategory,
    source: row.source,
    url: row.url,
    publishedAt: new Date(row.published_at).toISOString(),
    location: { country: row.country },
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    locationPrecision: row.location_precision as WorldEvent["locationPrecision"],
    importance: row.importance as WorldEvent["importance"],
    sentiment: "neutral",
    tickers: [],
    tags: row.tags as WorldEvent["tags"],
  };
}

/** Most recent events, newest first — used for the SSE stream's initial batch. */
export async function getRecentEvents(limit = STREAM_BATCH_SIZE): Promise<WorldEvent[]> {
  const { rows } = await query<Parameters<typeof rowToWorldEvent>[0]>(
    `SELECT id, url, title, description, category, subcategory, source, published_at,
            country, latitude, longitude, location_precision, importance, tags
     FROM world_events
     ORDER BY published_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(rowToWorldEvent);
}

/** Events inserted since a given timestamp — used to feed new SSE "event" ticks. */
export async function getEventsSince(since: Date): Promise<WorldEvent[]> {
  const { rows } = await query<Parameters<typeof rowToWorldEvent>[0]>(
    `SELECT id, url, title, description, category, subcategory, source, published_at,
            country, latitude, longitude, location_precision, importance, tags
     FROM world_events
     WHERE created_at > $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [since.toISOString(), STREAM_BATCH_SIZE],
  );
  return rows.map(rowToWorldEvent);
}

/** Keeps the table from growing forever — a live feed has no use for month-old rows. */
export async function pruneOldEvents(): Promise<number> {
  const result = await query(`DELETE FROM world_events WHERE published_at < now() - interval '${RETENTION_DAYS} days'`);
  return result.rowCount ?? 0;
}
