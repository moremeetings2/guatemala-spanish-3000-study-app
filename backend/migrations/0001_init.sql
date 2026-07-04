-- Spanish 3000 API — initial schema.
-- Run with: wrangler d1 execute spanish3000 --remote --file=migrations/0001_init.sql

PRAGMA foreign_keys = ON;

-- User accounts. Passwords are stored as PBKDF2-SHA256 hash + per-user salt.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  created_at    INTEGER NOT NULL                -- epoch ms
);

-- Opaque session tokens. Only a SHA-256 hash of the token is stored, so a DB
-- leak does not expose usable tokens. The raw token lives on the client.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Flashcard content. One row per card across every deck. `synonyms` and `data`
-- hold JSON; `sentence_es`/`sentence_en` hold the example sentence.
CREATE TABLE IF NOT EXISTS words (
  id          TEXT PRIMARY KEY,
  deck        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'word',    -- 'word' | 'phrase' | 'bonus'
  band        TEXT,                            -- '1K' | '2K' | '3K' | null
  rank        INTEGER,
  es          TEXT NOT NULL,
  en          TEXT NOT NULL,
  pos         TEXT,
  synonyms    TEXT,                            -- JSON array of strings
  sentence_es TEXT,
  sentence_en TEXT,
  data        TEXT,                            -- JSON blob of deck-specific extras
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_words_deck ON words(deck);

-- Per-user spaced-repetition progress. Mirrors the client's cardState shape.
CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id    TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'new',      -- 'new' | 'learning' | 'known'
  due        INTEGER,
  seen       INTEGER NOT NULL DEFAULT 0,       -- 0/1
  correct    INTEGER NOT NULL DEFAULT 0,
  wrong      INTEGER NOT NULL DEFAULT 0,
  weak       INTEGER NOT NULL DEFAULT 0,       -- 0/1
  star       INTEGER NOT NULL DEFAULT 0,       -- 0/1
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
