// Durable Object that keeps the "master" draft registry in D1 fresh every ~15 seconds.
//
// Why:
// - Cloudflare Scheduled Triggers can't run every 15s.
// - DO alarms can. We use an alarm to poll Sleeper and write to D1.
// - Notifications (cron 1/min) and the UI (poll D1 15s) both read the same registry.
//
// Binding name expected: DRAFT_REGISTRY (see wrangler.toml)

const TICK_MS = 15_000;
const ACTIVE_REFRESH_MS = 20_000; // treat active drafts as stale after ~1 tick
const INACTIVE_REFRESH_MS = 6 * 60 * 60 * 1000; // recheck inactive drafts every 6h

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
        teams INTEGER,
        timer_sec INTEGER,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT,
        best_ball INTEGER,
        completed_at INTEGER
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
    await add("teams", "INTEGER");
    await add("timer_sec", "INTEGER");
    await add("league_name", "TEXT");
    await add("league_avatar", "TEXT");
    await add("best_ball", "INTEGER");
    await add("completed_at", "INTEGER");
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
        updated_at INTEGER
      )`
    )
    .run();
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
        draft_id, last_picked, pick_count, league_id, league_name, league_avatar, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      next.draft_id,
      next.last_picked ?? null,
      next.pick_count ?? null,
      next.league_id ?? null,
      next.league_name ?? null,
      next.league_avatar ?? null,
      next.updated_at
    )
    .run();
  return next;
}

async function getDraft(draftId) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper draft fetch failed for ${draftId}: ${res.status}`);
  return res.json();
}

async function getPickCount(draftId) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper picks fetch failed for ${draftId}: ${res.status}`);
  const picks = await res.json();
  return Array.isArray(picks) ? picks.length : 0;
}

async function getLeague(leagueId) {
  if (!leagueId) return null;
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

function toLeagueAvatarUrl(avatarId) {
  return avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null;
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

async function getRegistryRow(db, draftId) {
  return (
    (await db
      .prepare(
        `SELECT draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
                last_picked, pick_count, league_id, league_name, league_avatar, best_ball, completed_at
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

  await db
    .prepare(
      `INSERT INTO push_draft_registry (
        draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
        last_picked, pick_count, draft_json, draft_order_json, teams, timer_sec,
        league_id, league_name, league_avatar, best_ball, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        teams=excluded.teams,
        timer_sec=excluded.timer_sec,
        league_id=COALESCE(excluded.league_id, push_draft_registry.league_id),
        league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
        league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
        best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
        completed_at=COALESCE(push_draft_registry.completed_at, excluded.completed_at)`
    )
    .bind(
      String(draftId),
      next.active ?? 0,
      String(next.status || ""),
      now,
      next.active ? now : (Number(cur?.last_active_at || 0) || null),
      !next.active ? now : (Number(cur?.last_inactive_at || 0) || null),
      next.last_picked ?? null,
      next.pick_count ?? null,
      next.draft_json ?? null,
      next.draft_order_json ?? null,
      next.teams ?? null,
      next.timer_sec ?? null,
      next.league_id ?? null,
      next.league_name ?? null,
      next.league_avatar ?? null,
      next.best_ball ?? null,
      next.completed_at ?? null
    )
    .run();
}

async function tickOnce(env) {
  const db = env?.PUSH_DB;
  if (!db?.prepare) return { ok: false, error: "PUSH_DB binding not found" };

  await ensureDraftRegistryTable(db);
  await ensureDraftCacheTable(db);

  const now = Date.now();
  const uniqueDraftIds = await listUniqueDraftIdsFromSubs(db);
  if (!uniqueDraftIds.length) return { ok: true, drafts: 0, active: 0, updated: 0 };

  const toCheck = [];
  for (const draftId of uniqueDraftIds) {
    const reg = await getRegistryRow(db, draftId);
    const lastChecked = Number(reg?.last_checked_at || 0);
    const wasActive = Number(reg?.active || 0) === 1;
    const staleMs = wasActive ? ACTIVE_REFRESH_MS : INACTIVE_REFRESH_MS;
    const needs = !lastChecked || now - lastChecked > staleMs;
    if (!reg || needs) toCheck.push({ draftId, wasActive, reg });
  }

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
          if (wasActive) active++;
          return;
        }

        const status = String(draft?.status || "").toLowerCase();
        const isActive = status === "drafting" || status === "paused";
        if (isActive) active++;

        const teams = Number(draft?.settings?.teams || 0) || null;
        const timerSec =
          Number(draft?.settings?.pick_timer || draft?.settings?.pick_timer_seconds || 0) || null;
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

        const completedAt = !isActive && Number(bestBall || 0) === 1 ? now : null;

        await upsertRegistry(db, draftId, {
          active: isActive ? 1 : 0,
          status,
          last_picked: lastPicked,
          pick_count: pickCount,
          draft_json: JSON.stringify(draft || {}),
          draft_order_json: draft?.draft_order ? JSON.stringify(draft.draft_order) : null,
          teams,
          timer_sec: timerSec,
          league_id: leagueId ? String(leagueId) : null,
          league_name: leagueName,
          league_avatar: leagueAvatarUrl,
          best_ball: bestBall == null ? null : Number(bestBall),
          completed_at: completedAt,
        });

        updated++;
      })
    );
  }

  return { ok: true, drafts: uniqueDraftIds.length, active, updated };
}

export class DraftRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async alarm() {
    try {
      await tickOnce(this.env);
    } finally {
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/tick" || url.pathname === "/kick") {
      const result = await tickOnce(this.env);
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  }
}
