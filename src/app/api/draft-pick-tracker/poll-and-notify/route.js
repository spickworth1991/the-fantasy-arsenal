export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

function jsonParseSafe(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function registryAvatarUrl(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://sleepercdn.com/avatars/thumbs/${s}`;
}

async function loadRegistryRow(db, draftId) {
  return db
    .prepare(
      `SELECT draft_id, active, status, league_name, league_id, league_avatar,
              timer_sec, current_pick, current_owner_name, clock_ends_at,
              roster_names_json, roster_by_username_json
       FROM push_draft_registry
       WHERE draft_id=?`
    )
    .bind(String(draftId))
    .first();
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
  // Create minimal if missing, then backfill columns so SELECT never fails.
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
        draft_order_json TEXT,
        teams INTEGER,
        timer_sec INTEGER,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT
      )`
    )
    .run();

  // Ensure the full superset used by poll-and-notify is present.
  await ensureTable(db, "push_draft_registry", `CREATE TABLE IF NOT EXISTS push_draft_registry (draft_id TEXT PRIMARY KEY)`, [
    { name: "active", type: "INTEGER" },
    { name: "status", type: "TEXT" },
    { name: "league_name", type: "TEXT" },
    { name: "league_id", type: "TEXT" },
    { name: "league_avatar", type: "TEXT" },
    { name: "timer_sec", type: "INTEGER" },
    { name: "current_pick", type: "INTEGER" },
    { name: "current_owner_name", type: "TEXT" },
    { name: "clock_ends_at", type: "INTEGER" },
    { name: "roster_names_json", type: "TEXT" },
    { name: "roster_by_username_json", type: "TEXT" },
  ]);
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

  const PAUSED_TITLES = ["Draft paused - but it's your pick", "Paused... you're still up", "Paused, but you're on deck", "League paused (your pick next)"];
  const PAUSED_BODIES = [
    `"${leagueName}" is paused, but it's your pick! your timer will start at ${timeLeftText}.`,
    `Heads up - "${leagueName}" is paused, but you're up next. Timer resumes at ${timeLeftText}.`,
    `"${leagueName}" paused. You're on the clock when it resumes (${timeLeftText}).`,
    `Paused in "${leagueName}" - you're still the pick. Resume clock: ${timeLeftText}.`,
  ];

  const UNPAUSED_TITLES = ["Draft resumed - you're up", "Back on: your pick", "Unpaused... clock is running", "Draft unpaused (still your turn)"];
  const UNPAUSED_BODIES = [
    `"${leagueName}" resumed - you're on the clock. (${timeLeftText} left)`,
    `Unpaused in "${leagueName}" - your pick is live. (${timeLeftText} left)`,
    `We're back. "${leagueName}" clock is ticking: ${timeLeftText} remaining.`,
    `"${leagueName}" unpaused - don't get auto-picked. (${timeLeftText} left)`,
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
  return db.prepare(`DELETE FROM push_clock_state WHERE endpoint=? AND draft_id=?`).bind(endpoint, String(draftId)).run();
}

export async function POST(req) {
  return handler(req);
}
export async function GET(req) {
  return handler(req);
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

    // Determine active drafts (drafting/paused) using the D1 registry.
    const activeDraftIdSet = new Set();
    try {
      const activeRows = await db
        .prepare(
          `SELECT draft_id
           FROM push_draft_registry
           WHERE active=1 AND (LOWER(status)='drafting' OR LOWER(status)='paused')`
        )
        .all();
      for (const r of activeRows?.results || []) {
        if (r?.draft_id) activeDraftIdSet.add(String(r.draft_id));
      }
    } catch {
      // ignore
    }

    for (const s of subs) {
      if (!s.username) {
        skippedNoUsername++;
        continue;
      }

      if (!s.draftIds.length) {
        skippedNoDrafts++;
        continue;
      }

      const onClockBatch = [];
      const pausedBatch = [];
      const unpausedBatch = [];

      // Only iterate drafts currently active in registry (drafting/paused).
      const activeDraftIdsForSub = (s.draftIds || []).filter((id) => activeDraftIdSet.has(String(id)));

      for (const draftId of activeDraftIdsForSub) {
        checked++;

        const reg = await loadRegistryRow(db, draftId);

        const status = String(reg?.status || "").toLowerCase();
        if (status !== "drafting" && status !== "paused") {
          await clearClockState(db, s.endpoint, draftId);
          continue;
        }

        const nextPickNo = Number(reg?.current_pick || 0);
        if (!nextPickNo) {
          skippedNoOrder++;
          continue;
        }

        const uname = String(s.username || "").toLowerCase().trim();
        const rosterByUsername = jsonParseSafe(reg?.roster_by_username_json || "{}", {});
        const rosterNames = jsonParseSafe(reg?.roster_names_json || "{}", {});

        const userRosterId = rosterByUsername?.[uname] != null ? String(rosterByUsername[uname]) : null;
        const userRosterName = userRosterId ? String(rosterNames?.[userRosterId] || "") : "";

        const currentOwnerName = String(reg?.current_owner_name || "");
        const isOnClock = Boolean(userRosterName) && Boolean(currentOwnerName) && userRosterName === currentOwnerName;

        if (!isOnClock) {
          await clearClockState(db, s.endpoint, draftId);
          skippedNotOnClock++;
          continue;
        }

        const timerSec = Number(reg?.timer_sec || 0);
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;

        const leagueId = reg?.league_id ? String(reg.league_id) : null;
        const leagueName = String(reg?.league_name || "your league");
        const leagueAvatar = registryAvatarUrl(reg?.league_avatar);

        const clockState = await loadClockState(db, s.endpoint, draftId);
        const prevPickNo = Number(clockState?.pick_no ?? 0);
        const prevStatus = String(clockState?.last_status || "");
        const isNewPick = prevPickNo !== nextPickNo;

        // remaining time from registry clock end
        let remainingMs = 0;
        const clockEndsAt = Number(reg?.clock_ends_at || 0);
        if (totalMs > 0 && clockEndsAt) remainingMs = Math.max(0, clockEndsAt - now);

        const frozenPausedRemaining = Number(clockState?.paused_remaining_ms);
        const wasPaused = prevStatus === "paused";
        const isPaused = status === "paused";

        // pause/unpause freeze bookkeeping
        if (!wasPaused && isPaused) {
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: status,
            paused_remaining_ms: Number.isFinite(remainingMs) ? remainingMs : null,
            paused_at_ms: now,
          });
        } else if (wasPaused && !isPaused) {
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: status,
            paused_remaining_ms: null,
            paused_at_ms: null,
          });
        }

        if (isPaused && Number.isFinite(frozenPausedRemaining)) {
          remainingMs = frozenPausedRemaining;
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

        // update state + no send
        if (!stageToSend) {
          await upsertClockState(db, s.endpoint, draftId, {
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
          });
          continue;
        }

        // set the stage bit we’re sending
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
        const icon = leagueAvatar;
        const { title, body } = buildMessage({ stage: stageToSend, leagueName, timeLeftText, timerSec });

        if (stageToSend === "onclock") {
          onClockBatch.push({ leagueName, remainingMs, icon, leagueUrl, draftUrl, leagueId: String(leagueId || ""), draftId: String(draftId), pickNo: nextPickNo });
          continue;
        }
        if (stageToSend === "paused") {
          pausedBatch.push({ leagueName, remainingMs, icon, leagueUrl, draftUrl, leagueId: String(leagueId || ""), draftId: String(draftId), pickNo: nextPickNo });
          continue;
        }
        if (stageToSend === "unpaused") {
          unpausedBatch.push({ leagueName, remainingMs, icon, leagueUrl, draftUrl, leagueId: String(leagueId || ""), draftId: String(draftId), pickNo: nextPickNo });
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
      }

      // batch summaries (unchanged behavior)
      if (onClockBatch.length === 1) {
        const b = onClockBatch[0];
        const msg = buildMessage({ stage: "onclock", leagueName: b.leagueName, timeLeftText: msToClock(b.remainingMs), timerSec: 0 });
        const pushRes = await sendPayload(s, {
          title: msg.title,
          body: msg.body,
          url: "/draft-pick-tracker",
          tag: `draft:${b.draftId}`,
          renotify: true,
          icon: b.icon,
          badge: "/android-chrome-192x192.png",
          data: { url: "/draft-pick-tracker", leagueUrl: b.leagueUrl, draftUrl: b.draftUrl, leagueId: b.leagueId, draftId: b.draftId, pickNo: b.pickNo, stage: "onclock", timeLeftMs: b.remainingMs },
          actions: [{ action: "open_tracker", title: "Open Tracker" }, ...(b.leagueUrl ? [{ action: "open_league", title: "Open League" }] : [])],
        });
        if (pushRes.ok) sent++;
      } else if (onClockBatch.length > 1) {
        const lines = onClockBatch.slice(0, 6).map((x) => `• ${x.leagueName} - ${msToClock(x.remainingMs)}`).join("\n");
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

      if (pausedBatch.length === 1) {
        const b = pausedBatch[0];
        const msg = buildMessage({ stage: "paused", leagueName: b.leagueName, timeLeftText: msToClock(b.remainingMs), timerSec: 0 });
        const pushRes = await sendPayload(s, {
          title: msg.title,
          body: msg.body,
          url: "/draft-pick-tracker",
          tag: `draft:${b.draftId}`,
          renotify: true,
          icon: b.icon,
          badge: "/android-chrome-192x192.png",
          data: { url: "/draft-pick-tracker", leagueUrl: b.leagueUrl, draftUrl: b.draftUrl, leagueId: b.leagueId, draftId: b.draftId, pickNo: b.pickNo, stage: "paused", timeLeftMs: b.remainingMs },
          actions: [{ action: "open_tracker", title: "Open Tracker" }, ...(b.leagueUrl ? [{ action: "open_league", title: "Open League" }] : [])],
        });
        if (pushRes.ok) sent++;
      } else if (pausedBatch.length > 1) {
        const lines = pausedBatch.slice(0, 6).map((x) => `• ${x.leagueName} - resumes with ${msToClock(x.remainingMs)}`).join("\n");
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

      if (unpausedBatch.length === 1) {
        const b = unpausedBatch[0];
        const msg = buildMessage({ stage: "unpaused", leagueName: b.leagueName, timeLeftText: msToClock(b.remainingMs), timerSec: 0 });
        const pushRes = await sendPayload(s, {
          title: msg.title,
          body: msg.body,
          url: "/draft-pick-tracker",
          tag: `draft:${b.draftId}`,
          renotify: true,
          icon: b.icon,
          badge: "/android-chrome-192x192.png",
          data: { url: "/draft-pick-tracker", leagueUrl: b.leagueUrl, draftUrl: b.draftUrl, leagueId: b.leagueId, draftId: b.draftId, pickNo: b.pickNo, stage: "unpaused", timeLeftMs: b.remainingMs },
          actions: [{ action: "open_tracker", title: "Open Tracker" }, ...(b.leagueUrl ? [{ action: "open_league", title: "Open League" }] : [])],
        });
        if (pushRes.ok) sent++;
      } else if (unpausedBatch.length > 1) {
        const lines = unpausedBatch.slice(0, 6).map((x) => `• ${x.leagueName} - ${msToClock(x.remainingMs)} left`).join("\n");
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