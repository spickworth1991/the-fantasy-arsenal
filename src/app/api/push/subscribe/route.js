export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

function json(resBody, init = {}) {
  const res = NextResponse.json(resBody, init);
  // Allow same-origin + local dev tooling.
  // This endpoint only stores a subscription; it does NOT send pushes.
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

async function ensurePushSubscriptionsColumns(db) {
  // Existing D1 tables can be out of sync between preview/prod.
  // Add columns we rely on (ignore errors if they already exist).
  const alters = [
    `ALTER TABLE push_subscriptions ADD COLUMN league_count INTEGER`,
    `ALTER TABLE push_subscriptions ADD COLUMN leagues_synced_at INTEGER`,
  ];
  for (const sql of alters) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.prepare(sql).run();
    } catch {
      // ignore (already exists)
    }
  }
}

async function fetchDraftIdsForUsername(username) {
  const uname = String(username || "").trim();
  if (!uname) return { draftIds: [], leagueCount: 0 };

  // Use current calendar year by default.
  const season = String(new Date().getFullYear());

  const uRes = await fetch(
    `https://api.sleeper.app/v1/user/${encodeURIComponent(uname)}`,
    { cache: "no-store" }
  );
  if (!uRes.ok) return { draftIds: [], leagueCount: 0 };
  const u = await uRes.json();
  const userId = u?.user_id;
  if (!userId) return { draftIds: [], leagueCount: 0 };

  const leaguesRes = await fetch(
    `https://api.sleeper.app/v1/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
    { cache: "no-store" }
  );
  if (!leaguesRes.ok) return { draftIds: [], leagueCount: 0 };

  const leagues = await leaguesRes.json();
  const arr = Array.isArray(leagues) ? leagues : [];
  const draftIds = arr
    .map((lg) => lg?.draft_id)
    .filter(Boolean)
    .map((x) => String(x));

  return { draftIds: Array.from(new Set(draftIds)), leagueCount: arr.length };
}

export async function OPTIONS() {
  return json({ ok: true });
}

export async function POST(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;

    const body = await req.json();
    const { username, draftIds, subscription } = body || {};

    if (!subscription?.endpoint) {
      return new NextResponse("Missing subscription endpoint.", { status: 400 });
    }

    if (!db?.prepare) {
      return new NextResponse(
        "PUSH_DB binding not found. In Cloudflare Pages: Settings → Functions → D1 bindings → add binding name PUSH_DB (Production + Preview).",
        { status: 500 }
      );
    }

    await ensurePushSubscriptionsColumns(db);

    // If the client didn't send draftIds (or it's empty), compute them server-side.
    let nextDraftIds = Array.isArray(draftIds) ? draftIds : [];
    let leagueCount = null;

    if (!nextDraftIds.length && username) {
      const fetched = await fetchDraftIdsForUsername(username);
      nextDraftIds = fetched.draftIds;
      leagueCount = fetched.leagueCount;
    }

    const endpoint = subscription.endpoint;
    const now = Date.now();

    await db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, subscription_json, username, draft_ids_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           subscription_json=excluded.subscription_json,
           username=excluded.username,
           draft_ids_json=excluded.draft_ids_json,
           updated_at=excluded.updated_at`
      )
      .bind(
        endpoint,
        JSON.stringify(subscription),
        username || null,
        JSON.stringify(Array.isArray(nextDraftIds) ? nextDraftIds : []),
        now,
        now
      )
      .run();

    // Best-effort: store league_count metadata to make future sync cheaper.
    if (leagueCount != null) {
      try {
        await db
          .prepare(
            `UPDATE push_subscriptions SET league_count=?, leagues_synced_at=? WHERE endpoint=?`
          )
          .bind(Number(leagueCount), now, endpoint)
          .run();
      } catch {
        // ignore
      }
    }

    const countRow = await db
      .prepare(`SELECT COUNT(*) AS c FROM push_subscriptions`)
      .first();

    return json({
      ok: true,
      endpoint,
      username: username || null,
      draftCount: Array.isArray(nextDraftIds) ? nextDraftIds.length : 0,
      dbCount: Number(countRow?.c ?? 0),
    });
  } catch (e) {
    return new NextResponse(e?.message || "Bad request.", { status: 400 });
  }
}
