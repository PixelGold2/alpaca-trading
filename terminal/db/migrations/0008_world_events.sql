-- Real news/market events collected from GDELT for the World Tracker map +
-- live feed, replacing the previous mock generator. `url` is GDELT's own
-- article dedup key (a GDELT article always has a unique URL) — the unique
-- constraint on it is what makes repeated collector runs safe to overlap
-- without inserting the same story twice (see events-store.ts's ON CONFLICT
-- DO NOTHING). Only geocoded rows are ever inserted (see gdelt-provider.ts);
-- there is no NULL-location fallback here, matching the app-wide rule that
-- WorldEvent always has a real location, never a fabricated one.

CREATE TABLE world_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  source TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  country TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location_precision TEXT NOT NULL,
  importance TEXT NOT NULL,
  importance_score SMALLINT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX world_events_published_at_idx ON world_events(published_at DESC);
CREATE INDEX world_events_category_idx ON world_events(category);
