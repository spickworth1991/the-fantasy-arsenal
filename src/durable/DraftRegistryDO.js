// Durable Object that keeps the "master" draft registry in D1 fresh every ~15 seconds.
//
// Why:
// - Cloudflare Scheduled Triggers can't run every 15s.
// - DO alarms can. We use an alarm to poll Sleeper and write to D1.
// - Notifications (cron 1/min) and the UI (poll D1 15s) both read the same registry.
//
// DO binding name expected: DRAFT_REGISTRY (wrangler.toml)
// D1 binding expected: PUSH_DB (wrangler.toml / Cloudflare dashboard)

const TICK_MS = 15_000;

// Treat active drafts as stale after ~1 tick.
const ACTIVE_REFRESH_MS = 15_000;
const ACTIVE_PICK_RECONCILE_MS = 60_000;

// Pre-draft drafts can flip to drafting quickly.
// Keep this tight enough to notice the transition without requiring a UI visit.
const PRE_DRAFT_REFRESH_MS = 60 * 1000;

// Recheck other inactive drafts.
const INACTIVE_REFRESH_MS = 6 * 60 * 60 * 1000;
const COMPLETE_REFRESH_MS = 60 * 1000;
const COMPLETE_RECHECK_WINDOW_MS = 10 * 60 * 1000;


// Store per-draft scheduling metadata in DO storage so we don't write D1 when nothing changes.
// Key: meta:<draftId> -> { lastCheckedAt, lastStatus }
const META_PREFIX = "meta:";
const LAST_TICK_RESULT_KEY = "tick:last-result";

async function sleeperJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper fetch failed ${res.status} for ${url}`);
  return res.json();
}

// ------------------------------------------------------------
// Discovery: keep push_subscriptions.draft_ids_json fresh WITHOUT requiring a UI visit.
// Goal: sweep all subscribed usernames quickly but safely (bounded API calls).
// ------------------------------------------------------------
const DISCOVERY_TARGET_SWEEP_MS = 2 * 60 * 1000;
const DISCOVERY_MIN_BATCH = 10;
const DISCOVERY_MAX_BATCH = 60;
const DISCOVERY_CONCURRENCY = 6;
const USERID_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DISCOVERY_CURSOR_KEY = "discovery:cursor";

async function ensurePushSubscriptionsTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        subscription_json TEXT,
        draft_ids_json TEXT,
        username TEXT,
        league_count INTEGER,
        updated_at INTEGER,
        created_at INTEGER
      )`
    )
    .run();

  // Back-compat: add missing cols
  try {
    const info = await db.prepare(`PRAGMA table_info(push_subscriptions)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
    const add = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_subscriptions ADD COLUMN ${name} ${type}`).run();
      }
    };
    await add("subscription_json", "TEXT");
    await add("draft_ids_json", "TEXT");
    await add("username", "TEXT");
    await add("league_count", "INTEGER");
    await add("updated_at", "INTEGER");
    await add("created_at", "INTEGER");
  } catch {
    // ignore
  }
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const s = v == null ? "" : String(v);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function stableStringArray(arr) {
  return uniqStrings((arr || []).map((v) => String(v || "").trim()).filter(Boolean)).sort();
}

function parseStableStringArray(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? stableStringArray(parsed) : [];
  } catch {
    return [];
  }
}

async function getUserIdByUsername(username) {
  const u = String(username || "").trim();
  if (!u) return null;
  const data = await sleeperJson(`https://api.sleeper.app/v1/user/${encodeURIComponent(u)}`);
  return data?.user_id ? String(data.user_id) : null;
}

async function getUserLeaguesById(userId, seasonYear) {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const year = String(seasonYear || new Date().getFullYear());
  try {
    const leagues = await sleeperJson(`https://api.sleeper.app/v1/user/${uid}/leagues/nfl/${year}`);
    return Array.isArray(leagues) ? leagues : [];
  } catch {
    return [];
  }
}

async function seedRegistryFromLeagues(db, leagues, onlyDraftIdsSet) {
  const now = Date.now();
  const rows = Array.isArray(leagues) ? leagues : [];
  for (const lg of rows) {
    const draftId = lg?.draft_id != null ? String(lg.draft_id) : "";
    if (!draftId) continue;
    if (onlyDraftIdsSet && !onlyDraftIdsSet.has(draftId)) continue;

    const leagueId = lg?.league_id != null ? String(lg.league_id) : null;
    const leagueName = lg?.name != null ? String(lg.name) : null;
    const leagueAvatar = lg?.avatar != null ? String(lg.avatar) : null;
    const bestBall = lg?.settings?.best_ball ? 1 : 0;

    await db
      .prepare(
        `INSERT INTO push_draft_registry (
           draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
           last_picked, pick_count,
           draft_json, draft_order_json, slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
           teams, rounds, timer_sec, reversal_round,
           league_id, league_name, league_avatar, best_ball,
           current_pick, current_owner_name, next_owner_name, clock_ends_at,
           completed_at, updated_at
         ) VALUES (
           ?, 0, 'pre_draft', ?, NULL, NULL,
           NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL,
           ?, ?, ?, ?,
           NULL, NULL, NULL, NULL,
           NULL, ?
         )
         ON CONFLICT(draft_id) DO UPDATE SET
           league_id=COALESCE(excluded.league_id, push_draft_registry.league_id),
           league_name=CASE
             WHEN (push_draft_registry.league_name IS NULL OR push_draft_registry.league_name='') AND excluded.league_name IS NOT NULL
             THEN excluded.league_name ELSE push_draft_registry.league_name END,
           league_avatar=CASE
             WHEN (push_draft_registry.league_avatar IS NULL OR push_draft_registry.league_avatar='') AND excluded.league_avatar IS NOT NULL
             THEN excluded.league_avatar ELSE push_draft_registry.league_avatar END,
           best_ball=COALESCE(excluded.best_ball, push_draft_registry.best_ball),
           updated_at=?`
      )
      .bind(draftId, now, leagueId, leagueName, leagueAvatar, bestBall, now, now)
      .run();
  }
}

async function listDiscoveryUsernames(db, limit, afterUsername = "") {
  const cursor = String(afterUsername || "").trim().toLowerCase();
  const sql = cursor
    ? `SELECT DISTINCT lower(username) AS username
       FROM push_subscriptions
       WHERE username IS NOT NULL AND username != '' AND lower(username) > ?
       ORDER BY username ASC
       LIMIT ?`
    : `SELECT DISTINCT lower(username) AS username
       FROM push_subscriptions
       WHERE username IS NOT NULL AND username != ''
       ORDER BY username ASC
       LIMIT ?`;
  const stmt = db.prepare(sql);
  const res = cursor
    ? await stmt.bind(cursor, Number(limit || 0)).all()
    : await stmt.bind(Number(limit || 0)).all();
  return res?.results || [];
}

async function listDraftIdsForUsername(db, username) {
  const res = await db
    .prepare(`SELECT draft_ids_json FROM push_subscriptions WHERE lower(username)=lower(?)`)
    .bind(String(username))
    .all();
  const set = new Set();
  for (const r of res?.results || []) {
    try {
      const ids = JSON.parse(r.draft_ids_json || "[]");
      if (Array.isArray(ids)) ids.filter(Boolean).forEach((x) => set.add(String(x)));
    } catch {
      // ignore
    }
  }
  return Array.from(set);
}

async function syncDraftIdsForUsername(db, username, draftIds, leagueCount, now) {
  const targetIds = stableStringArray(draftIds);
  const targetJson = JSON.stringify(targetIds);
  const rows = await db
    .prepare(`SELECT endpoint, draft_ids_json FROM push_subscriptions WHERE lower(username)=lower(?)`)
    .bind(String(username))
    .all();

  const needsUpdate = (rows?.results || []).some((row) => {
    const existingJson = JSON.stringify(parseStableStringArray(row?.draft_ids_json));
    return existingJson !== targetJson;
  });

  if (!needsUpdate) return false;

  await db
    .prepare(
      `UPDATE push_subscriptions
       SET draft_ids_json=?, league_count=?, updated_at=?
       WHERE lower(username)=lower(?)`
    )
    .bind(targetJson, Number(leagueCount || 0), now, username)
    .run();

  return true;
}

async function discoveryBatch(env, state) {
  const db = env?.PUSH_DB;
  if (!db?.prepare) return { ok: false, discoveredDrafts: 0, discoveredUsers: 0 };

  await ensurePushSubscriptionsTable(db);

  const now = Date.now();
  const seasonYear = new Date().getFullYear();

  let userCount = 0;
  try {
    const c = await db
      .prepare(
        `SELECT COUNT(DISTINCT username) AS c
         FROM push_subscriptions
         WHERE username IS NOT NULL AND username != ''`
      )
      .first();
    userCount = Number(c?.c || 0);
  } catch {
    userCount = 0;
  }

  if (!userCount) return { ok: true, discoveredDrafts: 0, discoveredUsers: 0, userCount: 0 };

  const rawBatch = Math.ceil((userCount * TICK_MS) / DISCOVERY_TARGET_SWEEP_MS);
  const batchSize = Math.max(DISCOVERY_MIN_BATCH, Math.min(DISCOVERY_MAX_BATCH, rawBatch));

  let discoveryCursor = "";
  try {
    discoveryCursor = String((await state?.storage?.get(DISCOVERY_CURSOR_KEY)) || "").trim().toLowerCase();
  } catch {
    discoveryCursor = "";
  }

  let rows = await listDiscoveryUsernames(db, batchSize, discoveryCursor);
  if (rows.length < batchSize) {
    const seen = new Set(rows.map((row) => String(row?.username || "").trim().toLowerCase()).filter(Boolean));
    const wrapped = await listDiscoveryUsernames(db, batchSize - rows.length);
    for (const row of wrapped) {
      const username = String(row?.username || "").trim().toLowerCase();
      if (!username || seen.has(username)) continue;
      seen.add(username);
      rows.push({ username });
      if (rows.length >= batchSize) break;
    }
  }
  if (!rows.length) return { ok: true, discoveredDrafts: 0, discoveredUsers: 0, userCount };

  const getCachedUserId = async (username) => {
    const key = `uid:${String(username || "").toLowerCase().trim()}`;
    if (!key || key === "uid:") return null;

    try {
      const cached = await state?.storage?.get(key);
      const obj = cached && typeof cached === "object" ? cached : null;
      if (obj?.userId && obj?.ts && now - Number(obj.ts) < USERID_CACHE_TTL_MS) return String(obj.userId);
    } catch {
      // ignore
    }

    let userId = null;
    try {
      userId = await getUserIdByUsername(username);
    } catch {
      userId = null;
    }

    if (userId) {
      try {
        await state?.storage?.put(key, { userId, ts: now });
      } catch {
        // ignore
      }
    }
    return userId;
  };

  let discoveredUsers = 0;
  let discoveredDrafts = 0;

  const queue = rows.slice();
  const workers = Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, queue.length) }, () =>
    (async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) break;

        const username = String(row.username || "").trim();
        if (!username) continue;

        const existing = stableStringArray(await listDraftIdsForUsername(db, username));
        const existingSet = new Set(existing.map(String));

        const userId = await getCachedUserId(username);
        if (!userId) continue;

        const leagues = await getUserLeaguesById(userId, seasonYear);
        const leagueDraftIds = stableStringArray(leagues.map((lg) => lg?.draft_id).filter(Boolean));
        const combined = stableStringArray([...existing, ...leagueDraftIds]);

        const newOnes = combined.filter((id) => !existingSet.has(String(id)));
        if (newOnes.length) {
          discoveredUsers++;
          discoveredDrafts += newOnes.length;
          const only = new Set(newOnes.map(String));
          await seedRegistryFromLeagues(db, leagues, only);
        }

        if (newOnes.length) {
          await syncDraftIdsForUsername(db, username, combined, leagues.length, now);
        }
      }
    })()
  );

  await Promise.all(workers);

  try {
    const lastUsername = String(rows[rows.length - 1]?.username || "").trim().toLowerCase();
    if (lastUsername) await state?.storage?.put(DISCOVERY_CURSOR_KEY, lastUsername);
  } catch {
    // ignore
  }

  return { ok: true, discoveredDrafts, discoveredUsers, checkedUsers: rows.length, userCount };
}

// ------------------------------------------------------------
// Registry + Cache schema
// ------------------------------------------------------------

async function ensureDraftRegistryTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_draft_registry (
        draft_id TEXT PRIMARY KEY,
        active INTEGER,
        status TEXT,
        last_checked_at INTEGER,
        last_active_at INTEGER,
        last_inactive_at INTEGER,
        last_picked INTEGER,
        pick_count INTEGER,
        draft_json TEXT,
        draft_order_json TEXT,
        slot_to_roster_json TEXT,
        roster_names_json TEXT,
        roster_by_username_json TEXT,
        traded_pick_owner_json TEXT,
        teams INTEGER,
        rounds INTEGER,
        timer_sec INTEGER,
        reversal_round INTEGER,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT,
        best_ball INTEGER,
        current_pick INTEGER,
        current_owner_name TEXT,
        next_owner_name TEXT,
        clock_ends_at INTEGER,
        clock_remaining_ms INTEGER,
        completed_at INTEGER,
        updated_at INTEGER
      )`
    )
    .run();

  // Back-compat in case the table exists but is missing columns.
  try {
    const info = await db.prepare(`PRAGMA table_info(push_draft_registry)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
    const add = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_draft_registry ADD COLUMN ${name} ${type}`).run();
      }
    };
    await add("pick_count", "INTEGER");
    await add("draft_json", "TEXT");
    await add("draft_order_json", "TEXT");
    await add("slot_to_roster_json", "TEXT");
    await add("roster_names_json", "TEXT");
    await add("roster_by_username_json", "TEXT");
    await add("traded_pick_owner_json", "TEXT");
    await add("teams", "INTEGER");
    await add("rounds", "INTEGER");
    await add("timer_sec", "INTEGER");
    await add("reversal_round", "INTEGER");
    await add("league_id", "TEXT");
    await add("league_name", "TEXT");
    await add("league_avatar", "TEXT");
    await add("best_ball", "INTEGER");
    await add("completed_at", "INTEGER");
    await add("current_pick", "INTEGER");
    await add("current_owner_name", "TEXT");
    await add("next_owner_name", "TEXT");
    await add("clock_ends_at", "INTEGER");
    await add("clock_remaining_ms", "INTEGER");
    await add("updated_at", "INTEGER");
  } catch {
    // ignore
  }
}

async function ensureDraftCacheTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_draft_cache (
        draft_id TEXT PRIMARY KEY,
        last_picked INTEGER,
        pick_count INTEGER,
        pick_count_synced_last_picked INTEGER,
        last_picks_sync_at INTEGER,
        state_marker TEXT,
        pick_sync_state_marker TEXT,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT,
        slot_to_roster_json TEXT,
        roster_names_json TEXT,
        roster_by_username_json TEXT,
        traded_pick_owner_json TEXT,
        rounds INTEGER,
        timer_sec INTEGER,
        reversal_round INTEGER,
        context_updated_at INTEGER,
        updated_at INTEGER
      )`
    )
    .run();

  // Back-compat for cache table too.
  try {
    const info = await db.prepare(`PRAGMA table_info(push_draft_cache)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
    const add = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_draft_cache ADD COLUMN ${name} ${type}`).run();
      }
    };
    await add("slot_to_roster_json", "TEXT");
    await add("roster_names_json", "TEXT");
    await add("roster_by_username_json", "TEXT");
    await add("traded_pick_owner_json", "TEXT");
    await add("rounds", "INTEGER");
    await add("timer_sec", "INTEGER");
    await add("reversal_round", "INTEGER");
    await add("context_updated_at", "INTEGER");
    await add("league_id", "TEXT");
    await add("league_name", "TEXT");
    await add("league_avatar", "TEXT");
    await add("pick_count_synced_last_picked", "INTEGER");
    await add("last_picks_sync_at", "INTEGER");
    await add("state_marker", "TEXT");
    await add("pick_sync_state_marker", "TEXT");
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------
// Batch helpers + diffing
// ------------------------------------------------------------

function chunks(arr, size) {
  const a = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

async function loadRegistryRowsMap(db, draftIds) {
  const ids = (draftIds || []).map(String).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;

  for (const group of chunks(ids, 80)) {
    const qs = group.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT draft_id, active, status,
                last_checked_at, last_active_at, last_inactive_at,
                last_picked, pick_count,
                draft_order_json, draft_json,
                slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
                teams, rounds, timer_sec, reversal_round,
                league_id, league_name, league_avatar, best_ball,
                current_pick, current_owner_name, next_owner_name, clock_ends_at, clock_remaining_ms,
                completed_at, updated_at
         FROM push_draft_registry
         WHERE draft_id IN (${qs})`
      )
      .bind(...group)
      .all();
    for (const r of res?.results || []) {
      if (r?.draft_id) map.set(String(r.draft_id), r);
    }
  }
  return map;
}

async function loadCacheRowsMap(db, draftIds) {
  const ids = (draftIds || []).map(String).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;

  for (const group of chunks(ids, 80)) {
    const qs = group.map(() => "?").join(",");
    const res = await db
      .prepare(`SELECT * FROM push_draft_cache WHERE draft_id IN (${qs})`)
      .bind(...group)
      .all();
    for (const r of res?.results || []) {
      if (r?.draft_id) map.set(String(r.draft_id), r);
    }
  }
  return map;
}

function jsonStable(v) {
  if (v == null) return null;
  const s = String(v);
  if (!s || s === "null" || s === "undefined") return null;
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return s;
  }
}

function same(a, b) {
  const aa = a == null ? null : a;
  const bb = b == null ? null : b;
  return aa === bb;
}

function buildPickSyncMarker({ status, lastPicked, pickCount, currentPick, currentOwnerName }) {
  return [
    String(status || ""),
    String(lastPicked == null ? "" : Number(lastPicked)),
    String(pickCount == null ? "" : Number(pickCount)),
    String(currentPick == null ? "" : Number(currentPick)),
    String(currentOwnerName || ""),
  ].join("|");
}

function shouldWriteRow(cur, patch) {
  if (!patch || typeof patch !== "object") return false;
  for (const k of Object.keys(patch)) {
    const a = cur?.[k];
    const b = patch[k];
    if (k.endsWith("_json")) {
      if (jsonStable(a) !== jsonStable(b)) return true;
    } else if (!same(a, b)) {
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------
// Load/save helpers
// ------------------------------------------------------------

async function loadDraftCache(db, draftId) {
  return (
    (await db.prepare(`SELECT * FROM push_draft_cache WHERE draft_id=?`).bind(String(draftId)).first()) ||
    null
  );
}



async function getDraft(draftId) {
  return sleeperJson(`https://api.sleeper.app/v1/draft/${draftId}`);
}

async function getPickCount(draftId) {
  const picks = await sleeperJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
  return Array.isArray(picks) ? picks.length : 0;
}

async function getPickCountWithRetry(draftId, attempts = 2) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await getPickCount(draftId);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('pick-count-sync-failed');
}

async function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function getLeague(leagueId) {
  if (!leagueId) return null;
  try {
    return await sleeperJson(`https://api.sleeper.app/v1/league/${leagueId}`);
  } catch {
    return null;
  }
}

function toLeagueAvatarUrl(avatarId) {
  return avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null;
}

function coerceJsonStr(v) {
  const s = v == null ? "" : String(v);
  if (!s || s === "null" || s === "undefined") return null;

  // Treat empty JSON containers as missing so we can re-hydrate.
  // Prevents the "{} means present" bug that leaves registry fields empty forever.
  try {
    const j = JSON.parse(s);
    if (j && typeof j === "object") {
      if (Array.isArray(j)) return j.length ? s : null;
      return Object.keys(j).length ? s : null;
    }
  } catch {
    // ignore
  }

  return s;
}

async function listUniqueDraftIdsFromSubs(db) {
  const rows = await db
    .prepare(`SELECT draft_ids_json FROM push_subscriptions WHERE draft_ids_json IS NOT NULL`)
    .all();
  const set = new Set();
  for (const r of rows?.results || []) {
    try {
      const ids = JSON.parse(r.draft_ids_json || "[]");
      if (Array.isArray(ids)) ids.filter(Boolean).forEach((x) => set.add(String(x)));
    } catch {
      // ignore
    }
  }
  return Array.from(set);
}

// Draft Monitor can register drafts into push_draft_registry even if nobody has alerts enabled.
async function listUniqueDraftIdsFromRegistry(db) {
  try {
    const rows = await db.prepare(`SELECT draft_id FROM push_draft_registry`).all();
    const set = new Set();
    for (const r of rows?.results || []) {
      if (r?.draft_id) set.add(String(r.draft_id));
    }
    return Array.from(set);
  } catch {
    return [];
  }
}

async function listUniqueDraftIds(db) {
  const [subs, reg] = await Promise.all([listUniqueDraftIdsFromSubs(db), listUniqueDraftIdsFromRegistry(db)]);
  return Array.from(new Set([...(subs || []), ...(reg || [])]));
}


function buildUpsertRegistryStmt(db, draftId, cur, patch) {
  const now = Date.now();
  const next = { ...(cur || {}), ...(patch || {}), draft_id: String(draftId), updated_at: now };

  return db
    .prepare(
      `INSERT INTO push_draft_registry (
        draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
        last_picked, pick_count,
        draft_json, draft_order_json,
        slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
        teams, rounds, timer_sec, reversal_round,
        league_id, league_name, league_avatar, best_ball,
        current_pick, current_owner_name, next_owner_name, clock_ends_at, clock_remaining_ms,
        completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        active=excluded.active,
        status=excluded.status,
        last_checked_at=COALESCE(excluded.last_checked_at, push_draft_registry.last_checked_at),
        last_active_at=excluded.last_active_at,
        last_inactive_at=excluded.last_inactive_at,
        last_picked=excluded.last_picked,
        pick_count=excluded.pick_count,
        draft_json=excluded.draft_json,
        draft_order_json=excluded.draft_order_json,
        slot_to_roster_json=COALESCE(excluded.slot_to_roster_json, push_draft_registry.slot_to_roster_json),
        roster_names_json=COALESCE(excluded.roster_names_json, push_draft_registry.roster_names_json),
        roster_by_username_json=COALESCE(excluded.roster_by_username_json, push_draft_registry.roster_by_username_json),
        traded_pick_owner_json=COALESCE(excluded.traded_pick_owner_json, push_draft_registry.traded_pick_owner_json),
        teams=excluded.teams,
        rounds=COALESCE(excluded.rounds, push_draft_registry.rounds),
        timer_sec=excluded.timer_sec,
        reversal_round=COALESCE(excluded.reversal_round, push_draft_registry.reversal_round),
        league_id=COALESCE(excluded.league_id, push_draft_registry.league_id),
        league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
        league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
        best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
        current_pick=excluded.current_pick,
        current_owner_name=excluded.current_owner_name,
        next_owner_name=excluded.next_owner_name,
        clock_ends_at=excluded.clock_ends_at,
        clock_remaining_ms=excluded.clock_remaining_ms,
        completed_at=COALESCE(push_draft_registry.completed_at, excluded.completed_at),
        updated_at=excluded.updated_at`
    )
    .bind(
      String(draftId),
      next.active ?? 0,
      String(next.status || ""),
      // scheduling is DO-storage-driven now; only write if patch sets it
      patch?.last_checked_at ?? null,
      next.active ? now : (Number(cur?.last_active_at || 0) || null),
      !next.active ? now : (Number(cur?.last_inactive_at || 0) || null),
      next.last_picked ?? null,
      next.pick_count ?? null,
      next.draft_json ?? null,
      next.draft_order_json ?? null,
      next.slot_to_roster_json ?? null,
      next.roster_names_json ?? null,
      next.roster_by_username_json ?? null,
      next.traded_pick_owner_json ?? null,
      next.teams ?? null,
      next.rounds ?? null,
      next.timer_sec ?? null,
      next.reversal_round ?? null,
      next.league_id ?? null,
      next.league_name ?? null,
      next.league_avatar ?? null,
      next.best_ball ?? null,
      next.current_pick ?? null,
      next.current_owner_name ?? null,
      next.next_owner_name ?? null,
      next.clock_ends_at ?? null,
      next.clock_remaining_ms ?? null,
      next.completed_at ?? null,
      now
    );
}

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function getDraftSlotForPick({ pickNo, teams, reversalRound, draftType }) {
  if (!pickNo || !teams) return null;
  const idx0 = pickNo - 1;
  const round = Math.floor(idx0 / teams) + 1;
  const pickInRound0 = idx0 % teams;
  const normalizedType = String(draftType || "snake").toLowerCase();

  if (normalizedType === "linear") {
    return { round, slot: pickInRound0 + 1 };
  }

  const rr = safeNum(reversalRound);
  let forward = true;
  if (round > 1) {
    for (let r = 2; r <= round; r++) {
      if (rr > 0 && r === rr) {
        // skip flip on reversal round (3RR)
      } else {
        forward = !forward;
      }
    }
  }

  const slot = forward ? pickInRound0 + 1 : teams - pickInRound0;
  return { round, slot };
}

function resolveRosterForPick({ pickNo, teams, slotToRoster, tradedPickOwners, seasonStr, reversalRound, draftType }) {
  const rs = getDraftSlotForPick({ pickNo, teams, reversalRound, draftType });
  if (!rs) return null;
  const origRosterId = slotToRoster?.[String(rs.slot)] || slotToRoster?.[rs.slot] || null;
  if (!origRosterId) return null;
  const traded = tradedPickOwners?.[`${seasonStr}|${rs.round}|${String(origRosterId)}`] || null;
  return traded || String(origRosterId);
}

// ------------------------------------------------------------
// Tick
// ------------------------------------------------------------

async function tickOnce(env, state, options = {}) {
  const forceActive = !!options?.forceActive;
  const forceAll = !!options?.forceAll;

  const db = env?.PUSH_DB;
  if (!db?.prepare) return { ok: false, error: "PUSH_DB binding not found" };

  await ensureDraftRegistryTable(db);
  await ensureDraftCacheTable(db);

  // Discovery runs each tick (bounded) so alerts don't depend on a UI visit.
  let discoveryResult = { ok: true, discoveredDrafts: 0, discoveredUsers: 0, checkedUsers: 0, userCount: 0 };
  try {
    discoveryResult = (await discoveryBatch(env, state)) || discoveryResult;
  } catch {
    // discovery should never block registry updates
  }

  const now = Date.now();
  const uniqueDraftIds = await listUniqueDraftIds(db);
  if (!uniqueDraftIds.length) return { ok: true, drafts: 0, active: 0, updated: 0 };

  // Batch-load D1 rows.
  const [registryMap, cacheMap] = await Promise.all([
    loadRegistryRowsMap(db, uniqueDraftIds),
    loadCacheRowsMap(db, uniqueDraftIds),
  ]);

  // Load DO metadata for scheduling.
  const metaKeys = uniqueDraftIds.map((id) => `${META_PREFIX}${String(id)}`);
  let metas = new Map();
  try {
    metas = await state.storage.get(metaKeys);
  } catch {
    metas = new Map();
  }

  // decide what needs to be checked this tick
  const toCheck = [];
  for (const draftId of uniqueDraftIds) {
    const id = String(draftId);
    const reg = registryMap.get(id) || null;
    const cacheRow = cacheMap.get(id) || null;
    const meta = (metas && typeof metas === "object") ? metas[`${META_PREFIX}${id}`] : null;
    const lastChecked = Number(meta?.lastCheckedAt || reg?.last_checked_at || 0);
    const wasActive = Number(reg?.active || 0) === 1;
    const statusLower = String(reg?.status || "").toLowerCase();
    const regLastPicked = Number.isFinite(Number(reg?.last_picked)) ? Number(reg.last_picked) : null;
    const cacheSyncedLastPicked = Number.isFinite(Number(cacheRow?.pick_count_synced_last_picked))
      ? Number(cacheRow.pick_count_synced_last_picked)
      : null;
    const pickCountKnown = Number.isFinite(Number(reg?.pick_count))
      ? Number(reg.pick_count)
      : (Number.isFinite(Number(cacheRow?.pick_count)) ? Number(cacheRow.pick_count) : null);
    const teamsKnown = Number.isFinite(Number(reg?.teams)) ? Number(reg.teams) : null;
    const roundsKnown = Number.isFinite(Number(reg?.rounds)) ? Number(reg.rounds) : null;
    const expectedTotalPicks = teamsKnown && roundsKnown ? teamsKnown * roundsKnown : 0;
    const completedAt = Number(reg?.completed_at || 0) || 0;
    const completeNeedsRecheck =
      statusLower === "complete" &&
      now - completedAt <= COMPLETE_RECHECK_WINDOW_MS &&
      (
        regLastPicked == null ||
        cacheSyncedLastPicked !== regLastPicked ||
        !Number.isFinite(pickCountKnown) ||
        (expectedTotalPicks > 0 && Number(pickCountKnown || 0) < expectedTotalPicks)
      );

    if (reg && statusLower === "complete" && !completeNeedsRecheck) continue;

    const staleMs = wasActive
      ? ACTIVE_REFRESH_MS
      : statusLower === "pre_draft"
      ? PRE_DRAFT_REFRESH_MS
      : statusLower === "complete"
      ? COMPLETE_REFRESH_MS
      : INACTIVE_REFRESH_MS;

    const needs = !lastChecked || now - lastChecked > staleMs;
    const shouldForce =
      forceAll ||
      (forceActive && (wasActive || statusLower === "drafting" || statusLower === "paused"));

    if (!reg || needs || shouldForce || completeNeedsRecheck) {
      toCheck.push({ draftId: id, wasActive, reg });
    }
  }

  let updated = 0;
  let active = 0;

  // Collect writes for batching.
  const registryWrites = [];
  const cacheWrites = new Map(); // draftId -> merged patch
  const metaWrites = new Map();

  const CONCURRENCY = 6;
  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const batch = toCheck.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async ({ draftId, wasActive, reg }) => {
        let draft;
        try {
          draft = await getDraft(draftId);
        } catch {
          if (wasActive) active++;
          return;
        }

        const status = String(draft?.status || "").toLowerCase();
        const isActive = status === "drafting" || status === "paused";
        if (isActive) active++;

        metaWrites.set(`${META_PREFIX}${draftId}`, { lastCheckedAt: now, lastStatus: status });

        const prevStatus = String(reg?.status || "").toLowerCase();
        const prevWasActive = prevStatus === "drafting" || prevStatus === "paused";
        const becameActive = isActive && !prevWasActive;

        const teams = Number(draft?.settings?.teams || 0) || null;
        const timerSec = Number(draft?.settings?.pick_timer || draft?.settings?.pick_timer_seconds || 0) || null;
        const rounds = Number(draft?.settings?.rounds || 0) || null;
        const reversalRound = Number(draft?.settings?.reversal_round || 0) || null;
        const leagueId = draft?.league_id || draft?.metadata?.league_id || null;

        const cacheRow = cacheMap.get(draftId) || null;

        const draftLastPicked = draft?.last_picked != null ? Number(draft.last_picked) : null;
        const lastPicked = draftLastPicked;
        const lastPickedEffective =
          draftLastPicked != null
            ? draftLastPicked
            : (Number.isFinite(Number(cacheRow?.last_picked)) ? Number(cacheRow.last_picked) : null);

        // ---------------------------------
        // pick_count sync (ONLY when last_picked moved and /picks not synced for that last_picked)
        // ---------------------------------
        let pickCount = Number(cacheRow?.pick_count);
        const cacheLastPicked = Number(cacheRow?.last_picked || 0);
        const cacheSyncedLastPicked = Number(cacheRow?.pick_count_synced_last_picked || 0);
        const cacheLastSyncAt = Number(cacheRow?.last_picks_sync_at || 0);
        const cacheSyncedStateMarker = String(cacheRow?.pick_sync_state_marker || "");
        const lastPickedNum = Number(draftLastPicked || 0);
        const prevRegistrySyncMarker = buildPickSyncMarker({
          status: prevStatus,
          lastPicked: reg?.last_picked,
          pickCount: reg?.pick_count,
          currentPick: reg?.current_pick,
          currentOwnerName: reg?.current_owner_name,
        });

        const expectedTotalPicks = teams && rounds ? Number(teams) * Number(rounds) : 0;
        const needsStateSync = prevRegistrySyncMarker !== cacheSyncedStateMarker;
        const staleActivePickSync =
          isActive &&
          (
            !Number.isFinite(cacheLastSyncAt) ||
            cacheLastSyncAt <= 0 ||
            now - cacheLastSyncAt >= ACTIVE_PICK_RECONCILE_MS
          );

        const needsLastPickedSync =
          lastPickedNum > 0 &&
          cacheSyncedLastPicked !== lastPickedNum;
        const wantsPickSync =
          (isActive || status === "complete") &&
          (!Number.isFinite(pickCount) || needsStateSync || needsLastPickedSync || staleActivePickSync);

        // Only force a sync when a pause transition itself matters, or when pick_count is missing.
        // Do NOT resync active drafts every kick/tick just because they're active.
        const forcePausedTransitionPickSync =
          status === "paused" &&
          (
            prevStatus !== "paused" ||
            !Number.isFinite(pickCount) ||
            cacheSyncedLastPicked !== lastPickedNum
          );

        // If a draft just resumed after being paused, we also want one reconciliation pass
        // in case picks moved during the pause window.
        const forceResumedTransitionPickSync =
          status === "drafting" &&
          prevStatus === "paused" &&
          (
            !Number.isFinite(pickCount) ||
            cacheSyncedLastPicked !== lastPickedNum
          );

        const forceCompletePickSync =
          status === "complete" &&
          (
            prevStatus !== "complete" ||
            !Number.isFinite(pickCount) ||
            (expectedTotalPicks > 0 && Number(pickCount || 0) < expectedTotalPicks)
          );

        // Only sync /picks when:
        // - we are missing pick_count
        // - Sleeper last_picked changed vs what we synced
        // - a pause/resume transition happened
        // - the draft just completed or still needs final reconciliation
        const canPickSync =
          wantsPickSync ||
          forcePausedTransitionPickSync ||
          forceResumedTransitionPickSync ||
          forceCompletePickSync;

              

        const stageCachePatch = (patch) => {
          const cur = cacheWrites.get(draftId) || {};
          cacheWrites.set(draftId, { ...cur, ...patch });
        };

        let nextSyncedLastPicked = cacheSyncedLastPicked;

        if (canPickSync) {
          try {
            pickCount = await getPickCountWithRetry(
              draftId,
              status === "paused" || prevStatus === "paused" ? 3 : 2
            );

            const prevPickCountKnown = Number.isFinite(Number(reg?.pick_count))
              ? Number(reg.pick_count)
              : (Number.isFinite(Number(cacheRow?.pick_count)) ? Number(cacheRow.pick_count) : null);
            const lastPickedNeedsSync = lastPickedNum > 0 && cacheSyncedLastPicked !== lastPickedNum;
            const lastPickedMoved = lastPickedNum > 0 && cacheLastPicked !== lastPickedNum;
            if (
              lastPickedNeedsSync &&
              prevPickCountKnown != null &&
              Number.isFinite(Number(pickCount)) &&
              Number(pickCount) <= prevPickCountKnown
            ) {
              try {
                await waitMs(750);
                const retryCount = await getPickCountWithRetry(
                  draftId,
                  status === "paused" || prevStatus === "paused" ? 2 : 1
                );
                if (Number.isFinite(Number(retryCount)) && Number(retryCount) > Number(pickCount)) {
                  pickCount = Number(retryCount);
                }
              } catch {
                // ignore
              }
            }

            const suspiciousPickSync =
              lastPickedNeedsSync &&
              prevPickCountKnown != null &&
              Number.isFinite(Number(pickCount)) &&
              Number(pickCount) <= prevPickCountKnown;
            const holdSyncedLastPickedOnce =
              (
                lastPickedNum > 0 &&
                cacheSyncedLastPicked !== lastPickedNum &&
                (
                  cacheLastPicked !== lastPickedNum ||
                  (
                    prevPickCountKnown != null &&
                    Number.isFinite(Number(pickCount)) &&
                    Number(pickCount) <= prevPickCountKnown
                  )
                )
              ) ||
              suspiciousPickSync;

            stageCachePatch({
              last_picked: lastPicked,
              pick_count: Number.isFinite(pickCount) ? pickCount : null,
              pick_count_synced_last_picked: holdSyncedLastPickedOnce
                ? (cacheSyncedLastPicked || null)
                : (lastPickedNum || null),
              last_picks_sync_at: now,
            });
            nextSyncedLastPicked = holdSyncedLastPickedOnce
              ? cacheSyncedLastPicked
              : lastPickedNum;
          } catch {
            // Still keep last_picked in cache if draft payload moved,
            // but do not write noisy sync timestamps by themselves.
            if (draftLastPicked != null && cacheLastPicked !== lastPickedNum) {
              stageCachePatch({
                last_picked: lastPicked,
              });
            }
          }
        } else if (draftLastPicked != null && cacheLastPicked !== lastPickedNum) {
          stageCachePatch({ last_picked: lastPicked });
        }

        // ---------------------------------
        // League meta (only if missing)
        // ---------------------------------
        let leagueName = reg?.league_name || cacheRow?.league_name || null;
        let leagueAvatarUrl = reg?.league_avatar || cacheRow?.league_avatar || null;
        let bestBall = reg?.best_ball;

        if (leagueId && (!leagueName || !leagueAvatarUrl || bestBall == null)) {
          const lg = await getLeague(String(leagueId));
          if (lg) {
            leagueName = leagueName || lg?.name || null;
            leagueAvatarUrl = leagueAvatarUrl || toLeagueAvatarUrl(lg?.avatar || null);
            bestBall = bestBall == null ? (Number(lg?.settings?.best_ball) ? 1 : 0) : bestBall;
            stageCachePatch({
              league_id: String(leagueId),
              league_name: leagueName,
              league_avatar: leagueAvatarUrl,
            });
          }
        }

        const completedAt =
          status === "complete"
            ? (Number(reg?.completed_at || 0) || now)
            : null;

        // ---------------------------------
        // Shared league context (only hydrate while ACTIVE)
        // ---------------------------------
        const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
        let lastContextAt = Number(cacheRow?.context_updated_at || 0) || 0;
        let contextStale = !lastContextAt || now - lastContextAt > CONTEXT_TTL_MS;

        let slotToRosterJson = coerceJsonStr(reg?.slot_to_roster_json) || coerceJsonStr(cacheRow?.slot_to_roster_json);
        let rosterNamesJson = coerceJsonStr(reg?.roster_names_json) || coerceJsonStr(cacheRow?.roster_names_json);
        let rosterByUsernameJson =
          coerceJsonStr(reg?.roster_by_username_json) || coerceJsonStr(cacheRow?.roster_by_username_json);
        let tradedPickOwnerJson =
          coerceJsonStr(reg?.traded_pick_owner_json) || coerceJsonStr(cacheRow?.traded_pick_owner_json);

        if (becameActive) {
          slotToRosterJson = null;
          rosterNamesJson = null;
          rosterByUsernameJson = null;
          tradedPickOwnerJson = null;
          lastContextAt = 0;
          contextStale = true;
        }

        let didHydrateRosterContext = false;

        const needsRosterContext = !slotToRosterJson || !rosterNamesJson || !rosterByUsernameJson;

        const forcePausedOwnerRefresh =
          status === "paused" &&
          (
            prevStatus !== "paused" ||
            cacheSyncedLastPicked !== lastPickedNum
          );

        const forceResumedOwnerRefresh =
          status === "drafting" &&
          prevStatus === "paused" &&
          cacheSyncedLastPicked !== lastPickedNum;

        const canHydrateRosterContext =
          Boolean(leagueId) &&
          isActive &&
          (
            needsRosterContext ||
            contextStale ||
            forcePausedOwnerRefresh ||
            forceResumedOwnerRefresh
          );
        if (canHydrateRosterContext) {
          try {
            const [users, rosters] = await Promise.all([
              sleeperJson(`https://api.sleeper.app/v1/league/${leagueId}/users`),
              sleeperJson(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
            ]);

            const ownerToName = new Map();
            for (const u of Array.isArray(users) ? users : []) {
              const nm = u?.display_name || u?.metadata?.team_name || u?.username || u?.user_id;
              if (u?.user_id) ownerToName.set(String(u.user_id), String(nm || u.user_id));
            }

            const rosterNames = {};
            for (const r of Array.isArray(rosters) ? rosters : []) {
              const rid = r?.roster_id != null ? String(r.roster_id) : "";
              if (!rid) continue;
              const nm = ownerToName.get(String(r?.owner_id)) || r?.owner_id || `Roster ${rid}`;
              rosterNames[rid] = String(nm);
            }

            const rosterByUsername = {};
            for (const u of Array.isArray(users) ? users : []) {
              const ownerId = String(u?.user_id || "");
              if (!ownerId) continue;

              const roster = (Array.isArray(rosters) ? rosters : []).find((x) => String(x?.owner_id) === ownerId);
              if (roster?.roster_id == null) continue;

              const rid = String(roster.roster_id);
              const u1 = String(u?.username || "").toLowerCase().trim();
              const u2 = String(u?.display_name || "").toLowerCase().trim();

              if (u1) rosterByUsername[u1] = rid;
              if (u2 && !rosterByUsername[u2]) rosterByUsername[u2] = rid;
            }

            const slotToRoster = {};
            const s2r = draft?.slot_to_roster_id || null;

            if (s2r && typeof s2r === "object") {
              for (const [slot, rid] of Object.entries(s2r)) {
                const s = Number(slot);
                if (!Number.isFinite(s) || s <= 0) continue;
                if (rid == null) continue;
                slotToRoster[String(s)] = String(rid);
              }
            } else {
              const ownerToRoster = new Map();
              for (const r of Array.isArray(rosters) ? rosters : []) {
                if (r?.owner_id != null && r?.roster_id != null) {
                  ownerToRoster.set(String(r.owner_id), String(r.roster_id));
                }
              }
              const draftOrder = draft?.draft_order || {};
              for (const [userId, slot] of Object.entries(draftOrder || {})) {
                const s = Number(slot);
                if (!Number.isFinite(s) || s <= 0) continue;
                const rid = ownerToRoster.get(String(userId));
                if (rid) slotToRoster[String(s)] = String(rid);
              }
            }

            rosterNamesJson = JSON.stringify(rosterNames);
            rosterByUsernameJson = JSON.stringify(rosterByUsername);
            slotToRosterJson = JSON.stringify(slotToRoster);

            if (
              Object.keys(rosterNames || {}).length > 0 &&
              Object.keys(rosterByUsername || {}).length > 0 &&
              Object.keys(slotToRoster || {}).length > 0
            ) {
              didHydrateRosterContext = true;
            }
          } catch {
            // ignore
          }
        }

        // traded_picks: only needed for on-clock owner resolution; hydrate only while ACTIVE.
        if (
          isActive &&
          Number(bestBall || 0) !== 1 &&
          leagueId &&
          (
            !tradedPickOwnerJson ||
            contextStale ||
            prevStatus === "paused" ||
            status === "paused"
          )
        ) {
          try {
            const traded = await sleeperJson(`https://api.sleeper.app/v1/draft/${draftId}/traded_picks`);
            const seasonStr = String(draft?.season || "");
            const best = new Map();
            for (let idx = 0; idx < (Array.isArray(traded) ? traded.length : 0); idx++) {
              const tp = traded[idx];
              const season = String(tp?.season ?? "");
              const round = Number(tp?.round || 0) || 0;
              const orig = String(tp?.roster_id ?? "");
              const owner = String(tp?.owner_id ?? "");
              if (!season || !round || !orig || !owner) continue;
              if (seasonStr && season !== seasonStr) continue;

              const key = `${season}|${round}|${orig}`;
              const score = Number(tp?.updated || tp?.created || 0) || 0;
              const prev = best.get(key);
              if (!prev || score > prev.score || (score === prev.score && idx > prev.idx)) {
                best.set(key, { owner, score, idx });
              }
            }
            const out = {};
            for (const [k, v] of best.entries()) out[k] = v.owner;
            tradedPickOwnerJson = JSON.stringify(out);
          } catch {
            // ignore
          }
        }

        stageCachePatch({
          slot_to_roster_json: slotToRosterJson,
          roster_names_json: rosterNamesJson,
          roster_by_username_json: rosterByUsernameJson,
          traded_pick_owner_json: Number(bestBall || 0) === 1 ? null : tradedPickOwnerJson,
          rounds,
          timer_sec: timerSec,
          reversal_round: reversalRound,
          context_updated_at: didHydrateRosterContext ? now : (lastContextAt || null),
        });

        // -------- computed convenience fields --------
        let currentPick = null;
        let currentOwnerName = null;
        let nextOwnerName = null;
        const prevPickCountKnown = Number.isFinite(Number(reg?.pick_count))
          ? Number(reg.pick_count)
          : (Number.isFinite(Number(cacheRow?.pick_count)) ? Number(cacheRow.pick_count) : null);
        const prevCurrentPick = Number.isFinite(Number(reg?.current_pick)) ? Number(reg.current_pick) : null;
        const prevCurrentOwnerName = reg?.current_owner_name != null ? String(reg.current_owner_name) : null;
        const prevNextOwnerName = reg?.next_owner_name != null ? String(reg.next_owner_name) : null;

        try {
          const pickCountNum = Number.isFinite(Number(pickCount)) ? Number(pickCount) : null;
          currentPick = status === "complete" ? null : (pickCountNum == null ? null : pickCountNum + 1);

          const slotToRoster = slotToRosterJson ? JSON.parse(slotToRosterJson) : null;
          const rosterNames = rosterNamesJson ? JSON.parse(rosterNamesJson) : null;
          const tradedOwners = tradedPickOwnerJson ? JSON.parse(tradedPickOwnerJson) : null;

          const seasonStr = String(draft?.season || "");
          const teamsNum = Number(teams || 0) || (slotToRoster ? Object.keys(slotToRoster).length : 0);

          if (currentPick != null && teamsNum > 0 && slotToRoster && rosterNames) {
            const draftType = String(draft?.type || "snake").toLowerCase();
            const ridCur = resolveRosterForPick({
              pickNo: currentPick,
              teams: teamsNum,
              slotToRoster,
              tradedPickOwners: tradedOwners,
              seasonStr,
              reversalRound: reversalRound || 0,
              draftType,
            });
            const ridNext = resolveRosterForPick({
              pickNo: currentPick + 1,
              teams: teamsNum,
              slotToRoster,
              tradedPickOwners: tradedOwners,
              seasonStr,
              reversalRound: reversalRound || 0,
              draftType,
            });

            currentOwnerName = rosterNames?.[String(ridCur)] || null;
            nextOwnerName = rosterNames?.[String(ridNext)] || null;
          }

          if (status === "complete") {
            currentOwnerName = null;
            nextOwnerName = null;
          }
        } catch {
          // ignore
        }

        const pickStateAlreadyPublished =
          prevPickCountKnown != null &&
          Number.isFinite(Number(pickCount)) &&
          Number(pickCount) === Number(prevPickCountKnown) &&
          prevCurrentPick != null &&
          currentPick != null &&
          Number(currentPick) === Number(prevCurrentPick) &&
          String(currentOwnerName || "") === String(prevCurrentOwnerName || "") &&
          String(nextOwnerName || "") === String(prevNextOwnerName || "");

        const lastPickedNeedsSync = lastPickedNum > 0 && nextSyncedLastPicked !== lastPickedNum;
        const lastPickedMoved = lastPickedNum > 0 && cacheLastPicked !== lastPickedNum;
        const suspiciousPickSync =
          lastPickedNeedsSync &&
          !pickStateAlreadyPublished &&
          status !== "complete" &&
          Number.isFinite(Number(pickCount)) &&
          (
            (prevPickCountKnown != null && Number(pickCount) <= prevPickCountKnown) ||
            (prevCurrentPick != null && currentPick != null && Number(currentPick) <= prevCurrentPick)
          );

        if (suspiciousPickSync) {
          stageCachePatch({
            pick_count_synced_last_picked: cacheSyncedLastPicked || null,
          });
          nextSyncedLastPicked = cacheSyncedLastPicked;
        }
        const nextSyncMarker = buildPickSyncMarker({
          status,
          lastPicked: lastPickedEffective,
          pickCount: Number.isFinite(Number(pickCount)) ? Number(pickCount) : null,
          currentPick,
          currentOwnerName,
        });
        stageCachePatch({
          state_marker: nextSyncMarker,
          pick_sync_state_marker: suspiciousPickSync ? (cacheSyncedStateMarker || null) : nextSyncMarker,
        });

        const prevPublishedLastPicked = Number.isFinite(Number(reg?.last_picked))
          ? Number(reg.last_picked)
          : (cacheSyncedLastPicked > 0 ? cacheSyncedLastPicked : null);
        const publishSyncedPickState =
          lastPickedNum <= 0 || nextSyncedLastPicked === lastPickedNum;
        const publishedLastPicked = publishSyncedPickState
          ? lastPickedEffective
          : prevPublishedLastPicked;
        const publishedPickCount = publishSyncedPickState
          ? (Number.isFinite(Number(pickCount)) ? Number(pickCount) : null)
          : (Number.isFinite(Number(reg?.pick_count))
              ? Number(reg.pick_count)
              : (Number.isFinite(Number(cacheRow?.pick_count)) ? Number(cacheRow.pick_count) : null));
        const publishedCurrentPick = publishSyncedPickState
          ? currentPick
          : (Number.isFinite(Number(reg?.current_pick)) ? Number(reg.current_pick) : null);
        const publishedCurrentOwnerName = publishSyncedPickState
          ? currentOwnerName
          : (reg?.current_owner_name != null ? String(reg.current_owner_name) : null);
        const publishedNextOwnerName = publishSyncedPickState
          ? nextOwnerName
          : (reg?.next_owner_name != null ? String(reg.next_owner_name) : null);
        const prevClockEndsAt = Number.isFinite(Number(reg?.clock_ends_at))
          ? Number(reg.clock_ends_at)
          : null;
        const prevClockRemainingMs = Number.isFinite(Number(reg?.clock_remaining_ms))
          ? Number(reg.clock_remaining_ms)
          : null;
        const rawClockEndsAt =
          publishedLastPicked != null && timerSec
            ? Number(publishedLastPicked) + Number(timerSec) * 1000
            : null;
        let clockEndsAt = null;
        let clockRemainingMs = null;

        if (status === "complete") {
          clockEndsAt = null;
          clockRemainingMs = null;
        } else if (status === "paused") {
          let frozenRemainingMs = null;

          if (prevStatus === "paused" && prevClockRemainingMs != null) {
            frozenRemainingMs = Math.max(0, prevClockRemainingMs);
          } else if (prevClockEndsAt != null) {
            frozenRemainingMs = Math.max(0, prevClockEndsAt - now);
          } else if (rawClockEndsAt != null) {
            frozenRemainingMs = Math.max(0, rawClockEndsAt - now);
          }

          clockEndsAt = null;
          clockRemainingMs = frozenRemainingMs;
        } else {
          clockEndsAt = rawClockEndsAt;
          clockRemainingMs = null;
        }

        const registryPatch = {
          active: isActive ? 1 : 0,
          status,
          last_picked: publishedLastPicked,
          pick_count: publishedPickCount,
          slot_to_roster_json: slotToRosterJson,
          roster_names_json: rosterNamesJson,
          roster_by_username_json: rosterByUsernameJson,
          traded_pick_owner_json: Number(bestBall || 0) === 1 ? null : tradedPickOwnerJson,
          teams,
          rounds,
          timer_sec: timerSec,
          reversal_round: reversalRound,
          league_id: leagueId ? String(leagueId) : null,
          league_name: leagueName,
          league_avatar: leagueAvatarUrl,
          best_ball: bestBall == null ? null : Number(bestBall),
          current_pick: publishedCurrentPick,
          current_owner_name: publishedCurrentOwnerName,
          next_owner_name: publishedNextOwnerName,
          clock_ends_at: clockEndsAt,
          clock_remaining_ms: clockRemainingMs,
          completed_at: completedAt,
        };

        const regCur = reg || registryMap.get(draftId) || null;
        const changed = shouldWriteRow(regCur, registryPatch);
        if (changed) {
          registryPatch.draft_json = JSON.stringify(draft || {});
          registryPatch.draft_order_json = draft?.draft_order ? JSON.stringify(draft.draft_order) : null;

          registryWrites.push(buildUpsertRegistryStmt(db, draftId, regCur, registryPatch));
          registryMap.set(draftId, { ...(regCur || {}), ...registryPatch, draft_id: draftId, updated_at: now });
          updated++;
        }
      })
    );
  }

  // Persist DO scheduling metadata.
  try {
    if (metaWrites.size) await state.storage.put(metaWrites);
  } catch {
    // ignore
  }

  // Flush cache writes (batched)
  let cacheWriteCount = 0;
  if (cacheWrites.size) {
    const stmts = [];
    for (const [draftId, patch] of cacheWrites.entries()) {
      const cur = cacheMap.get(draftId) || (await loadDraftCache(db, draftId)) || {};
      const next = { ...cur, ...patch, draft_id: String(draftId), updated_at: now };
      if (!shouldWriteRow(cur, patch)) continue;
      stmts.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO push_draft_cache (
              draft_id,
              last_picked, pick_count,
              pick_count_synced_last_picked,
              last_picks_sync_at,
              state_marker,
              pick_sync_state_marker,
              league_id, league_name, league_avatar,
              slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
              rounds, timer_sec, reversal_round,
              context_updated_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            next.draft_id,
            next.last_picked ?? null,
            next.pick_count ?? null,
            next.pick_count_synced_last_picked ?? null,
            next.last_picks_sync_at ?? null,
            next.state_marker ?? null,
            next.pick_sync_state_marker ?? null,
            next.league_id ?? null,
            next.league_name ?? null,
            next.league_avatar ?? null,
            next.slot_to_roster_json ?? null,
            next.roster_names_json ?? null,
            next.roster_by_username_json ?? null,
            next.traded_pick_owner_json ?? null,
            next.rounds ?? null,
            next.timer_sec ?? null,
            next.reversal_round ?? null,
            next.context_updated_at ?? null,
            next.updated_at
          )
      );
      cacheMap.set(draftId, next);
    }
    cacheWriteCount = stmts.length;

    for (const group of chunks(stmts, 40)) {
      try {
        await db.batch(group);
      } catch {
        for (const s of group) {
          try {
            await s.run();
          } catch {
            // ignore
          }
        }
      }
    }
  }

  // Flush registry writes (batched)
  const registryWriteCount = registryWrites.length;
  if (registryWrites.length) {
    for (const group of chunks(registryWrites, 40)) {
      try {
        await db.batch(group);
      } catch {
        for (const s of group) {
          try {
            await s.run();
          } catch {
            // ignore
          }
        }
      }
    }
  }

  const result = {
    ok: true,
    drafts: uniqueDraftIds.length,
    active,
    updated,
    checked: toCheck.length,
    registryWriteCount,
    cacheWriteCount,
    discovery: discoveryResult,
  };

  try {
    await state.storage.put(LAST_TICK_RESULT_KEY, { ...result, ts: Date.now() });
  } catch {
    // ignore
  }

  return result;
}

export class DraftRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async alarm() {
    try {
      await tickOnce(this.env, this.state);
    } finally {
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/tick") {
      const result = await tickOnce(this.env, this.state);
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/kick") {
      const result = await tickOnce(this.env, this.state, { forceActive: true });
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/stats") {
      const result = (await this.state.storage.get(LAST_TICK_RESULT_KEY)) || null;
      return new Response(JSON.stringify({ ok: true, lastTick: result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  }
}
