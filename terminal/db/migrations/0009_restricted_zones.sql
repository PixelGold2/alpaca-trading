-- Conflict zones and maritime blockades/restricted waters for the World
-- Tracker map, now AI-discovered (Gemini + Google Search grounding, see
-- zone-scanner.ts) instead of a hand-maintained static list. `id` is a
-- normalized slug of the zone's name so a rescan updates the same row
-- (ON CONFLICT DO UPDATE) rather than duplicating it. `last_confirmed_at`
-- is what the scan-loop's pruning is based on: a zone the AI stops
-- reporting ages out instead of lingering forever (see zones-store.ts).

CREATE TABLE restricted_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'conflict' | 'maritime'
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  severity TEXT, -- 'critical' | 'high' | 'medium' | NULL (maritime entries don't currently use this)
  summary TEXT NOT NULL,
  source_note TEXT, -- free-text attribution the model gave (outlet/organization), not a guaranteed URL
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX restricted_zones_kind_idx ON restricted_zones(kind);
