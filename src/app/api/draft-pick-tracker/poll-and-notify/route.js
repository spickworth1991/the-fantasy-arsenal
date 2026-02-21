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
      sent_onclock INTEGER,
      sent_25 INTEGER,
      sent_50 INTEGER,
      sent_10min INTEGER,
      sent_final INTEGER,
      sent_paused INTEGER,
      sent_unpaused INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (endpoint, draft_id)
    )`
  );
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

  // 1) Preferred: header (works great from your own scripts / curl / GitHub actions)
  const headerSecret = req.headers.get("x-push-secret");
  if (headerSecret && headerSecret === expected) return true;

  // 2) Fallback for cron providers that can't set headers: query param
  //    Example: /api/draft-pick-tracker/poll-and-notify?key=YOUR_SECRET
  //    (Still protected; just less ideal than headers because URLs can leak in logs.)
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

// Snake: round odd L->R, round even R->L
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

// tiny deterministic hash -> stable “random” variations per stage
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

  const ONCLOCK_TITLES = [
    "You're on the clock 🕒",
    "Your pick is up 👀",
    "ON THE CLOCK",
    "Draft alert: your turn",
  ];
  const ONCLOCK_BODIES = [
    `You're on the clock in "${leagueName}". Time left: ${timeLeftText}.`,
    `It's your pick in "${leagueName}". ${timeLeftText} remaining.`,
    `"${leagueName}" — you're up. Clock: ${timeLeftText}.`,
  ];

  const P25_TITLES = ["Clock check: 25% used", "Quick reminder ⏳", "Don’t forget your pick"];
  const P25_BODIES = [
    `You've used ~25% of your clock in "${leagueName}". Don’t forget to pick. (${timeLeftText} left)`,
    `"${leagueName}": 25% of your timer is gone. Make your pick when ready. (${timeLeftText} left)`,
    `Friendly nudge — "${leagueName}" clock is moving. (${timeLeftText} left)`,
  ];

  const P50_TITLES = ["Half your clock is gone", "You good? 😅", "Still on the clock"];
  const P50_BODIES = [
    `You've used ~50% of your clock in "${leagueName}". Did you forget? (${timeLeftText} left)`,
    `"${leagueName}": halfway through your timer. Don’t get auto-picked. (${timeLeftText} left)`,
    `Just checking — still your pick in "${leagueName}". (${timeLeftText} left)`,
  ];

  const TEN_TITLES = ["⚠️ 10 minutes left", "Seriously… 10 minutes left", "Final stretch"];
  const TEN_BODIES = [
    `Seriously — you only have 10 minutes left in "${leagueName}". Make your pick.`,
    `"${leagueName}": 10 minutes remaining. Lock it in.`,
    `10 minutes left on the clock in "${leagueName}". Don’t get burned.`,
  ];

  const FINAL_TITLES = ["⚠️ Almost out of time", "Last call", "Clock is dying"];
  const FINAL_BODIES = [
    `"${leagueName}": you're almost out of time. (${timeLeftText} left)`,
    `Last call — "${leagueName}" pick timer is almost done. (${timeLeftText} left)`,
    `Clock’s about to expire in "${leagueName}". (${timeLeftText} left)`,
  ];

  const PAUSED_TITLES = [
    "Draft paused — but it’s your pick",
    "Paused… you’re still up",
    "⏸️ Paused, but you’re on deck",
    "League paused (your pick next)",
  ];
  const PAUSED_BODIES = [
    `"${leagueName}" is paused, but it’s your pick! your timer will start at ${timeLeftText}.`,
    `Heads up — "${leagueName}" is paused, but you’re up next. Timer resumes at ${timeLeftText}.`,
    `"${leagueName}" paused. You’re on the clock when it resumes (${timeLeftText}).`,
    `Paused in "${leagueName}" — you’re still the pick. Resume clock: ${timeLeftText}.`,
  ];

  const UNPAUSED_TITLES = [
    "Draft resumed — you’re up",
    "▶️ Back on: your pick",
    "Unpaused… clock is running",
    "Draft unpaused (still your turn)",
  ];
  const UNPAUSED_BODIES = [
    `"${leagueName}" resumed — you’re on the clock. (${timeLeftText} left)`,
    `Unpaused in "${leagueName}" — your pick is live. (${timeLeftText} left)`,
    `We’re back. "${leagueName}" clock is ticking: ${timeLeftText} remaining.`,
    `"${leagueName}" unpaused — don’t get auto-picked. (${timeLeftText} left)`,
  ];

  if (stage === "onclock") {
    return { title: pickVariant(ONCLOCK_TITLES, baseSeed), body: pickVariant(ONCLOCK_BODIES, baseSeed) };
  }
  if (stage === "p25") {
    return { title: pickVariant(P25_TITLES, baseSeed), body: pickVariant(P25_BODIES, baseSeed) };
  }
  if (stage === "p50") {
    return { title: pickVariant(P50_TITLES, baseSeed), body: pickVariant(P50_BODIES, baseSeed) };
  }
  if (stage === "ten") {
    return { title: pickVariant(TEN_TITLES, baseSeed), body: pickVariant(TEN_BODIES, baseSeed) };
  }
  if (stage === "final") {
    return { title: pickVariant(FINAL_TITLES, baseSeed), body: pickVariant(FINAL_BODIES, baseSeed) };
  }
  if (stage === "paused") {
    return { title: pickVariant(PAUSED_TITLES, baseSeed), body: pickVariant(PAUSED_BODIES, baseSeed) };
  }
  if (stage === "unpaused") {
    return { title: pickVariant(UNPAUSED_TITLES, baseSeed), body: pickVariant(UNPAUSED_BODIES, baseSeed) };
  }
  return { title: "Draft Update", body: `Update in "${leagueName}".` };
}

async function loadClockState(db, endpoint, draftId) {
  return db
    .prepare(
      `SELECT pick_no, last_status,
              sent_onclock, sent_25, sent_50, sent_10min, sent_final, sent_paused, sent_unpaused
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
          sent_onclock, sent_25, sent_50, sent_10min, sent_final, sent_paused, sent_unpaused,
          updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint, draft_id) DO UPDATE SET
         pick_no=excluded.pick_no,
         last_status=excluded.last_status,
         sent_onclock=excluded.sent_onclock,
         sent_25=excluded.sent_25,
         sent_50=excluded.sent_50,
         sent_10min=excluded.sent_10min,
         sent_final=excluded.sent_final,
         sent_paused=excluded.sent_paused,
         sent_unpaused=excluded.sent_unpaused,
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
      Number(row.sent_final || 0),
      Number(row.sent_paused || 0),
      Number(row.sent_unpaused || 0),
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

// Per-draft cache to reduce Sleeper subrequests.
// IMPORTANT: use a new table name so existing deployments with an older schema
// (push_draft_state) don't 500 when new columns are introduced.
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
    (await db
      .prepare(`SELECT * FROM push_draft_cache WHERE draft_id=?`)
      .bind(String(draftId))
      .first()) || null
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

    // Ensure core push tables/columns exist (prevents silent subscription issues).
    await ensurePushTables(db);

    // New cache table (prevents schema mismatch 500s).
    await ensureDraftCacheTable(db);

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

    for (const s of subs) {
      if (!s.username) {
        skippedNoUsername++;
        continue;
      }

      // Auto-refresh draft IDs so users never have to "re-enable" after joining leagues.
      // Refresh when missing OR periodically (cheap: one Sleeper leagues call per sub).
      const REFRESH_MS = 15 * 60 * 1000; // 15 minutes
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

          // Update in-memory subscription row for this poll.
          s.draftIds = newDraftIds;
          s.leagueCount = newLeagueCount;
          s.updatedAt = now;

          // Reuse userId from this call if present.
          if (computed.userId) userIdCache.set(s.username, computed.userId);

          // If still empty after refresh, skip.
          if (!s.draftIds.length) {
            skippedNoDrafts++;
            continue;
          }
        } catch {
          // If refresh fails, fall back to whatever we already have.
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

      for (const draftId of s.draftIds) {
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

        const nextPickNo = pickCount + 1;
        const { slot: currentSlot } = getCurrentSlotSnake(nextPickNo, teams);
        const isOnClock = currentSlot === userSlot;

        if (!isOnClock) {
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
          } else if (draftCacheRow?.league_id && (draftCacheRow?.league_name || draftCacheRow?.league_avatar)) {
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

        const lastPickedMs = Number(draft?.last_picked || 0);
        const clockStart = lastPickedMs > 0 ? lastPickedMs : now;
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;
        const remainingMs = totalMs > 0 ? Math.max(0, clockStart + totalMs - now) : 0;
        const timeLeftText = totalMs > 0 ? msToClock(remainingMs) : "—";

        const clockState = await loadClockState(db, s.endpoint, draftId);
        const prevPickNo = Number(clockState?.pick_no ?? 0);
        const prevStatus = String(clockState?.last_status || "");
        const isNewPick = prevPickNo !== nextPickNo;

        let stageToSend = null;

        const sentPaused = Number(clockState?.sent_paused ?? 0) === 1;
        const sentUnpaused = Number(clockState?.sent_unpaused ?? 0) === 1;
        const sentOnclock = Number(clockState?.sent_onclock ?? 0) === 1;
        const sent25 = Number(clockState?.sent_25 ?? 0) === 1;
        const sent50 = Number(clockState?.sent_50 ?? 0) === 1;
        const sent10 = Number(clockState?.sent_10min ?? 0) === 1;
        const sentFinal = Number(clockState?.sent_final ?? 0) === 1;

        if (status === "paused") {
          if (isNewPick || !sentPaused) stageToSend = "paused";
        } else {
          if (prevStatus === "paused" && !sentUnpaused) stageToSend = "unpaused";
          else if (isNewPick || !sentOnclock) stageToSend = "onclock";
          else if (totalMs > 0) {
            const usedFrac = 1 - remainingMs / totalMs;
            if (timerSec >= 600) {
              if (remainingMs <= 600_000 && !sent10) stageToSend = "ten";
              else if (usedFrac >= 0.5 && !sent50) stageToSend = "p50";
              else if (usedFrac >= 0.25 && !sent25) stageToSend = "p25";
            } else {
              const finalThresholdMs = clamp(Math.floor(totalMs * 0.2), 20_000, 120_000);
              if (remainingMs <= finalThresholdMs && !sentFinal) stageToSend = "final";
              else if (usedFrac >= 0.5 && !sent50) stageToSend = "p50";
              else if (usedFrac >= 0.25 && !sent25) stageToSend = "p25";
            }
          }
        }

        if (!stageToSend) {
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: status,
            sent_onclock: isNewPick ? 0 : sentOnclock ? 1 : 0,
            sent_25: isNewPick ? 0 : sent25 ? 1 : 0,
            sent_50: isNewPick ? 0 : sent50 ? 1 : 0,
            sent_10min: isNewPick ? 0 : sent10 ? 1 : 0,
            sent_final: isNewPick ? 0 : sentFinal ? 1 : 0,
            sent_paused: isNewPick ? 0 : sentPaused ? 1 : 0,
            sent_unpaused: isNewPick ? 0 : sentUnpaused ? 1 : 0,
          });
          continue;
        }

        const nextFlags = {
          pick_no: nextPickNo,
          last_status: status,
          sent_onclock: isNewPick ? 0 : sentOnclock ? 1 : 0,
          sent_25: isNewPick ? 0 : sent25 ? 1 : 0,
          sent_50: isNewPick ? 0 : sent50 ? 1 : 0,
          sent_10min: isNewPick ? 0 : sent10 ? 1 : 0,
          sent_final: isNewPick ? 0 : sentFinal ? 1 : 0,
          sent_paused: isNewPick ? 0 : sentPaused ? 1 : 0,
          sent_unpaused: isNewPick ? 0 : sentUnpaused ? 1 : 0,
        };
        if (stageToSend === "onclock") nextFlags.sent_onclock = 1;
        if (stageToSend === "p25") nextFlags.sent_25 = 1;
        if (stageToSend === "p50") nextFlags.sent_50 = 1;
        if (stageToSend === "ten") nextFlags.sent_10min = 1;
        if (stageToSend === "final") nextFlags.sent_final = 1;
        if (stageToSend === "paused") nextFlags.sent_paused = 1;
        if (stageToSend === "unpaused") nextFlags.sent_unpaused = 1;
        await upsertClockState(db, s.endpoint, draftId, nextFlags);

        const leagueUrl = sleeperLeagueUrl(leagueId) || sleeperDraftUrl(draftId);
        const draftUrl = sleeperDraftUrl(draftId);
        const icon = bestLeagueAvatarUrl({ league, draft });
        const { title, body } = buildMessage({ stage: stageToSend, leagueName, timeLeftText, timerSec });
        const tag = `draft:${draftId}`;

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
const pushRes = await sendPayload(s, {
          title,
          body,
          url: "/draft-pick-tracker",
          tag,
          renotify: true,
          icon,
          badge: "/android-chrome-192x192.png",
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
      }

      if (onClockBatch.length === 1) {
        const b = onClockBatch[0];
        const timeLeftText2 = msToClock(b.remainingMs);
        const { title, body } = buildMessage({ stage: "onclock", leagueName: b.leagueName, timeLeftText: timeLeftText2 });

        const pushRes = await sendPayload(s, {
          title,
          body,
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
          .map((x) => `• ${x.leagueName} — ${msToClock(x.remainingMs)}`)
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
    }

    // Paused batching (per endpoint)
      if (pausedBatch.length === 1) {
        const b = pausedBatch[0];
        const t = msToClock(b.remainingMs);
        const { title, body } = buildMessage({ stage: "paused", leagueName: b.leagueName, timeLeftText: t });

        const pushRes = await sendPayload(s, {
          title,
          body,
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
          .map((x) => `• ${x.leagueName} — resumes at ${msToClock(x.remainingMs)}`)
          .join("\n");
        const more = pausedBatch.length > 6 ? `\n+${pausedBatch.length - 6} more` : "";

        const pushRes = await sendPayload(s, {
          title: `Paused (but you’re up in ${pausedBatch.length})`,
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

      // Unpaused batching (per endpoint)
      if (unpausedBatch.length === 1) {
        const b = unpausedBatch[0];
        const t = msToClock(b.remainingMs);
        const { title, body } = buildMessage({ stage: "unpaused", leagueName: b.leagueName, timeLeftText: t });

        const pushRes = await sendPayload(s, {
          title,
          body,
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
          .map((x) => `• ${x.leagueName} — ${msToClock(x.remainingMs)} left`)
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
