-- "What's New" announcements — admin-authored, visible to every signed-in user.
-- Optional image stored as bytea (same rationale as feedback_reports: small
-- illustrative screenshots, not a general file-storage need), served inline
-- from the post's own page, never exposed under public/.

CREATE TABLE whats_new_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_data BYTEA,
  image_mime_type TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX whats_new_posts_created_at_idx ON whats_new_posts(created_at DESC);
