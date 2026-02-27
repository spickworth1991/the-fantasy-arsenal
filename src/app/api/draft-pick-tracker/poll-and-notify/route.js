export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

function getDb(env) {
  return env?.PUSH_DB || env?.DB || env?.D1 || env?.DRAFT_DB || null;
}

// Best-effort: ensure the DO alarm is ticking.
async function kickDraftRegistry(env) {
  try {
    const ns = env?.DRAFT_REGISTRY;
    if (!ns?.idFromName) return;
    const id = ns.idFromName("master");
    const stub = ns.get(id);
    await stub.fetch("https://do/kick", { method: "GET" });
  } catch {
    // ignore
  }
}

async function ensureTable(db, table, createSql, columnsToEnsure = []) {
  await db.prepare(createSql).run();
  if (!columnsToEnsure.length) return;

  let info;
  try {
    info = await db.prepare(`PRAGMA table_info(${table})`).all();
  } catch {
    return;
  }
  const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
  for (const col of columnsToEnsure) {
    const name = String(col?.name || "").trim();
    const type = String(col?.type || "TEXT").trim();
    if (!name || existing.has(name)) continue;
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
  }
}

async function ensurePushTables(db) {
  await ensureTable(
    db,
    "push_subscriptions",
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription_json TEXT,
      draft_ids_json TEXT,
      username TEXT,
      league_count INTEGER,
      updated_at INTEGER,
      created_at INTEGER
    )`,
    [
      { name: "subscription_json", type: "TEXT" },
      { name: "draft_ids_json", type: "TEXT" },
      { name: "username", type: "TEXT" },
      { name: "league_count", type: "INTEGER" },
      { name: "updated_at", type: "INTEGER" },
      { name: "created_at", type: "INTEGER" },
    ]
  );

  await ensureTable(
    db,
    "push_clock_state",
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
    )`,
    [
      { name: "sent_urgent", type: "INTEGER" },
      { name: "paused_remaining_ms", type: "INTEGER" },
      { name: "paused_at_ms", type: "INTEGER" },
      { name: "resume_clock_start_ms", type: "INTEGER" },
    ]
  );
}

async function ensureDraftRegistryTable(db) {
  // DO creates + hydrates. We only ensure the columns exist for reads.
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
        completed_at INTEGER
      )`
    )
    .run();
}

export async function POST(req) {
  return handler(req);
}
export async function GET(req) {
  return handler(req);
}

function assertAuth(req, env) {
  const expected = env?.PUSH_ADMIN_SECRET;
  if (!expected) return false;

  const headerSecret = req.headers.get("x-push-secret");
  if (headerSecret && headerSecret === expected) return true;

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key && key === expected) return true;
  } catch {
    // ignore
  }
  return false;
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

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function getSnakeSlotForPick({ pickNo, teams, reversalRound }) {
  if (!pickNo || !teams) return null;

  const idx0 = pickNo - 1;
  const round = Math.floor(idx0 / teams) + 1;
  const pickInRound0 = idx0 % teams;

  // Normal snake flips every round; 3RR means the specified round does NOT flip.
  const rr = safeNum(reversalRound);
  let forward = true;
  if (round > 1) {
    for (let r = 2; r <= round; r++) {
      if (rr > 0 && r === rr) {
        // skip flip
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

  const key = `${seasonStr}|${rs.round}|${String(origRosterId)}`;
  const tradedOwner = tradedPickOwners?.[key] || null;
  return tradedOwner || String(origRosterId);
}

function hash32(str) {
  str = String(str ?? "");
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return h >>> 0;
}
function pickVariant(list, seed) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const idx = hash32(seed) % list.length;
  return list[idx];
}

function sleeperLeagueUrl(leagueId) {
  return leagueId ? `https://sleeper.com/leagues/${leagueId}` : null;
}
function sleeperDraftUrl(draftId) {
  return draftId ? `https://sleeper.com/draft/nfl/${draftId}` : null;
}

function buildMessage({ stage, leagueName, timeLeftText, timerSec }) {
  const baseSeed = `${stage}|${leagueName}|${timerSec}`;

  const ONCLOCK_TITLES = ["You're on the clock", "Your pick is up", "ON THE CLOCK", "Draft alert: your turn"];
  const ONCLOCK_BODIES = [
    `You're on the clock in ${leagueName}. ⏱️ ${timeLeftText} left.`,
    `It's your pick in ${leagueName} — ${timeLeftText} remaining.`,
    `${leagueName}: you're up. ⏱️ ${timeLeftText} left.`,
  ];

  const P25_TITLES = ["Clock check: 25% used", "Quick reminder", "Don't forget your pick"];
  const P25_BODIES = [
    `${leagueName}: ≈25% of your timer is gone. ${timeLeftText} left.`,
    `Quick nudge for ${leagueName} — ${timeLeftText} left.`,
    `${leagueName} clock is moving. ${timeLeftText} remaining.`,
  ];

  const P50_TITLES = ["Half your clock is gone", "You good?", "Still on the clock"];
  const P50_BODIES = [
    `${leagueName}: you're halfway through. ${timeLeftText} left.`,
    `Still your pick in ${leagueName} — ${timeLeftText} left.`,
    `${leagueName}: don't let it auto-pick. ${timeLeftText} remaining.`,
  ];

  const TEN_TITLES = ["10 minutes left", "Seriously... 10 minutes left", "Final stretch"];
  const TEN_BODIES = [
    `${leagueName}: 10 minutes left. Lock it in.`,
    `10-minute warning for ${leagueName}.`,
    `${leagueName}: final 10 minutes.`,
  ];

  const URGENT_TITLES = [
    "\u26a0\ufe0f URGENT: 2 minutes",
    "\ud83d\udea8 PICK NOW \u2013 2 MIN",
    "\u23f1\ufe0f CLOCK CRITICAL",
    "\ud83d\udd25 LAST 2 MINUTES",
  ];
  const URGENT_BODIES = [
    `\ud83d\udea8 ${leagueName}: under 2 minutes left (⏱️ ${timeLeftText}). Pick NOW.`,
    `\u26a0\ufe0f ${leagueName}: timer is about to expire (⏱️ ${timeLeftText}).`,
    `\ud83d\udd25 ${leagueName}: final moments (⏱️ ${timeLeftText}). Don't get auto-picked.`,
  ];

  const FINAL_TITLES = ["Almost out of time", "Last call", "Clock is running out"];
  const FINAL_BODIES = [
    `${leagueName}: almost out of time — ${timeLeftText} left.`,
    `Last call for ${leagueName}. ${timeLeftText} left.`,
    `${leagueName}: clock is about to expire. ${timeLeftText} left.`,
  ];

  const PAUSED_TITLES = [
    "Draft paused - but it's your pick",
    "Paused... you're still up",
    "Paused, but you're on deck",
    "League paused (your pick next)",
  ];
  const PAUSED_BODIES = [
    `${leagueName} is paused, but it's your pick. When it resumes, you'll have ${timeLeftText}.`,
    `Paused: ${leagueName}. You're up when it resumes (⏱️ ${timeLeftText}).`,
    `${leagueName} paused — you're still on the clock when it resumes. ${timeLeftText} will remain.`,
    `Draft paused in ${leagueName}. Your clock resumes with ${timeLeftText}.`,
  ];

  const UNPAUSED_TITLES = [
    "Draft resumed - you're up",
    "Back on: your pick",
    "Unpaused... clock is running",
    "Draft unpaused (still your turn)",
  ];
  const UNPAUSED_BODIES = [
    `${leagueName} resumed — you're on the clock. ${timeLeftText} left.`,
    `Unpaused: ${leagueName}. Your pick is live (⏱️ ${timeLeftText}).`,
    `Back on in ${leagueName}. ${timeLeftText} remaining.`,
    `${leagueName} unpaused — clock is running. ${timeLeftText} left.`,
  ];

  if (stage === "onclock") return { title: pickVariant(ONCLOCK_TITLES, baseSeed), body: pickVariant(ONCLOCK_BODIES, baseSeed) };
  if (stage === "p25") return { title: pickVariant(P25_TITLES, baseSeed), body: pickVariant(P25_BODIES, baseSeed) };
  if (stage === "p50") return { title: pickVariant(P50_TITLES, baseSeed), body: pickVariant(P50_BODIES, baseSeed) };
  if (stage === "ten") return { title: pickVariant(TEN_TITLES, baseSeed), body: pickVariant(TEN_BODIES, baseSeed) };
  if (stage === "urgent") return { title: pickVariant(URGENT_TITLES, baseSeed), body: pickVariant(URGENT_BODIES, baseSeed) };
  if (stage === "final") return { title: pickVariant(FINAL_TITLES, baseSeed), body: pickVariant(FINAL_BODIES, baseSeed) };
  if (stage === "paused") return { title: pickVariant(PAUSED_TITLES, baseSeed), body: pickVariant(PAUSED_BODIES, baseSeed) };
  if (stage === "unpaused") return { title: pickVariant(UNPAUSED_TITLES, baseSeed), body: pickVariant(UNPAUSED_BODIES, baseSeed) };
  return { title: "Draft Update", body: `Update in "${leagueName}".` };
}

async function loadClockState(db, endpoint, draftId) {
  return db
    .prepare(
      `SELECT pick_no, last_status,
              sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final, sent_paused, sent_unpaused,
              paused_remaining_ms, paused_at_ms, resume_clock_start_ms
       FROM push_clock_state
       WHERE endpoint=? AND draft_id=?`
    )
    .bind(endpoint, String(draftId))
    .first();
}

async function upsertClockState(db, endpoint, draftId, row) {
  const now = Date.now();
  const pickNo = Number(row.pick_no);
  return db
    .prepare(
      `INSERT INTO push_clock_state
         (endpoint, draft_id, pick_no, last_status,
          sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final, sent_paused, sent_unpaused,
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
      endpoint,
      String(draftId),
      pickNo,
      String(row.last_status || ""),
      Number(row.sent_onclock || 0),
      Number(row.sent_25 || 0),
      Number(row.sent_50 || 0),
      Number(row.sent_10min || 0),
      Number(row.sent_urgent || 0),
      Number(row.sent_final || 0),
      Number(row.sent_paused || 0),
      Number(row.sent_unpaused || 0),
      row.paused_remaining_ms == null ? null : Number(row.paused_remaining_ms),
      row.paused_at_ms == null ? null : Number(row.paused_at_ms),
      row.resume_clock_start_ms == null ? null : Number(row.resume_clock_start_ms),
      now
    )
    .run();
}

async function clearClockState(db, endpoint, draftId) {
  return db
    .prepare(`DELETE FROM push_clock_state WHERE endpoint=? AND draft_id=?`)
    .bind(endpoint, String(draftId))
    .run();
}

async function getUserId(username) {
  const res = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sleeper user fetch failed for ${username}: ${res.status}`);
  const u = await res.json();
  return u?.user_id || null;
}

async function getUserLeagues(userId, season) {
  if (!userId) return [];
  const year = String(season || new Date().getFullYear());
  const res = await fetch(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${year}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const leagues = await res.json().catch(() => []);
  return Array.isArray(leagues) ? leagues : [];
}

async function computeDraftIdsForUsername(username, season) {
  const userId = await getUserId(username);
  if (!userId) return { userId: null, draftIds: [], leagueCount: 0 };
  const leagues = await getUserLeagues(userId, season);
  const draftIds = leagues.map((lg) => lg?.draft_id).filter(Boolean).map(String);
  return { userId, leagueCount: leagues.length, draftIds: Array.from(new Set(draftIds)) };
}

async function handler(req) {
  const url = new URL(req.url);
  const DEBUG = url.searchParams.get("debug") === "1" || req.headers.get("x-debug") === "1";
  const debug = { steps: [], drafts: [] };
  const step = (name, data) => {
    if (!DEBUG) return;
    debug.steps.push({ t: Date.now(), name, data });
    // eslint-disable-next-line no-console
    console.log("[poll-and-notify]", name, data ?? "");
  };
  const dlog = (draftId, data) => {
    if (!DEBUG) return;
    debug.drafts.push({ t: Date.now(), draftId: String(draftId), ...data });
  };

  try {
    const { env } = getRequestContext();

    if (!assertAuth(req, env)) {
      return new NextResponse(
        "Unauthorized. Provide x-push-secret header, or ?key=... query param (cron-job.org fallback).",
        { status: 401 }
      );
    }

    const db = getDb(env);
    if (!db?.prepare) {
      return new NextResponse(
        "D1 binding not found. Expected one of: PUSH_DB, DB, D1, DRAFT_DB.",
        { status: 500 }
      );
    }

    await ensurePushTables(db);
    await ensureDraftRegistryTable(db);

    // keep DO alive
    await kickDraftRegistry(env);

    const vapidPrivateRaw = env?.VAPID_PRIVATE_KEY;
    const vapidSubject = env?.VAPID_SUBJECT;
    if (!vapidPrivateRaw || !vapidSubject) {
      return new NextResponse("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.", { status: 500 });
    }

    let vapidPrivateJwk;
    try {
      vapidPrivateJwk = JSON.parse(vapidPrivateRaw);
    } catch {
      return new NextResponse("VAPID_PRIVATE_KEY must be a JSON JWK string.", { status: 500 });
    }

    const now = Date.now();

    const subRows = await db
      .prepare(
        `SELECT endpoint, subscription_json, draft_ids_json, username, league_count, updated_at
         FROM push_subscriptions`
      )
      .all();

    const subs = (subRows?.results || [])
      .map((r) => {
        let sub = null;
        let draftIds = [];
        try {
          sub = JSON.parse(r.subscription_json);
        } catch {}
        try {
          draftIds = JSON.parse(r.draft_ids_json || "[]");
        } catch {}
        return {
          endpoint: r.endpoint,
          sub,
          username: r.username || null,
          draftIds: Array.isArray(draftIds) ? draftIds : [],
          leagueCount: Number(r.league_count || 0),
          updatedAt: Number(r.updated_at || 0),
        };
      })
      .filter((x) => x?.sub?.endpoint && x.endpoint);

    step("subs_loaded", { subs: subs.length });

    const userIdCache = new Map();

    let sent = 0;
    let checked = 0;
    let skippedNoDrafts = 0;
    let skippedNoUsername = 0;
    let skippedNoContext = 0;

    const sendPayload = async (subRow, payload) => {
      const { endpoint, fetchInit } = await buildWebPushRequest({
        subscription: subRow.sub,
        payload,
        vapidSubject,
        vapidPrivateJwk,
      });
      return fetch(endpoint, fetchInit);
    };

    // Optional: refresh draft_ids_json every 4h so registry keeps expanding.
    for (const s of subs) {
      if (!s.username) continue;
      const REFRESH_MS = 4 * 60 * 60 * 1000;
      const needsRefresh = !s.draftIds.length || !s.updatedAt || now - s.updatedAt > REFRESH_MS;
      if (!needsRefresh) continue;
      try {
        const computed = await computeDraftIdsForUsername(s.username);
        await db
          .prepare(
            `UPDATE push_subscriptions
             SET draft_ids_json=?, league_count=?, updated_at=?
             WHERE endpoint=?`
          )
          .bind(JSON.stringify(computed.draftIds || []), Number(computed.leagueCount || 0), now, s.endpoint)
          .run();
        s.draftIds = computed.draftIds || [];
        s.leagueCount = Number(computed.leagueCount || 0);
        s.updatedAt = now;
        if (computed.userId) userIdCache.set(s.username, computed.userId);
      } catch {
        // ignore
      }
    }

    // Preload active drafts from registry.
    const activeRows = await db
      .prepare(
        `SELECT draft_id FROM push_draft_registry
         WHERE active=1`
      )
      .all();
    const activeDraftIdSet = new Set((activeRows?.results || []).map((r) => String(r?.draft_id || "")).filter(Boolean));
    step("active_drafts", { active: activeDraftIdSet.size });

    for (const s of subs) {
      if (!s.username) {
        skippedNoUsername++;
        continue;
      }
      if (!s.draftIds.length) {
        skippedNoDrafts++;
        continue;
      }

      // userId only needed for fallback (if roster_by_username_json missing).
      let userId = userIdCache.get(s.username);
      if (!userId) {
        try {
          userId = await getUserId(s.username);
          userIdCache.set(s.username, userId);
        } catch {
          userId = null;
        }
      }

      const activeDraftIdsForSub = (s.draftIds || []).filter((id) => activeDraftIdSet.has(String(id)));
      if (!activeDraftIdsForSub.length) continue;

      for (const draftId of activeDraftIdsForSub) {
        checked++;

        const reg = await db
          .prepare(
            `SELECT draft_id, status, last_picked, timer_sec, teams, reversal_round,
                    league_id, league_name, league_avatar,
                    draft_json, draft_order_json,
                    slot_to_roster_json, roster_by_username_json, traded_pick_owner_json,
                    current_pick, clock_ends_at
             FROM push_draft_registry
             WHERE draft_id=?`
          )
          .bind(String(draftId))
          .first();

        const status = String(reg?.status || "").toLowerCase();
        if (status !== "drafting" && status !== "paused") {
          await clearClockState(db, s.endpoint, draftId);
          dlog(draftId, { action: "skip_inactive", status });
          continue;
        }

        // Determine subscriber roster id
        const uname = String(s.username || "").toLowerCase().trim();
        let myRosterId = null;
        try {
          const rbu = reg?.roster_by_username_json ? JSON.parse(reg.roster_by_username_json) : null;
          if (rbu && typeof rbu === "object") myRosterId = rbu[uname] != null ? String(rbu[uname]) : null;
        } catch {
          myRosterId = null;
        }

        // Fallback: if registry context missing, we can't accurately handle traded picks.
        if (!myRosterId) {
          skippedNoContext++;
          dlog(draftId, { action: "skip_no_roster_context", hasRosterByUsername: !!reg?.roster_by_username_json, userId: userId || null });
          continue;
        }

        const currentPick = reg?.current_pick != null ? Number(reg.current_pick) : null;
        const teams = Number(reg?.teams || 0);
        if (!currentPick || !teams) {
          skippedNoContext++;
          dlog(draftId, { action: "skip_missing_current_pick", currentPick, teams });
          continue;
        }

        let slotToRoster = null;
        let tradedOwners = null;
        let seasonStr = "";
        let reversalRound = Number(reg?.reversal_round || 0) || 0;

        try {
          slotToRoster = reg?.slot_to_roster_json ? JSON.parse(reg.slot_to_roster_json) : null;
        } catch {
          slotToRoster = null;
        }
        try {
          tradedOwners = reg?.traded_pick_owner_json ? JSON.parse(reg.traded_pick_owner_json) : null;
        } catch {
          tradedOwners = null;
        }
        try {
          const d = reg?.draft_json ? JSON.parse(reg.draft_json) : null;
          seasonStr = String(d?.season || "");
          if (!reversalRound) reversalRound = Number(d?.settings?.reversal_round || 0) || 0;
        } catch {
          seasonStr = "";
        }

        if (!slotToRoster || typeof slotToRoster !== "object") {
          skippedNoContext++;
          dlog(draftId, { action: "skip_missing_slot_to_roster" });
          continue;
        }

        const rosterOnClock = resolveRosterForPick({
          pickNo: currentPick,
          teams,
          slotToRoster,
          tradedPickOwners: tradedOwners,
          seasonStr,
          reversalRound,
        });

        const isOnClock = rosterOnClock && String(rosterOnClock) === String(myRosterId);
        if (!isOnClock) {
          await clearClockState(db, s.endpoint, draftId);
          dlog(draftId, { action: "not_on_clock", myRosterId, rosterOnClock, currentPick });
          continue;
        }

        // Clock math + stage selection
        const timerSec = Number(reg?.timer_sec || 0) || 0;
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;
        const lastPickedMs = Number(reg?.last_picked || 0) || 0;
        const clockEndsAt = Number(reg?.clock_ends_at || 0) || (lastPickedMs && totalMs ? lastPickedMs + totalMs : 0);

        const clockState = await loadClockState(db, s.endpoint, draftId);
        const prevPickNo = Number(clockState?.pick_no ?? 0);
        const prevStatus = String(clockState?.last_status || "");
        const isNewPick = prevPickNo !== currentPick;

        // Freeze remaining when paused
        let remainingMs = totalMs > 0 && clockEndsAt > 0 ? Math.max(0, clockEndsAt - now) : 0;
        const frozenPausedRemaining = Number(clockState?.paused_remaining_ms ?? NaN);
        if (status === "paused" && Number.isFinite(frozenPausedRemaining)) {
          remainingMs = clamp(frozenPausedRemaining, 0, totalMs);
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
          pick_no: currentPick,
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
            status === "paused" ? (Number.isFinite(frozenPausedRemaining) ? frozenPausedRemaining : remainingMs) : null,
          paused_at_ms: status === "paused" ? (Number(clockState?.paused_at_ms || 0) || now) : null,
          resume_clock_start_ms:
            prevStatus === "paused" && status === "drafting" && totalMs > 0 ? now - (totalMs - remainingMs) : null,
        };

        if (stageToSend === "onclock") nextFlags.sent_onclock = 1;
        if (stageToSend === "p25") nextFlags.sent_25 = 1;
        if (stageToSend === "p50") nextFlags.sent_50 = 1;
        if (stageToSend === "ten") nextFlags.sent_10min = 1;
        if (stageToSend === "urgent") nextFlags.sent_urgent = 1;
        if (stageToSend === "final") nextFlags.sent_final = 1;
        if (stageToSend === "paused") nextFlags.sent_paused = 1;
        if (stageToSend === "unpaused") nextFlags.sent_unpaused = 1;

        await upsertClockState(db, s.endpoint, draftId, nextFlags);

        if (!stageToSend) {
          dlog(draftId, { action: "no_send", status, currentPick, remainingMs });
          continue;
        }

        const leagueId = reg?.league_id ? String(reg.league_id) : null;
        const leagueName = reg?.league_name || "your league";
        const leagueAvatar = reg?.league_avatar || null;

        const leagueUrl = sleeperLeagueUrl(leagueId) || sleeperDraftUrl(draftId);
        const draftUrl = sleeperDraftUrl(draftId);
        const icon = leagueAvatar || undefined;

        const { title, body } = buildMessage({ stage: stageToSend, leagueName, timeLeftText, timerSec });

        const isUrgent = stageToSend === "urgent";

        const pushRes = await sendPayload(s, {
          title,
          body,
          url: "/draft-pick-tracker",
          tag: `draft:${draftId}`,
          renotify: true,
          icon,
          badge: "/android-chrome-192x192.png",
          requireInteraction: isUrgent ? true : undefined,
          vibrate: isUrgent ? [100, 60, 100, 60, 180] : undefined,
          data: {
            url: "/draft-pick-tracker",
            leagueUrl,
            draftUrl,
            leagueId,
            draftId: String(draftId),
            pickNo: currentPick,
            stage: stageToSend,
            timeLeftMs: remainingMs,
          },
          actions: [
            { action: "open_tracker", title: "Open Tracker" },
            ...(leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
          ],
        });

        if (pushRes.ok) {
          sent++;
          dlog(draftId, { action: "sent", stage: stageToSend, currentPick, remainingMs });
        } else if (pushRes.status === 404 || pushRes.status === 410) {
          await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
          await clearClockState(db, s.endpoint, draftId);
          dlog(draftId, { action: "subscription_gone", status: pushRes.status });
        } else {
          dlog(draftId, { action: "send_failed", status: pushRes.status });
        }
      }
    }

    const out = {
      ok: true,
      subs: subs.length,
      checked,
      sent,
      skippedNoDrafts,
      skippedNoUsername,
      skippedNoContext,
    };

    if (DEBUG) out.debug = { steps: debug.steps, drafts: debug.drafts.slice(0, 500) };

    return NextResponse.json(out);
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}
