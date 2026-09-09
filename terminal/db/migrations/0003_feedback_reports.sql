-- Feedback / bug report widget, reviewed from a dedicated admin panel section.
-- Optional screenshot stored as bytea (small evidence images, not a general
-- file-storage need) rather than the filesystem or a new object-storage
-- dependency, and served back to admins only, inline in the admin page's own
-- server-rendered HTML — never exposed under public/.

CREATE TABLE feedback_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('feedback', 'bug')),
  description TEXT NOT NULL,
  page_url TEXT,
  image_data BYTEA,
  image_mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feedback_reports_status_idx ON feedback_reports(status, created_at DESC);
