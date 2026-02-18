export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildPushHTTPRequest } from "@pushforge/builder";

export async function POST(req) {
  return handler(req);
}
export async function GET(req) {
  return handler(req);
}

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env?.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function msToClock(ms) {
  const s = Math.max(0, Math.floor(safeNum(ms) / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hh > 0) return `${hh}:${pad(mm)}:${pad(ss)}`;
  return `${mm}:${pad(ss)}`;
}

function hash32(str) {
  // deterministic, cheap (Edge-safe)
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickVariant(arr, key) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const idx = hash32(String(key)) % arr.length;
  return arr[idx];
}

// ----- Sleeper fetch helpers -----

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function getPickCount(draftId) {
  const picks = await fetchJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
  return Array.isArray(picks) ? picks.length : 0;
}

async function getDraft(draftId) {
  return fetchJson(`https://api.sleeper.app/v1/draft/${draftId}`);
}

async function getTradedPicks(draftId) {
  try {
    const tps = await fetchJson(
      `https://api.sleeper.app/v1/draft/${draftId}/traded_picks`
    );
    return Array.isArray(tps) ? tps : [];
  } catch {
    return [];
  }
}

async function getLeague(leagueId) {
  return fetchJson(`https://api.sleeper.app/v1/league/${leagueId}`);
}

async function getLeagueUsers(leagueId) {
  try {
    const u = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/users`);
    return Array.isArray(u) ? u : [];
  } catch {
    return [];
  }
}

async function getLeagueRosters(leagueId) {
  try {
    const r = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

async function getUserId(username) {
  const u = await fetchJson(
    `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`
  );
  return u?.user_id ? String(u.user_id) : null;
}

// ----- Traded pick ownership (round/slot aware, supports 3RR) -----

function buildTradedPickOwnerMap(tradedPicks = [], seasonStr = "") {
  // key: `${season}|${round}|${originalRosterId}` => currentOwnerRosterId
  const bestByKey = new Map();

  const scoreRow = (tp) => {
    const updated = safeNum(tp?.updated);
    const created = safeNum(tp?.created);
    if (updated > 0) return updated;
    if (created > 0) return created;

    const tx = tp?.transaction_id;
    if (typeof tx === "number" && Number.isFinite(tx)) return tx;
    if (typeof tx === "string") {
      const n = Number(tx);
      if (Number.isFinite(n)) return n;
      return hash32(tx);
    }
    return 0;
  };

  (tradedPicks || []).forEach((tp, idx) => {
    const season = String(tp?.season ?? "");
    const round = safeNum(tp?.round);
    const orig = String(tp?.roster_id ?? "");
    const owner = String(tp?.owner_id ?? "");

    if (!season || !round || !orig || !owner) return;
    if (seasonStr && season !== seasonStr) return;

    const key = `${season}|${round}|${orig}`;
    const prev = bestByKey.get(key);
    const next = { owner, score: scoreRow(tp), idx };
    if (!prev || next.score > prev.score || (next.score === prev.score && next.idx > prev.idx)) {
      bestByKey.set(key, next);
    }
  });

  const m = new Map();
  for (const [key, val] of bestByKey.entries()) m.set(key, val.owner);
  return m;
}

function getSnakeSlotForPick({ pickNo, teams, reversalRound }) {
  if (!pickNo || !teams) return null;
  const idx0 = pickNo - 1;
  const round = Math.floor(idx0 / teams) + 1;
  const pickInRound0 = idx0 % teams;

  // Normal snake flips each round; 3RR means skip the flip on reversalRound.
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

function resolveRosterForPick({
  pickNo,
  teams,
  rosterBySlot,
  tradedOwnerMap,
  seasonStr,
  reversalRound,
}) {
  const rs = getSnakeSlotForPick({ pickNo, teams, reversalRound });
  if (!rs) return null;
  const { round, slot } = rs;
  const origRosterId = rosterBySlot.get(slot) || null;
  if (!origRosterId) return null;
  const tradedOwner = tradedOwnerMap?.get(`${seasonStr}|${round}|${String(origRosterId)}`) || null;
  return tradedOwner || String(origRosterId);
}

function buildRosterBySlot(draft, rosters = []) {
  const rosterBySlot = new Map();

  // best when present
  const slotToRoster = draft?.slot_to_roster_id || {};
  for (const [slot, rid] of Object.entries(slotToRoster)) {
    const s = safeNum(slot);
    if (s && rid != null) rosterBySlot.set(s, String(rid));
  }
  if (rosterBySlot.size > 0) return rosterBySlot;

  // fallback: draft_order user_id -> slot; rosters owner_id -> roster_id
  const ownerToRoster = new Map();
  (rosters || []).forEach((r) => {
    if (r?.owner_id != null && r?.roster_id != null) {
      ownerToRoster.set(String(r.owner_id), String(r.roster_id));
    }
  });

  const draftOrder = draft?.draft_order || {};
  for (const [userId, slot] of Object.entries(draftOrder)) {
    const s = safeNum(slot);
    const rid = ownerToRoster.get(String(userId));
    if (s && rid) rosterBySlot.set(s, rid);
  }

  return rosterBySlot;
}

function getMyRosterIdForLeague(users = [], rosters = [], username) {
  const uname = String(username || "").toLowerCase().trim();
  if (!uname) return null;

  const u =
    (users || []).find((x) => String(x?.username || "").toLowerCase() === uname) ||
    (users || []).find((x) => String(x?.display_name || "").toLowerCase() === uname);
  if (!u?.user_id) return null;

  const r = (rosters || []).find((x) => String(x?.owner_id) === String(u.user_id));
  return r?.roster_id ? String(r.roster_id) : null;
}

function leagueAvatarUrl(avatarId) {
  return avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null;
}

function sleeperDraftUrl(draftId) {
  // NFL drafts live here (works for most Sleeper leagues)
  return draftId ? `https://sleeper.com/draft/nfl/${draftId}` : null;
}

// ----- Notification copy -----

const COPY = {
  onclock: [
    "You're on the clock.",
    "Your pick is up.",
    "You're up — make your pick.",
  ],
  pct25: [
    "25% of your clock is gone — don't forget to pick.",
    "Quick nudge: you're 25% into your timer.",
    "Quarter of the clock used — lock it in.",
  ],
  pct50: [
    "Half your clock is gone… you good?",
    "50% used — still on the clock.",
    "Friendly panic: you're at halftime of your timer.",
  ],
  ten: [
    "Seriously — 10 minutes left. Make your pick.",
    "10 minutes remaining. Don't let it auto-pick.",
    "Only 10 minutes left… pick time.",
  ],
  final: [
    "LAST CALL — time is almost up.",
    "Auto-pick danger zone. Move.",
    "Final warning — pick now.",
  ],
  paused: [
    "Draft paused — you're still on the clock.",
    "Paused, but your pick is still next.",
    "Draft is paused. You're up when it resumes.",
  ],
  unpaused: [
    "Draft resumed — you're still on the clock.",
    "We're back. You're up.",
    "Unpaused — you still have the pick.",
  ],
};

function buildNotification(kind, items) {
  const count = items.length;
  const one = count === 1 ? items[0] : null;
  const clockBits = (it) => `${it.leagueName} — ${msToClock(it.remainingMs)} left`;
  const lines = items.map((it) => `• ${clockBits(it)}`);

  const titleBase =
    kind === "onclock"
      ? "You're on the clock"
      : kind === "pct25"
      ? "Clock warning"
      : kind === "pct50"
      ? "Clock warning"
      : kind === "ten"
      ? "10 minutes left"
      : kind === "final"
      ? "Final warning"
      : kind === "paused"
      ? "Draft paused"
      : kind === "unpaused"
      ? "Draft resumed"
      : "Draft Update";

  const title = count > 1 ? `${titleBase} (${count})` : titleBase;

  // If only one league, use more personality; if multiple, keep it concise.
  const blurb = count === 1 ? pickVariant(COPY[kind] || [], `${one.draftId}|${one.pickNo}|${kind}`) : "";
  const body = [
    blurb,
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");

  const tag = `tfa-dpt-${kind}`;
  const requireInteraction = ["onclock", "final", "paused", "unpaused"].includes(kind);
  const renotify = kind !== "onclock";

  const icon = one?.leagueAvatarUrl || undefined;
  const leagueUrl = one?.leagueUrl || undefined;

  const actions =
    one && leagueUrl
      ? [
          { action: "open-tracker", title: "Open Tracker" },
          { action: "open-league", title: "Open Draft" },
        ]
      : [{ action: "open-tracker", title: "Open Tracker" }];

  return {
    title,
    body,
    url: "/draft-pick-tracker",
    tag,
    renotify,
    requireInteraction,
    icon,
    data: leagueUrl ? { leagueUrl } : undefined,
    actions,
  };
}

// ----- DB helpers -----

async function getClockState(db, endpoint, draftId) {
  return db
    .prepare(
      `SELECT pick_no, last_status, sent_onclock, sent_25, sent_50, sent_10min, sent_final, sent_paused, sent_unpaused
       FROM push_clock_state
       WHERE endpoint=? AND draft_id=?`
    )
    .bind(endpoint, String(draftId))
    .first();
}

async function upsertClockState(db, endpoint, draftId, fields) {
  const now = safeNum(fields.updated_at);
  const pickNo = safeNum(fields.pick_no);
  const lastStatus = fields.last_status ?? null;

  const flags = {
    sent_onclock: safeNum(fields.sent_onclock ?? 0),
    sent_25: safeNum(fields.sent_25 ?? 0),
    sent_50: safeNum(fields.sent_50 ?? 0),
    sent_10min: safeNum(fields.sent_10min ?? 0),
    sent_final: safeNum(fields.sent_final ?? 0),
    sent_paused: safeNum(fields.sent_paused ?? 0),
    sent_unpaused: safeNum(fields.sent_unpaused ?? 0),
  };

  await db
    .prepare(
      `INSERT INTO push_clock_state (
        endpoint, draft_id, pick_no, last_status,
        sent_onclock, sent_25, sent_50, sent_10min, sent_final, sent_paused, sent_unpaused,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      lastStatus,
      flags.sent_onclock,
      flags.sent_25,
      flags.sent_50,
      flags.sent_10min,
      flags.sent_final,
      flags.sent_paused,
      flags.sent_unpaused,
      now
    )
    .run();
}

async function deleteClockState(db, endpoint, draftId) {
  await db
    .prepare(`DELETE FROM push_clock_state WHERE endpoint=? AND draft_id=?`)
    .bind(endpoint, String(draftId))
    .run();
}

// ----- Main handler -----

async function handler(req) {
  try {
    const { env } = getRequestContext();
    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const vapidPrivate = env?.VAPID_PRIVATE_KEY;
    const subject = env?.VAPID_SUBJECT;
    if (!vapidPrivate || !subject) {
      return new NextResponse("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.", { status: 500 });
    }

    let jwk;
    try {
      jwk = JSON.parse(vapidPrivate);
    } catch {
      return new NextResponse("VAPID_PRIVATE_KEY must be a JSON JWK string.", { status: 500 });
    }

    const now = Date.now();

    const subRows = await db
      .prepare(
        `SELECT endpoint, subscription_json, draft_ids_json, username FROM push_subscriptions`
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
        };
      })
      .filter((x) => x?.sub?.endpoint && x.endpoint);

    // Caches (reduce Sleeper calls within this poll)
    const userIdCache = new Map(); // username -> user_id
    const draftCache = new Map(); // draftId -> draft
    const pickCountCache = new Map(); // draftId -> pickCount
    const tradedCache = new Map(); // draftId -> traded_picks[]
    const leagueCache = new Map(); // leagueId -> league
    const leagueUsersCache = new Map(); // leagueId -> users[]
    const leagueRostersCache = new Map(); // leagueId -> rosters[]
    const myRosterCache = new Map(); // `${leagueId}|${username}` -> roster_id

    // endpoint -> kind -> items
    const bucket = new Map();
    const addToBucket = (endpoint, kind, item) => {
      if (!bucket.has(endpoint)) bucket.set(endpoint, new Map());
      const m = bucket.get(endpoint);
      if (!m.has(kind)) m.set(kind, []);
      m.get(kind).push(item);
    };

    let checkedDrafts = 0;
    let onClockDrafts = 0;
    let sent = 0;
    let pruned = 0;

    let skippedNoDrafts = 0;
    let skippedNoUsername = 0;

    for (const s of subs) {
      if (!s.draftIds.length) {
        skippedNoDrafts++;
        continue;
      }
      if (!s.username) {
        skippedNoUsername++;
        continue;
      }

      // Resolve Sleeper user_id
      let userId = userIdCache.get(s.username);
      if (!userId) {
        userId = await getUserId(s.username).catch(() => null);
        userIdCache.set(s.username, userId);
      }
      if (!userId) continue;

      for (const draftId of s.draftIds) {
        checkedDrafts++;

        // Draft
        let draft = draftCache.get(draftId);
        if (!draft) {
          draft = await getDraft(draftId).catch(() => null);
          if (!draft) continue;
          draftCache.set(draftId, draft);
        }

        const draftStatus = String(draft?.status || "").toLowerCase();
        if (draftStatus === "complete") {
          // keep DB tidy
          await deleteClockState(db, s.endpoint, draftId);
          continue;
        }

        const leagueId = draft?.league_id ? String(draft.league_id) : null;
        if (!leagueId) continue;

        // League meta
        let league = leagueCache.get(leagueId);
        if (!league) {
          league = await getLeague(leagueId).catch(() => null);
          if (league) leagueCache.set(leagueId, league);
        }

        // League users/rosters (for roster_id)
        let leagueUsers = leagueUsersCache.get(leagueId);
        if (!leagueUsers) {
          leagueUsers = await getLeagueUsers(leagueId);
          leagueUsersCache.set(leagueId, leagueUsers);
        }
        let leagueRosters = leagueRostersCache.get(leagueId);
        if (!leagueRosters) {
          leagueRosters = await getLeagueRosters(leagueId);
          leagueRostersCache.set(leagueId, leagueRosters);
        }

        const myRosterKey = `${leagueId}|${s.username}`;
        let myRosterId = myRosterCache.get(myRosterKey);
        if (!myRosterId) {
          myRosterId = getMyRosterIdForLeague(leagueUsers, leagueRosters, s.username);
          myRosterCache.set(myRosterKey, myRosterId);
        }

        // picks count
        let pickCount = pickCountCache.get(draftId);
        if (pickCount == null) {
          pickCount = await getPickCount(draftId).catch(() => null);
          if (pickCount == null) continue;
          pickCountCache.set(draftId, pickCount);
        }

        const nextPickNo = pickCount + 1;

        // traded picks
        let traded = tradedCache.get(draftId);
        if (!traded) {
          traded = await getTradedPicks(draftId);
          tradedCache.set(draftId, traded);
        }

        const timerSec = safeNum(draft?.settings?.pick_timer);
        const timerMs = timerSec > 0 ? timerSec * 1000 : 90 * 1000;
        const lastPickTs = safeNum(draft?.last_picked);
        const clockStartMs = lastPickTs > 0 ? lastPickTs : now;
        const clockEndsAt = clockStartMs + timerMs;
        const remainingMs = Math.max(0, clockEndsAt - now);

        // Determine if YOU own the current pick (supports traded picks)
        let onClock = false;

        // If we have roster ids, do it correctly.
        if (myRosterId) {
          const teams =
            safeNum(draft?.settings?.teams) ||
            safeNum(draft?.settings?.slots) ||
            safeNum(draft?.settings?.num_teams) ||
            safeNum(leagueRosters?.length) ||
            0;

          const rosterBySlot = buildRosterBySlot(draft, leagueRosters);
          const seasonStr = String(draft?.season || league?.season || "");
          const reversalRound = safeNum(draft?.settings?.reversal_round);
          const tradedOwnerMap = buildTradedPickOwnerMap(traded, seasonStr);

          const rosterIdAtPick = resolveRosterForPick({
            pickNo: nextPickNo,
            teams,
            rosterBySlot,
            tradedOwnerMap,
            seasonStr,
            reversalRound,
          });

          onClock = String(rosterIdAtPick || "") === String(myRosterId);
        } else {
          // fallback (no roster id): draft_order slot logic (no traded picks support)
          const teams = safeNum(draft?.settings?.teams);
          const draftOrder = draft?.draft_order || null;
          const userSlot = draftOrder?.[userId] ? safeNum(draftOrder[userId]) : 0;
          if (teams > 0 && userSlot > 0) {
            // Simple snake: round odd L->R, even R->L
            const idx = (nextPickNo - 1) % teams;
            const round = Math.floor((nextPickNo - 1) / teams) + 1;
            const currentSlot = round % 2 === 1 ? idx + 1 : teams - idx;
            onClock = currentSlot === userSlot;
          }
        }

        const state = await getClockState(db, s.endpoint, draftId);
        const prevPickNo = safeNum(state?.pick_no);
        const prevStatus = String(state?.last_status || "").toLowerCase();

        if (!onClock) {
          if (state) await deleteClockState(db, s.endpoint, draftId);
          continue;
        }

        onClockDrafts++;

        const leagueName =
          league?.name || draft?.metadata?.name || draft?.metadata?.league_name || "your league";
        const leagueAvatar = league?.avatar || draft?.metadata?.avatar || null;
        const item = {
          draftId: String(draftId),
          leagueId,
          leagueName,
          leagueAvatarUrl: leagueAvatarUrl(leagueAvatar),
          leagueUrl: sleeperDraftUrl(draftId),
          remainingMs,
          pickNo: nextPickNo,
          status: draftStatus,
          timerSec,
        };

        // New pick_no => reset flags
        const isNewPick = !state || prevPickNo !== nextPickNo;

        // Pause / unpause handling
        const isPaused = draftStatus === "paused";
        const isDrafting = draftStatus === "drafting";

        // Insert/update base state row early so we don't double-send if worker retries.
        const baseFlags = {
          sent_onclock: isNewPick ? 0 : safeNum(state?.sent_onclock),
          sent_25: isNewPick ? 0 : safeNum(state?.sent_25),
          sent_50: isNewPick ? 0 : safeNum(state?.sent_50),
          sent_10min: isNewPick ? 0 : safeNum(state?.sent_10min),
          sent_final: isNewPick ? 0 : safeNum(state?.sent_final),
          sent_paused: isNewPick ? 0 : safeNum(state?.sent_paused),
          sent_unpaused: isNewPick ? 0 : safeNum(state?.sent_unpaused),
        };

        // Always persist current status + pick_no.
        await upsertClockState(db, s.endpoint, draftId, {
          pick_no: nextPickNo,
          last_status: draftStatus,
          ...baseFlags,
          updated_at: now,
        });

        // 1) On-clock notification (one-time per pick)
        if (isNewPick || safeNum(state?.sent_onclock) === 0) {
          // If paused, treat this as a paused notice.
          if (isPaused) {
            if (safeNum(state?.sent_paused) === 0 || isNewPick) {
              addToBucket(s.endpoint, "paused", item);
              await upsertClockState(db, s.endpoint, draftId, {
                pick_no: nextPickNo,
                last_status: draftStatus,
                ...baseFlags,
                sent_paused: 1,
                sent_onclock: 1,
                updated_at: now,
              });
            }
          } else {
            addToBucket(s.endpoint, "onclock", item);
            await upsertClockState(db, s.endpoint, draftId, {
              pick_no: nextPickNo,
              last_status: draftStatus,
              ...baseFlags,
              sent_onclock: 1,
              updated_at: now,
            });
          }
          // Don't send threshold reminders in the same minute as the on-clock ping.
          continue;
        }

        // 2) Pause transition (send once)
        if (isPaused) {
          if (prevStatus !== "paused" && safeNum(state?.sent_paused) === 0) {
            addToBucket(s.endpoint, "paused", item);
            await upsertClockState(db, s.endpoint, draftId, {
              pick_no: nextPickNo,
              last_status: draftStatus,
              ...baseFlags,
              sent_paused: 1,
              updated_at: now,
            });
          }
          // No other warnings while paused.
          continue;
        }

        // 3) Unpause transition (only if still on clock)
        if (isDrafting && prevStatus === "paused" && safeNum(state?.sent_unpaused) === 0) {
          addToBucket(s.endpoint, "unpaused", item);
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: draftStatus,
            ...baseFlags,
            sent_unpaused: 1,
            updated_at: now,
          });
          // Let the unpause notice stand alone.
          continue;
        }

        // 4) Threshold reminders (drafting only)
        if (!isDrafting || timerMs <= 0) continue;

        const usedPct = 1 - remainingMs / timerMs; // 0..1

        // 25%
        if (safeNum(state?.sent_25) === 0 && usedPct >= 0.25) {
          addToBucket(s.endpoint, "pct25", item);
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: draftStatus,
            ...baseFlags,
            sent_25: 1,
            updated_at: now,
          });
        }

        // 50%
        if (safeNum(state?.sent_50) === 0 && usedPct >= 0.5) {
          addToBucket(s.endpoint, "pct50", item);
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: draftStatus,
            ...baseFlags,
            sent_50: 1,
            updated_at: now,
          });
        }

        // 10 minutes remaining (or smaller drafts: clamp to 20% of timer)
        const tenMs = Math.min(10 * 60 * 1000, Math.floor(timerMs * 0.2));
        if (safeNum(state?.sent_10min) === 0 && remainingMs > 0 && remainingMs <= tenMs) {
          addToBucket(s.endpoint, "ten", item);
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: draftStatus,
            ...baseFlags,
            sent_10min: 1,
            updated_at: now,
          });
        }

        // Final warning (last 2 minutes, or last 10% of timer)
        const finalMs = Math.min(2 * 60 * 1000, Math.floor(timerMs * 0.1));
        if (safeNum(state?.sent_final) === 0 && remainingMs > 0 && remainingMs <= finalMs) {
          addToBucket(s.endpoint, "final", item);
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: draftStatus,
            ...baseFlags,
            sent_final: 1,
            updated_at: now,
          });
        }
      }
    }

    // Send notifications (batched per endpoint per kind)
    for (const [endpoint, kindMap] of bucket.entries()) {
      // Find the matching subscription object for this endpoint.
      const s = subs.find((x) => x.endpoint === endpoint);
      if (!s?.sub) continue;

      // Stable kind order (higher urgency first)
      const kindOrder = ["onclock", "unpaused", "paused", "final", "ten", "pct50", "pct25"];
      for (const kind of kindOrder) {
        const items = kindMap.get(kind);
        if (!items || items.length === 0) continue;

        const msg = buildNotification(kind, items);

        const { endpoint: pushEndpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription: s.sub,
          message: {
            payload: msg,
            adminContact: subject,
          },
        });

        const res = await fetch(pushEndpoint, { method: "POST", headers, body });
        if (res.ok) {
          sent++;
        } else {
          // prune dead endpoints
          if (res.status === 404 || res.status === 410) {
            await db
              .prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`)
              .bind(endpoint)
              .run();
            await db
              .prepare(`DELETE FROM push_clock_state WHERE endpoint=?`)
              .bind(endpoint)
              .run();
            pruned++;
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      subs: subs.length,
      checkedDrafts,
      onClockDrafts,
      sent,
      pruned,
      skippedNoDrafts,
      skippedNoUsername,
    });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}
