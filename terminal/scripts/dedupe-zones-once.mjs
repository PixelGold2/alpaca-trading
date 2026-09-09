#!/usr/bin/env node
// One-time cleanup: merges the duplicate restricted_zones rows created by
// the old exact-name-slug matching (see zones-store.ts upsertZones, fixed
// to match by geographic proximity going forward). Groups existing rows by
// kind + proximity (same 0.5-overlap-fraction rule as the app), keeps the
// most-recently-confirmed row in each cluster, deletes the rest. Safe to
// delete this script after running it once — it's not part of the app.
import "dotenv/config";
import pg from "pg";

const MERGE_OVERLAP_FRACTION = 0.5;

function approxDistanceKm(lat1, lng1, lat2, lng2) {
  const yKm = (lat1 - lat2) * 110.574;
  const xKm = (lng1 - lng2) * 111.32 * Math.cos((lat2 * Math.PI) / 180);
  return Math.sqrt(xKm * xKm + yKm * yKm);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(
  `SELECT id, name, kind, latitude, longitude, radius_km, last_confirmed_at
   FROM restricted_zones ORDER BY last_confirmed_at DESC`,
);

// Union-find so chains of near-duplicates (A~B, B~C but A and C not
// directly within range) merge into one cluster rather than two.
const parent = new Map(rows.map((r) => [r.id, r.id]));
function find(id) {
  while (parent.get(id) !== id) {
    parent.set(id, parent.get(parent.get(id)));
    id = parent.get(id);
  }
  return id;
}
function union(a, b) {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
}

for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i];
    const b = rows[j];
    if (a.kind !== b.kind) continue;
    const distance = approxDistanceKm(Number(a.latitude), Number(a.longitude), Number(b.latitude), Number(b.longitude));
    if (distance <= (Number(a.radius_km) + Number(b.radius_km)) * MERGE_OVERLAP_FRACTION) {
      union(a.id, b.id);
    }
  }
}

const clusters = new Map();
for (const row of rows) {
  const root = find(row.id);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(row);
}

let deleted = 0;
for (const members of clusters.values()) {
  if (members.length <= 1) continue;
  // rows are already ordered by last_confirmed_at DESC, so members[0] is the freshest — keep it, drop the rest.
  const [keep, ...drop] = members;
  console.log(`Merging ${members.length} zones into "${keep.name}" (${keep.id}):`);
  for (const d of drop) console.log(`  - dropping "${d.name}" (${d.id})`);
  const ids = drop.map((d) => d.id);
  await pool.query(`DELETE FROM restricted_zones WHERE id = ANY($1)`, [ids]);
  deleted += ids.length;
}

console.log(`\nDone. ${rows.length} zones -> ${rows.length - deleted} after merging (${deleted} duplicates removed).`);
await pool.end();
