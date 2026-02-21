export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

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
      was_onclock INTEGER,
      sent_onclock INTEGER,
      sent_25 INTEGER,
      sent_50 INTEGER,
      sent_10min INTEGER,
      sent_urgent INTEGER,
      sent_final INTEGER,
      sent_paused INTEGER,
      sent_unpaused INTEGER,
      sent_auto INTEGER,
      pick_start_ms INTEGER,
      last_remaining_ms INTEGER,
      paused_remaining_ms INTEGER,
      paused_at_ms INTEGER,
      resume_clock_start_ms INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (endpoint, draft_id)
    )`,
    [
      { name: "was_onclock", type: "INTEGER" },
      { name: "sent_urgent", type: "INTEGER" },
      { name: "sent_auto", type: "INTEGER" },
      { name: "pick_start_ms", type: "INTEGER" },
      { name: "last_remaining_ms", type: "INTEGER" },
      { name: "paused_remaining_ms", type: "INTEGER" },
      { name: "paused_at_ms", type: "INTEGER" },
      { name: "resume_clock_start_ms", type: "INTEGER" },
    ]
  );
}

async function ensureDraftRegistryTable(db) {
  // Shared registry: lets us stop polling finished drafts for hours at a time,
  // while still keeping draft_ids stored on subscriptions for future ADP tooling.
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
        league_avatar TEXT
      )`
    )
    .run();

  // Back-compat: older deployments may have the table without newer columns.
  // Ensure draft_json exists so the tracker page can use the shared registry cache.
  try {
    const info = await db.prepare(`PRAGMA table_info(push_draft_registry)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
    if (!existing.has("draft_json")) {
      await db.prepare(`ALTER TABLE push_draft_registry ADD COLUMN draft_json TEXT`).run();
    }
  } catch {
    // ignore
  }
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

async function getPickCount(draftId) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sleeper picks fetch failed for ${draftId}: ${res.status}`);
  const picks = await res.json();
  return Array.isArray(picks) ? picks.length : 0;
}

async function getDraft(draftId) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper draft fetch failed for ${draftId}: ${res.status}`);
  return res.json();
}

async function getLeague(leagueId) {
  if (!leagueId) return null;
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
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
  return {
    userId,
    leagueCount: leagues.length,
    draftIds: Array.from(new Set(draftIds)),
  };
}

function getCurrentSlotSnake(pickNo, teams) {
  const idx = (pickNo - 1) % teams;
  const round = Math.floor((pickNo - 1) / teams) + 1;
  const slot = round % 2 === 1 ? idx + 1 : teams - idx;
  return { slot, round };
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

function bestLeagueAvatarUrl({ league, draft }) {
  const leagueAvatar = league?.avatar || null;
  const draftAvatar = draft?.metadata?.avatar || null;
  const avatarId = leagueAvatar || draftAvatar;
  return avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null;
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

  const AUTO_TITLES = ["🚨 Auto-pick happened", "🚨 You got auto-picked", "Auto-pick alert"];
  const AUTO_BODIES = [
    `${leagueName}: your timer hit 0 and an auto-pick was made.`,
    `Auto-pick in ${leagueName} — you ran out of time.`,
    `${leagueName}: looks like the clock expired and you were auto-picked.`,
  ];

  if (stage === "onclock") return { title: pickVariant(ONCLOCK_TITLES, baseSeed), body: pickVariant(ONCLOCK_BODIES, baseSeed) };
  if (stage === "p25") return { title: pickVariant(P25_TITLES, baseSeed), body: pickVariant(P25_BODIES, baseSeed) };
  if (stage === "p50") return { title: pickVariant(P50_TITLES, baseSeed), body: pickVariant(P50_BODIES, baseSeed) };
  if (stage === "ten") return { title: pickVariant(TEN_TITLES, baseSeed), body: pickVariant(TEN_BODIES, baseSeed) };
  if (stage === "urgent") return { title: pickVariant(URGENT_TITLES, baseSeed), body: pickVariant(URGENT_BODIES, baseSeed) };
  if (stage === "final") return { title: pickVariant(FINAL_TITLES, baseSeed), body: pickVariant(FINAL_BODIES, baseSeed) };
  if (stage === "paused") return { title: pickVariant(PAUSED_TITLES, baseSeed), body: pickVariant(PAUSED_BODIES, baseSeed) };
  if (stage === "unpaused") return { title: pickVariant(UNPAUSED_TITLES, baseSeed), body: pickVariant(UNPAUSED_BODIES, baseSeed) };
  if (stage === "auto") return { title: pickVariant(AUTO_TITLES, baseSeed), body: pickVariant(AUTO_BODIES, baseSeed) };
  return { title: "Draft Update", body: `Update in "${leagueName}".` };
}

async function loadClockState(db, endpoint, draftId) {
  return db
    .prepare(
      `SELECT pick_no, last_status,
              was_onclock,
              sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final, sent_paused, sent_unpaused,
              sent_auto, pick_start_ms,
              last_remaining_ms,
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
          was_onclock,
          sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final, sent_paused, sent_unpaused,
          sent_auto, pick_start_ms,
          last_remaining_ms,
          paused_remaining_ms, paused_at_ms, resume_clock_start_ms,
          updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint, draft_id) DO UPDATE SET
         pick_no=excluded.pick_no,
         last_status=excluded.last_status,
         was_onclock=excluded.was_onclock,
         sent_onclock=excluded.sent_onclock,
         sent_25=excluded.sent_25,
         sent_50=excluded.sent_50,
         sent_10min=excluded.sent_10min,
         sent_urgent=excluded.sent_urgent,
         sent_final=excluded.sent_final,
         sent_paused=excluded.sent_paused,
         sent_unpaused=excluded.sent_unpaused,
         sent_auto=excluded.sent_auto,
         pick_start_ms=excluded.pick_start_ms,
         last_remaining_ms=excluded.last_remaining_ms,
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
      Number(row.was_onclock || 0),
      Number(row.sent_onclock || 0),
      Number(row.sent_25 || 0),
      Number(row.sent_50 || 0),
      Number(row.sent_10min || 0),
      Number(row.sent_urgent || 0),
      Number(row.sent_final || 0),
      Number(row.sent_paused || 0),
      Number(row.sent_unpaused || 0),
      Number(row.sent_auto || 0),
      row.pick_start_ms == null ? null : Number(row.pick_start_ms),
      row.last_remaining_ms == null ? null : Number(row.last_remaining_ms),
      row.paused_remaining_ms == null ? null : Number(row.paused_remaining_ms),
      row.paused_at_ms == null ? null : Number(row.paused_at_ms),
      row.resume_clock_start_ms == null ? null : Number(row.resume_clock_start_ms),
      now
    )
    .run();
}

async function clearClockState(db, endpoint, draftId) {
  return db.prepare(`DELETE FROM push_clock_state WHERE endpoint=? AND draft_id=?`).bind(endpoint, String(draftId)).run();
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
  return (await db.prepare(`SELECT * FROM push_draft_cache WHERE draft_id=?`).bind(String(draftId)).first()) || null;
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

async function handler(req) {
  try {
    const { env } = getRequestContext();

    if (!assertAuth(req, env)) {
      return new NextResponse(
        "Unauthorized. Provide x-push-secret header, or ?key=... query param (cron-job.org fallback).",
        { status: 401 }
      );
    }

    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    await ensurePushTables(db);
    await ensureDraftCacheTable(db);
    await ensureDraftRegistryTable(db);

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
        try { sub = JSON.parse(r.subscription_json); } catch {}
        try { draftIds = JSON.parse(r.draft_ids_json || "[]"); } catch {}
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

    const draftCache = new Map();
    const leagueCache = new Map();
    const userIdCache = new Map();

    let sent = 0;
    let checked = 0;

    let skippedNoDrafts = 0;
    let skippedNoUsername = 0;
    let skippedNoOrder = 0;
    let skippedNotOnClock = 0;

    const sendPayload = async (subRow, payload) => {
      const { endpoint, fetchInit } = await buildWebPushRequest({
        subscription: subRow.sub,
        payload,
        vapidSubject,
        vapidPrivateJwk,
      });
      return fetch(endpoint, fetchInit);
    };

    // ---- Shared draft registry pass ----
    // Build one set of drafts we should actively poll (drafting/paused). Finished drafts
    // get cooled down in the registry so we aren't burning calls forever.
    const uniqueDraftIds = Array.from(
      new Set(
        subs
          .flatMap((s) => (Array.isArray(s.draftIds) ? s.draftIds : []))
          .filter(Boolean)
          .map(String)
      )
    );

    const ACTIVE_REFRESH_MS = 60 * 1000; // always re-check active drafts each run
    const INACTIVE_REFRESH_MS = 6 * 60 * 60 * 1000; // re-check inactive drafts every 6 hours
    const activeDraftIdSet = new Set();

    for (const draftId of uniqueDraftIds) {
      const reg = await db
        .prepare(
          `SELECT draft_id, active, status, last_checked_at
           FROM push_draft_registry
           WHERE draft_id=?`
        )
        .bind(String(draftId))
        .first();

      const lastChecked = Number(reg?.last_checked_at || 0);
      const wasActive = Number(reg?.active || 0) === 1;
      const needsRecheck =
        !lastChecked || now - lastChecked > (wasActive ? ACTIVE_REFRESH_MS : INACTIVE_REFRESH_MS);

      if (!needsRecheck) {
        if (wasActive) activeDraftIdSet.add(String(draftId));
        continue;
      }

      let draft;
      try {
        draft = await (async () => {
          const cached = draftCache.get(draftId);
          if (cached) return cached;
          const d = await getDraft(draftId);
          draftCache.set(draftId, d);
          return d;
        })();
      } catch {
        // If Sleeper is flaky, keep prior classification.
        if (wasActive) activeDraftIdSet.add(String(draftId));
        continue;
      }

      const status = String(draft?.status || "").toLowerCase();
      const isActive = status === "drafting" || status === "paused";
      const teams = Number(draft?.settings?.teams || 0) || null;
      const timerSec = Number(draft?.settings?.pick_timer || 0) || null;
      const lastPicked = Number(draft?.last_picked || 0) || null;
      const leagueId = draft?.league_id || draft?.metadata?.league_id || null;

      await db
        .prepare(
          `INSERT INTO push_draft_registry (
            draft_id, active, status, last_checked_at, last_active_at, last_inactive_at,
            last_picked, pick_count, draft_json, draft_order_json, teams, timer_sec,
            league_id, league_name, league_avatar
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            active=excluded.active,
            status=excluded.status,
            last_checked_at=excluded.last_checked_at,
            last_active_at=excluded.last_active_at,
            last_inactive_at=excluded.last_inactive_at,
            last_picked=excluded.last_picked,
            teams=excluded.teams,
            timer_sec=excluded.timer_sec,
            league_id=excluded.league_id,
            draft_json=excluded.draft_json,
            draft_order_json=excluded.draft_order_json`
        )
        .bind(
          String(draftId),
          isActive ? 1 : 0,
          status,
          now,
          isActive ? now : Number(reg?.last_active_at || 0) || null,
          !isActive ? now : Number(reg?.last_inactive_at || 0) || null,
          lastPicked,
          null,
          JSON.stringify(draft || {}),
          draft?.draft_order ? JSON.stringify(draft.draft_order) : null,
          teams,
          timerSec,
          leagueId ? String(leagueId) : null,
          null,
          null
        )
        .run();

      if (isActive) activeDraftIdSet.add(String(draftId));
    }

    for (const s of subs) {
      if (!s.username) {
        skippedNoUsername++;
        continue;
      }

      const REFRESH_MS = 15 * 60 * 1000;
      const needsRefresh = !s.draftIds.length || !s.updatedAt || now - s.updatedAt > REFRESH_MS;

      if (needsRefresh) {
        try {
          const computed = await computeDraftIdsForUsername(s.username);
          const newDraftIds = computed.draftIds || [];
          const newLeagueCount = Number(computed.leagueCount || 0);

          await db
            .prepare(
              `UPDATE push_subscriptions
               SET draft_ids_json=?, league_count=?, updated_at=?
               WHERE endpoint=?`
            )
            .bind(JSON.stringify(newDraftIds), newLeagueCount, now, s.endpoint)
            .run();

          s.draftIds = newDraftIds;
          s.leagueCount = newLeagueCount;
          s.updatedAt = now;

          if (computed.userId) userIdCache.set(s.username, computed.userId);

          if (!s.draftIds.length) {
            skippedNoDrafts++;
            continue;
          }
        } catch {
          if (!s.draftIds.length) {
            skippedNoDrafts++;
            continue;
          }
        }
      }

      if (!s.draftIds.length) {
        skippedNoDrafts++;
        continue;
      }

      let userId = userIdCache.get(s.username);
      if (!userId) {
        userId = await getUserId(s.username);
        userIdCache.set(s.username, userId);
      }
      if (!userId) {
        skippedNoOrder++;
        continue;
      }

      const onClockBatch = [];
      const pausedBatch = [];
      const unpausedBatch = [];

      // Only iterate drafts that are currently active (drafting/paused).
      const activeDraftIdsForSub = (s.draftIds || []).filter((id) => activeDraftIdSet.has(String(id)));
      for (const draftId of activeDraftIdsForSub) {
        checked++;

        const draft = await (async () => {
          const cached = draftCache.get(draftId);
          if (cached) return cached;
          const d = await getDraft(draftId);
          draftCache.set(draftId, d);
          return d;
        })();

        const status = String(draft?.status || "").toLowerCase();
        if (status !== "drafting" && status !== "paused") {
          await clearClockState(db, s.endpoint, draftId);
          continue;
        }

        const teams = Number(draft?.settings?.teams || 0);
        const timerSec = Number(draft?.settings?.pick_timer || 0);
        const draftOrder = draft?.draft_order || null;

        if (!teams || !draftOrder || !draftOrder[userId]) {
          skippedNoOrder++;
          continue;
        }

        const userSlot = Number(draftOrder[userId]);
        const lastPicked = Number(draft?.last_picked || 0);

        const draftCacheRow = await loadDraftCache(db, draftId);

        let pickCount;
        if (
          draftCacheRow &&
          Number(draftCacheRow.last_picked || 0) === lastPicked &&
          Number.isFinite(Number(draftCacheRow.pick_count))
        ) {
          pickCount = Number(draftCacheRow.pick_count);
        } else {
          pickCount = await getPickCount(draftId);
          await saveDraftCache(db, draftId, { last_picked: lastPicked, pick_count: pickCount });
        }

        // Keep the shared registry in-sync so the Draft Monitor page can read draft + pick counts
        // without each client hammering Sleeper.
        await db
          .prepare(
            `UPDATE push_draft_registry
             SET last_picked=?, pick_count=?, draft_json=?, last_checked_at=?
             WHERE draft_id=?`
          )
          .bind(lastPicked, pickCount, JSON.stringify(draft || {}), now, String(draftId))
          .run();

        const nextPickNo = pickCount + 1;
        const { slot: currentSlot } = getCurrentSlotSnake(nextPickNo, teams);
        const isOnClock = currentSlot === userSlot;

        // Load previous per-endpoint state early so we can (a) freeze pause time accurately and
        // (b) detect likely auto-picks when the clock advances and you're no longer on the clock.
        const clockState = await loadClockState(db, s.endpoint, draftId);

        if (!isOnClock) {
          // Likely auto-pick detection:
          // Sleeper doesn't explicitly label auto picks, so we infer it when:
          // - you WERE on the clock for the previous pick
          // - the pick advanced (prevPickNo === nextPickNo - 1)
          // - elapsed time from pick start to last_picked is ~the full timer
          const prevPickNo = Number(clockState?.pick_no ?? 0);
          const wasOnClock = Number(clockState?.was_onclock ?? 0) === 1;
          const sentAuto = Number(clockState?.sent_auto ?? 0) === 1;
          const startMs = Number(clockState?.pick_start_ms ?? 0);
          const endMs = Number(draft?.last_picked || 0);
          const timerMs = timerSec > 0 ? timerSec * 1000 : 0;
          const tolMs = timerMs > 0 ? Math.min(15_000, Math.max(5_000, Math.floor(timerMs * 0.05))) : 0;

          if (!sentAuto && wasOnClock && prevPickNo > 0 && prevPickNo === nextPickNo - 1 && timerMs > 0 && endMs > 0) {
            const elapsed = startMs > 0 ? endMs - startMs : 0;
            if (elapsed >= timerMs - tolMs) {
              const leagueId = draft?.league_id || draft?.metadata?.league_id || null;
              const leagueName = draft?.metadata?.name || draft?.metadata?.league_name || "your league";
              const icon = draft?.metadata?.avatar
                ? `https://sleepercdn.com/avatars/thumbs/${draft.metadata.avatar}`
                : null;
              const leagueUrl = sleeperLeagueUrl(leagueId) || sleeperDraftUrl(draftId);
              const draftUrl = sleeperDraftUrl(draftId);
              const { title, body } = buildMessage({ stage: "auto", leagueName, timeLeftText: "0:00", timerSec });

              const pushRes = await sendPayload(s, {
                title,
                body,
                url: "/draft-pick-tracker",
                tag: `draft:${draftId}:auto:${prevPickNo}`,
                renotify: true,
                requireInteraction: true,
                icon,
                badge: "/android-chrome-192x192.png",
                data: {
                  url: "/draft-pick-tracker",
                  leagueUrl,
                  draftUrl,
                  leagueId,
                  draftId: String(draftId),
                  pickNo: prevPickNo,
                  stage: "auto",
                  timeLeftMs: 0,
                },
                actions: [
                  { action: "open_tracker", title: "Open Tracker" },
                  ...(leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
                ],
              });

              if (pushRes.ok) sent++;

              // Mark auto sent so we don't double-fire if multiple polls happen before state clears.
              await upsertClockState(db, s.endpoint, draftId, {
                pick_no: prevPickNo,
                last_status: String(clockState?.last_status || ""),
                was_onclock: 0,
                sent_auto: 1,
                sent_onclock: Number(clockState?.sent_onclock ?? 0),
                sent_25: Number(clockState?.sent_25 ?? 0),
                sent_50: Number(clockState?.sent_50 ?? 0),
                sent_10min: Number(clockState?.sent_10min ?? 0),
                sent_urgent: Number(clockState?.sent_urgent ?? 0),
                sent_final: Number(clockState?.sent_final ?? 0),
                sent_paused: Number(clockState?.sent_paused ?? 0),
                sent_unpaused: Number(clockState?.sent_unpaused ?? 0),
                pick_start_ms: startMs || null,
                last_remaining_ms: Number(clockState?.last_remaining_ms ?? null),
                paused_remaining_ms: Number(clockState?.paused_remaining_ms ?? null),
                paused_at_ms: Number(clockState?.paused_at_ms ?? null),
                resume_clock_start_ms: Number(clockState?.resume_clock_start_ms ?? null),
              });
            }
          }

          await clearClockState(db, s.endpoint, draftId);
          skippedNotOnClock++;
          continue;
        }

        const leagueId = draft?.league_id || draft?.metadata?.league_id || null;

        let league = null;
        if (leagueId) {
          const cachedL = leagueCache.get(String(leagueId));
          if (cachedL) {
            league = cachedL;
          } else if (
            draftCacheRow?.league_id &&
            (draftCacheRow?.league_name || draftCacheRow?.league_avatar)
          ) {
            league = { name: draftCacheRow.league_name || null, avatar: draftCacheRow.league_avatar || null };
            leagueCache.set(String(leagueId), league);
          } else {
            league = await getLeague(leagueId);
            leagueCache.set(String(leagueId), league);
            if (league?.name || league?.avatar) {
              await saveDraftCache(db, draftId, {
                league_id: String(leagueId),
                league_name: league?.name || null,
                league_avatar: league?.avatar || null,
              });
            }
          }
        }

        const leagueName =
          draft?.metadata?.name || draft?.metadata?.league_name || league?.name || "your league";

        // clockState already loaded above (before isOnClock checks)
        const prevPickNo = Number(clockState?.pick_no ?? 0);
        const prevStatus = String(clockState?.last_status || "");
        const isNewPick = prevPickNo !== nextPickNo;

        const lastPickedMs = Number(draft?.last_picked || 0);
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;

        // Base "clock start" normally comes from Sleeper's last_picked timestamp.
        // But when a draft pauses, Sleeper doesn't include pause duration in last_picked,
        // so remaining time becomes wrong. We freeze remaining time when paused, then
        // synthesize a new clock start when it resumes.
        let clockStart = lastPickedMs > 0 ? lastPickedMs : now;

        const frozenPausedRemaining = Number(clockState?.paused_remaining_ms ?? NaN);
        if (prevStatus === "paused" && status === "drafting" && totalMs > 0) {
          // resumed: use stored resume_clock_start_ms when possible (prevents drift / false "0:00" urgency).
          const resumeStart = Number(clockState?.resume_clock_start_ms ?? NaN);
          if (Number.isFinite(resumeStart) && resumeStart > 0) {
            clockStart = resumeStart;
          } else if (Number.isFinite(frozenPausedRemaining)) {
            clockStart = now - (totalMs - frozenPausedRemaining);
          }
        }

        let remainingMs = totalMs > 0 ? Math.max(0, clockStart + totalMs - now) : 0;
        if (status === "paused" && Number.isFinite(frozenPausedRemaining)) {
          remainingMs = clamp(frozenPausedRemaining, 0, totalMs);
        }

        const timeLeftText = totalMs > 0 ? msToClock(remainingMs) : "-";

        let stageToSend = null;

        const sentPaused = Number(clockState?.sent_paused ?? 0) === 1;
        const sentUnpaused = Number(clockState?.sent_unpaused ?? 0) === 1;
        const sentOnclock = Number(clockState?.sent_onclock ?? 0) === 1;
        const sent25 = Number(clockState?.sent_25 ?? 0) === 1;
        const sent50 = Number(clockState?.sent_50 ?? 0) === 1;
        const sent10 = Number(clockState?.sent_10min ?? 0) === 1;
        const sentUrgent = Number(clockState?.sent_urgent ?? 0) === 1;
        const sentFinal = Number(clockState?.sent_final ?? 0) === 1;

        if (status === "paused") {
          if (isNewPick || !sentPaused) stageToSend = "paused";
        } else {
          if (prevStatus === "paused" && !sentUnpaused) stageToSend = "unpaused";
          else if (isNewPick || !sentOnclock) stageToSend = "onclock";
          else if (totalMs > 0) {
            const usedFrac = 1 - remainingMs / totalMs;

            // Always: critical alert at <= 2 minutes remaining.
            if (remainingMs <= 120000 && !sentUrgent) stageToSend = "urgent";
            else {
              // 10-minute warning only makes sense for timers > 10 minutes.
              // Also prevent it from firing immediately after the initial on-clock ping.
              const canTen = totalMs > 600000; // > 10 minutes total
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

        if (!stageToSend) {
          const lastRem = Number(clockState?.last_remaining_ms ?? NaN);
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: status,
            was_onclock: 1,
            sent_onclock: isNewPick ? 0 : sentOnclock ? 1 : 0,
            sent_25: isNewPick ? 0 : sent25 ? 1 : 0,
            sent_50: isNewPick ? 0 : sent50 ? 1 : 0,
            sent_10min: isNewPick ? 0 : sent10 ? 1 : 0,
            sent_urgent: isNewPick ? 0 : sentUrgent ? 1 : 0,
            sent_final: isNewPick ? 0 : sentFinal ? 1 : 0,
            sent_paused: isNewPick ? 0 : sentPaused ? 1 : 0,
            sent_unpaused: isNewPick ? 0 : sentUnpaused ? 1 : 0,
            sent_auto: Number(clockState?.sent_auto ?? 0),
            pick_start_ms:
              isNewPick || !Number.isFinite(Number(clockState?.pick_start_ms))
                ? clockStart
                : Number(clockState?.pick_start_ms),
            last_remaining_ms: status === "drafting" ? remainingMs : Number.isFinite(lastRem) ? lastRem : null,
            paused_remaining_ms:
              status === "paused"
                ? Number.isFinite(Number(clockState?.paused_remaining_ms))
                  ? Number(clockState?.paused_remaining_ms)
                  : Number.isFinite(lastRem)
                    ? lastRem
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
                ? now - (totalMs - (Number.isFinite(frozenPausedRemaining) ? frozenPausedRemaining : remainingMs))
                : null,
          });
          continue;
        }

        const nextFlags = {
          // Keep a "last known" remaining while drafting so if the league pauses
          // between polls we can freeze close to the real remaining time.
          pick_no: nextPickNo,
          last_status: status,
          was_onclock: 1,
          sent_onclock: isNewPick ? 0 : sentOnclock ? 1 : 0,
          sent_25: isNewPick ? 0 : sent25 ? 1 : 0,
          sent_50: isNewPick ? 0 : sent50 ? 1 : 0,
          sent_10min: isNewPick ? 0 : sent10 ? 1 : 0,
          sent_urgent: isNewPick ? 0 : sentUrgent ? 1 : 0,
          sent_final: isNewPick ? 0 : sentFinal ? 1 : 0,
          sent_paused: isNewPick ? 0 : sentPaused ? 1 : 0,
          sent_unpaused: isNewPick ? 0 : sentUnpaused ? 1 : 0,
          sent_auto: Number(clockState?.sent_auto ?? 0),
          pick_start_ms:
            isNewPick || !Number.isFinite(Number(clockState?.pick_start_ms))
              ? clockStart
              : Number(clockState?.pick_start_ms),
          last_remaining_ms: status === "drafting" ? remainingMs : Number.isFinite(Number(clockState?.last_remaining_ms)) ? Number(clockState?.last_remaining_ms) : null,
          paused_remaining_ms:
            status === "paused"
              ? Number.isFinite(Number(clockState?.paused_remaining_ms))
                ? Number(clockState?.paused_remaining_ms)
                : Number.isFinite(Number(clockState?.last_remaining_ms))
                  ? Number(clockState?.last_remaining_ms)
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
              ? now - (totalMs - (Number.isFinite(frozenPausedRemaining) ? frozenPausedRemaining : remainingMs))
              : null,
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

        const leagueUrl = sleeperLeagueUrl(leagueId) || sleeperDraftUrl(draftId);
        const draftUrl = sleeperDraftUrl(draftId);
        const icon = bestLeagueAvatarUrl({ league, draft });
        const { title, body } = buildMessage({ stage: stageToSend, leagueName, timeLeftText, timerSec });

        if (stageToSend === "onclock") {
          onClockBatch.push({
            leagueName,
            remainingMs,
            icon,
            leagueUrl,
            draftUrl,
            leagueId: String(leagueId || ""),
            draftId: String(draftId),
            pickNo: nextPickNo,
          });
          continue;
        }

        if (stageToSend === "paused") {
          pausedBatch.push({
            leagueName,
            remainingMs,
            icon,
            leagueUrl,
            draftUrl,
            leagueId: String(leagueId || ""),
            draftId: String(draftId),
            pickNo: nextPickNo,
          });
          continue;
        }

        if (stageToSend === "unpaused") {
          unpausedBatch.push({
            leagueName,
            remainingMs,
            icon,
            leagueUrl,
            draftUrl,
            leagueId: String(leagueId || ""),
            draftId: String(draftId),
            pickNo: nextPickNo,
          });
          continue;
        }

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
            draftId,
            pickNo: nextPickNo,
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
        } else if (pushRes.status === 404 || pushRes.status === 410) {
          await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
          await clearClockState(db, s.endpoint, draftId);
        }
      } // end for each draftId

      // ----- onClock batching (per endpoint) -----
      if (onClockBatch.length === 1) {
        const b = onClockBatch[0];
        const timeLeftText2 = msToClock(b.remainingMs);
        const msg = buildMessage({ stage: "onclock", leagueName: b.leagueName, timeLeftText: timeLeftText2, timerSec: 0 });

        const pushRes = await sendPayload(s, {
          title: msg.title,
          body: msg.body,
          url: "/draft-pick-tracker",
          tag: `draft:${b.draftId}`,
          renotify: true,
          icon: b.icon,
          badge: "/android-chrome-192x192.png",
          data: {
            url: "/draft-pick-tracker",
            leagueUrl: b.leagueUrl,
            draftUrl: b.draftUrl,
            leagueId: b.leagueId,
            draftId: b.draftId,
            pickNo: b.pickNo,
            stage: "onclock",
            timeLeftMs: b.remainingMs,
          },
          actions: [
            { action: "open_tracker", title: "Open Tracker" },
            ...(b.leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
          ],
        });

        if (pushRes.ok) sent++;
      } else if (onClockBatch.length > 1) {
        const lines = onClockBatch
          .slice(0, 6)
          .map((x) => `• ${x.leagueName} - ${msToClock(x.remainingMs)}`)
          .join("\n");
        const more = onClockBatch.length > 6 ? `\n+${onClockBatch.length - 6} more` : "";

        const pushRes = await sendPayload(s, {
          title: `You're on the clock (${onClockBatch.length} leagues)`,
          body: `${lines}${more}`,
          url: "/draft-pick-tracker",
          tag: "onclock-summary",
          renotify: true,
          icon: onClockBatch[0]?.icon,
          badge: "/android-chrome-192x192.png",
          data: { url: "/draft-pick-tracker" },
          actions: [{ action: "open_tracker", title: "Open Tracker" }],
        });

        if (pushRes.ok) sent++;
      }

      // ----- paused batching (per endpoint) -----
      if (pausedBatch.length === 1) {
        const b = pausedBatch[0];
        const t = msToClock(b.remainingMs);
        const msg = buildMessage({ stage: "paused", leagueName: b.leagueName, timeLeftText: t, timerSec: 0 });

        const pushRes = await sendPayload(s, {
          title: msg.title,
          body: msg.body,
          url: "/draft-pick-tracker",
          tag: `draft:${b.draftId}`,
          renotify: true,
          icon: b.icon,
          badge: "/android-chrome-192x192.png",
          data: {
            url: "/draft-pick-tracker",
            leagueUrl: b.leagueUrl,
            draftUrl: b.draftUrl,
            leagueId: b.leagueId,
            draftId: b.draftId,
            pickNo: b.pickNo,
            stage: "paused",
            timeLeftMs: b.remainingMs,
          },
          actions: [
            { action: "open_tracker", title: "Open Tracker" },
            ...(b.leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
          ],
        });

        if (pushRes.ok) sent++;
      } else if (pausedBatch.length > 1) {
        const lines = pausedBatch
          .slice(0, 6)
          .map((x) => `• ${x.leagueName} - resumes with ${msToClock(x.remainingMs)}`)
          .join("\n");
        const more = pausedBatch.length > 6 ? `\n+${pausedBatch.length - 6} more` : "";

        const pushRes = await sendPayload(s, {
          title: `Paused (but you're up in ${pausedBatch.length})`,
          body: `${lines}${more}`,
          url: "/draft-pick-tracker",
          tag: "paused-summary",
          renotify: true,
          icon: pausedBatch[0]?.icon,
          badge: "/android-chrome-192x192.png",
          data: { url: "/draft-pick-tracker" },
          actions: [{ action: "open_tracker", title: "Open Tracker" }],
        });

        if (pushRes.ok) sent++;
      }

      // ----- unpaused batching (per endpoint) -----
      if (unpausedBatch.length === 1) {
        const b = unpausedBatch[0];
        const t = msToClock(b.remainingMs);
        const msg = buildMessage({ stage: "unpaused", leagueName: b.leagueName, timeLeftText: t, timerSec: 0 });

        const pushRes = await sendPayload(s, {
          title: msg.title,
          body: msg.body,
          url: "/draft-pick-tracker",
          tag: `draft:${b.draftId}`,
          renotify: true,
          icon: b.icon,
          badge: "/android-chrome-192x192.png",
          data: {
            url: "/draft-pick-tracker",
            leagueUrl: b.leagueUrl,
            draftUrl: b.draftUrl,
            leagueId: b.leagueId,
            draftId: b.draftId,
            pickNo: b.pickNo,
            stage: "unpaused",
            timeLeftMs: b.remainingMs,
          },
          actions: [
            { action: "open_tracker", title: "Open Tracker" },
            ...(b.leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
          ],
        });

        if (pushRes.ok) sent++;
      } else if (unpausedBatch.length > 1) {
        const lines = unpausedBatch
          .slice(0, 6)
          .map((x) => `• ${x.leagueName} - ${msToClock(x.remainingMs)} left`)
          .join("\n");
        const more = unpausedBatch.length > 6 ? `\n+${unpausedBatch.length - 6} more` : "";

        const pushRes = await sendPayload(s, {
          title: `Drafts resumed (${unpausedBatch.length} leagues)`,
          body: `${lines}${more}`,
          url: "/draft-pick-tracker",
          tag: "unpaused-summary",
          renotify: true,
          icon: unpausedBatch[0]?.icon,
          badge: "/android-chrome-192x192.png",
          data: { url: "/draft-pick-tracker" },
          actions: [{ action: "open_tracker", title: "Open Tracker" }],
        });

        if (pushRes.ok) sent++;
      }
    } // end subs loop

    return NextResponse.json({
      ok: true,
      subs: subs.length,
      checked,
      sent,
      skippedNoDrafts,
      skippedNoUsername,
      skippedNoOrder,
      skippedNotOnClock,
    });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}