-- Run this ONCE only when arsenal_accounts already exists from the original key-based account implementation.
ALTER TABLE arsenal_accounts ADD COLUMN login_name TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN password_hash TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN password_salt TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN favorite_team TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN fantasy_style TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN experience_level TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE arsenal_accounts ADD COLUMN leaderboard_visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE arsenal_accounts ADD COLUMN record_season INTEGER;
ALTER TABLE arsenal_accounts ADD COLUMN record_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arsenal_accounts ADD COLUMN record_losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arsenal_accounts ADD COLUMN record_ties INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arsenal_accounts ADD COLUMN record_points_for REAL NOT NULL DEFAULT 0;
ALTER TABLE arsenal_accounts ADD COLUMN record_leagues INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arsenal_accounts ADD COLUMN record_updated_at INTEGER;

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
