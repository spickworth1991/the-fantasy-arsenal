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
      current_pick INTEGER,
      current_owner_name TEXT,
      next_owner_name TEXT,
      clock_ends_at INTEGER,
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
    // --------------------------------------------------
    // Compute shared draft math (snake + traded logic)
    // --------------------------------------------------

    const seasonStr = String(draft?.season || "");
    const teamsNum = Number(draft?.settings?.teams || 0) || 0;
    const reversalRound = Number(draft?.settings?.reversal_round || 0) || 0;

    const currentPick = (Number(pickCount) || 0) + 1;

    function getSnakeSlot(pickNo) {
      if (!pickNo || !teamsNum) return null;
      const idx0 = pickNo - 1;
      const round = Math.floor(idx0 / teamsNum) + 1;
      const pickInRound0 = idx0 % teamsNum;

      let forward = true;
      for (let r = 2; r <= round; r++) {
        if (reversalRound > 0 && r === reversalRound) continue;
        forward = !forward;
      }

      const slot = forward ? pickInRound0 + 1 : teamsNum - pickInRound0;
      return { round, slot };
    }

    function resolveRoster(pickNo) {
      const rs = getSnakeSlot(pickNo);
      if (!rs) return null;

      const origRosterId =
        slotToRosterJson
          ? JSON.parse(slotToRosterJson)?.[String(rs.slot)]
          : null;

      if (!origRosterId) return null;

      const traded =
        tradedPickOwnerJson
          ? JSON.parse(tradedPickOwnerJson)?.[
              `${seasonStr}|${rs.round}|${origRosterId}`
            ]
          : null;

      return traded || origRosterId;
    }

    const rosterNames = rosterNamesJson
      ? JSON.parse(rosterNamesJson)
      : {};

    const currentRosterId = resolveRoster(currentPick);
    const nextRosterId = resolveRoster(currentPick + 1);

    const currentOwnerName =
      rosterNames?.[String(currentRosterId)] || null;

    const nextOwnerName =
      rosterNames?.[String(nextRosterId)] || null;

    const clockEndsAt =
      lastPicked && timerSec
        ? Number(lastPicked) + Number(timerSec) * 1000
        : null;
        
    await upsertRegistry(db, draftId, {
      active: isActive ? 1 : 0,
      status,
      last_picked: lastPicked,
      pick_count: pickCount,
      current_pick: currentPick,
      current_owner_name: currentOwnerName,
      next_owner_name: nextOwnerName,
      clock_ends_at: clockEndsAt,
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