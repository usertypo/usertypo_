-- Allow friend_online inbox rows (SQLite cannot ALTER CHECK — rebuild table).
CREATE TABLE IF NOT EXISTS notifications_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('friend_request', 'friend_accepted', 'friend_online')),
  title TEXT NOT NULL,
  body TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO notifications_v2 (id, user_id, type, title, body, data, read_at, created_at)
SELECT id, user_id, type, title, body, data, read_at, created_at
FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_v2 RENAME TO notifications;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id)
  WHERE read_at IS NULL;
