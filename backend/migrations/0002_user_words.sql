-- My Words: per-user custom vocabulary. Each row is private to its owner and
-- surfaces in the app as the "My Words" deck. The shared `words` catalog is
-- untouched — users add alongside it, never edit it (product rule).
-- Run with: wrangler d1 execute spanish3000 --remote --file=migrations/0002_user_words.sql

CREATE TABLE IF NOT EXISTS user_words (
  id          TEXT PRIMARY KEY,                 -- "mine-<ms>-<rand>"; doubles as the card id in the app
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  es          TEXT NOT NULL,
  en          TEXT NOT NULL,
  pos         TEXT,
  sentence_es TEXT,
  sentence_en TEXT,
  created_at  INTEGER NOT NULL,                 -- epoch ms
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_words_user ON user_words(user_id);
-- One entry per Spanish term per user (case-insensitive) to prevent duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_words_user_es ON user_words(user_id, es COLLATE NOCASE);
