-- Self-registration + admin approval, and a notifications table for the
-- top-bar bell (registration-request alerts to start with).

ALTER TABLE users
  ADD COLUMN username TEXT UNIQUE,
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT,
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- Requested one-time backfill: pixelgoldgaming@gmail.com gets a username.
UPDATE users SET username = 'PixelGold' WHERE email = 'pixelgoldgaming@gmail.com';

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_unread_idx ON notifications(recipient_user_id, read_at);
