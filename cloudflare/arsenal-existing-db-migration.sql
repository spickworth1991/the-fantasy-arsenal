-- Run this ONCE only when arsenal_accounts already exists from the original key-based account implementation.
ALTER TABLE arsenal_accounts ADD COLUMN login_name TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN password_hash TEXT;
ALTER TABLE arsenal_accounts ADD COLUMN password_salt TEXT;

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
