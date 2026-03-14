export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

const DEFAULT_PUSH_SETTINGS = {
  onClock: true,
  progress: true,
  paused: true,
  badges: true,
};

function normalizePushSettings(input) {
  return {
    ...DEFAULT_PUSH_SETTINGS,
    ...(input && typeof input === "object" ? input : {}),
  };
}

function buildAlsoUpSummary(onClockSnapshot, options = {}) {
  const { excludeDraftIds = [] } = options || {};
  const exclude = new Set(
    (Array.isArray(excludeDraftIds) ? excludeDraftIds : []).map((x) => String(x || ""))
  );

  const list = (Array.isArray(onClockSnapshot) ? onClockSnapshot : [])
    .filter((x) => !exclude.has(String(x?.draftId || "")))
    .slice();

  if (!list.length) return "";

  list.sort((a, b) => {
    const aStage = String(a?.stage || "");
    const bStage = String(b?.stage || "");

    const aResumed = aStage === "unpaused" ? 1 : 0;
    const bResumed = bStage === "unpaused" ? 1 : 0;
    if (aResumed !== bResumed) return bResumed - aResumed;

    const aUrgent = aStage === "urgent" || aStage === "five" ? 1 : 0;
    const bUrgent = bStage === "urgent" || bStage === "five" ? 1 : 0;
    if (aUrgent !== bUrgent) return bUrgent - aUrgent;

    const aPaused = aStage === "paused" ? 1 : 0;
    const bPaused = bStage === "paused" ? 1 : 0;
    if (aPaused !== bPaused) return aPaused - bPaused;

    const ar = Number.isFinite(a?.remainingMs) ? a.remainingMs : Number.MAX_SAFE_INTEGER;
    const br = Number.isFinite(b?.remainingMs) ? b.remainingMs : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });

  const count = list.length;
  const urgent25 = list.find((x) => {
    const ms = Number(x?.remainingMs || 0);
    const total = Number(x?.timerMs || 0);
    return total > 0 && ms > 0 && ms <= Math.floor(total * 0.25);
  });

  if (urgent25) {
    const name = String(urgent25?.leagueName || "One league");
    const urgentByCount =
      count === 1
        ? [
            `You're also up elsewhere — ${name} is already under 25%.`,
            `One other league is live, and ${name} is already under 25%.`,
            `You also have another clock running — ${name} is getting tight.`,
          ]
        : count <= 3
        ? [
            `You're also on the clock in ${count} other leagues. ${name} is already under 25%.`,
            `Also up in ${count} other leagues — ${name} is getting tight.`,
            `${count} other leagues are live too. ${name} is already in the last 25%.`,
          ]
        : [
            `You've got ${count} other clocks running. ${name} is already under 25%.`,
            `${count} other leagues are still live, and ${name} is getting tight.`,
            `Multiple other clocks are running (${count} total). ${name} is already in the last 25%.`,
          ];
    return pickRandom(urgentByCount);
  }

  const baseByCount =
    count === 1
      ? [
          `You're also up in 1 other league.`,
          `You also have 1 other league on the clock.`,
          `You're also on the clock elsewhere.`,
        ]
      : count <= 3
      ? [
          `You're also on the clock in ${count} other leagues.`,
          `You also have ${count} other leagues on the clock.`,
          `Also up in ${count} other leagues.`,
        ]
      : [
          `You've got ${count} other clocks running too.`,
          `Multiple other leagues are live for you (${count}).`,
          `You're also on the clock across ${count} other leagues.`,
        ];

  return pickRandom(baseByCount);
}

function getReachedStageFlags(totalMs, remainingMs) {
    const safeTotal = Number(totalMs || 0);
    const safeRemaining = Math.max(0, Number(remainingMs || 0));
    const usedFrac = safeTotal > 0 ? 1 - safeRemaining / safeTotal : 0;

    const canTen = safeTotal > 600000;
    const tenEligible = canTen && safeRemaining <= 600000 && safeRemaining < safeTotal - 30000;

    const canFive = safeTotal > 300000;
    const fiveEligible = canFive && safeRemaining <= 300000 && safeRemaining < safeTotal - 30000;

    const quarterLeftEligible =
      safeTotal > 0 &&
      safeRemaining <= Math.floor(safeTotal * 0.25) &&
      safeRemaining > 600000;

    const finalThresholdMs = clamp(Math.floor(safeTotal * 0.1), 15000, 60000);
    const finalEligible = safeRemaining <= finalThresholdMs;
    const urgentEligible = safeRemaining <= 120000;

    return {
      sent_onclock: 1,
      sent_50: usedFrac >= 0.5 ? 1 : 0,
      sent_25: quarterLeftEligible ? 1 : 0,
      sent_10min: tenEligible ? 1 : 0,
      sent_5min: fiveEligible ? 1 : 0,
      sent_urgent: urgentEligible ? 1 : 0,
      sent_final: finalEligible ? 1 : 0,
    };
  }

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

function safeLower(v) {
  return String(v || "").trim().toLowerCase();
}


function getDebugConfig(req) {
  try {
    const url = new URL(req.url);
    const enabled = [
      url.searchParams.get("debug"),
      req.headers.get("x-debug-push"),
    ].some((v) => {
      const s = String(v || "").trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    });

    const username = safeLower(
      url.searchParams.get("debug_username") || req.headers.get("x-debug-username") || ""
    );
    const endpoint = String(
      url.searchParams.get("debug_endpoint") || req.headers.get("x-debug-endpoint") || ""
    ).trim();
    const maxEntriesRaw = Number(
      url.searchParams.get("debug_max") || req.headers.get("x-debug-max") || 40
    );
    const maxEntries = Number.isFinite(maxEntriesRaw)
      ? Math.max(1, Math.min(200, Math.floor(maxEntriesRaw)))
      : 40;

    return { enabled, username, endpoint, maxEntries };
  } catch {
    return { enabled: false, username: "", endpoint: "", maxEntries: 40 };
  }
}

function makeEndpointLabel(endpoint) {
  const s = String(endpoint || "").trim();
  if (!s) return "";
  if (s.length <= 20) return s;
  return `${s.slice(0, 8)}…${s.slice(-8)}`;
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

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const idx = Math.floor(Math.random() * list.length);
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
    case "p50":
      return "50% left";
    case "p25":
      return "25% left";
    case "ten":
      return "10 min left";
    case "five":
      return "5 min left";
    case "urgent":
      return "URGENT (<2 min)";
    case "final":
      return "FINAL";
    case "paused":
      return "PAUSED";
    case "unpaused":
      return "RESUMED";
    default:
      return "UPDATE";
  }
}

function buildEventNotificationTag(ev) {
  const draftId = String(ev?.draftId || "draft");
  const pickNo = Number(ev?.pickNo || 0);
  const stage = String(ev?.stage || "update");
  return `draft:${draftId}:pick:${pickNo || "na"}:stage:${stage}`;
}

function buildGroupedNotificationTag(sortedEvents = [], anyUrgent = false) {
  const list = Array.isArray(sortedEvents) ? sortedEvents : [];
  const sig = list
    .slice(0, 4)
    .map((ev) => `${String(ev?.draftId || "d")}:${Number(ev?.pickNo || 0) || "na"}:${String(ev?.stage || "u")}`)
    .join("|") || "none";
  return `${anyUrgent ? "draft-summary-urgent" : "draft-summary"}:${sig}`;
}

function isAppleSubscriptionEndpoint(endpoint) {
  const s = String(endpoint || "").trim().toLowerCase();
  return s.includes("push.apple.com") || s.includes("web.push.apple.com");
}

function buildGroupedTitle(sortedEvents = []) {
  const list = Array.isArray(sortedEvents) ? sortedEvents : [];
  if (!list.length) return "Draft updates";

  const hasCritical = list.some((ev) => {
    const stage = String(ev?.stage || "");
    return stage === "urgent" || stage === "final" || stage === "five";
  });

  const hasResumed = list.some((ev) => String(ev?.stage || "") === "unpaused");
  const hasPaused = list.some((ev) => String(ev?.stage || "") === "paused");

  if (hasCritical) return "Urgent draft alerts";
  if (hasResumed) return "Drafts resumed";
  if (hasPaused) return "Draft status updates";
  if (list.length > 1) return "Multiple picks live";
  return "Draft update";
}

function buildMessage({ stage, leagueName, timeLeftText }) {
  const hasUsefulTime =
    typeof timeLeftText === "string" &&
    timeLeftText.trim() !== "" &&
    timeLeftText.trim() !== "-" &&
    timeLeftText.trim() !== "0:00" &&
    timeLeftText.trim() !== "00:00" &&
    timeLeftText.trim() !== "0:00:00" &&
    timeLeftText.trim() !== "00:00:00";

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
    "You're officially up",
  ];

  const ONCLOCK_BODIES = [
    `You're on the clock in "${leagueName}". Time left: ${timeLeftText}.`,
    `It's your pick in "${leagueName}". ${timeLeftText} remaining.`,
    `"${leagueName}" — you're up. Clock: ${timeLeftText}.`,
    `Your pick is live in "${leagueName}". ${timeLeftText} to decide.`,
    `Draft time in "${leagueName}". You have ${timeLeftText}.`,
    `You're on the clock in "${leagueName}" — clock is running (${timeLeftText}).`,
    `"${leagueName}": you're the current pick. ${timeLeftText} left.`,
    `Heads up — it's your turn in "${leagueName}". Remaining: ${timeLeftText}.`,
    `Your pick is due in "${leagueName}". ${timeLeftText} left on the clock.`,
    `Clock started for you in "${leagueName}". ${timeLeftText} remaining.`,
    `Your turn in "${leagueName}". Make it count — ${timeLeftText} left.`,
    `You're on the clock in "${leagueName}" — ${timeLeftText} left.`,
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
    `You've hit the halfway point in "${leagueName}". ${timeLeftText} left.`,
    `"${leagueName}": half your timer is gone. ${timeLeftText} remains.`,
    `Still your pick in "${leagueName}" — halfway through the clock. (${timeLeftText} left)`,
    `"${leagueName}": clock check, you're at the halfway mark. (${timeLeftText} left)`,
    `Mid-clock alert in "${leagueName}". ${timeLeftText} to go.`,
    `You're halfway through your timer in "${leagueName}". (${timeLeftText} left)`,
    `Still on the clock in "${leagueName}". Halfway point reached. (${timeLeftText} left)`,
    `Clock warning — "${leagueName}" is still waiting on you. (${timeLeftText} left)`,
  ];

  const P25_TITLES = [
    "Friendly nudge",
    "Quarter left on the clock",
    "Clock's getting shorter",
    "Pick check-in",
    "25% left",
    "Just a reminder",
    "Still your pick",
    "Draft reminder",
    "Heads up",
    "Clock check",
  ];
  const P25_BODIES = [
    `Friendly nudge — only about 25% of your clock remains in "${leagueName}". (${timeLeftText} left)`,
    `"${leagueName}": you're down to roughly the last quarter of your timer. (${timeLeftText} left)`,
    `Still your pick in "${leagueName}". About 25% of the clock is left. (${timeLeftText} left)`,
    `Clock check — "${leagueName}" is into the last quarter now. (${timeLeftText} left)`,
    `Don't forget about "${leagueName}" — you're in the last 25% of your timer. (${timeLeftText} left)`,
    `"${leagueName}": final quarter of your clock. (${timeLeftText} left)`,
    `Quick reminder: only the last quarter of the timer is left in "${leagueName}". (${timeLeftText} left)`,
  ];

  const TEN_TITLES = [
    "10 minutes left",
    "10-minute warning",
    "Final stretch",
    "Clock warning: 10 min",
    "Last 10 minutes",
    "Time's getting tight",
    "Draft clock: 10 min",
    "Pick soon",
    "10 minutes — make a move",
    "Heads up: 10 minutes",
  ];
  const TEN_BODIES = [
    `10 minutes left in "${leagueName}". Time to lock in your pick.`,
    `"${leagueName}": 10 minutes remaining. Make your move.`,
    `Clock warning — 10 minutes left for your pick in "${leagueName}".`,
    `You're into the final 10 minutes in "${leagueName}".`,
    `"${leagueName}": final 10 minutes. Don't get caught sleeping.`,
    `10-minute warning in "${leagueName}". Pick when ready — but ready soon.`,
    `The clock's down to 10 minutes in "${leagueName}".`,
    `10 minutes remain in "${leagueName}". This is where the pressure starts.`,
  ];

  const FIVE_TITLES = [
    "5 minutes left",
    "Seriously, it's getting close",
    "Clock is getting real",
    "Final 5 minutes",
    "This is your 5-minute warning",
    "You're getting very close",
    "Alright, seriously now",
    "Clock's almost a problem",
    "This pick needs to happen",
    "5 minutes — let's go",
  ];
  const FIVE_BODIES = [
    `Seriously, it's getting close in "${leagueName}" — only 5 minutes left.`,
    `"${leagueName}": 5 minutes remaining. Time to make the pick.`,
    `Alright, seriously now — "${leagueName}" is down to 5 minutes.`,
    `Final 5 minutes in "${leagueName}". Don't let this become an auto-pick.`,
    `You're getting close in "${leagueName}". Just 5 minutes left.`,
    `"${leagueName}": this is the 5-minute warning. Pick soon.`,
    `The clock is getting real in "${leagueName}" — 5 minutes left.`,
    `This pick needs to happen soon in "${leagueName}". 5 minutes left.`,
    `No more casual browsing — "${leagueName}" has 5 minutes left.`,
    `Five minutes left in "${leagueName}". This is where it gets serious.`,
  ];

  const URGENT_TITLES = [
    "⚠️ URGENT: under 2 minutes",
    "🚨 PICK NOW",
    "⏱️ CLOCK CRITICAL",
    "🔥 LAST 2 MINUTES",
    "🚨 Under 2 minutes",
    "⚠️ Draft emergency",
    "🚨 Auto-pick danger",
    "⏱️ Clock is red",
    "🔥 FINAL MOMENTS",
    "🚨 You're about to time out",
  ];
  const URGENT_BODIES = [
    `🚨 "${leagueName}": under 2 minutes left (${timeLeftText}). Draft now.`,
    `⚠️ "${leagueName}" pick timer is nearly gone (${timeLeftText}).`,
    `🔥 "${leagueName}": final moments (${timeLeftText}). Don't get auto-picked.`,
    `🚨 "${leagueName}": clock is critical — ${timeLeftText} left.`,
    `⚠️ Time is almost out in "${leagueName}" (${timeLeftText}).`,
    `🔥 "${leagueName}" — you're under 2 minutes. (${timeLeftText})`,
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
    "Last chance",
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
  ];

  const PAUSED_TITLES = [
    "Draft paused — but it's your pick",
    "Paused… you're still up",
    "League paused - your pick is waiting",
    "Draft is paused — but you're the pick",
    "Paused — you're currently on the clock",
    "Draft paused — you’re the current pick",
  ];

  const PAUSED_BODIES_WITH_TIME = [
    `"${leagueName}" is paused, but it's still your pick. ${timeLeftText} left.`,
    `Heads up — "${leagueName}" is paused, but you're the current pick. ${timeLeftText} remaining.`,
    `"${leagueName}" paused. The pick stopped with ${timeLeftText} left.`,
    `Paused in "${leagueName}" — you're still the pick when it resumes. ${timeLeftText} left.`,
    `"${leagueName}" is paused — you’re still the active pick. ${timeLeftText} remaining.`,
    `Draft paused in "${leagueName}" — your pick is waiting with ${timeLeftText} left.`,
  ];

  const PAUSED_BODIES_NO_TIME = [
    `"${leagueName}" is paused, but it's still your pick.`,
    `Heads up — "${leagueName}" is paused, and you're still the current pick.`,
    `"${leagueName}" paused while your pick was up.`,
    `Paused in "${leagueName}" — you're still the pick when it resumes.`,
    `"${leagueName}" is paused — you’re still the active pick.`,
    `Draft paused in "${leagueName}" — your pick is waiting.`,
  ];

  const UNPAUSED_TITLES = [
    "Draft resumed — you're up",
    "Back on: your pick",
    "Unpaused… clock is running",
    "Draft unpaused (still your turn)",
    "Resumed — you're still the pick",
    "Draft resumed — you're on the clock",
  ];
  const UNPAUSED_BODIES = [
    `"${leagueName}" resumed — it's still your pick. ${timeLeftText} left.`,
    `Unpaused in "${leagueName}" — you're still up. ${timeLeftText} remaining.`,
    `We're back. "${leagueName}" resumed and it's your pick. ${timeLeftText} left.`,
    `"${leagueName}" unpaused — you're the current pick. Clock: ${timeLeftText}.`,
    `"${leagueName}" is live again — still your turn. ${timeLeftText} left.`,
    `Draft resumed in "${leagueName}" — you’re still the pick. ${timeLeftText} remaining.`,
  ];

  if (stage === "onclock") return { title: pickRandom(ONCLOCK_TITLES), body: pickRandom(ONCLOCK_BODIES) };
  if (stage === "p50") return { title: pickRandom(P50_TITLES), body: pickRandom(P50_BODIES) };
  if (stage === "p25") return { title: pickRandom(P25_TITLES), body: pickRandom(P25_BODIES) };
  if (stage === "ten") return { title: pickRandom(TEN_TITLES), body: pickRandom(TEN_BODIES) };
  if (stage === "five") return { title: pickRandom(FIVE_TITLES), body: pickRandom(FIVE_BODIES) };
  if (stage === "urgent") return { title: pickRandom(URGENT_TITLES), body: pickRandom(URGENT_BODIES) };
  if (stage === "final") return { title: pickRandom(FINAL_TITLES), body: pickRandom(FINAL_BODIES) };

  if (stage === "paused") {
    return {
      title: pickRandom(PAUSED_TITLES),
      body: pickRandom(hasUsefulTime ? PAUSED_BODIES_WITH_TIME : PAUSED_BODIES_NO_TIME),
    };
  }

  if (stage === "unpaused") return { title: pickRandom(UNPAUSED_TITLES), body: pickRandom(UNPAUSED_BODIES) };

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
      settings_json TEXT,
      last_badge_count INTEGER,
      last_badge_synced_at INTEGER,
      updated_at INTEGER,
      created_at INTEGER
    )`,
    [
      { name: "subscription_json", type: "TEXT" },
      { name: "draft_ids_json", type: "TEXT" },
      { name: "username", type: "TEXT" },
      { name: "league_count", type: "INTEGER" },
      { name: "settings_json", type: "TEXT" },
      { name: "last_badge_count", type: "INTEGER" },
      { name: "last_badge_synced_at", type: "INTEGER" },
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
      sent_5min INTEGER,
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
      { name: "sent_5min", type: "INTEGER" },
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
                sent_onclock, sent_25, sent_50, sent_10min, sent_5min, sent_urgent, sent_final, sent_paused, sent_unpaused,
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
          sent_onclock, sent_25, sent_50, sent_10min, sent_5min, sent_urgent, sent_final, sent_paused, sent_unpaused,
          paused_remaining_ms, paused_at_ms, resume_clock_start_ms,
          updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint, draft_id) DO UPDATE SET
         pick_no=excluded.pick_no,
         last_status=excluded.last_status,
         sent_onclock=excluded.sent_onclock,
         sent_25=excluded.sent_25,
         sent_50=excluded.sent_50,
         sent_10min=excluded.sent_10min,
         sent_5min=excluded.sent_5min,
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
      Number(row.sent_5min || 0),
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

function shouldPersistClockState(prevRow, nextRow) {
  if (!nextRow || typeof nextRow !== "object") return false;
  if (!prevRow) return true;

  return !(
    Number(prevRow?.pick_no ?? 0) === Number(nextRow?.pick_no ?? 0) &&
    String(prevRow?.last_status || "") === String(nextRow?.last_status || "") &&
    Number(prevRow?.sent_onclock || 0) === Number(nextRow?.sent_onclock || 0) &&
    Number(prevRow?.sent_25 || 0) === Number(nextRow?.sent_25 || 0) &&
    Number(prevRow?.sent_50 || 0) === Number(nextRow?.sent_50 || 0) &&
    Number(prevRow?.sent_10min || 0) === Number(nextRow?.sent_10min || 0) &&
    Number(prevRow?.sent_5min || 0) === Number(nextRow?.sent_5min || 0) &&
    Number(prevRow?.sent_urgent || 0) === Number(nextRow?.sent_urgent || 0) &&
    Number(prevRow?.sent_final || 0) === Number(nextRow?.sent_final || 0) &&
    Number(prevRow?.sent_paused || 0) === Number(nextRow?.sent_paused || 0) &&
    Number(prevRow?.sent_unpaused || 0) === Number(nextRow?.sent_unpaused || 0) &&
    ((prevRow?.paused_remaining_ms == null ? null : Number(prevRow?.paused_remaining_ms)) ===
      (nextRow?.paused_remaining_ms == null ? null : Number(nextRow?.paused_remaining_ms))) &&
    ((prevRow?.paused_at_ms == null ? null : Number(prevRow?.paused_at_ms)) ===
      (nextRow?.paused_at_ms == null ? null : Number(nextRow?.paused_at_ms))) &&
    ((prevRow?.resume_clock_start_ms == null ? null : Number(prevRow?.resume_clock_start_ms)) ===
      (nextRow?.resume_clock_start_ms == null ? null : Number(nextRow?.resume_clock_start_ms)))
  );
}

function makeBaseFlags(clockState, nextPickNo, status, isNewPick) {
  return {
    pick_no: nextPickNo,
    last_status: status,
    sent_onclock: isNewPick ? 0 : Number(clockState?.sent_onclock || 0) ? 1 : 0,
    sent_25: isNewPick ? 0 : Number(clockState?.sent_25 || 0) ? 1 : 0,
    sent_50: isNewPick ? 0 : Number(clockState?.sent_50 || 0) ? 1 : 0,
    sent_10min: isNewPick ? 0 : Number(clockState?.sent_10min || 0) ? 1 : 0,
    sent_5min: isNewPick ? 0 : Number(clockState?.sent_5min || 0) ? 1 : 0,
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
    const debug = getDebugConfig(req);
    const debugEntries = [];
    const pushDebug = (entry) => {
      if (!debug.enabled) return;
      if (debugEntries.length >= debug.maxEntries) return;
      debugEntries.push(entry);
    };

    const subRows = await db
      .prepare(
        `SELECT endpoint, subscription_json, draft_ids_json, username, league_count, settings_json, last_badge_count, last_badge_synced_at, updated_at
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
        let settings = DEFAULT_PUSH_SETTINGS;
        try {
          settings = normalizePushSettings(JSON.parse(r.settings_json || "{}"));
        } catch {}
        return {
          endpoint: r.endpoint,
          sub,
          username: r.username || null,
          draftIds: Array.isArray(draftIds) ? draftIds : [],
          leagueCount: Number(r.league_count || 0),
          settings,
          lastBadgeCount: Number(r.last_badge_count || 0),
          lastBadgeSyncedAt: Number(r.last_badge_synced_at || 0),
          updatedAt: Number(r.updated_at || 0),
        };
      })
      .filter((x) => x?.sub?.endpoint && x.endpoint);

    let sent = 0;
    let checked = 0;
    let stateWriteCount = 0;
    let clearWriteCount = 0;
    let badgeWriteCount = 0;
    let deleteSubWriteCount = 0;

    let skippedNoDrafts = 0;
    let skippedNoUsername = 0;
    let skippedNoOrder = 0;
    let skippedNotOnClock = 0;
    let skippedMissingRosterCtx = 0;

    const sendPayload = async (subRow, payload) => {
      try {
        if (!subRow?.sub?.endpoint) {
          return { ok: false, status: 0, error: "missing-endpoint" };
        }

        const appleWebPush = isAppleSubscriptionEndpoint(subRow?.sub?.endpoint);
        const mergedPayload = {
          ...(payload && typeof payload === "object" ? payload : {}),
          isAppleWebPush: appleWebPush,
        };

        const { endpoint, fetchInit } = await buildWebPushRequest({
          subscription: subRow.sub,
          payload: mergedPayload,
          vapidSubject,
          vapidPrivateJwk,
        });

        const res = await fetch(endpoint, fetchInit);
        let responseText = null;
        try {
          responseText = await res.clone().text();
        } catch {
          responseText = null;
        }
        return {
          ok: !!res?.ok,
          status: Number(res?.status || 0),
          statusText: String(res?.statusText || ""),
          endpoint,
          endpointLabel: makeEndpointLabel(endpoint),
          isAppleWebPush: appleWebPush,
          responseText,
          payloadMeta: {
            silent: !!mergedPayload?.silent,
            hasTitle: !!mergedPayload?.title,
            tag: String(mergedPayload?.tag || ""),
            appBadgeCount: Number.isFinite(Number(mergedPayload?.appBadgeCount))
              ? Number(mergedPayload.appBadgeCount)
              : null,
            clearAppBadge: !!mergedPayload?.clearAppBadge,
            badgesEnabled: mergedPayload?.badgesEnabled !== false,
          },
          response: res,
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          error: err?.message || "push-send-failed",
          endpoint: String(subRow?.sub?.endpoint || ""),
          endpointLabel: makeEndpointLabel(subRow?.sub?.endpoint || ""),
          isAppleWebPush: isAppleSubscriptionEndpoint(subRow?.sub?.endpoint),
        };
      }
    };

    const buildBadgeSyncStmt = (endpoint, count) =>
      db
        .prepare(
          `UPDATE push_subscriptions
           SET last_badge_count=?, last_badge_synced_at=?, updated_at=?
           WHERE endpoint=?`
        )
        .bind(Number(count || 0), now, now, endpoint);

    const shouldSendStageForSettings = (stage, settings) => {
      const s = normalizePushSettings(settings);
      if (stage === "onclock") return !!s.onClock;
      if (stage === "paused" || stage === "unpaused") return !!s.paused;
      return !!s.progress;
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
      if (debug.enabled) {
        const usernameMatch = !debug.username || safeLower(s.username) === debug.username;
        const endpointMatch = !debug.endpoint || String(s.endpoint || "") === debug.endpoint;
        if (!usernameMatch || !endpointMatch) continue;
      }
      for (const id of s.draftIds || []) {
        const draftId = String(id || "");
        if (draftId && activeDraftIdSet.has(draftId)) allRelevantDraftIds.push(draftId);
      }
    }

    const registryMap = await loadRegistryRowsMap(db, allRelevantDraftIds);

    for (const s of subs) {
      if (!s.username) {
        skippedNoUsername++;
        pushDebug({ endpoint: s.endpoint, username: s.username, reason: "no-username" });
        if (s.settings?.badges && s.lastBadgeCount > 0) {
          const badgeRes = await sendPayload(s, {
            silent: true,
            badgesEnabled: true,
            appBadgeCount: 0,
            clearAppBadge: true,
            url: "/draft-pick-tracker",
          });
          if (badgeRes?.ok) {
            await batchRun(db, [buildBadgeSyncStmt(s.endpoint, 0)]);
          }
        }
        continue;
      }

      if (!s.draftIds.length) {
        skippedNoDrafts++;
        pushDebug({ endpoint: s.endpoint, username: s.username, reason: "no-drafts" });
        if (s.settings?.badges && s.lastBadgeCount > 0) {
          const badgeRes = await sendPayload(s, {
            silent: true,
            badgesEnabled: true,
            appBadgeCount: 0,
            clearAppBadge: true,
            url: "/draft-pick-tracker",
          });
          if (badgeRes?.ok) {
            await batchRun(db, [buildBadgeSyncStmt(s.endpoint, 0)]);
          }
        }
        continue;
      }

      const activeDraftIdsForSub = (s.draftIds || [])
        .map(String)
        .filter((id) => activeDraftIdSet.has(id));

      if (!activeDraftIdsForSub.length) {
        pushDebug({ endpoint: s.endpoint, username: s.username, reason: "no-active-drafts" });
        if (s.settings?.badges && s.lastBadgeCount > 0) {
          const badgeRes = await sendPayload(s, {
            silent: true,
            badgesEnabled: true,
            appBadgeCount: 0,
            clearAppBadge: true,
            url: "/draft-pick-tracker",
          });
          if (badgeRes?.ok) {
            await batchRun(db, [buildBadgeSyncStmt(s.endpoint, 0)]);
          }
        }
        continue;
      }

      const clockStateMap = await loadClockStatesForEndpoint(db, s.endpoint, activeDraftIdsForSub);

      const events = [];
      const onClockSnapshot = [];
      const stateStatements = [];
      const clearStatements = [];
      const deleteSubStatements = [];
      const badgeStatements = [];

      for (const draftId of activeDraftIdsForSub) {
        checked++;

        const reg = registryMap.get(String(draftId));
        if (!reg) continue;
        const clockState = clockStateMap.get(String(draftId)) || null;

        const status = String(reg?.status || "").toLowerCase();
        if (status !== "drafting" && status !== "paused") {
          if (clockState) {
            clearStatements.push(buildClearClockStateStmt(db, s.endpoint, draftId));
          }
          continue;
        }

        const nextPickNo = Number(reg?.current_pick || 0);
        if (!nextPickNo) {
          skippedNoOrder++;
          pushDebug({ endpoint: s.endpoint, username: s.username, draftId, reason: "no-current-pick" });
          continue;
        }

        const uname = safeLower(s.username);

        const rosterByUsername = jsonParseSafe(reg?.roster_by_username_json || "{}", {});
        const rosterNames = jsonParseSafe(reg?.roster_names_json || "{}", {});

        const hasRosterCtx =
          rosterByUsername &&
          typeof rosterByUsername === "object" &&
          Object.keys(rosterByUsername).length > 0 &&
          rosterNames &&
          typeof rosterNames === "object" &&
          Object.keys(rosterNames).length > 0;

        if (!hasRosterCtx) {
          skippedMissingRosterCtx++;
          pushDebug({ endpoint: s.endpoint, username: s.username, draftId, reason: "missing-roster-context" });
          continue;
        }

        const userRosterId =
          rosterByUsername?.[uname] != null ? String(rosterByUsername[uname]) : null;
        const userRosterName = userRosterId ? String(rosterNames?.[userRosterId] || "") : "";

        const currentOwnerName = String(reg?.current_owner_name || "");
        const isOnClock =
          Boolean(userRosterName) &&
          Boolean(currentOwnerName) &&
          safeLower(userRosterName) === safeLower(currentOwnerName);

        if (!isOnClock) {
          if (clockState) {
            clearStatements.push(buildClearClockStateStmt(db, s.endpoint, draftId));
          }
          skippedNotOnClock++;
          pushDebug({ endpoint: s.endpoint, username: s.username, draftId, reason: "not-on-clock", currentOwnerName, userRosterName });
          continue;
        }

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
            remainingMs = Math.max(
              0,
              frozenPausedRemaining - Math.max(0, now - resumeClockStartMs)
            );
          } else {
            remainingMs = frozenPausedRemaining;
          }
        }

        if (!isPaused && rawRemainingMs > 0 && remainingMs <= 0) {
          remainingMs = rawRemainingMs;
        }
        onClockSnapshot.push({
          draftId: String(draftId),
          leagueName: String(reg?.league_name || "your league"),
          stage: wasPaused && !isPaused ? "unpaused" : status === "paused" ? "paused" : "onclock",
          remainingMs: Number.isFinite(remainingMs) ? remainingMs : 0,
          timerMs: totalMs > 0 ? totalMs : 0,
        });

        const baseFlags = makeBaseFlags(clockState, nextPickNo, status, isNewPick);

        if (isPaused) {
          baseFlags.paused_remaining_ms = pausedRemainingKnown
            ? frozenPausedRemaining
            : remainingMs;
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
        const sent5 = baseFlags.sent_5min === 1;
        const sentUrgent = baseFlags.sent_urgent === 1;
        const sentFinal = baseFlags.sent_final === 1;

        const transitionedToPaused = status === "paused" && prevStatus !== "paused";
        const transitionedFromPaused = status !== "paused" && prevStatus === "paused";

        if (status === "paused") {
          if (transitionedToPaused || isNewPick || !sentPaused) stageToSend = "paused";
        } else {
          if (transitionedFromPaused) {
            stageToSend = "unpaused";
          } else if (isNewPick || !sentOnclock) {
            stageToSend = "onclock";
          } else if (totalMs > 0) {
            const usedFrac = 1 - remainingMs / totalMs;

            if (remainingMs <= 120000 && !sentUrgent) {
              stageToSend = "urgent";
            } else {
              const canTen = totalMs > 600000;
              const tenEligible =
                canTen && remainingMs <= 600000 && remainingMs < totalMs - 30000;

              const canFive = totalMs > 300000;
              const fiveEligible =
                canFive && remainingMs <= 300000 && remainingMs < totalMs - 30000;

              const quarterLeftEligible =
                totalMs > 0 &&
                remainingMs <= Math.floor(totalMs * 0.25) &&
                remainingMs > 600000;

              if (fiveEligible && !sent5) stageToSend = "five";
              else if (tenEligible && !sent10) stageToSend = "ten";
              else if (quarterLeftEligible && !sent25) stageToSend = "p25";
              else if (usedFrac >= 0.5 && !sent50) stageToSend = "p50";
              else {
                const finalThresholdMs = clamp(Math.floor(totalMs * 0.1), 15000, 60000);
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
          if (shouldPersistClockState(clockState, baseFlags)) {
            stateStatements.push(buildClockStateStmt(db, s.endpoint, draftId, baseFlags));
          }
          pushDebug({ endpoint: s.endpoint, username: s.username, draftId, reason: "no-stage-to-send", pickNo: nextPickNo, status, prevStatus, sentPaused, sentUnpaused, sentOnclock, transitionedToPaused, transitionedFromPaused, isNewPick });
          continue;
        }

        const nextFlags = { ...baseFlags };
        if (stageToSend === "onclock") nextFlags.sent_onclock = 1;
        if (stageToSend === "p25") nextFlags.sent_25 = 1;
        if (stageToSend === "p50") nextFlags.sent_50 = 1;
        if (stageToSend === "ten") nextFlags.sent_10min = 1;
        if (stageToSend === "five") nextFlags.sent_5min = 1;
        if (stageToSend === "urgent") nextFlags.sent_urgent = 1;
        if (stageToSend === "final") nextFlags.sent_final = 1;
        if (stageToSend === "paused") {
          nextFlags.sent_paused = 1;
          nextFlags.sent_unpaused = 0;
        }

        if (stageToSend === "unpaused") {
        nextFlags.sent_unpaused = 1;
        nextFlags.sent_paused = 0;

        const reached = getReachedStageFlags(totalMs, remainingMs);
        nextFlags.sent_onclock = Math.max(nextFlags.sent_onclock, reached.sent_onclock);
        nextFlags.sent_50 = Math.max(nextFlags.sent_50, reached.sent_50);
        nextFlags.sent_25 = Math.max(nextFlags.sent_25, reached.sent_25);
        nextFlags.sent_10min = Math.max(nextFlags.sent_10min, reached.sent_10min);
        nextFlags.sent_5min = Math.max(nextFlags.sent_5min, reached.sent_5min);
        nextFlags.sent_urgent = Math.max(nextFlags.sent_urgent, reached.sent_urgent);
        nextFlags.sent_final = Math.max(nextFlags.sent_final, reached.sent_final);
      }

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

      const activeBadgeCount = onClockSnapshot.length;
      const shouldBadge = !!s.settings?.badges;
      const badgeCountChanged = Number(s.lastBadgeCount || 0) !== activeBadgeCount;
      const eventsToNotifyPreview = events.filter((ev) => shouldSendStageForSettings(ev.stage, s.settings));
      const willSendVisibleNotification = eventsToNotifyPreview.length > 0;

      if (!willSendVisibleNotification) {
        if (shouldBadge && badgeCountChanged) {
          const badgeRes = await sendPayload(s, {
            silent: true,
            badgesEnabled: true,
            appBadgeCount: activeBadgeCount,
            clearAppBadge: activeBadgeCount <= 0,
            url: "/draft-pick-tracker",
          });
          if (badgeRes?.ok) {
            badgeStatements.push(buildBadgeSyncStmt(s.endpoint, activeBadgeCount));
          } else if (badgeRes?.status === 404 || badgeRes?.status === 410) {
            deleteSubStatements.push(
              db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint)
            );
          }
        } else if (!shouldBadge && Number(s.lastBadgeCount || 0) !== 0) {
          const badgeRes = await sendPayload(s, {
            silent: true,
            badgesEnabled: true,
            appBadgeCount: 0,
            clearAppBadge: true,
            url: "/draft-pick-tracker",
          });
          if (badgeRes?.ok) {
            badgeStatements.push(buildBadgeSyncStmt(s.endpoint, 0));
          }
        }
      }

      if (!events.length) {
        pushDebug({ endpoint: s.endpoint, username: s.username, reason: "no-events", activeBadgeCount, onClockSnapshotCount: onClockSnapshot.length });
        stateWriteCount += stateStatements.length;
        clearWriteCount += clearStatements.length;
        badgeWriteCount += badgeStatements.length;
        deleteSubWriteCount += deleteSubStatements.length;
        await batchRun(db, [...clearStatements, ...stateStatements, ...badgeStatements, ...deleteSubStatements]);
        continue;
      }

      const sendIndividual = async (ev) => {
        if (!shouldSendStageForSettings(ev.stage, s.settings)) {
          const prevClockState = clockStateMap.get(String(ev.draftId)) || null;
          if (shouldPersistClockState(prevClockState, ev.nextFlags)) {
            stateStatements.push(buildClockStateStmt(db, s.endpoint, ev.draftId, ev.nextFlags));
          }
          return;
        }
        const isUrgent = ev.stage === "urgent" || ev.stage === "five";
        const alsoUpSummary = buildAlsoUpSummary(onClockSnapshot, {
          excludeDraftIds: [ev.draftId],
        });
        const bodyWithSummary = alsoUpSummary
          ? `${ev.body} ${alsoUpSummary}`
          : ev.body;
        const isAppleEndpoint = isAppleSubscriptionEndpoint(s?.sub?.endpoint || s?.endpoint || "");

        const pushRes = await sendPayload(s, {
          title: ev.title,
          body: bodyWithSummary,
          url: "/draft-pick-tracker",
          tag: isAppleEndpoint ? undefined : buildEventNotificationTag(ev),
          renotify: isAppleEndpoint ? undefined : true,
          icon: ev.icon,
          badge: isAppleEndpoint ? undefined : "/android-chrome-192x192.png",
          appBadgeCount: activeBadgeCount,
          clearAppBadge: activeBadgeCount <= 0,
          badgesEnabled: isAppleEndpoint ? false : !!s.settings?.badges,
          requireInteraction: isAppleEndpoint ? undefined : (isUrgent ? true : undefined),
          vibrate: isAppleEndpoint ? undefined : (isUrgent ? [100, 60, 100, 60, 180] : undefined),
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
          actions: isAppleEndpoint
            ? undefined
            : [
                { action: "open_tracker", title: "Open Tracker" },
                ...(ev.leagueUrl ? [{ action: "open_league", title: "Open League" }] : []),
              ],
        });

        pushDebug({ endpoint: s.endpoint, username: s.username, draftId: ev.draftId, send: "individual", stage: ev.stage, pickNo: ev.pickNo, result: pushRes });

        if (pushRes?.ok) {
          sent++;
          const prevClockState = clockStateMap.get(String(ev.draftId)) || null;
          if (shouldPersistClockState(prevClockState, ev.nextFlags)) {
            stateStatements.push(buildClockStateStmt(db, s.endpoint, ev.draftId, ev.nextFlags));
          }
          if (shouldBadge && Number(s.lastBadgeCount || 0) !== activeBadgeCount) {
            badgeStatements.push(buildBadgeSyncStmt(s.endpoint, activeBadgeCount));
          } else if (!shouldBadge && Number(s.lastBadgeCount || 0) !== 0) {
            badgeStatements.push(buildBadgeSyncStmt(s.endpoint, 0));
          }
        } else if (pushRes?.status === 404 || pushRes?.status === 410) {
          deleteSubStatements.push(
            db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint)
          );
          clearStatements.push(buildClearClockStateStmt(db, s.endpoint, ev.draftId));
        }
      };

      if (events.length === 1) {
        await sendIndividual(events[0]);
        stateWriteCount += stateStatements.length;
        clearWriteCount += clearStatements.length;
        badgeWriteCount += badgeStatements.length;
        deleteSubWriteCount += deleteSubStatements.length;
        await batchRun(db, [...clearStatements, ...stateStatements, ...badgeStatements, ...deleteSubStatements]);
        continue;
      }

      const isUrg = (ev) =>
        ev.stage === "urgent" ||
        ev.stage === "five" ||
        (ev.remainingMs > 0 && ev.remainingMs <= 120000 && ev.stage !== "paused");
      const isPausedStage = (ev) => ev.stage === "paused";
      const isResumedStage = (ev) => ev.stage === "unpaused";

      const eventsToNotify = eventsToNotifyPreview;
      if (!eventsToNotify.length) {
        pushDebug({ endpoint: s.endpoint, username: s.username, reason: "events-filtered-by-settings", eventStages: events.map((ev) => ev.stage), settings: s.settings });
        for (const ev of events) {
          const prevClockState = clockStateMap.get(String(ev.draftId)) || null;
          if (shouldPersistClockState(prevClockState, ev.nextFlags)) {
            stateStatements.push(buildClockStateStmt(db, s.endpoint, ev.draftId, ev.nextFlags));
          }
        }
        stateWriteCount += stateStatements.length;
        clearWriteCount += clearStatements.length;
        badgeWriteCount += badgeStatements.length;
        deleteSubWriteCount += deleteSubStatements.length;
        await batchRun(db, [...clearStatements, ...stateStatements, ...badgeStatements, ...deleteSubStatements]);
        continue;
      }

      const sorted = eventsToNotify.slice().sort((a, b) => {
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
      const title = buildGroupedTitle(sorted);

      const summaryIcon = sorted.find((x) => x.icon)?.icon || null;

      const isAppleEndpoint = isAppleSubscriptionEndpoint(s?.sub?.endpoint || s?.endpoint || "");
      const pushRes = await sendPayload(s, {
        title,
        body: [
          `Triggered: ${sorted
            .slice(0, 3)
            .map((ev) => {
              const lbl = stageLabel(ev.stage);
              const showTime =
                ev.stage !== "paused" &&
                ev.stage !== "unpaused" &&
                ev.remainingMs > 0;
              const t = showTime ? ` ${msToClock(ev.remainingMs)}` : "";
              return `${ev.leagueName} ${lbl}${t}`;
            })
            .join(" | ")}${sorted.length > 3 ? ` +${sorted.length - 3} more` : ""}`,
          buildAlsoUpSummary(onClockSnapshot, {
            excludeDraftIds: sorted.map((ev) => ev.draftId),
          }),
        ].filter(Boolean).join(" "),
        url: "/draft-pick-tracker",
        tag: isAppleEndpoint ? undefined : buildGroupedNotificationTag(sorted, anyUrgent),
        renotify: isAppleEndpoint ? undefined : true,
        icon: summaryIcon,
        badge: isAppleEndpoint ? undefined : "/android-chrome-192x192.png",
        appBadgeCount: activeBadgeCount,
        clearAppBadge: activeBadgeCount <= 0,
        badgesEnabled: isAppleEndpoint ? false : !!s.settings?.badges,
        requireInteraction: isAppleEndpoint ? undefined : (anyUrgent ? true : undefined),
        vibrate: isAppleEndpoint ? undefined : (anyUrgent ? [100, 60, 100, 60, 180] : undefined),
        data: {
          url: "/draft-pick-tracker",
          summary: true,
          count: sorted.length,
          urgent: anyUrgent ? 1 : 0,
        },
        actions: isAppleEndpoint ? undefined : [{ action: "open_tracker", title: "Open Tracker" }],
      });

      pushDebug({ endpoint: s.endpoint, username: s.username, send: "grouped", stages: sorted.map((ev) => ev.stage), draftIds: sorted.map((ev) => ev.draftId), pickNos: sorted.map((ev) => ev.pickNo), result: pushRes });

      if (pushRes?.ok) {
        sent++;
        for (const ev of events) {
          const prevClockState = clockStateMap.get(String(ev.draftId)) || null;
          if (shouldPersistClockState(prevClockState, ev.nextFlags)) {
            stateStatements.push(buildClockStateStmt(db, s.endpoint, ev.draftId, ev.nextFlags));
          }
        }
        if (shouldBadge && Number(s.lastBadgeCount || 0) !== activeBadgeCount) {
          badgeStatements.push(buildBadgeSyncStmt(s.endpoint, activeBadgeCount));
        } else if (Number(s.lastBadgeCount || 0) !== 0) {
          badgeStatements.push(buildBadgeSyncStmt(s.endpoint, 0));
        }
      } else if (pushRes?.status === 404 || pushRes?.status === 410) {
        deleteSubStatements.push(
          db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint)
        );
        for (const ev of events) {
          clearStatements.push(buildClearClockStateStmt(db, s.endpoint, ev.draftId));
        }
      }

      stateWriteCount += stateStatements.length;
      clearWriteCount += clearStatements.length;
      badgeWriteCount += badgeStatements.length;
      deleteSubWriteCount += deleteSubStatements.length;
      await batchRun(db, [...clearStatements, ...stateStatements, ...badgeStatements, ...deleteSubStatements]);
    }

    return NextResponse.json({
      ok: true,
      subs: subs.length,
      checked,
      sent,
      stateWriteCount,
      clearWriteCount,
      badgeWriteCount,
      deleteSubWriteCount,
      skippedNoDrafts,
      skippedNoUsername,
      skippedNoOrder,
      skippedNotOnClock,
      skippedMissingRosterCtx,
      ...(debug.enabled
        ? {
            debug: {
              filter: {
                username: debug.username || null,
                endpoint: debug.endpoint || null,
                maxEntries: debug.maxEntries,
              },
              entries: debugEntries,
            },
          }
        : {}),
    });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}
