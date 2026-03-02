// Durable Object that keeps the "master" draft registry in D1 fresh every ~15 seconds.
//
// Why:
// - Cloudflare Scheduled Triggers can't run every 15s.
// - DO alarms can. We use an alarm to poll Sleeper and write to D1.
// - Notifications (cron 1/min) and the UI (poll D1 15s) both read the same registry.
//
// DO binding name expected: DRAFT_REGISTRY (wrangler.toml)
// D1 binding expected: PUSH_DB (wrangler.toml / Cloudflare dashboard)

import { buildWebPushRequest } from "../lib/webpush";

const TICK_MS = 15_000;
const ACTIVE_REFRESH_MS = 20_000; // treat active drafts as stale after ~1 tick
const PRE_DRAFT_REFRESH_MS = 60 * 1000; // 1 minute
const INACTIVE_REFRESH_MS = 6 * 60 * 60 * 1000; // recheck other inactive drafts every 6h

// Critical: bound the amount of work per 15s alarm so the DO never falls behind as registry grows.
const MAX_DRAFTS_PER_TICK = 60;      // total drafts we will refresh per tick (across all statuses)
const MAX_ACTIVE_PER_TICK = 40;      // prioritize active drafts (drafting/paused)
const MAX_PREDRAFT_PER_TICK = 15;    // then pre_draft
// remainder (MAX_DRAFTS_PER_TICK - above) goes to inactive


// Discovery: keep push_subscriptions.draft_ids_json fresh without requiring a UI visit.
// Goal: sweep *all* subscribed usernames quickly but safely (bounded API calls).
// We refresh a small batch every tick, sized so we typically complete a full sweep
// in ~2 minutes (or as close as possible given caps).
const DISCOVERY_TARGET_SWEEP_MS = 2 * 60 * 1000;
const DISCOVERY_MIN_BATCH = 10;
const DISCOVERY_MAX_BATCH = 60;
const DISCOVERY_CONCURRENCY = 6;
const USERID_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// Notifications: run inside the DO so we don't need a separate cron poll.
// We still gate the *send* pass to avoid doing push work every 15s tick.
const NOTIFY_MIN_INTERVAL_MS = 30_000; // aim for 30s - 1m behind at worst


async function sleeperJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper fetch failed ${res.status} for ${url}`);
  return res.json();
}



async function ensurePushSubscriptionsTable(db) {
  // Minimal schema needed for discovery.
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

async function ensurePushClockStateTable(db) {
  // Match poll-and-notify schema exactly (column names included).
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_clock_state (
        endpoint TEXT,
        draft_id TEXT,
        pick_no INTEGER,
        last_status TEXT,
        sent_onclock INTEGER,
        sent_25 INTEGER,
        sent_50 INTEGER,
        sent_10min INTEGER,
        sent_urgent INTEGER,
        sent_final INTEGER,
        sent_paused INTEGER,
        sent_unpaused INTEGER,
        paused_remaining_ms INTEGER,
        paused_at_ms INTEGER,
        resume_clock_start_ms INTEGER,
        updated_at INTEGER,
        PRIMARY KEY (endpoint, draft_id)
      )`
    )
    .run();

  // Backfill missing columns safely if an older version exists.
  try {
    const info = await db.prepare(`PRAGMA table_info(push_clock_state)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));

    const add = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_clock_state ADD COLUMN ${name} ${type}`).run();
      }
    };

    await add("pick_no", "INTEGER");
    await add("last_status", "TEXT");
    await add("sent_onclock", "INTEGER");
    await add("sent_25", "INTEGER");
    await add("sent_50", "INTEGER");
    await add("sent_10min", "INTEGER");
    await add("sent_urgent", "INTEGER");
    await add("sent_final", "INTEGER");
    await add("sent_paused", "INTEGER");
    await add("sent_unpaused", "INTEGER");
    await add("paused_remaining_ms", "INTEGER");
    await add("paused_at_ms", "INTEGER");
    await add("resume_clock_start_ms", "INTEGER");
    await add("updated_at", "INTEGER");
  } catch {
    // ignore
  }
}

async function ensurePushTables(db) {
  await ensurePushSubscriptionsTable(db);
  await ensurePushClockStateTable(db);
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
  // Seed minimal league metadata for newly discovered drafts so the UI + notifier have names/avatars
  // even before a full hydrate occurs.
  const now = Date.now();
  const rows = Array.isArray(leagues) ? leagues : [];
  for (const lg of rows) {
    const draftId = lg?.draft_id != null ? String(lg.draft_id) : "";
    if (!draftId) continue;
    if (onlyDraftIdsSet && !onlyDraftIdsSet.has(draftId)) continue;

    const leagueId = lg?.league_id != null ? String(lg.league_id) : null;
    const leagueName = lg?.name != null ? String(lg.name) : null;
    const leagueAvatar = lg?.avatar != null ? toLeagueAvatarUrl(String(lg.avatar)) : null;
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
            WHEN excluded.league_name IS NOT NULL AND excluded.league_name != '' AND excluded.league_name != push_draft_registry.league_name
            THEN excluded.league_name
            ELSE push_draft_registry.league_name
          END,
          league_avatar=CASE
            WHEN excluded.league_avatar IS NOT NULL AND excluded.league_avatar != '' AND excluded.league_avatar != push_draft_registry.league_avatar
            THEN excluded.league_avatar
            ELSE push_draft_registry.league_avatar
          END,
           best_ball=COALESCE(excluded.best_ball, push_draft_registry.best_ball),
           updated_at=?`
      )
      .bind(
        draftId,
        now,
        leagueId,
        leagueName,
        leagueAvatar,
        bestBall,
        now,
        now
      )
      .run();
  }
}

async function listDiscoveryUsernames(db, limit) {
  // Sweep by username (not endpoint) so multiple devices for the same user stay in sync.
  // Use oldest updated_at across that username for fair ordering.
  const res = await db
    .prepare(
      `SELECT username, MIN(COALESCE(updated_at, 0)) AS oldest
       FROM push_subscriptions
       WHERE username IS NOT NULL AND username != ''
       GROUP BY username
       ORDER BY oldest ASC
       LIMIT ?`
    )
    .bind(Number(limit || 0))
    .all();
  return res?.results || [];
}

async function listDraftIdsForUsername(db, username) {
  const res = await db
    .prepare(`SELECT draft_ids_json FROM push_subscriptions WHERE username=?`)
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

  const rows = await listDiscoveryUsernames(db, batchSize);
  if (!rows.length) return { ok: true, discoveredDrafts: 0, discoveredUsers: 0, userCount };

  // Simple in-DO userId cache with TTL.
  const getCachedUserId = async (username) => {
    const key = `uid:${String(username || "").toLowerCase().trim()}`;
    if (!key || key === "uid:") return null;
    try {
      const cached = await state.storage.get(key);
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
        await state.storage.put(key, { userId, ts: now });
      } catch {
        // ignore
      }
    }
    return userId;
  };

  let discoveredUsers = 0;
  let discoveredDrafts = 0;

  const queue = rows.slice();
  const workers = Array.from(
    { length: Math.min(DISCOVERY_CONCURRENCY, queue.length) },
    () =>
      (async () => {
        while (queue.length) {
          const row = queue.shift();
          if (!row) break;
          const username = String(row.username || "").trim();
          if (!username) continue;

          const existing = await listDraftIdsForUsername(db, username);
          const existingSet = new Set(existing.map(String));

          const userId = await getCachedUserId(username);
          if (!userId) continue;

          const leagues = await getUserLeaguesById(userId, seasonYear);
          const leagueDraftIds = uniqStrings(leagues.map((lg) => lg?.draft_id).filter(Boolean));
          const combined = uniqStrings([...existing, ...leagueDraftIds]);

          const newOnes = combined.filter((id) => !existingSet.has(String(id)));
          if (newOnes.length) {
            discoveredUsers++;
            discoveredDrafts += newOnes.length;
            const only = new Set(newOnes.map(String));
            await seedRegistryFromLeagues(db, leagues, only);
          }

          // Update ALL endpoints for that username so devices stay in sync.
          await db
            .prepare(
              `UPDATE push_subscriptions
               SET draft_ids_json=?, league_count=?, updated_at=?
               WHERE username=?`
            )
            .bind(JSON.stringify(combined), Number(leagues.length || 0), now, username)
            .run();
        }
      })()
  );

  await Promise.all(workers);

  return { ok: true, discoveredDrafts, discoveredUsers, checkedUsers: rows.length, userCount };
}

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
    // computed columns (optional but helps UI)
    await add("current_pick", "INTEGER");
    await add("current_owner_name", "TEXT");
    await add("next_owner_name", "TEXT");
    await add("clock_ends_at", "INTEGER");
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
  } catch {
    // ignore
  }
}

async function loadDraftCache(db, draftId) {
  return (
    (await db.prepare(`SELECT * FROM push_draft_cache WHERE draft_id=?`).bind(String(draftId)).first()) ||
    null
  );
}

async function saveDraftCache(db, draftId, patch) {
  const now = Date.now();
  const cur = (await loadDraftCache(db, draftId)) || {};
  const next = { ...cur, ...patch, draft_id: String(draftId), updated_at: now };
  await db
    .prepare(
      `INSERT OR REPLACE INTO push_draft_cache (
        draft_id,
        last_picked, pick_count,
        league_id, league_name, league_avatar,
        slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
        rounds, timer_sec, reversal_round,
        context_updated_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      next.draft_id,
      next.last_picked ?? null,
      next.pick_count ?? null,
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
    .run();
  return next;
}

async function getDraft(draftId) {
  return sleeperJson(`https://api.sleeper.app/v1/draft/${draftId}`);
}

async function getPickCount(draftId) {
  const picks = await sleeperJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
  return Array.isArray(picks) ? picks.length : 0;
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
    // ignore parse failures
  }

  return s;
}



async function listDraftsToCheckPrioritized(db, now, opts = {}) {
  // We intentionally DO NOT scan every draft id and then do 1 query per draft.
  // Instead, we let D1 give us a bounded set of drafts that are most likely stale,
  // prioritized as: active -> pre_draft -> inactive.

  const activeCutoff = now - ACTIVE_REFRESH_MS;
  const preDraftCutoff = now - (opts?.forcePreDraft ? 60_000 : PRE_DRAFT_REFRESH_MS);
  const inactiveCutoff = now - INACTIVE_REFRESH_MS;

  const limitActive = Math.max(0, Math.min(MAX_ACTIVE_PER_TICK, MAX_DRAFTS_PER_TICK));
  const limitPre = Math.max(
    0,
    Math.min(MAX_PREDRAFT_PER_TICK, Math.max(0, MAX_DRAFTS_PER_TICK - limitActive))
  );
  const limitInactive = Math.max(0, MAX_DRAFTS_PER_TICK - limitActive - limitPre);

  // Helper to normalize results
  const norm = (rows) =>
    (rows || []).map((r) => ({
      draftId: String(r?.draft_id || ""),
      wasActive: Number(r?.active || 0) === 1,
      reg: r || null,
    })).filter((x) => x.draftId);

  // 1) ACTIVE: status drafting/paused, and stale by ACTIVE_REFRESH_MS
  const activeRes = await db
    .prepare(
      `SELECT
         draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
         last_picked, pick_count,
         draft_order_json, draft_json,
         slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
         teams, rounds, timer_sec, reversal_round,
         league_id, league_name, league_avatar, best_ball,
         current_pick, current_owner_name, next_owner_name, clock_ends_at,
         completed_at,
         updated_at
       FROM push_draft_registry
       WHERE status IN ('drafting','paused')
         AND (last_checked_at IS NULL OR last_checked_at < ?)
       ORDER BY COALESCE(last_checked_at, 0) ASC
       LIMIT ?`
    )
    .bind(activeCutoff, limitActive)
    .all();

  // 2) PRE-DRAFT: status pre_draft, stale by PRE_DRAFT_REFRESH_MS (or 60s if forcePreDraft)
  const preRes = await db
    .prepare(
      `SELECT
         draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
         last_picked, pick_count,
         draft_order_json, draft_json,
         slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
         teams, rounds, timer_sec, reversal_round,
         league_id, league_name, league_avatar, best_ball,
         current_pick, current_owner_name, next_owner_name, clock_ends_at,
         completed_at,
         updated_at
       FROM push_draft_registry
       WHERE status = 'pre_draft'
         AND (last_checked_at IS NULL OR last_checked_at < ?)
       ORDER BY COALESCE(last_checked_at, 0) ASC
       LIMIT ?`
    )
    .bind(preDraftCutoff, limitPre)
    .all();

  // 3) INACTIVE (but not complete): stale by INACTIVE_REFRESH_MS
  const inactiveRes = await db
    .prepare(
      `SELECT
         draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
         last_picked, pick_count,
         draft_order_json, draft_json,
         slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
         teams, rounds, timer_sec, reversal_round,
         league_id, league_name, league_avatar, best_ball,
         current_pick, current_owner_name, next_owner_name, clock_ends_at,
         completed_at,
         updated_at
       FROM push_draft_registry
       WHERE status IS NOT NULL
         AND status != 'complete'
         AND status NOT IN ('drafting','paused','pre_draft')
         AND (last_checked_at IS NULL OR last_checked_at < ?)
       ORDER BY COALESCE(last_checked_at, 0) ASC
       LIMIT ?`
    )
    .bind(inactiveCutoff, limitInactive)
    .all();

  const picked = [...norm(activeRes?.results), ...norm(preRes?.results), ...norm(inactiveRes?.results)];

  // De-dupe just in case (shouldn't happen, but safe)
  const seen = new Set();
  const out = [];
  for (const item of picked) {
    if (!item.draftId || seen.has(item.draftId)) continue;
    seen.add(item.draftId);
    out.push(item);
  }
  return out;
}

function chunkArray(arr, size) {
  const out = [];
  const a = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

async function getRegistryRowsForDraftIds(db, draftIds) {
  const ids = (draftIds || []).map(String).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;

  // Be safe with SQL placeholder limits by chunking.
  // 200 is conservative and keeps the SQL string sane.
  const CHUNK = 200;

  for (const batch of chunkArray(ids, CHUNK)) {
    const placeholders = batch.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
                last_picked, pick_count,
                draft_order_json, draft_json,
                slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
                teams, rounds, timer_sec, reversal_round,
                league_id, league_name, league_avatar, best_ball,
                current_pick, current_owner_name, next_owner_name, clock_ends_at,
                completed_at,
                updated_at
         FROM push_draft_registry
         WHERE draft_id IN (${placeholders})`
      )
      .bind(...batch)
      .all();

    for (const r of res?.results || []) {
      map.set(String(r.draft_id), r);
    }
  }

  return map;
}

async function getRegistryRow(db, draftId) {
  return (
    (await db
      .prepare(
        `SELECT draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
                last_picked, pick_count,
                draft_order_json, draft_json,
                slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
                teams, rounds, timer_sec, reversal_round,
                league_id, league_name, league_avatar, best_ball,
                current_pick, current_owner_name, next_owner_name, clock_ends_at,
		        completed_at,
		        updated_at
         FROM push_draft_registry
         WHERE draft_id=?`
      )
      .bind(String(draftId))
      .first()) || null
  );
}

async function upsertRegistry(db, draftId, patch) {
  const now = Date.now();
  const cur = (await getRegistryRow(db, draftId)) || {};
  const next = { ...cur, ...patch };

  const curActive = Number(cur?.active || 0) === 1;
  const nextActive = Number(next?.active || 0) === 1;

  // Only stamp these when the active flag transitions.
  const transitioned = curActive !== nextActive;

  const lastActiveAt =
    transitioned && nextActive
      ? now
      : (cur?.last_active_at != null ? Number(cur.last_active_at) : null);

  const lastInactiveAt =
    transitioned && !nextActive
      ? now
      : (cur?.last_inactive_at != null ? Number(cur.last_inactive_at) : null);

  await db
    .prepare(
      `INSERT INTO push_draft_registry (
        draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
        last_picked, pick_count,
        draft_json, draft_order_json,
        slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
        teams, rounds, timer_sec, reversal_round,
        league_id, league_name, league_avatar, best_ball,
        current_pick, current_owner_name, next_owner_name, clock_ends_at,
        completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        active=excluded.active,
        status=excluded.status,
        last_checked_at=excluded.last_checked_at,
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

        -- ✅ Fix 3: keep league name fresh if Sleeper changes it
        league_name=CASE
          WHEN excluded.league_name IS NOT NULL AND excluded.league_name != '' AND excluded.league_name != push_draft_registry.league_name
          THEN excluded.league_name
          ELSE push_draft_registry.league_name
        END,

        -- ✅ also keep avatar fresh if we have a value (safe + consistent)
        league_avatar=CASE
          WHEN excluded.league_avatar IS NOT NULL AND excluded.league_avatar != '' AND excluded.league_avatar != push_draft_registry.league_avatar
          THEN excluded.league_avatar
          ELSE push_draft_registry.league_avatar
        END,

        best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
        current_pick=COALESCE(excluded.current_pick, push_draft_registry.current_pick),
        current_owner_name=COALESCE(excluded.current_owner_name, push_draft_registry.current_owner_name),
        next_owner_name=COALESCE(excluded.next_owner_name, push_draft_registry.next_owner_name),
        clock_ends_at=COALESCE(excluded.clock_ends_at, push_draft_registry.clock_ends_at),
        completed_at=COALESCE(push_draft_registry.completed_at, excluded.completed_at),
        updated_at=excluded.updated_at`
    )
    .bind(
      String(draftId),
      nextActive ? 1 : 0,
      String(next.status || ""),
      now,
      lastActiveAt,
      lastInactiveAt,
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
      next.completed_at ?? null,
      now
    )
    .run();
}

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function getSnakeSlotForPick({ pickNo, teams, reversalRound }) {
  if (!pickNo || !teams) return null;
  const idx0 = pickNo - 1;
  const round = Math.floor(idx0 / teams) + 1;
  const pickInRound0 = idx0 % teams;

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

function resolveRosterForPick({ pickNo, teams, slotToRoster, tradedPickOwners, seasonStr, reversalRound }) {
  const rs = getSnakeSlotForPick({ pickNo, teams, reversalRound });
  if (!rs) return null;
  const origRosterId = slotToRoster?.[String(rs.slot)] || null;
  if (!origRosterId) return null;
  const traded = tradedPickOwners?.[`${seasonStr}|${rs.round}|${String(origRosterId)}`] || null;
  return traded || String(origRosterId);
}

// ---------------------------------------------------------------------------
// Notifications (moved into the DO)
// ---------------------------------------------------------------------------

function hashString(s) {
  const str = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickDeterministic(arr, seed) {
  const a = Array.isArray(arr) ? arr : [];
  if (!a.length) return null;
  const idx = hashString(seed) % a.length;
  return a[idx];
}

function formatTimeLeft(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function msToClock(ms) {
  const s = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  if (hh > 0) return `${hh}:${pad(mm)}:${pad(ss)}`;
  return `${mm}:${pad(ss)}`;
}

function stageLabel(stage) {
  switch (stage) {
    case "onclock": return "ON CLOCK";
    case "p25": return "25% used";
    case "p50": return "50% used";
    case "ten": return "10 min left";
    case "urgent": return "URGENT (<2 min)";
    case "final": return "FINAL";
    case "paused": return "PAUSED (your pick)";
    case "unpaused": return "RESUMED (your pick)";
    default: return "UPDATE";
  }
}

function buildMessage({ stage, leagueName, timeLeftText, timerSec }) {
  const baseSeed = `${stage}|${leagueName}|${timerSec}`;

  const ONCLOCK_TITLES = ["You're on the clock", "Your pick is up", "ON THE CLOCK", "Draft alert: your turn"];
  const ONCLOCK_BODIES = [
    `You're on the clock in "${leagueName}". Time left: ${timeLeftText}.`,
    `It's your pick in "${leagueName}". ${timeLeftText} remaining.`,
    `"${leagueName}" - you're up. Clock: ${timeLeftText}.`,
  ];

  const P25_TITLES = ["Clock check: 25% used", "Quick reminder", "Don't forget your pick"];
  const P25_BODIES = [
    `You've used ~25% of your clock in "${leagueName}". Don't forget to pick. (${timeLeftText} left)`,
    `"${leagueName}": 25% of your timer is gone. Make your pick when ready. (${timeLeftText} left)`,
    `Friendly nudge - "${leagueName}" clock is moving. (${timeLeftText} left)`,
  ];

  const P50_TITLES = ["Half your clock is gone", "You good?", "Still on the clock"];
  const P50_BODIES = [
    `You've used ~50% of your clock in "${leagueName}". Did you forget? (${timeLeftText} left)`,
    `"${leagueName}": halfway through your timer. Don't get auto-picked. (${timeLeftText} left)`,
    `Just checking - still your pick in "${leagueName}". (${timeLeftText} left)`,
  ];

  const TEN_TITLES = ["10 minutes left", "Seriously... 10 minutes left", "Final stretch"];
  const TEN_BODIES = [
    `Seriously - you only have 10 minutes left in "${leagueName}". Make your pick.`,
    `"${leagueName}": 10 minutes remaining. Lock it in.`,
    `10 minutes left on the clock in "${leagueName}". Don't get burned.`,
  ];

  const URGENT_TITLES = ["⚠️ URGENT: 2 minutes", "🚨 PICK NOW – 2 MIN", "⏱️ CLOCK CRITICAL", "🔥 LAST 2 MINUTES"];
  const URGENT_BODIES = [
    `🚨 "${leagueName}": under 2 minutes left (${timeLeftText}). Draft NOW.`,
    `⚠️ "${leagueName}" pick timer is about to expire (${timeLeftText}).`,
    `🔥 "${leagueName}": final moments (${timeLeftText}). Don't get auto-picked.`,
  ];

  const FINAL_TITLES = ["Almost out of time", "Last call", "Clock is dying"];
  const FINAL_BODIES = [
    `"${leagueName}": you're almost out of time. (${timeLeftText} left)`,
    `Last call - "${leagueName}" pick timer is almost done. (${timeLeftText} left)`,
    `Clock's about to expire in "${leagueName}". (${timeLeftText} left)`,
  ];

  // IMPORTANT: pause/unpause messages do NOT include time text.
  const PAUSED_TITLES = [
    "Draft paused - but it's your pick",
    "Paused... you're still up",
    "Paused, but you're on deck",
    "League paused (your pick next)",
  ];
  const PAUSED_BODIES = [
    `"${leagueName}" is paused, but it's still your pick.`,
    `Heads up - "${leagueName}" is paused, but you're the current pick.`,
    `"${leagueName}" paused. You're still on deck for the pick.`,
    `Paused in "${leagueName}" - you're still the pick when it resumes.`,
  ];

  const UNPAUSED_TITLES = ["Draft resumed - you're up", "Back on: your pick", "Unpaused... clock is running", "Draft unpaused (still your turn)"];
  const UNPAUSED_BODIES = [
    `"${leagueName}" resumed — it's still your pick.`,
    `Unpaused in "${leagueName}" — you're still up.`,
    `We're back. "${leagueName}" resumed and it's your pick.`,
    `"${leagueName}" unpaused — you're the current pick.`,
  ];

  const map = {
    onclock: { titles: ONCLOCK_TITLES, bodies: ONCLOCK_BODIES },
    p25: { titles: P25_TITLES, bodies: P25_BODIES },
    p50: { titles: P50_TITLES, bodies: P50_BODIES },
    ten: { titles: TEN_TITLES, bodies: TEN_BODIES },
    urgent: { titles: URGENT_TITLES, bodies: URGENT_BODIES },
    final: { titles: FINAL_TITLES, bodies: FINAL_BODIES },
    paused: { titles: PAUSED_TITLES, bodies: PAUSED_BODIES },
    unpaused: { titles: UNPAUSED_TITLES, bodies: UNPAUSED_BODIES },
  };

  const bucket = map[String(stage || "")] || map.onclock;
  const title = pickDeterministic(bucket.titles, `${baseSeed}|t`) || "Draft alert";
  const body = pickDeterministic(bucket.bodies, `${baseSeed}|b`) || "";
  return { title, body };
}

function buildSummaryMessage({ onClockRows, triggeredRows }) {
  // Always summarize if multiple leagues are on the clock OR multiple triggers fire.
  const urgentAny = (onClockRows || []).some((r) => Number(r?.remainingSec ?? Infinity) <= 120);
  const title = urgentAny ? "⚠️ URGENT" : "Draft alerts";

  const lines = [];
  const ordered = [...(onClockRows || [])].sort((a, b) => {
    const au = Number(a?.remainingSec ?? 9e9);
    const bu = Number(b?.remainingSec ?? 9e9);
    return au - bu;
  });

  for (const r of ordered) {
    const nm = r?.leagueName || "(league)";
    if (r?.status === "paused") {
      lines.push(`${nm} — PAUSED (still your pick)`);
    } else if (Number.isFinite(Number(r?.remainingSec))) {
      lines.push(`${nm} — ${formatTimeLeft(r.remainingSec)} left`);
    } else {
      lines.push(`${nm} — you're up`);
    }
  }

  // If the trigger was a pause/unpause, make that obvious at the top.
  const trigStages = new Set((triggeredRows || []).map((x) => String(x?.stage || "")));
  if (trigStages.has("paused")) lines.unshift("Paused: you're still on the clock");
  if (trigStages.has("unpaused")) lines.unshift("Resumed: clock is live");

  const body = lines.slice(0, 15).join("\n");
  return { title, body };
}

async function loadClockStatesForDraftIds(db, endpoint, draftIds) {
  const ep = String(endpoint || "");
  const ids = (draftIds || []).map(String).filter(Boolean);
  const map = new Map();
  if (!ep || !ids.length) return map;

  // Chunk to stay under any placeholder/SQL limits.
  const CHUNK = 200;

  for (const batch of chunkArray(ids, CHUNK)) {
    const placeholders = batch.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT draft_id,
                pick_no, last_status,
                sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final,
                sent_paused, sent_unpaused,
                paused_remaining_ms, paused_at_ms, resume_clock_start_ms
         FROM push_clock_state
         WHERE endpoint=?
           AND draft_id IN (${placeholders})`
      )
      .bind(ep, ...batch)
      .all();

    for (const r of res?.results || []) {
      map.set(String(r.draft_id), r);
    }
  }

  return map;
}

async function loadClockState(db, endpoint, draftId) {
  return (
    (await db
      .prepare(
        `SELECT pick_no, last_status,
                sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final,
                sent_paused, sent_unpaused,
                paused_remaining_ms, paused_at_ms, resume_clock_start_ms
         FROM push_clock_state
         WHERE endpoint=? AND draft_id=?`
      )
      .bind(String(endpoint), String(draftId))
      .first()) || null
  );
}

async function upsertClockState(db, endpoint, draftId, row) {
  const now = Date.now();
  const pickNo = Number(row?.pick_no || 0) || 0;
  console.log("🧠 UPSERT CLOCK STATE:", endpoint, draftId, {
    pick: row?.pick_no,
    status: row?.last_status
  });
  await db
    .prepare(
      `INSERT INTO push_clock_state
         (endpoint, draft_id, pick_no, last_status,
          sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final,
          sent_paused, sent_unpaused,
          paused_remaining_ms, paused_at_ms, resume_clock_start_ms,
          updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint, draft_id) DO UPDATE SET
         pick_no=excluded.pick_no,
         last_status=excluded.last_status,
         sent_onclock=excluded.sent_onclock,
         sent_25=excluded.sent_25,
         sent_50=excluded.sent_50,
         sent_10min=excluded.sent_10min,
         sent_urgent=excluded.sent_urgent,
         sent_final=excluded.sent_final,
         sent_paused=excluded.sent_paused,
         sent_unpaused=excluded.sent_unpaused,
         paused_remaining_ms=excluded.paused_remaining_ms,
         paused_at_ms=excluded.paused_at_ms,
         resume_clock_start_ms=excluded.resume_clock_start_ms,
         updated_at=excluded.updated_at`
    )
    .bind(
      String(endpoint),
      String(draftId),
      pickNo,
      String(row?.last_status || ""),
      Number(row?.sent_onclock || 0),
      Number(row?.sent_25 || 0),
      Number(row?.sent_50 || 0),
      Number(row?.sent_10min || 0),
      Number(row?.sent_urgent || 0),
      Number(row?.sent_final || 0),
      Number(row?.sent_paused || 0),
      Number(row?.sent_unpaused || 0),
      row?.paused_remaining_ms == null ? null : Number(row.paused_remaining_ms),
      row?.paused_at_ms == null ? null : Number(row.paused_at_ms),
      row?.resume_clock_start_ms == null ? null : Number(row.resume_clock_start_ms),
      now
    )
    .run();
}

async function clearClockState(db, endpoint, draftId) {
  await db
    .prepare(`DELETE FROM push_clock_state WHERE endpoint=? AND draft_id=?`)
    .bind(String(endpoint), String(draftId))
    .run();
}



async function sendPush(env, subscription, payload) {
  const vapidPrivateRaw = env?.VAPID_PRIVATE_KEY;
  const vapidSubject = env?.VAPID_SUBJECT;
  if (!vapidPrivateRaw || !vapidSubject) {
    console.log(
      "🚫 PUSH missing VAPID env vars",
      JSON.stringify({
        hasPrivate: Boolean(vapidPrivateRaw),
        hasSubject: Boolean(vapidSubject),
        subEndpoint: String(subscription?.endpoint || "").slice(0, 120),
        title: String(payload?.title || "").slice(0, 80),
        tag: String(payload?.tag || "").slice(0, 80),
      })
    );
    return { ok: false, error: "Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT" };
  }

  let vapidJwk = null;
  try {
    vapidJwk = JSON.parse(String(vapidPrivateRaw));
  } catch {
    console.log(
      "🚫 PUSH VAPID_PRIVATE_KEY parse failed",
      JSON.stringify({
        subEndpoint: String(subscription?.endpoint || "").slice(0, 120),
        title: String(payload?.title || "").slice(0, 80),
        tag: String(payload?.tag || "").slice(0, 80),
      })
    );
    return { ok: false, error: "VAPID_PRIVATE_KEY must be JSON JWK" };
  }

  let req;
  try {
    req = await buildWebPushRequest({
      subscription,
      vapid: { subject: String(vapidSubject), privateKeyJwk: vapidJwk },
      payload,
    });
  } catch (err) {
    console.log(
      "💥 PUSH buildWebPushRequest threw",
      JSON.stringify({
        err: String(err?.message || err),
        subEndpoint: String(subscription?.endpoint || "").slice(0, 120),
        title: String(payload?.title || "").slice(0, 80),
        tag: String(payload?.tag || "").slice(0, 80),
      })
    );
    return { ok: false, status: 0, error: String(err?.message || err) };
  }

  // buildWebPushRequest returns { endpoint, fetchInit }
  try {
    console.log(
      "🚀 SENDING PUSH",
      JSON.stringify({
        endpoint: String(req?.endpoint || "").slice(0, 160),
        subEndpoint: String(subscription?.endpoint || "").slice(0, 120),
        title: String(payload?.title || "").slice(0, 80),
        tag: String(payload?.tag || "").slice(0, 80),
      })
    );

    const res = await fetch(req.endpoint, req.fetchInit);
    const text = await res.text().catch(() => "");

    console.log(
      "🚀 PUSH RESPONSE",
      JSON.stringify({
        ok: Boolean(res.ok),
        status: Number(res.status || 0),
        endpoint: String(req?.endpoint || "").slice(0, 160),
        title: String(payload?.title || "").slice(0, 80),
        tag: String(payload?.tag || "").slice(0, 80),
        body: String(text || "").slice(0, 200),
      })
    );

    return { ok: Boolean(res.ok), status: Number(res.status || 0), error: res.ok ? null : String(text || "") };
  } catch (err) {
    console.log(
      "💥 PUSH FETCH THROW",
      JSON.stringify({
        err: String(err?.message || err),
        endpoint: String(req?.endpoint || "").slice(0, 160),
        subEndpoint: String(subscription?.endpoint || "").slice(0, 120),
        title: String(payload?.title || "").slice(0, 80),
        tag: String(payload?.tag || "").slice(0, 80),
      })
    );
    return { ok: false, status: 0, error: String(err?.message || err) };
  }
}

async function notifyFromRegistry(env, state, db) {
  console.log("📣 notifyFromRegistry START");
  await ensurePushTables(db);

  const now = Date.now();

  const rows = await db
    .prepare(
      `SELECT endpoint, subscription_json, username, draft_ids_json
       FROM push_subscriptions
       WHERE subscription_json IS NOT NULL AND subscription_json != ''
         AND username IS NOT NULL AND username != ''`
    )
    .all();

  console.log("📣 SUBS FOUND:", rows?.results?.length || 0);

  const subs = rows?.results || [];
  if (!subs.length) return { ok: true, subs: 0, sent: 0 };

  let sent = 0;

  for (const s of subs) {
    const endpoint = String(s?.endpoint || "");
    const username = String(s?.username || "").trim();
    if (!endpoint || !username) continue;

    let subscription = null;
    try { subscription = JSON.parse(String(s?.subscription_json || "")); } catch {}
    if (!subscription) continue;

    let draftIds = [];
    try { draftIds = JSON.parse(String(s?.draft_ids_json || "[]")); } catch {}
    if (!Array.isArray(draftIds) || !draftIds.length) continue;
    const regMap = await getRegistryRowsForDraftIds(db, draftIds);
    const clockMap = await loadClockStatesForDraftIds(db, endpoint, draftIds);
    const unameKey = username.toLowerCase().trim();

    const events = [];

    for (const draftIdRaw of draftIds) {
      const draftId = String(draftIdRaw || "");
      if (!draftId) continue;

      const reg = regMap.get(draftId);
      if (!reg) continue;

      const status = String(reg?.status || "").toLowerCase();
      if (status !== "drafting" && status !== "paused") {
        await clearClockState(db, endpoint, draftId);
        continue;
      }

      const nextPickNo = Number(reg?.current_pick || 0) || 0;
      if (!nextPickNo) continue;

      let rosterByUsername = null;
      let rosterNames = null;
      try {
        rosterByUsername = reg?.roster_by_username_json ? JSON.parse(String(reg.roster_by_username_json)) : null;
        rosterNames = reg?.roster_names_json ? JSON.parse(String(reg.roster_names_json)) : null;
      } catch {}

      const hasRosterCtx =
        rosterByUsername && typeof rosterByUsername === "object" && Object.keys(rosterByUsername).length > 0 &&
        rosterNames && typeof rosterNames === "object" && Object.keys(rosterNames).length > 0;

      if (!hasRosterCtx) {
        // registry not hydrated yet — skip but don't wipe state
        continue;
      }

      const userRosterId = rosterByUsername?.[unameKey] != null ? String(rosterByUsername[unameKey]) : null;
      const userRosterName = userRosterId ? String(rosterNames?.[userRosterId] || "") : "";

      const currentOwnerName = String(reg?.current_owner_name || "");
      const isOnClock = Boolean(userRosterName) && Boolean(currentOwnerName) && userRosterName === currentOwnerName;

      if (!isOnClock) {
        await clearClockState(db, endpoint, draftId);
        continue;
      }

      const timerSec = Number(reg?.timer_sec || 0) || 0;
      const totalMs = timerSec > 0 ? timerSec * 1000 : 0;

      let remainingMs = 0;
      const clockEndsAt = Number(reg?.clock_ends_at || 0) || 0;
      if (totalMs > 0 && clockEndsAt) remainingMs = Math.max(0, clockEndsAt - now);

      const clockState = clockMap.get(draftId) || {};
      const prevPickNo = Number(clockState?.pick_no ?? 0);
      const prevStatus = String(clockState?.last_status || "").toLowerCase();
      const isNewPick = prevPickNo !== nextPickNo;

      const frozenPausedRemaining = Number(clockState?.paused_remaining_ms);
      const wasPaused = prevStatus === "paused";
      const isPaused = status === "paused";

      if (!wasPaused && isPaused) {
        await upsertClockState(db, endpoint, draftId, {
          pick_no: nextPickNo,
          last_status: status,
          paused_remaining_ms: Number.isFinite(remainingMs) ? remainingMs : null,
          paused_at_ms: now,
          sent_onclock: Number(clockState?.sent_onclock || 0),
          sent_25: Number(clockState?.sent_25 || 0),
          sent_50: Number(clockState?.sent_50 || 0),
          sent_10min: Number(clockState?.sent_10min || 0),
          sent_urgent: Number(clockState?.sent_urgent || 0),
          sent_final: Number(clockState?.sent_final || 0),
          sent_paused: Number(clockState?.sent_paused || 0),
          sent_unpaused: Number(clockState?.sent_unpaused || 0),
        });
      } else if (wasPaused && !isPaused) {
        await upsertClockState(db, endpoint, draftId, {
          pick_no: nextPickNo,
          last_status: status,
          paused_remaining_ms: null,
          paused_at_ms: null,
          sent_onclock: Number(clockState?.sent_onclock || 0),
          sent_25: Number(clockState?.sent_25 || 0),
          sent_50: Number(clockState?.sent_50 || 0),
          sent_10min: Number(clockState?.sent_10min || 0),
          sent_urgent: Number(clockState?.sent_urgent || 0),
          sent_final: Number(clockState?.sent_final || 0),
          sent_paused: Number(clockState?.sent_paused || 0),
          sent_unpaused: Number(clockState?.sent_unpaused || 0),
        });
      }

      if (isPaused && Number.isFinite(frozenPausedRemaining)) {
        remainingMs = frozenPausedRemaining;
      }

      const timeLeftText = totalMs > 0 ? msToClock(remainingMs) : "-";

      const sentPaused = Number(clockState?.sent_paused ?? 0) === 1;
      const sentUnpaused = Number(clockState?.sent_unpaused ?? 0) === 1;
      const sentOnclock = Number(clockState?.sent_onclock ?? 0) === 1;
      const sent25 = Number(clockState?.sent_25 ?? 0) === 1;
      const sent50 = Number(clockState?.sent_50 ?? 0) === 1;
      const sent10 = Number(clockState?.sent_10min ?? 0) === 1;
      const sentUrgent = Number(clockState?.sent_urgent ?? 0) === 1;
      const sentFinal = Number(clockState?.sent_final ?? 0) === 1;

      let stageToSend = null;

      if (status === "paused") {
        if (isNewPick || !sentPaused) stageToSend = "paused";
      } else {
        if (prevStatus === "paused" && !sentUnpaused) stageToSend = "unpaused";
        else if (isNewPick || !sentOnclock) stageToSend = "onclock";
        else if (totalMs > 0) {
          const usedFrac = 1 - remainingMs / totalMs;

          if (remainingMs <= 120000 && !sentUrgent) stageToSend = "urgent";
          else {
            const canTen = totalMs > 600000;
            const tenEligible = canTen && remainingMs <= 600000 && remainingMs < totalMs - 30000;

            if (tenEligible && !sent10) stageToSend = "ten";
            else if (usedFrac >= 0.5 && !sent50) stageToSend = "p50";
            else if (usedFrac >= 0.25 && !sent25) stageToSend = "p25";
            else {
              const finalThresholdMs = clamp(Math.floor(totalMs * 0.2), 20000, 120000);
              if (remainingMs <= finalThresholdMs && !sentFinal) stageToSend = "final";
            }
          }
        }
      }

      const nextFlags = {
        pick_no: nextPickNo,
        last_status: status,
        sent_onclock: isNewPick ? 0 : sentOnclock ? 1 : 0,
        sent_25: isNewPick ? 0 : sent25 ? 1 : 0,
        sent_50: isNewPick ? 0 : sent50 ? 1 : 0,
        sent_10min: isNewPick ? 0 : sent10 ? 1 : 0,
        sent_urgent: isNewPick ? 0 : sentUrgent ? 1 : 0,
        sent_final: isNewPick ? 0 : sentFinal ? 1 : 0,
        sent_paused: isNewPick ? 0 : sentPaused ? 1 : 0,
        sent_unpaused: isNewPick ? 0 : sentUnpaused ? 1 : 0,
        paused_remaining_ms:
          status === "paused"
            ? Number.isFinite(Number(clockState?.paused_remaining_ms))
              ? Number(clockState?.paused_remaining_ms)
              : remainingMs
            : null,
        paused_at_ms:
          status === "paused"
            ? Number.isFinite(Number(clockState?.paused_at_ms))
              ? Number(clockState?.paused_at_ms)
              : now
            : null,
        resume_clock_start_ms:
          prevStatus === "paused" && status === "drafting" && totalMs > 0
            ? now - (totalMs - remainingMs)
            : null,
      };

      // Always persist the base state (pick/status + carry-forward sent flags).
      // IMPORTANT: we do NOT mark a stage as "sent" until a push send succeeds.
      await upsertClockState(db, endpoint, draftId, nextFlags);

      if (!stageToSend) continue;

      const leagueName = String(reg?.league_name || "League");
      const msgTimeLeft = stageToSend === "paused" || stageToSend === "unpaused" ? "" : timeLeftText;
      const msg = buildMessage({ stage: stageToSend, leagueName, timeLeftText: msgTimeLeft, timerSec });

      events.push({
        draftId,
        leagueName,
        stage: stageToSend,
        remainingMs,
        title: msg.title,
        body: msg.body,
        nextFlags,
      });
    }
    console.log("📬 EVENTS FOR", username, ":", events.map(e => ({
      draft: e.draftId,
      stage: e.stage
    })));

    if (!events.length) continue;

// same payload builder used elsewhere in your file
    const sendPayload = async (payload) => sendPush(env, subscription, payload);

    const stageToFlagField = (stage) => {
      switch (String(stage || "")) {
        case "onclock": return "sent_onclock";
        case "p25": return "sent_25";
        case "p50": return "sent_50";
        case "ten": return "sent_10min";
        case "urgent": return "sent_urgent";
        case "final": return "sent_final";
        case "paused": return "sent_paused";
        case "unpaused": return "sent_unpaused";
        default: return null;
      }
    };


    if (events.length === 1) {
      const ev = events[0];
      const res = await sendPayload({
        title: ev.title,
        body: ev.body,
        url: "/draft-pick-tracker",
        tag: `draft:${ev.draftId}`,
        renotify: true,
      });

      if (res.ok) {
        sent++;

        const field = stageToFlagField(ev.stage);
        if (field) {
          await upsertClockState(db, endpoint, ev.draftId, {
            ...(ev.nextFlags || {}),
            [field]: 1,
          });
        }
      }

	      if (!res.ok) {
	        console.log(
	          "🚨 NOTIFY send failed",
	          JSON.stringify({
	            endpoint: String(endpoint).slice(0, 120),
	            draftId: String(ev?.draftId || ""),
	            stage: String(ev?.stage || ""),
	            status: Number(res?.status || 0),
	            error: String(res?.error || "").slice(0, 200),
	          })
	        );
	      }

      continue;
    }

    // SUMMARY MODE
    const sorted = events.slice().sort((a, b) => {
      const au = a.stage === "urgent" || (a.remainingMs > 0 && a.remainingMs <= 120000 && a.stage !== "paused") ? 1 : 0;
      const bu = b.stage === "urgent" || (b.remainingMs > 0 && b.remainingMs <= 120000 && b.stage !== "paused") ? 1 : 0;
      if (au !== bu) return bu - au;

      const ap = a.stage === "paused" ? 1 : 0;
      const bp = b.stage === "paused" ? 1 : 0;
      if (ap !== bp) return ap - bp;

      const ar = a.stage === "unpaused" ? 1 : 0;
      const br = b.stage === "unpaused" ? 1 : 0;
      if (ar !== br) return br - ar;

      return (a.remainingMs || 0) - (b.remainingMs || 0);
    });

    const anyUrgent = sorted.some(
      (x) => x.stage === "urgent" || (x.remainingMs > 0 && x.remainingMs <= 120000 && x.stage !== "paused")
    );

    const title = anyUrgent ? "⚠️ URGENT" : `Draft updates (${sorted.length})`;

    const formatLine = (ev) => {
      const lbl = stageLabel(ev.stage);
      const showTime = ev.stage !== "paused" && ev.stage !== "unpaused" && ev.remainingMs > 0;
      const t = showTime ? ` — ${msToClock(ev.remainingMs)}` : "";
      return `• ${ev.leagueName} — ${lbl}${t}`;
    };

    const maxLines = 8;
    const lines = sorted.slice(0, maxLines).map(formatLine).join("\n");
    const more = sorted.length > maxLines ? `\n+${sorted.length - maxLines} more` : "";

    const res = await sendPayload({
      title,
      body: `${lines}${more}`,
      url: "/draft-pick-tracker",
      tag: anyUrgent ? "draft-summary-urgent" : "draft-summary",
      renotify: true,
    });

    if (res.ok) {
      sent++;

      // Mark each underlying event as sent only after the summary push succeeds.
      for (const ev of events) {
        const field = stageToFlagField(ev.stage);
        if (!field) continue;
        await upsertClockState(db, endpoint, ev.draftId, {
          ...(ev.nextFlags || {}),
          [field]: 1,
        });
      }
    }

	    if (!res.ok) {
	      console.log(
	        "🚨 NOTIFY summary send failed",
	        JSON.stringify({
	          endpoint: String(endpoint).slice(0, 120),
	          status: Number(res?.status || 0),
	          error: String(res?.error || "").slice(0, 200),
	          leagues: events.map((e) => String(e?.leagueName || "").slice(0, 48)).slice(0, 8),
	        })
	      );
	    }
  }

  return { ok: true, subs: subs.length, sent };
}

async function tickOnce(env, state, opts = {}) {
  const db = env?.PUSH_DB; // ✅ this worker's D1 binding is PUSH_DB
  if (!db?.prepare) return { ok: false, error: "PUSH_DB binding not found" };

  await ensureDraftRegistryTable(db);
  await ensureDraftCacheTable(db);
  // Discovery runs inside the DO so alerts don't depend on someone visiting the UI.
  // It refreshes push_subscriptions.draft_ids_json in a fair, oldest-first sweep by username.
  // NOTE: this requires the DO state (storage) for the in-DO uid cache.
  try {
    if (state?.storage) await discoveryBatch(env, state);
  } catch {
    // discovery should never block registry updates
  }


    const now = Date.now();

    // IMPORTANT: do NOT scan every draft and do 1 query per draft.
    // Instead, pull a bounded, prioritized set of stale drafts directly from D1.
    const toCheck = await listDraftsToCheckPrioritized(db, now, opts);
  let updated = 0;
  let active = 0;

  const CONCURRENCY = 6;
  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const batch = toCheck.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ draftId, wasActive, reg }) => {
        let draft;
        try {
          draft = await getDraft(draftId);
        } catch {
          // if we fail to fetch but it was previously active, keep it counted so UI doesn't flicker
          if (wasActive) active++;
          return;
        }

        const status = String(draft?.status || "").toLowerCase();
        const isActive = status === "drafting" || status === "paused";
        if (isActive) active++;

        // If a draft just transitioned into an active state, force a roster-context rebuild.
        // Why: pre-draft can have a placeholder/partial draft_order / slot mapping, and when
        // the draft actually starts Sleeper may populate slot_to_roster_id (or change order).
        // If we don't force a rebuild, we can get stuck with stale-but-non-null JSON.
        const prevStatus = String(reg?.status || "").toLowerCase();
        const becameActive = isActive && !(prevStatus === "drafting" || prevStatus === "paused");

        const teams = Number(draft?.settings?.teams || 0) || null;
        const timerSec = Number(draft?.settings?.pick_timer || draft?.settings?.pick_timer_seconds || 0) || null;
        const rounds = Number(draft?.settings?.rounds || 0) || null;
        const reversalRound = Number(draft?.settings?.reversal_round || 0) || null;
        const lastPicked = Number(draft?.last_picked || 0) || null;
        const leagueId = draft?.league_id || draft?.metadata?.league_id || null;

        const cacheRow = await loadDraftCache(db, draftId);
        let pickCount = Number(cacheRow?.pick_count);
        const cacheLastPicked = Number(cacheRow?.last_picked || 0);

        if (!Number.isFinite(pickCount) || cacheLastPicked !== Number(lastPicked || 0)) {
          try {
            pickCount = await getPickCount(draftId);
          } catch {
            pickCount = Number.isFinite(pickCount) ? pickCount : null;
          }
          await saveDraftCache(db, draftId, { last_picked: lastPicked, pick_count: pickCount });
        }

        let leagueName = reg?.league_name || cacheRow?.league_name || null;
        let leagueAvatarUrl = reg?.league_avatar || cacheRow?.league_avatar || null;
        let bestBall = reg?.best_ball;

        if (leagueId && (!leagueName || !leagueAvatarUrl || bestBall == null)) {
          const lg = await getLeague(String(leagueId));
          if (lg) {
            leagueName = leagueName || lg?.name || null;
            leagueAvatarUrl = leagueAvatarUrl || toLeagueAvatarUrl(lg?.avatar || null);
            bestBall = bestBall == null ? (Number(lg?.settings?.best_ball) ? 1 : 0) : bestBall;
            await saveDraftCache(db, draftId, {
              league_id: String(leagueId),
              league_name: leagueName,
              league_avatar: leagueAvatarUrl,
            });
          }
        }

        // Best-ball "complete" is a TFA concept (we don't need to keep rechecking forever).
        const prevCompletedAt = Number(reg?.completed_at || cacheRow?.completed_at || 0) || null;
        const completedAt =
        Number(bestBall || 0) === 1 && !isActive
          ? (prevCompletedAt || now)
          : null;
        // ------------------------------------------------------------
        // Shared league context (cached in D1) so clients do NOT
        // hit Sleeper users/rosters/traded_picks endpoints.
        // ------------------------------------------------------------
        const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
        let lastContextAt = Number(cacheRow?.context_updated_at || 0) || 0;
        let contextStale = !lastContextAt || now - lastContextAt > CONTEXT_TTL_MS;

        // NOTE: older code wrote the literal string "null" into these columns.
        // Treat that as missing so the DO will re-hydrate the context.
        let slotToRosterJson =
          coerceJsonStr(reg?.slot_to_roster_json) || coerceJsonStr(cacheRow?.slot_to_roster_json);
        let rosterNamesJson =
          coerceJsonStr(reg?.roster_names_json) || coerceJsonStr(cacheRow?.roster_names_json);
        let rosterByUsernameJson =
          coerceJsonStr(reg?.roster_by_username_json) || coerceJsonStr(cacheRow?.roster_by_username_json);
        let tradedPickOwnerJson =
          coerceJsonStr(reg?.traded_pick_owner_json) || coerceJsonStr(cacheRow?.traded_pick_owner_json);

        // Force a full refresh when we first see the draft become active.
        // This guarantees we retry on subsequent ticks if hydration fails.
        if (becameActive) {
          slotToRosterJson = null;
          rosterNamesJson = null;
          rosterByUsernameJson = null;
          tradedPickOwnerJson = null;
          lastContextAt = 0;
          contextStale = true;
        }

	      // Track whether we *successfully* hydrated non-empty context, so we don't
	      // advance context_updated_at when we only produced empty {} values.
	      let didHydrateRosterContext = false;

        const needsRosterContext = !slotToRosterJson || !rosterNamesJson || !rosterByUsernameJson;
        const canHydrateRosterContext = Boolean(leagueId) && (needsRosterContext || contextStale);

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

              const roster = (Array.isArray(rosters) ? rosters : []).find(
                (x) => String(x?.owner_id) === ownerId
              );
              if (roster?.roster_id == null) continue;

              const rid = String(roster.roster_id);

              // Map BOTH username and display_name to roster_id (lowercased).
              // Some league-user records can be missing `username` but still have `display_name`.
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
            // ignore hydration failure; we will try again on next context refresh
          }
        }

        // traded_picks: skip for bestball. only hydrate when missing.
        if (Number(bestBall || 0) !== 1 && leagueId && !tradedPickOwnerJson) {
          try {
            const traded = await sleeperJson(
              `https://api.sleeper.app/v1/draft/${draftId}/traded_picks`
            );
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

        // persist context in cache as well
        await saveDraftCache(db, draftId, {
          slot_to_roster_json: slotToRosterJson,
          roster_names_json: rosterNamesJson,
          roster_by_username_json: rosterByUsernameJson,
          traded_pick_owner_json: Number(bestBall || 0) === 1 ? null : tradedPickOwnerJson,
          rounds,
          timer_sec: timerSec,
          reversal_round: reversalRound,
	        // Only move the TTL forward when we hydrated meaningful context.
	        context_updated_at: didHydrateRosterContext ? now : (lastContextAt || null),
        });

        // -------- computed convenience fields (optional) --------
        let currentPick = null;
        let currentOwnerName = null;
        let nextOwnerName = null;

        try {
          const pickCountNum = Number.isFinite(Number(pickCount)) ? Number(pickCount) : 0;
          currentPick = pickCountNum + 1;

          const slotToRoster = slotToRosterJson ? JSON.parse(slotToRosterJson) : null;
          const rosterNames = rosterNamesJson ? JSON.parse(rosterNamesJson) : null;
          const tradedOwners = tradedPickOwnerJson ? JSON.parse(tradedPickOwnerJson) : null;

          const seasonStr = String(draft?.season || "");
          const teamsNum = Number(teams || 0) || (slotToRoster ? Object.keys(slotToRoster).length : 0);

          if (teamsNum > 0 && slotToRoster && rosterNames) {
            const ridCur = resolveRosterForPick({
              pickNo: currentPick,
              teams: teamsNum,
              slotToRoster,
              tradedPickOwners: tradedOwners,
              seasonStr,
              reversalRound: reversalRound || 0,
            });
            const ridNext = resolveRosterForPick({
              pickNo: currentPick + 1,
              teams: teamsNum,
              slotToRoster,
              tradedPickOwners: tradedOwners,
              seasonStr,
              reversalRound: reversalRound || 0,
            });

            currentOwnerName = rosterNames?.[String(ridCur)] || null;
            nextOwnerName = rosterNames?.[String(ridNext)] || null;
          }
        } catch {
          // ignore computed failure
        }

        const clockEndsAt =
          lastPicked && timerSec ? Number(lastPicked) + Number(timerSec) * 1000 : null;

        await upsertRegistry(db, draftId, {
          active: isActive ? 1 : 0,
          status,
          last_picked: lastPicked,
          pick_count: pickCount,
          draft_json: JSON.stringify(draft || {}),
          draft_order_json: draft?.draft_order ? JSON.stringify(draft.draft_order) : null,
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
          current_pick: currentPick,
          current_owner_name: currentOwnerName,
          next_owner_name: nextOwnerName,
          clock_ends_at: clockEndsAt,
          completed_at: completedAt,
        });

        updated++;
      })
    );
  }

  // ✅ Notifications should be evaluated *after* we refresh the registry in this tick.
  // Otherwise we can repeatedly read stale/empty computed fields (current_owner_name/clock_ends_at)
  // and never generate events.
  // Gate to ~30s so we don't do push work every 15s alarm.
  let notify = null;
  try {
    const last = state?.storage ? await state.storage.get("last_notify_at") : 0;
    const lastAt = Number(last || 0);

    console.log("🟡 NOTIFY CHECK", {
      now,
      lastAt,
      diff: now - lastAt,
      gate: NOTIFY_MIN_INTERVAL_MS,
    });

    if (state?.storage && (!lastAt || now - lastAt >= NOTIFY_MIN_INTERVAL_MS)) {
      console.log("🟢 RUNNING notifyFromRegistry()", {
        tickDrafts: toCheck.length,
        tickUpdated: updated,
        tickActive: active,
        source: String(opts?.source || ""),
      });
      notify = await notifyFromRegistry(env, state, db);
      console.log("🟢 NOTIFY RESULT:", JSON.stringify(notify));
      await state.storage.put("last_notify_at", now);
    } else {
      console.log("⚪ NOTIFY SKIPPED (interval gate)");
    }
  } catch (err) {
    console.log("❌ NOTIFY BLOCK ERROR:", err?.message || err);
  }

  return { ok: true, drafts: toCheck.length, active, updated, notify };
}

export class DraftRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    // Self-arm on first instantiation.
    this.state.blockConcurrencyWhile(async () => {
      try {
        const a = await this.state.storage.getAlarm();
        if (!a) await this.state.storage.setAlarm(Date.now() + 500);
      } catch {
        // ignore
      }
    });
  }

  async alarm() {
    console.log("🔥 DO ALARM FIRED", Date.now());

    try {
      const result = await tickOnce(this.env, this.state, { source: "alarm" });
      console.log("🔥 TICK RESULT:", JSON.stringify(result));
    } finally {
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/tick" || url.pathname === "/kick") {
      const forcePreDraft = url.pathname === "/kick";
      const result = await tickOnce(this.env, this.state, {
        source: forcePreDraft ? "kick" : "tick",
        forcePreDraft,
      });

      // Optional: keep it armed on manual tick too
      await this.state.storage.setAlarm(Date.now() + TICK_MS);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}