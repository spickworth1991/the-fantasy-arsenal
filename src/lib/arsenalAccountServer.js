import { getRequestContext } from "@cloudflare/next-on-pages";

const schemaReady = new WeakMap();

export function arsenalEnv() {
  try {
    return getRequestContext()?.env || {};
  } catch {
    return {};
  }
}

export function arsenalDb() {
  const env = arsenalEnv();
  return env.ARSENAL_DB || env.PUSH_DB || null;
}

export async function ensureArsenalSchema(db) {
  if (!db?.prepare) throw new Error("ARSENAL_DB (or PUSH_DB) D1 binding is not configured.");
  if (schemaReady.has(db)) return schemaReady.get(db);
  const ready = (async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_accounts (
    account_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    sleeper_username TEXT,
    display_name TEXT,
    bio TEXT,
    avatar_type TEXT NOT NULL DEFAULT 'stock',
    avatar_value TEXT NOT NULL DEFAULT 'blitz',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_sync_items (
    account_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    item_value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, item_key)
  )`).run();
    for (const statement of [
      `ALTER TABLE arsenal_accounts ADD COLUMN login_name TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN password_hash TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN password_salt TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN favorite_team TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN fantasy_style TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN experience_level TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE arsenal_accounts ADD COLUMN leaderboard_visible INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_season INTEGER`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_wins INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_losses INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_ties INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_points_for REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_leagues INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE arsenal_accounts ADD COLUMN record_updated_at INTEGER`,
      `ALTER TABLE arsenal_accounts ADD COLUMN career_json TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN badges_json TEXT`,
      `ALTER TABLE arsenal_accounts ADD COLUMN public_sections_json TEXT`,
    ]) {
      try { await db.prepare(statement).run(); } catch {}
    }
    await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS arsenal_accounts_login
      ON arsenal_accounts(login_name COLLATE NOCASE) WHERE login_name IS NOT NULL`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS arsenal_sessions_account
      ON arsenal_sessions(account_id, last_seen_at)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS arsenal_sync_account_updated
    ON arsenal_sync_items(account_id, updated_at)`).run();
  })();
  schemaReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    schemaReady.delete(db);
    throw error;
  }
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export async function authenticateArsenal(request, db) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  let account = await db.prepare(`SELECT a.* FROM arsenal_accounts a
    JOIN arsenal_sessions s ON s.account_id=a.account_id WHERE s.token_hash=?`).bind(tokenHash).first();
  if (!account) account = await db.prepare(`SELECT * FROM arsenal_accounts WHERE token_hash=?`).bind(tokenHash).first();
  if (account) {
    db.prepare(`UPDATE arsenal_accounts SET last_seen_at=? WHERE account_id=?`).bind(Date.now(), account.account_id).run().catch(() => {});
    db.prepare(`UPDATE arsenal_sessions SET last_seen_at=? WHERE token_hash=?`).bind(Date.now(), tokenHash).run().catch(() => {});
  }
  return account || null;
}

export function publicAccount(account) {
  if (!account) return null;
  return {
    accountId: account.account_id,
    loginName: account.login_name || "",
    hasPassword: !!account.password_hash,
    sleeperUsername: account.sleeper_username || "",
    displayName: account.display_name || account.sleeper_username || "Arsenal Manager",
    bio: account.bio || "",
    avatarType: account.avatar_type || "stock",
    avatarValue: account.avatar_value || "blitz",
    favoriteTeam: account.favorite_team || "",
    fantasyStyle: account.fantasy_style || "balanced",
    experienceLevel: account.experience_level || "veteran",
    profilePublic: Number(account.profile_public ?? 1) === 1,
    leaderboardVisible: Number(account.leaderboard_visible ?? 1) === 1,
    record: {
      season:Number(account.record_season || 0),
      wins:Number(account.record_wins || 0),
      losses:Number(account.record_losses || 0),
      ties:Number(account.record_ties || 0),
      pointsFor:Number(account.record_points_for || 0),
      leagues:Number(account.record_leagues || 0),
      updatedAt:Number(account.record_updated_at || 0),
    },
    career:safeJson(account.career_json, null),
    badges:safeJson(account.badges_json, []),
    publicSections:safeJson(account.public_sections_json, { career:true, badges:true, trophies:true }),
    createdAt: Number(account.created_at || 0),
    updatedAt: Number(account.updated_at || 0),
  };
}

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function publicProfile(account) {
  const profile = publicAccount(account);
  if (!profile) return null;
  const { loginName, hasPassword, ...safeProfile } = profile;
  return safeProfile;
}

export function randomSecret(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name:"PBKDF2", hash:"SHA-256", salt:new TextEncoder().encode(String(salt)), iterations:100000 },
    material,
    256
  );
  return Array.from(new Uint8Array(bits)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(db, accountId) {
  const token = `tfa_${randomSecret(32)}`;
  await db.prepare(`INSERT INTO arsenal_sessions(token_hash, account_id, created_at, last_seen_at)
    VALUES (?, ?, ?, ?)`).bind(await sha256(token), accountId, Date.now(), Date.now()).run();
  return token;
}
