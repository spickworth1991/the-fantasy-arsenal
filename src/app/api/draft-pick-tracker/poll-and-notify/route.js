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
      .prepare(`SELECT endpoint, subscription_json, draft_ids_json FROM push_subscriptions`)
      .all();

    const subs = (subRows?.results || [])
      .map((r) => {
        let sub = null;
        let draftIds = [];
        try { sub = JSON.parse(r.subscription_json); } catch {}
        try { draftIds = JSON.parse(r.draft_ids_json || "[]"); } catch {}
        return { endpoint: r.endpoint, sub, draftIds: Array.isArray(draftIds) ? draftIds : [] };
      })
      .filter((x) => x?.sub?.endpoint && x.endpoint);

    let sent = 0;
    let checked = 0;

    for (const s of subs) {
      for (const draftId of s.draftIds) {
        checked += 1;

        const pickCount = await getPickCount(draftId);

        const state = await db
          .prepare(`SELECT last_pick_count FROM push_draft_state WHERE endpoint=? AND draft_id=?`)
          .bind(s.endpoint, String(draftId))
          .first();

        const lastPickCount = Number(state?.last_pick_count ?? 0);

        if (pickCount > lastPickCount) {
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

          const payload = {
            title: "Draft Pick Tracker",
            body: `New pick made (total picks: ${pickCount}). Tap to open.`,
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
    }

    return NextResponse.json({ ok: true, sent, checked, subs: subs.length });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}
