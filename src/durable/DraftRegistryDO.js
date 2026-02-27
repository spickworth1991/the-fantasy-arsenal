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
const ACTIVE_REFRESH_MS = 20_000; // treat active drafts as stale after ~1 tick
const PRE_DRAFT_REFRESH_MS = 2 * 60 * 1000; // 2 minutes
const INACTIVE_REFRESH_MS = 6 * 60 * 60 * 1000; // recheck other inactive drafts every 6h

async function sleeperJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper fetch failed ${res.status} for ${url}`);
  return res.json();
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
        league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
        league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
        best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
        current_pick=COALESCE(excluded.current_pick, push_draft_registry.current_pick),
        current_owner_name=COALESCE(excluded.current_owner_name, push_draft_registry.current_owner_name),
        next_owner_name=COALESCE(excluded.next_owner_name, push_draft_registry.next_owner_name),
        clock_ends_at=COALESCE(excluded.clock_ends_at, push_draft_registry.clock_ends_at),
	      completed_at=COALESCE(push_draft_registry.completed_at, excluded.completed_at),
	      updated_at=excluded.updated_at)`
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

async function tickOnce(env) {
  const db = env?.PUSH_DB; // ✅ this worker's D1 binding is PUSH_DB
  if (!db?.prepare) return { ok: false, error: "PUSH_DB binding not found" };

  await ensureDraftRegistryTable(db);
  await ensureDraftCacheTable(db);

  const now = Date.now();
  const uniqueDraftIds = await listUniqueDraftIds(db);
  if (!uniqueDraftIds.length) return { ok: true, drafts: 0, active: 0, updated: 0 };

  // decide what needs to be checked this tick
  const toCheck = [];
  for (const draftId of uniqueDraftIds) {
    const reg = await getRegistryRow(db, draftId);
    const lastChecked = Number(reg?.last_checked_at || 0);
    const wasActive = Number(reg?.active || 0) === 1;
    const statusLower = String(reg?.status || "").toLowerCase();
    const staleMs = wasActive
      ? ACTIVE_REFRESH_MS
      : statusLower === "pre_draft"
      ? PRE_DRAFT_REFRESH_MS
      : INACTIVE_REFRESH_MS;

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
          // if we fail to fetch but it was previously active, keep it counted so UI doesn't flicker
          if (wasActive) active++;
          return;
        }

        const status = String(draft?.status || "").toLowerCase();
        const isActive = status === "drafting" || status === "paused";
        if (isActive) active++;

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
        const completedAt = !isActive && Number(bestBall || 0) === 1 ? now : null;

        // ------------------------------------------------------------
        // Shared league context (cached in D1) so clients do NOT
        // hit Sleeper users/rosters/traded_picks endpoints.
        // ------------------------------------------------------------
        const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
        const lastContextAt = Number(cacheRow?.context_updated_at || 0) || 0;
        const contextStale = !lastContextAt || now - lastContextAt > CONTEXT_TTL_MS;

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
              const uname = String(u?.username || "").toLowerCase().trim();
              if (!uname) continue;
              const ownerId = String(u?.user_id || "");
              const roster = (Array.isArray(rosters) ? rosters : []).find(
                (x) => String(x?.owner_id) === ownerId
              );
              if (roster?.roster_id != null) rosterByUsername[uname] = String(roster.roster_id);
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