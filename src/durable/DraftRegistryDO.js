const TICK_MS = 15_000;
const ACTIVE_REFRESH_MS = 20_000;
const PRE_DRAFT_REFRESH_MS = 2 * 60 * 1000;
const INACTIVE_REFRESH_MS = 6 * 60 * 60 * 1000;

async function sleeperJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sleeper fetch failed ${res.status} for ${url}`);
  }
  return res.json();
}

async function ensureDraftRegistryTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_draft_registry (
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
      completed_at INTEGER
    )
  `).run();
}

async function ensureDraftCacheTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_draft_cache (
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
    )
  `).run();
}

async function getDraft(draftId) {
  return sleeperJson(`https://api.sleeper.app/v1/draft/${draftId}`);
}

async function getPickCount(draftId) {
  const picks = await sleeperJson(
    `https://api.sleeper.app/v1/draft/${draftId}/picks`
  );
  return Array.isArray(picks) ? picks.length : 0;
}

async function getLeague(leagueId) {
  if (!leagueId) return null;
  try {
    return await sleeperJson(
      `https://api.sleeper.app/v1/league/${leagueId}`
    );
  } catch {
    return null;
  }
}

function toLeagueAvatarUrl(avatarId) {
  return avatarId
    ? `https://sleepercdn.com/avatars/thumbs/${avatarId}`
    : null;
}

async function listUniqueDraftIds(db) {
  const rows = await db
    .prepare(`SELECT draft_id FROM push_draft_registry`)
    .all();

  const set = new Set();
  for (const r of rows?.results || []) {
    if (r?.draft_id) set.add(String(r.draft_id));
  }
  return Array.from(set);
}

async function getRegistryRow(db, draftId) {
  return (
    (await db
      .prepare(`SELECT * FROM push_draft_registry WHERE draft_id=?`)
      .bind(String(draftId))
      .first()) || null
  );
}

async function upsertRegistry(db, draftId, patch) {
  const now = Date.now();
  const cur = (await getRegistryRow(db, draftId)) || {};
  const next = { ...cur, ...patch };

  await db.prepare(`
    INSERT OR REPLACE INTO push_draft_registry (
      draft_id, active, status,
      last_checked_at, last_active_at, last_inactive_at,
      last_picked, pick_count,
      draft_json, draft_order_json,
      slot_to_roster_json, roster_names_json,
      roster_by_username_json, traded_pick_owner_json,
      teams, rounds, timer_sec, reversal_round,
      league_id, league_name, league_avatar,
      best_ball, completed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    String(draftId),
    next.active ?? 0,
    next.status ?? "",
    now,
    next.active ? now : cur.last_active_at ?? null,
    !next.active ? now : cur.last_inactive_at ?? null,
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
    next.completed_at ?? null
  ).run();
}

async function tickOnce(env) {
  const db = env?.DRAFT_REGISTRY; // ✅ FIXED BINDING
  if (!db?.prepare) {
    return { ok: false, error: "DRAFT_REGISTRY binding not found" };
  }

  await ensureDraftRegistryTable(db);
  await ensureDraftCacheTable(db);

  const draftIds = await listUniqueDraftIds(db);
  const now = Date.now();

  let updated = 0;
  let active = 0;

  for (const draftId of draftIds) {
    let draft;
    try {
      draft = await getDraft(draftId);
    } catch {
      continue;
    }

    const status = String(draft?.status || "").toLowerCase();
    const isActive = status === "drafting" || status === "paused";
    if (isActive) active++;

    const lastPicked = Number(draft?.last_picked || 0) || null;
    const pickCount = await getPickCount(draftId);

    await upsertRegistry(db, draftId, {
      active: isActive ? 1 : 0,
      status,
      last_picked: lastPicked,
      pick_count: pickCount,
      draft_json: JSON.stringify(draft),
      draft_order_json: draft?.draft_order
        ? JSON.stringify(draft.draft_order)
        : null,
    });

    updated++;
  }

  return { ok: true, drafts: draftIds.length, active, updated };
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
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}