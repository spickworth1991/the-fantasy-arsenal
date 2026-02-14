export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildPushHTTPRequest } from "@pushforge/builder";

export async function POST(req, context) {
  return handler(req, context);
}
export async function GET(req, context) {
  return handler(req, context);
}

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

function getPrivateJWK(env) {
  const raw = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!raw || !subject) throw new Error("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.");

  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error("VAPID_PRIVATE_KEY must be a JSON JWK string (from `npx @pushforge/builder vapid`).");
  }
  return { jwk, subject };
}

function toNativeHeaders(h) {
  const out = new Headers();
  if (!h) return out;

  if (typeof h.forEach === "function") {
    h.forEach((v, k) => out.set(k, v));
    return out;
  }

  for (const [k, v] of Object.entries(h)) out.set(k, String(v));
  return out;
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
  const slot = round % 2 === 1 ? idx + 1 : teams - idx;
  return { slot, round };
}

async function handler(req, context) {
  try {
    const env = context?.env || process.env;

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const { jwk, subject } = getPrivateJWK(env);
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
    const userIdCache = new Map();

    let sent = 0;
    let checked = 0;
    let changes = 0;
    let skippedNoDrafts = 0;
    let skippedNoUsername = 0;
    let skippedNoOrder = 0;
    let skippedNotOnClock = 0;

    for (const s of subs) {
      if (!s.draftIds.length) { skippedNoDrafts++; continue; }
      if (!s.username) { skippedNoUsername++; continue; }

      let userId = userIdCache.get(s.username);
      if (!userId) {
        userId = await getUserId(s.username);
        userIdCache.set(s.username, userId);
      }
      if (!userId) { skippedNoOrder++; continue; }

      for (const draftId of s.draftIds) {
        checked++;

        const pickCount = await getPickCount(draftId);

        const state = await db
          .prepare(`SELECT last_pick_count FROM push_draft_state WHERE endpoint=? AND draft_id=?`)
          .bind(s.endpoint, String(draftId))
          .first();

        const lastPickCount = Number(state?.last_pick_count ?? 0);

        if (pickCount <= lastPickCount) continue;
        changes++;

        await db
          .prepare(
            `INSERT INTO push_draft_state (endpoint, draft_id, last_pick_count, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(endpoint, draft_id) DO UPDATE SET
               last_pick_count=excluded.last_pick_count,
               updated_at=excluded.updated_at`
          )
          .bind(s.endpoint, String(draftId), pickCount, now)
          .run();

        let draft = draftCache.get(draftId);
        if (!draft) {
          draft = await getDraft(draftId);
          draftCache.set(draftId, draft);
        }

        const leagueName = draft?.metadata?.name || draft?.metadata?.league_name || "your league";
        const teams = Number(draft?.settings?.teams || 0);
        const draftOrder = draft?.draft_order || null;

        if (!teams || !draftOrder || !draftOrder[userId]) {
          skippedNoOrder++;
          continue;
        }

        const userSlot = Number(draftOrder[userId]);
        const nextPickNo = pickCount + 1;
        const { slot: currentSlot } = getCurrentSlotSnake(nextPickNo, teams);

        if (currentSlot !== userSlot) {
          skippedNotOnClock++;
          continue;
        }

        const payload = {
          title: "You're on the clock",
          body: `You are on the clock in "${leagueName}".`,
          url: "/draft-pick-tracker",
        };

        const { endpoint, headers, body: pushBody } = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription: s.sub,
          message: { payload, adminContact: subject },
        });

        const pushRes = await fetch(endpoint, {
          method: "POST",
          headers: toNativeHeaders(headers),
          body: pushBody,
        });

        if (pushRes.ok) {
          sent++;
        } else if (pushRes.status === 404 || pushRes.status === 410) {
          await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
        }
      }
    }

    return NextResponse.json({
      ok: true,
      subs: subs.length,
      checked,
      changes,
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
