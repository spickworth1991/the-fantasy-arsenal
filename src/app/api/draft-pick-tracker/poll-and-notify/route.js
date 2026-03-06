export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

async function kickDraftRegistry(env) {
  try {
    if (!env?.DRAFT_REGISTRY?.idFromName) return;
    const id = env.DRAFT_REGISTRY.idFromName("master");
    const stub = env.DRAFT_REGISTRY.get(id);
    await stub.fetch("https://draft-registry/kick", { method: "POST" });
  } catch {
    // never block notifications on a kick failure
  }
}

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

function stageLabel(stage) {
  switch (stage) {
    case "onclock":
      return "ON CLOCK";
    case "p25":
      return "25% used";
    case "p50":
      return "50% used";
    case "ten":
      return "10 min left";
    case "urgent":
      return "URGENT (<2 min)";
    case "final":
      return "FINAL";
    case "paused":
      return "PAUSED (your pick)";
    case "unpaused":
      return "RESUMED (your pick)";
    default:
      return "UPDATE";
  }
}

function buildMessage({ stage, leagueName, timeLeftText, timerSec }) {
  const baseSeed = `${stage}|${leagueName}|${timerSec}`;

  const ONCLOCK_TITLES = [
    "You're on the clock",
    "Your pick is up",
    "ON THE CLOCK",
    "Draft alert: your turn",
    "Pick is live",
    "Your turn to draft",
    "Time to choose",
    "You're up next",
    "Draft: action needed",
    "Clock started — you're up",
    "Your selection is due",
    "It's your move",
    "Make the pick",
    "Draft ping",
    "You're drafting now",
  ];
  const ONCLOCK_BODIES = [
    `You're on the clock in "${leagueName}". Time left: ${timeLeftText}.`,
    `It's your pick in "${leagueName}". ${timeLeftText} remaining.`,
    `"${leagueName}" — you're up. Clock: ${timeLeftText}.`,
    `Your pick is live in "${leagueName}". ${timeLeftText} to decide.`,
    `Draft time in "${leagueName}". You have ${timeLeftText}.`,
    `You're on deck in "${leagueName}" — clock is running (${timeLeftText}).`,
    `"${leagueName}": you're the current pick. ${timeLeftText} left.`,
    `Heads up — it's your turn in "${leagueName}". Remaining: ${timeLeftText}.`,
    `Your pick is due in "${leagueName}". ${timeLeftText} left on the clock.`,
    `Clock started for you in "${leagueName}". ${timeLeftText} remaining.`,
    `Your turn in "${leagueName}". Make it count — ${timeLeftText} left.`,
    `You're on the clock in "${leagueName}" — ${timeLeftText} left.`,
  ];

  const P25_TITLES = [
    "Clock check: 25% used",
    "Quick reminder",
    "Don't forget your pick",
    "Gentle nudge",
    "Timer check-in",
    "Clock update",
    "Draft reminder",
    "Still your pick",
    "Clock is moving",
    "Just checking in",
    "Draft: small nudge",
    "Pick reminder",
  ];
  const P25_BODIES = [
    `You've used ~25% of your clock in "${leagueName}". Don't forget to pick. (${timeLeftText} left)`,
    `"${leagueName}": 25% of your timer is gone. Make your pick when ready. (${timeLeftText} left)`,
    `Friendly nudge — "${leagueName}" clock is moving. (${timeLeftText} left)`,
    `"${leagueName}": clock check — you're about 25% in. (${timeLeftText} left)`,
    `Reminder: it's still your pick in "${leagueName}". (${timeLeftText} left)`,
    `Just a heads up — "${leagueName}" timer is rolling. (${timeLeftText} left)`,
    `You’re a quarter into the clock in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}" check-in: you’ve used some clock. (${timeLeftText} left)`,
    `Still on the clock in "${leagueName}". (${timeLeftText} left)`,
    `Draft reminder for "${leagueName}". (${timeLeftText} left)`,
  ];

  const P50_TITLES = [
    "Half your clock is gone",
    "You good?",
    "Still on the clock",
    "Clock warning",
    "Timer halfway",
    "Draft check: halfway",
    "Still your pick",
    "Don't get auto-picked",
    "Mid-clock alert",
    "Pick pending",
    "Clock is halfway",
    "Draft: halfway point",
  ];
  const P50_BODIES = [
    `You've used ~50% of your clock in "${leagueName}". Did you forget? (${timeLeftText} left)`,
    `"${leagueName}": halfway through your timer. Don't get auto-picked. (${timeLeftText} left)`,
    `Just checking — still your pick in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}": you’re halfway through the clock. (${timeLeftText} left)`,
    `Clock warning — "${leagueName}" is still waiting on you. (${timeLeftText} left)`,
    `You’re mid-clock in "${leagueName}". Don’t sleep on this. (${timeLeftText} left)`,
    `Halfway mark reached in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}" — you're burning clock. (${timeLeftText} left)`,
    `Still your pick in "${leagueName}". (${timeLeftText} left)`,
    `Draft alert: you're halfway through your timer in "${leagueName}". (${timeLeftText} left)`,
  ];

  const TEN_TITLES = [
    "10 minutes left",
    "Seriously... 10 minutes left",
    "Final stretch",
    "10-minute warning",
    "Clock warning: 10 min",
    "Last 10 minutes",
    "Time's getting tight",
    "Draft clock: 10 min",
    "Pick soon",
    "10 minutes — make a move",
    "Final 10 minutes",
    "Heads up: 10 minutes",
  ];
  const TEN_BODIES = [
    `Seriously — you only have 10 minutes left in "${leagueName}". Make your pick.`,
    `"${leagueName}": 10 minutes remaining. Lock it in.`,
    `10 minutes left on the clock in "${leagueName}". Don't get burned.`,
    `10-minute warning in "${leagueName}". Make your selection soon.`,
    `"${leagueName}": you’re down to 10 minutes. Pick now.`,
    `Clock check — "${leagueName}" has 10 minutes left for you.`,
    `Final 10 minutes in "${leagueName}". Don’t risk an auto-pick.`,
    `You’ve got 10 minutes left in "${leagueName}". Choose wisely.`,
    `"${leagueName}": 10 minutes remain. Time to decide.`,
    `10 minutes left in "${leagueName}". Make the pick before it gets ugly.`,
  ];

  const URGENT_TITLES = [
    "⚠️ URGENT: 2 minutes",
    "🚨 PICK NOW – 2 MIN",
    "⏱️ CLOCK CRITICAL",
    "🔥 LAST 2 MINUTES",
    "🚨 Under 2 minutes",
    "⚠️ Draft emergency",
    "🚨 Pick now",
    "⏱️ Clock is red",
    "🔥 FINAL MOMENTS",
    "🚨 Auto-pick risk",
    "⚠️ Critical timer",
    "🚨 You're about to time out",
  ];
  const URGENT_BODIES = [
    `🚨 "${leagueName}": under 2 minutes left (${timeLeftText}). Draft NOW.`,
    `⚠️ "${leagueName}" pick timer is about to expire (${timeLeftText}).`,
    `🔥 "${leagueName}": final moments (${timeLeftText}). Don't get auto-picked.`,
    `🚨 "${leagueName}": clock is critical — ${timeLeftText} left.`,
    `⚠️ Time is almost out in "${leagueName}" (${timeLeftText}).`,
    `🔥 "${leagueName}" — you’re under 2 minutes. (${timeLeftText})`,
    `🚨 Pick immediately in "${leagueName}". (${timeLeftText} left)`,
    `⚠️ "${leagueName}": you are about to time out. (${timeLeftText})`,
    `🔥 Auto-pick danger in "${leagueName}". (${timeLeftText} left)`,
    `🚨 "${leagueName}": last chance — ${timeLeftText}.`,
  ];

  const FINAL_TITLES = [
    "Almost out of time",
    "Last call",
    "Clock is dying",
    "Final warning",
    "Clock nearly done",
    "This is close",
    "Time running out",
    "Final seconds",
    "Pick or regret",
    "Clock warning",
    "Last chance",
    "Auto-pick imminent",
  ];
  const FINAL_BODIES = [
    `"${leagueName}": you're almost out of time. (${timeLeftText} left)`,
    `Last call — "${leagueName}" pick timer is almost done. (${timeLeftText} left)`,
    `Clock's about to expire in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}": very little time remains. (${timeLeftText} left)`,
    `Final warning — "${leagueName}" is seconds away. (${timeLeftText} left)`,
    `Clock nearly done in "${leagueName}". (${timeLeftText} left)`,
    `Time is running out in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}": you’re at the end of the clock. (${timeLeftText} left)`,
    `Pick now in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}": don’t let this auto-pick. (${timeLeftText} left)`,
  ];

  const PAUSED_TITLES = [
    "Draft paused — but it's your pick",
    "Paused… you're still up",
    "League paused (your pick next)",
    "Draft is paused (you're the pick)",
    "Paused — you're currently on the clock",
    "Draft paused — you’re the current pick",
    "Hold up — paused on your pick",
    "Paused in your league (still your turn)",
    "Draft paused — your turn is waiting",
    "Paused — your pick is pending",
    "Draft paused — don’t forget you’re up",
  ];
  const PAUSED_BODIES = [
    `"${leagueName}" is paused, but it's still your pick.`,
    `Heads up — "${leagueName}" is paused, but you're the current pick.`,
    `"${leagueName}" paused. You're still on deck for the pick.`,
    `Paused in "${leagueName}" — you're still the pick when it resumes.`,
    `"${leagueName}" is paused — you’re still the active pick.`,
    `Draft paused in "${leagueName}" — your pick is waiting.`,
    `Paused state in "${leagueName}" — you're still up.`,
    `"${leagueName}" paused — when it resumes, you're the pick.`,
    `Heads up: "${leagueName}" paused and your pick is pending.`,
    `Draft is paused in "${leagueName}". You're still on the clock when it resumes.`,
  ];

  const UNPAUSED_TITLES = [
    "Draft resumed — you're up",
    "Back on: your pick",
    "Unpaused… clock is running",
    "Draft unpaused (still your turn)",
    "Resumed — you're still the pick",
    "Draft resumed — you're on the clock",
    "We’re live again — your pick",
    "Unpaused — your turn is active",
    "Draft back on (still your pick)",
    "Resumed — pick is yours",
    "Draft resumed — make your move",
    "Unpaused — you’re still up",
  ];
  const UNPAUSED_BODIES = [
    `"${leagueName}" resumed — it's still your pick.`,
    `Unpaused in "${leagueName}" — you're still up.`,
    `We're back. "${leagueName}" resumed and it's your pick.`,
    `"${leagueName}" unpaused — you're the current pick.`,
    `"${leagueName}" is live again — still your turn.`,
    `Draft resumed in "${leagueName}" — you’re still the pick.`,
    `Unpaused: "${leagueName}" is running again and you're up.`,
    `Back on in "${leagueName}" — your pick is active.`,
    `Draft resumed — "${leagueName}" still needs your pick.`,
    `Unpaused in "${leagueName}". You’re still on the clock.`,
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

  await ensureTable(
    db,
    "push_draft_registry",
    `CREATE TABLE IF NOT EXISTS push_draft_registry (draft_id TEXT PRIMARY KEY)`,
    [
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
    ]
  );
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function batchRun(db, statements, size = 40) {
  if (!statements.length) return;
  for (const group of chunk(statements, size)) {
    try {
      await db.batch(group);
    } catch {
      for (const stmt of group) {
        try {
          await stmt.run();
        } catch {
          // ignore
        }
      }
    }
  }
}

async function loadRegistryRowsMap(db, draftIds) {
  const ids = Array.from(new Set((draftIds || []).map(String).filter(Boolean)));
  const out = new Map();
  for (const group of chunk(ids, 80)) {
    const qs = group.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT draft_id, active, status, league_name, league_id, league_avatar,
                timer_sec, current_pick, current_owner_name, clock_ends_at,
                roster_names_json, roster_by_username_json
         FROM push_draft_registry
         WHERE draft_id IN (${qs})`
      )
      .bind(...group)
      .all();
    for (const row of rows?.results || []) {
      if (row?.draft_id) out.set(String(row.draft_id), row);
    }
  }
  return out;
}

async function loadClockStatesForEndpoint(db, endpoint, draftIds) {
  const ids = Array.from(new Set((draftIds || []).map(String).filter(Boolean)));
  const out = new Map();
  if (!ids.length) return out;

  for (const group of chunk(ids, 80)) {
    const qs = group.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT pick_no, last_status,
                sent_onclock, sent_25, sent_50, sent_10min, sent_urgent, sent_final, sent_paused, sent_unpaused,
                paused_remaining_ms, paused_at_ms, resume_clock_start_ms,
                draft_id
         FROM push_clock_state
         WHERE endpoint=? AND draft_id IN (${qs})`
      )
      .bind(endpoint, ...group)
      .all();

    for (const row of rows?.results || []) {
      if (row?.draft_id) out.set(String(row.draft_id), row);
    }
  }

  return out;
}

function buildClockStateStmt(db, endpoint, draftId, row) {
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
    );
}

function buildClearClockStateStmt(db, endpoint, draftId) {
  return db
    .prepare(`DELETE FROM push_clock_state WHERE endpoint=? AND draft_id=?`)
    .bind(endpoint, String(draftId));
}

function makeBaseFlags(clockState, nextPickNo, status, isNewPick) {
  return {
    pick_no: nextPickNo,
    last_status: status,
    sent_onclock: isNewPick ? 0 : Number(clockState?.sent_onclock || 0) ? 1 : 0,
    sent_25: isNewPick ? 0 : Number(clockState?.sent_25 || 0) ? 1 : 0,
    sent_50: isNewPick ? 0 : Number(clockState?.sent_50 || 0) ? 1 : 0,
    sent_10min: isNewPick ? 0 : Number(clockState?.sent_10min || 0) ? 1 : 0,
    sent_urgent: isNewPick ? 0 : Number(clockState?.sent_urgent || 0) ? 1 : 0,
    sent_final: isNewPick ? 0 : Number(clockState?.sent_final || 0) ? 1 : 0,
    sent_paused: isNewPick ? 0 : Number(clockState?.sent_paused || 0) ? 1 : 0,
    sent_unpaused: isNewPick ? 0 : Number(clockState?.sent_unpaused || 0) ? 1 : 0,
    paused_remaining_ms: null,
    paused_at_ms: null,
    resume_clock_start_ms: null,
  };
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

    await kickDraftRegistry(env);

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

    let sent = 0;
    let checked = 0;

    let skippedNoDrafts = 0;
    let skippedNoUsername = 0;
    let skippedNoOrder = 0;
    let skippedNotOnClock = 0;
    let skippedMissingRosterCtx = 0;

    const sendPayload = async (subRow, payload) => {
      const { endpoint, fetchInit } = await buildWebPushRequest({
        subscription: subRow.sub,
        payload,
        vapidSubject,
        vapidPrivateJwk,
      });
      return fetch(endpoint, fetchInit);
    };

    const activeRows = await db
      .prepare(
        `SELECT draft_id
         FROM push_draft_registry
         WHERE active=1 AND (LOWER(status)='drafting' OR LOWER(status)='paused')`
      )
      .all();

    const activeDraftIdSet = new Set();
    for (const r of activeRows?.results || []) {
      if (r?.draft_id) activeDraftIdSet.add(String(r.draft_id));
    }

    const allRelevantDraftIds = [];
    for (const s of subs) {
      for (const id of s.draftIds || []) {
        const draftId = String(id || "");
        if (draftId && activeDraftIdSet.has(draftId)) allRelevantDraftIds.push(draftId);
      }
    }

    const registryMap = await loadRegistryRowsMap(db, allRelevantDraftIds);

    for (const s of subs) {
      if (!s.username) {
        skippedNoUsername++;
        continue;
      }

      if (!s.draftIds.length) {
        skippedNoDrafts++;
        continue;
      }

      const activeDraftIdsForSub = (s.draftIds || [])
        .map(String)
        .filter((id) => activeDraftIdSet.has(id));

      if (!activeDraftIdsForSub.length) continue;

      const clockStateMap = await loadClockStatesForEndpoint(db, s.endpoint, activeDraftIdsForSub);

      const events = [];
      const stateStatements = [];
      const clearStatements = [];
      const deleteSubStatements = [];

      for (const draftId of activeDraftIdsForSub) {
        checked++;

        const reg = registryMap.get(String(draftId));
        if (!reg) continue;

        const status = String(reg?.status || "").toLowerCase();
        if (status !== "drafting" && status !== "paused") {
          clearStatements.push(buildClearClockStateStmt(db, s.endpoint, draftId));
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

        const hasRosterCtx =
          rosterByUsername && typeof rosterByUsername === "object" && Object.keys(rosterByUsername).length > 0 &&
          rosterNames && typeof rosterNames === "object" && Object.keys(rosterNames).length > 0;

        if (!hasRosterCtx) {
          skippedMissingRosterCtx++;
          continue;
        }

        const userRosterId = rosterByUsername?.[uname] != null ? String(rosterByUsername[uname]) : null;
        const userRosterName = userRosterId ? String(rosterNames?.[userRosterId] || "") : "";

        const currentOwnerName = String(reg?.current_owner_name || "");
        const isOnClock = Boolean(userRosterName) && Boolean(currentOwnerName) && userRosterName === currentOwnerName;

        if (!isOnClock) {
          clearStatements.push(buildClearClockStateStmt(db, s.endpoint, draftId));
          skippedNotOnClock++;
          continue;
        }

        const clockState = clockStateMap.get(String(draftId)) || null;
        const prevPickNo = Number(clockState?.pick_no ?? 0);
        const prevStatus = String(clockState?.last_status || "");
        const isNewPick = prevPickNo !== nextPickNo;

        const timerSec = Number(reg?.timer_sec || 0);
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;
        const rawClockEndsAt = Number(reg?.clock_ends_at || 0);
        const rawRemainingMs =
          totalMs > 0 && rawClockEndsAt > 0 ? Math.max(0, rawClockEndsAt - now) : 0;

        const frozenPausedRemaining = Number(clockState?.paused_remaining_ms);
        const pausedRemainingKnown = Number.isFinite(frozenPausedRemaining);
        const resumeClockStartMs = Number(clockState?.resume_clock_start_ms);
        const resumeStartKnown = Number.isFinite(resumeClockStartMs);

        const wasPaused = prevStatus === "paused";
        const isPaused = status === "paused";

        let remainingMs = rawRemainingMs;

        if (isPaused) {
          remainingMs = pausedRemainingKnown ? frozenPausedRemaining : rawRemainingMs;
        } else if (wasPaused && pausedRemainingKnown) {
          if (resumeStartKnown) {
            remainingMs = Math.max(0, frozenPausedRemaining - Math.max(0, now - resumeClockStartMs));
          } else {
            remainingMs = frozenPausedRemaining;
          }
        }

        const baseFlags = makeBaseFlags(clockState, nextPickNo, status, isNewPick);

        if (isPaused) {
          baseFlags.paused_remaining_ms = pausedRemainingKnown ? frozenPausedRemaining : remainingMs;
          baseFlags.paused_at_ms = Number.isFinite(Number(clockState?.paused_at_ms))
            ? Number(clockState.paused_at_ms)
            : now;
          baseFlags.resume_clock_start_ms = null;
        } else if (wasPaused && pausedRemainingKnown) {
          baseFlags.paused_remaining_ms = frozenPausedRemaining;
          baseFlags.paused_at_ms = Number.isFinite(Number(clockState?.paused_at_ms))
            ? Number(clockState.paused_at_ms)
            : null;
          baseFlags.resume_clock_start_ms = resumeStartKnown ? resumeClockStartMs : now;
        }

        let stageToSend = null;

        const sentPaused = baseFlags.sent_paused === 1;
        const sentUnpaused = baseFlags.sent_unpaused === 1;
        const sentOnclock = baseFlags.sent_onclock === 1;
        const sent25 = baseFlags.sent_25 === 1;
        const sent50 = baseFlags.sent_50 === 1;
        const sent10 = baseFlags.sent_10min === 1;
        const sentUrgent = baseFlags.sent_urgent === 1;
        const sentFinal = baseFlags.sent_final === 1;

        if (status === "paused") {
          if (isNewPick || !sentPaused) stageToSend = "paused";
        } else {
          if (prevStatus === "paused" && !sentUnpaused) {
            stageToSend = "unpaused";
          } else if (isNewPick || !sentOnclock) {
            stageToSend = "onclock";
          } else if (totalMs > 0) {
            const usedFrac = 1 - remainingMs / totalMs;

            if (remainingMs <= 120000 && !sentUrgent) {
              stageToSend = "urgent";
            } else {
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

        const leagueId = reg?.league_id ? String(reg.league_id) : null;
        const leagueName = String(reg?.league_name || "your league");
        const leagueAvatar = registryAvatarUrl(reg?.league_avatar);
        const timeLeftText = totalMs > 0 ? msToClock(remainingMs) : "-";

        if (!stageToSend) {
          stateStatements.push(buildClockStateStmt(db, s.endpoint, draftId, baseFlags));
          continue;
        }

        const nextFlags = { ...baseFlags };
        if (stageToSend === "onclock") nextFlags.sent_onclock = 1;
        if (stageToSend === "p25") nextFlags.sent_25 = 1;
        if (stageToSend === "p50") nextFlags.sent_50 = 1;
        if (stageToSend === "ten") nextFlags.sent_10min = 1;
        if (stageToSend === "urgent") nextFlags.sent_urgent = 1;
        if (stageToSend === "final") nextFlags.sent_final = 1;
        if (stageToSend === "paused") nextFlags.sent_paused = 1;
        if (stageToSend === "unpaused") nextFlags.sent_unpaused = 1;

        const leagueUrl = sleeperLeagueUrl(leagueId) || sleeperDraftUrl(draftId);
        const draftUrl = sleeperDraftUrl(draftId);

        const { title, body } = buildMessage({
          stage: stageToSend,
          leagueName,
          timeLeftText,
          timerSec,
        });

        events.push({
          stage: stageToSend,
          leagueName,
          remainingMs: Number.isFinite(remainingMs) ? remainingMs : 0,
          icon: leagueAvatar,
          leagueUrl,
          draftUrl,
          leagueId: String(leagueId || ""),
          draftId: String(draftId),
          pickNo: nextPickNo,
          title,
          body,
          nextFlags,
        });
      }

      if (!events.length) {
        await batchRun(db, [...clearStatements, ...stateStatements]);
        continue;
      }

      const sendIndividual = async (ev) => {
        const isUrgent = ev.stage === "urgent";
        const pushRes = await sendPayload(s, {
          title: ev.title,
          body: ev.body,
          url: "/draft-pick-tracker",
          tag: `draft:${ev.draftId}`,
          renotify: true,
          icon: ev.icon,
          badge: "/android-chrome-192x192.png",
          requireInteraction: isUrgent ? true : undefined,
          vibrate: isUrgent ? [100, 60, 100, 60, 180] : undefined,
          data: {
            url: "/draft-pick-tracker",
            leagueUrl: ev.leagueUrl,
            draftUrl: ev.draftUrl,
            leagueId: ev.leagueId,
            draftId: ev.draftId,
            pickNo: ev.pickNo,
            stage: ev.stage,
            timeLeftMs: ev.remainingMs,
          },
          actions: [
            { action: "open_tracker", title: "Open Tracker" },
            ...(ev.leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
          ],
        });

        if (pushRes.ok) {
          sent++;
          stateStatements.push(buildClockStateStmt(db, s.endpoint, ev.draftId, ev.nextFlags));
        } else if (pushRes.status === 404 || pushRes.status === 410) {
          deleteSubStatements.push(
            db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint)
          );
          clearStatements.push(buildClearClockStateStmt(db, s.endpoint, ev.draftId));
        }
      };

      if (events.length === 1) {
        await sendIndividual(events[0]);
        await batchRun(db, [...clearStatements, ...stateStatements, ...deleteSubStatements]);
        continue;
      }

      const isUrg = (ev) => ev.stage === "urgent" || (ev.remainingMs > 0 && ev.remainingMs <= 120000 && ev.stage !== "paused");
      const isPausedStage = (ev) => ev.stage === "paused";
      const isResumedStage = (ev) => ev.stage === "unpaused";

      const sorted = events.slice().sort((a, b) => {
        const au = isUrg(a) ? 1 : 0;
        const bu = isUrg(b) ? 1 : 0;
        if (au !== bu) return bu - au;

        const ap = isPausedStage(a) ? 1 : 0;
        const bp = isPausedStage(b) ? 1 : 0;
        if (ap !== bp) return ap - bp;

        const ar = isResumedStage(a) ? 1 : 0;
        const br = isResumedStage(b) ? 1 : 0;
        if (ar !== br) return br - ar;

        return (a.remainingMs || 0) - (b.remainingMs || 0);
      });

      const anyUrgent = sorted.some((x) => isUrg(x));
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

      const summaryIcon = sorted.find((x) => x.icon)?.icon || null;

      const pushRes = await sendPayload(s, {
        title,
        body: `${lines}${more}`,
        url: "/draft-pick-tracker",
        tag: anyUrgent ? "draft-summary-urgent" : "draft-summary",
        renotify: true,
        icon: summaryIcon,
        badge: "/android-chrome-192x192.png",
        requireInteraction: anyUrgent ? true : undefined,
        vibrate: anyUrgent ? [100, 60, 100, 60, 180] : undefined,
        data: {
          url: "/draft-pick-tracker",
          summary: true,
          count: sorted.length,
          urgent: anyUrgent ? 1 : 0,
        },
        actions: [{ action: "open_tracker", title: "Open Tracker" }],
      });

      if (pushRes.ok) {
        sent++;
        for (const ev of events) {
          stateStatements.push(buildClockStateStmt(db, s.endpoint, ev.draftId, ev.nextFlags));
        }
      } else if (pushRes.status === 404 || pushRes.status === 410) {
        deleteSubStatements.push(
          db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint)
        );
        for (const ev of events) {
          clearStatements.push(buildClearClockStateStmt(db, s.endpoint, ev.draftId));
        }
      }

      await batchRun(db, [...clearStatements, ...stateStatements, ...deleteSubStatements]);
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
      skippedMissingRosterCtx,
    });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}