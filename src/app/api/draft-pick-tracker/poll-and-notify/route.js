export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildPushHTTPRequest } from "@pushforge/builder";

export async function POST(req) { return handler(req); }
export async function GET(req) { return handler(req); }

function assertAuth(req) {
  const secret = req.headers.get("x-push-secret");
  return !!process.env.PUSH_ADMIN_SECRET && secret === process.env.PUSH_ADMIN_SECRET;
}

function getDb() {
  return process.env.PUSH_DB;
}

function getPrivateJWK() {
  const raw = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!raw || !subject) throw new Error("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.");

  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error("VAPID_PRIVATE_KEY must be a JSON JWK string (from `npx @pushforge/builder vapid`).");
  }
  return { jwk, subject };
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
  const slot = round % 2 === 1 ? (idx + 1) : (teams - idx);
  return { slot, round };
}

async function handler(req) {
  try {
    if (!assertAuth(req)) return new NextResponse("Unauthorized", { status: 401 });

    const db = getDb();
    if (!db?.prepare) {
      return new NextResponse(
        "PUSH_DB binding not found. Add a D1 binding named PUSH_DB in Cloudflare Pages.",
        { status: 500 }
      );
    }

    const { jwk, subject } = getPrivateJWK();
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

    // Small caches so we don’t refetch draft/user repeatedly in the same run
    const draftCache = new Map();
    const userIdCache = new Map();

    let sent = 0;
    let checked = 0;

    for (const s of subs) {
      if (!s.draftIds.length) continue;

      // Username is required for “on the clock”
      if (!s.username) continue;

      let userId = userIdCache.get(s.username);
      if (!userId) {
        userId = await getUserId(s.username);
        userIdCache.set(s.username, userId);
      }
      if (!userId) continue;

      for (const draftId of s.draftIds) {
        checked += 1;

        const pickCount = await getPickCount(draftId);

        // Load per-endpoint draft state
        const state = await db
          .prepare(`SELECT last_pick_count FROM push_draft_state WHERE endpoint=? AND draft_id=?`)
          .bind(s.endpoint, String(draftId))
          .first();

        const lastPickCount = Number(state?.last_pick_count ?? 0);

        // Only act when something changed (prevents spam)
        if (pickCount <= lastPickCount) continue;

        // Update state immediately to prevent dupes on partial failures
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

        // Fetch draft (contains league name + draft_order mapping) :contentReference[oaicite:1]{index=1}
        let draft = draftCache.get(draftId);
        if (!draft) {
          draft = await getDraft(draftId);
          draftCache.set(draftId, draft);
        }

        const leagueName = draft?.metadata?.name || "your league";
        const teams = Number(draft?.settings?.teams || 0);
        const draftOrder = draft?.draft_order || null;

        if (!teams || !draftOrder || !draftOrder[userId]) {
          // Can’t determine “on the clock” without these.
          continue;
        }

        const userSlot = Number(draftOrder[userId]);
        const nextPickNo = pickCount + 1;

        // Only handling snake drafts here (your drafts are snake)
        const { slot: currentSlot } = getCurrentSlotSnake(nextPickNo, teams);

        if (currentSlot !== userSlot) {
          // Not their turn — no push
          continue;
        }

        // ✅ Send “on the clock” notification
        const payload = {
          title: "You're on the clock",
          body: `You are on the clock in "${leagueName}".`,
          url: "/draft-pick-tracker",
        };

        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription: s.sub,
          message: { payload, adminContact: subject },
        });

        const pushRes = await fetch(endpoint, { method: "POST", headers, body });
        if (pushRes.ok) sent += 1;
      }
    }

    return NextResponse.json({ ok: true, sent, checked, subs: subs.length });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}
