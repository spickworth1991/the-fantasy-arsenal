CREATE TABLE IF NOT EXISTS arsenal_accounts (
  account_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  sleeper_username TEXT,
  display_name TEXT,
  bio TEXT,
  avatar_type TEXT NOT NULL DEFAULT 'stock',
  avatar_value TEXT NOT NULL DEFAULT 'blitz',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  login_name TEXT,
  password_hash TEXT,
  password_salt TEXT,
  favorite_team TEXT,
  fantasy_style TEXT,
  experience_level TEXT,
  profile_public INTEGER NOT NULL DEFAULT 1,
  leaderboard_visible INTEGER NOT NULL DEFAULT 1,
  record_season INTEGER,
  record_wins INTEGER NOT NULL DEFAULT 0,
  record_losses INTEGER NOT NULL DEFAULT 0,
  record_ties INTEGER NOT NULL DEFAULT 0,
  record_points_for REAL NOT NULL DEFAULT 0,
  record_leagues INTEGER NOT NULL DEFAULT 0,
  record_updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS arsenal_accounts_login
  ON arsenal_accounts(login_name COLLATE NOCASE) WHERE login_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS arsenal_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS arsenal_sessions_account
  ON arsenal_sessions(account_id, last_seen_at);

CREATE TABLE IF NOT EXISTS arsenal_sync_items (
  account_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, item_key)
);

CREATE INDEX IF NOT EXISTS arsenal_sync_account_updated
  ON arsenal_sync_items(account_id, updated_at);
