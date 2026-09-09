-- Profile picture, bio, and presence tracking for users. Avatar stored as
-- bytea (same rationale as chat_messages/feedback_reports/whats_new_posts —
-- small shared image, not a general file-storage need), served via a
-- dedicated route (not inlined as a data: URI) so it's fetched once and
-- cached by the browser instead of repeated in every chat poll response.
-- last_seen_at is a best-effort heartbeat updated on authenticated requests
-- (see lib/auth/session.ts), read through lib/presence.ts's online/away/
-- offline thresholds.

ALTER TABLE users
  ADD COLUMN avatar_data BYTEA,
  ADD COLUMN avatar_mime_type TEXT,
  ADD COLUMN bio TEXT,
  ADD COLUMN last_seen_at TIMESTAMPTZ;
