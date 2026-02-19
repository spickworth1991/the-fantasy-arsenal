export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

export async function POST(req) { return handler(req); }
export async function GET(req) { return handler(req); }

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env?.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

async function getPickCount(draftId) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`, { cache: "no-store" });
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
  const res = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper user fetch failed for ${username}: ${res.status}`);
  const u = await res.json();
  return u?.user_id || null;
}

// Snake: round odd L->R, round even R->L
function getCurrentSlotSnake(pickNo, teams) {
  const idx = (pickNo - 1) % teams;
  const round = Math.floor((pickNo - 1) / teams) + 1;
  const slot = round % 2 === 1 ? (idx + 1) : (teams - idx);
  return { slot, round };
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

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
  // Best effort:
  // - league.avatar is common on league object
  // - draft.metadata.avatar sometimes exists
  const leagueAvatar = league?.avatar || null;
  const draftAvatar = draft?.metadata?.avatar || null;
  const avatarId = leagueAvatar || draftAvatar;

  // Sleeper league avatars:
  // https://sleepercdn.com/avatars/thumbs/<avatarId>
  // (If avatarId isn't valid, SW will still fall back to icon.)
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

  const P25_TITLES = [
    "Clock check: 25% used",
    "Quick reminder ⏳",
    "Don’t forget your pick",
  ];
  const P25_BODIES = [
    `You've used ~25% of your clock in "${leagueName}". Don’t forget to pick. (${timeLeftText} left)`,
    `"${leagueName}": 25% of your timer is gone. Make your pick when ready. (${timeLeftText} left)`,
    `Friendly nudge — "${leagueName}" clock is moving. (${timeLeftText} left)`,
  ];

  const P50_TITLES = [
    "Half your clock is gone",
    "You good? 😅",
    "Still on the clock",
  ];
  const P50_BODIES = [
    `You've used ~50% of your clock in "${leagueName}". Did you forget? (${timeLeftText} left)`,
    `"${leagueName}": halfway through your timer. Don’t get auto-picked. (${timeLeftText} left)`,
    `Just checking — still your pick in "${leagueName}". (${timeLeftText} left)`,
  ];

  const TEN_TITLES = [
    "⚠️ 10 minutes left",
    "Seriously… 10 minutes left",
    "Final stretch",
  ];
  const TEN_BODIES = [
    `Seriously — you only have 10 minutes left in "${leagueName}". Make your pick.`,
    `"${leagueName}": 10 minutes remaining. Lock it in.`,
    `10 minutes left on the clock in "${leagueName}". Don’t get burned.`,
  ];

  const FINAL_TITLES = [
    "⚠️ Almost out of time",
    "Last call",
    "Clock is dying",
  ];
  const FINAL_BODIES = [
    `"${leagueName}": you're almost out of time. (${timeLeftText} left)`,
    `Last call — "${leagueName}" pick timer is almost done. (${timeLeftText} left)`,
    `Clock’s about to expire in "${leagueName}". (${timeLeftText} left)`,
  ];

  const PAUSED_TITLES = [
    "Draft paused (you're still up)",
    "Paused — but you're on the clock",
  ];
  const PAUSED_BODIES = [
    `"${leagueName}" is paused. You're on the clock when it resumes.`,
    `Draft paused in "${leagueName}". You're up when it unpauses.`,
  ];

  const UNPAUSED_TITLES = [
    "Draft resumed — you're up",
    "Unpaused: you're still on the clock",
  ];
  const UNPAUSED_BODIES = [
    `"${leagueName}" resumed and you’re on the clock. (${timeLeftText} left)`,
    `Unpaused in "${leagueName}" — your pick is still up. (${timeLeftText} left)`,
  ];

  if (stage === "onclock") {
    return {
      title: pickVariant(ONCLOCK_TITLES, baseSeed),
      body: pickVariant(ONCLOCK_BODIES, baseSeed),
    };
  }
  if (stage === "p25") {
    return {
      title: pickVariant(P25_TITLES, baseSeed),
      body: pickVariant(P25_BODIES, baseSeed),
    };
  }
  if (stage === "p50") {
    return {
      title: pickVariant(P50_TITLES, baseSeed),
      body: pickVariant(P50_BODIES, baseSeed),
    };
  }
  if (stage === "ten") {
    return {
      title: pickVariant(TEN_TITLES, baseSeed),
      body: pickVariant(TEN_BODIES, baseSeed),
    };
  }
  if (stage === "final") {
    return {
      title: pickVariant(FINAL_TITLES, baseSeed),
      body: pickVariant(FINAL_BODIES, baseSeed),
    };
  }
  if (stage === "paused") {
    return {
      title: pickVariant(PAUSED_TITLES, baseSeed),
      body: pickVariant(PAUSED_BODIES, baseSeed),
    };
  }
  if (stage === "unpaused") {
    return {
      title: pickVariant(UNPAUSED_TITLES, baseSeed),
      body: pickVariant(UNPAUSED_BODIES, baseSeed),
    };
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

async function handler(req) {
  try {
    const { env } = getRequestContext();

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

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
      .prepare(`SELECT endpoint, subscription_json, draft_ids_json, username FROM push_subscriptions`)
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

    // helper: send one push payload to a single subscription row
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
      if (!s.draftIds.length) { skippedNoDrafts++; continue; }
      if (!s.username) { skippedNoUsername++; continue; }

      let userId = userIdCache.get(s.username);
      if (!userId) {
        userId = await getUserId(s.username);
        userIdCache.set(s.username, userId);
      }
      if (!userId) { skippedNoOrder++; continue; }

      // If multiple leagues trigger an on-clock event in the same poll,
      // we prefer a single stacked “summary” notification.
      /** @type {Array<{leagueName:string,remainingMs:number,icon?:string,leagueUrl?:string,draftUrl?:string,leagueId?:string,draftId?:string,pickNo?:number}>} */
      const onClockBatch = [];

      for (const draftId of s.draftIds) {
        checked++;

        // Always fetch draft + pick count because we need status + timer + last_picked
        const [pickCount, draft] = await Promise.all([
          getPickCount(draftId),
          (async () => {
            const cached = draftCache.get(draftId);
            if (cached) return cached;
            const d = await getDraft(draftId);
            draftCache.set(draftId, d);
            return d;
          })(),
        ]);

        const leagueId = draft?.league_id || draft?.metadata?.league_id || null;
        let league = null;
        if (leagueId) {
          const cachedL = leagueCache.get(String(leagueId));
          if (cachedL) league = cachedL;
          else {
            league = await getLeague(leagueId);
            leagueCache.set(String(leagueId), league);
          }
        }

        const leagueName =
          draft?.metadata?.name ||
          draft?.metadata?.league_name ||
          league?.name ||
          "your league";

        const status = String(draft?.status || "").toLowerCase(); // drafting | paused | complete...
        const teams = Number(draft?.settings?.teams || 0);
        const timerSec = Number(draft?.settings?.pick_timer || 0);

        const draftOrder = draft?.draft_order || null;
        if (!teams || !draftOrder || !draftOrder[userId]) {
          skippedNoOrder++;
          continue;
        }

        const userSlot = Number(draftOrder[userId]);
        const nextPickNo = pickCount + 1;
        const { slot: currentSlot } = getCurrentSlotSnake(nextPickNo, teams);
        const isOnClock = currentSlot === userSlot;

        // If you're not on the clock, clear any previous stage flags
        if (!isOnClock) {
          await clearClockState(db, s.endpoint, draftId);
          skippedNotOnClock++;
          continue;
        }

        // Determine clock timing
        const lastPickedMs = Number(draft?.last_picked || 0);
        const clockStart = lastPickedMs > 0 ? lastPickedMs : now;
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;
        const remainingMs = totalMs > 0 ? Math.max(0, clockStart + totalMs - now) : 0;
        const timeLeftText = totalMs > 0 ? msToClock(remainingMs) : "—";

        // Load state
        const st = await loadClockState(db, s.endpoint, draftId);
        const prevPickNo = Number(st?.pick_no ?? 0);
        const prevStatus = String(st?.last_status || "");

        // If pick changed (new on-clock pick), reset flags
        const isNewPick = prevPickNo !== nextPickNo;

        // Build “should send” stages in priority order (one per poll per draft)
        // Paused behavior: send paused once, then nothing else while paused.
        // Unpaused behavior: if it was paused and now drafting, send unpaused once.
        let stageToSend = null;

        const sentPaused = Number(st?.sent_paused ?? 0) === 1;
        const sentUnpaused = Number(st?.sent_unpaused ?? 0) === 1;

        const sentOnclock = Number(st?.sent_onclock ?? 0) === 1;
        const sent25 = Number(st?.sent_25 ?? 0) === 1;
        const sent50 = Number(st?.sent_50 ?? 0) === 1;
        const sent10 = Number(st?.sent_10min ?? 0) === 1;
        const sentFinal = Number(st?.sent_final ?? 0) === 1;

        if (status === "paused") {
          // If paused, only send the paused notice once per pick
          if (isNewPick || !sentPaused) stageToSend = "paused";
        } else {
          // draft is not paused
          if (prevStatus === "paused" && !sentUnpaused) {
            stageToSend = "unpaused";
          } else if (isNewPick || !sentOnclock) {
            stageToSend = "onclock";
          } else if (totalMs > 0) {
            const usedFrac = 1 - (remainingMs / totalMs);
            // 10 minutes left stage (only if timer supports it)
            if (timerSec >= 600) {
              if (remainingMs <= 600_000 && !sent10) stageToSend = "ten";
              else if (usedFrac >= 0.50 && !sent50) stageToSend = "p50";
              else if (usedFrac >= 0.25 && !sent25) stageToSend = "p25";
            } else {
              // short timers: use % stages + a final “almost out of time”
              const finalThresholdMs = clamp(Math.floor(totalMs * 0.20), 20_000, 120_000); // 20% or 20s..120s
              if (remainingMs <= finalThresholdMs && !sentFinal) stageToSend = "final";
              else if (usedFrac >= 0.50 && !sent50) stageToSend = "p50";
              else if (usedFrac >= 0.25 && !sent25) stageToSend = "p25";
            }
          }
        }

        // If nothing to send, just keep state fresh
        if (!stageToSend) {
          await upsertClockState(db, s.endpoint, draftId, {
            pick_no: nextPickNo,
            last_status: status,
            sent_onclock: isNewPick ? 0 : (sentOnclock ? 1 : 0),
            sent_25: isNewPick ? 0 : (sent25 ? 1 : 0),
            sent_50: isNewPick ? 0 : (sent50 ? 1 : 0),
            sent_10min: isNewPick ? 0 : (sent10 ? 1 : 0),
            sent_final: isNewPick ? 0 : (sentFinal ? 1 : 0),
            sent_paused: isNewPick ? 0 : (sentPaused ? 1 : 0),
            sent_unpaused: isNewPick ? 0 : (sentUnpaused ? 1 : 0),
          });
          continue;
        }

        // Mark flags (we want stacking, so each stage should have its own tag)
        const nextFlags = {
          pick_no: nextPickNo,
          last_status: status,
          sent_onclock: (isNewPick ? 0 : (sentOnclock ? 1 : 0)),
          sent_25: (isNewPick ? 0 : (sent25 ? 1 : 0)),
          sent_50: (isNewPick ? 0 : (sent50 ? 1 : 0)),
          sent_10min: (isNewPick ? 0 : (sent10 ? 1 : 0)),
          sent_final: (isNewPick ? 0 : (sentFinal ? 1 : 0)),
          sent_paused: (isNewPick ? 0 : (sentPaused ? 1 : 0)),
          sent_unpaused: (isNewPick ? 0 : (sentUnpaused ? 1 : 0)),
        };

        if (stageToSend === "onclock") nextFlags.sent_onclock = 1;
        if (stageToSend === "p25") nextFlags.sent_25 = 1;
        if (stageToSend === "p50") nextFlags.sent_50 = 1;
        if (stageToSend === "ten") nextFlags.sent_10min = 1;
        if (stageToSend === "final") nextFlags.sent_final = 1;
        if (stageToSend === "paused") nextFlags.sent_paused = 1;
        if (stageToSend === "unpaused") nextFlags.sent_unpaused = 1;

        await upsertClockState(db, s.endpoint, draftId, nextFlags);

        // Build premium push payload
        const leagueUrl = sleeperLeagueUrl(leagueId) || sleeperDraftUrl(draftId);
        const draftUrl = sleeperDraftUrl(draftId);
        const icon = bestLeagueAvatarUrl({ league, draft });

        const { title, body } = buildMessage({
          stage: stageToSend,
          leagueName,
          timeLeftText,
          timerSec,
        });

        // TAGGING:
        // - Per draft + pick so updates replace (renotify) instead of spamming a pile of stages.
        // - Different leagues remain separate because draftId differs.
        const tag = `clock:${draftId}:pick:${nextPickNo}`;

        // If it's an initial on-clock notification, batch it so multiple leagues stack nicely.
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

        const pushRes = await sendPayload(s, {
          title,
          body,
          url: "/draft-pick-tracker",

          // premium options consumed by sw.js
          tag,
          renotify: true,
          icon, // league avatar if available
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
        } else {
          // prune dead endpoints
          if (pushRes.status === 404 || pushRes.status === 410) {
            await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
            await clearClockState(db, s.endpoint, draftId);
          }
        }
      }

      // Flush batched on-clock notifications for this endpoint.
      if (onClockBatch.length === 1) {
        const b = onClockBatch[0];
        const timeLeftText2 = msToClock(b.remainingMs);
        const { title, body } = buildMessage({
          stage: "onclock",
          leagueName: b.leagueName,
          timeLeftText: timeLeftText2,
        });

        const pushRes = await sendPayload(s, {
          title,
          body,
          url: "/draft-pick-tracker",
          tag: `clock:${b.draftId}:pick:${b.pickNo}`,
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
