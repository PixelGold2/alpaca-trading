-- Member-wide chat, split into fixed topic categories. Optional image per
-- message stored as bytea (same rationale as feedback_reports/whats_new_posts
-- — small shared attachments, not a general file-storage need), served inline,
-- never exposed under public/. A message needs a body, an image, or both —
-- never neither.

CREATE TYPE chat_category AS ENUM ('general', 'markets', 'forex', 'crypto', 'futures', 'commodities');

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category chat_category NOT NULL,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  image_data BYTEA,
  image_mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR image_data IS NOT NULL)
);

CREATE INDEX chat_messages_category_created_idx ON chat_messages(category, created_at DESC);
