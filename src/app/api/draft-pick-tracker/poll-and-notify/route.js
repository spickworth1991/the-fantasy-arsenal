export const runtime = "edge";

import { NextResponse } from "next/server";
import { NextResponse } from "next/server";
import { buildPushPayload } from "@block65/webcrypto-web-push";

// Allow cron-job.org to call either GET or POST
export async function POST(req) {
  return handler(req);
}
export async function GET(req) {
  return handler(req);
}

function getDb() {
  // Cloudflare Pages (next-on-pages) D1 binding should be exposed here.
  // If you bound it as PUSH_DB, this should work.
  return process.env.PUSH_DB;
}

function assertAuth(req) {
  const secret = req.headers.get("x-push-secret");
  return !!process.env.PUSH_ADMIN_SECRET && secret === process.env.PUSH_ADMIN_SECRET;
}

function getVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID env vars. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.");
  }

  return { subject, publicKey, privateKey };
}

async function getPickCount(draftId) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`, {
    // a little safety for edge runtimes
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sleeper picks fetch failed for draft ${draftId}: ${res.status}`);
  const picks = await res.json();
  return Array.isArray(picks) ? picks.length : 0;
}

async function handler(req) {
  try {
    if (!assertAuth(req)) return new NextResponse("Unauthorized", { status: 401 });

    const db = getDb();
    if (!db?.prepare) {
      return new NextResponse(
        "PUSH_DB binding not found. In Cloudflare Pages → Settings → Bindings, add a D1 binding named PUSH_DB.",
        { status: 500 }
      );
    }

    const vapid = getVapid();
    const now = Date.now();

    // Load subscriptions
    const subRows = await db
      .prepare(`SELECT endpoint, subscription_json, draft_ids_json FROM push_subscriptions`)
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
          draftIds: Array.isArray(draftIds) ? draftIds : [],
        };
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
          // Update state first so retries don’t double-send
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

          const msg = {
            data: JSON.stringify({
              title: "Draft Pick Tracker",
              body: `New pick made (total picks: ${pickCount}). Tap to open.`,
              url: "/draft-pick-tracker",
            }),
            options: { ttl: 60 },
          };

          const payload = await buildPushPayload(msg, s.sub, vapid);
          const pushRes = await fetch(s.sub.endpoint, payload);

          if (pushRes.ok) sent += 1;
          // If endpoint is dead/expired, you *can* optionally delete it here later.
        }
      }
    }

    return NextResponse.json({ ok: true, sent, checked, subs: subs.length });
  } catch (e) {
    return new NextResponse(e?.message || "Poll failed", { status: 500 });
  }
}
