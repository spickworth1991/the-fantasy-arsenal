export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req, context) {
  try {
    const env = context?.env || {};
    const db = env.PUSH_DB || PUSH_DB;

    const body = await req.json();
    const { username, draftIds, subscription } = body || {};

    if (!subscription?.endpoint) {
      return new NextResponse("Missing subscription endpoint.", { status: 400 });
    }

    if (!db?.prepare) {
      return new NextResponse(
        "PUSH_DB binding not found. Add a D1 binding named PUSH_DB in Cloudflare Pages (Preview env too).",
        { status: 500 }
      );
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
        JSON.stringify(Array.isArray(draftIds) ? draftIds : []),
        now,
        now
      )
      .run();

    // ✅ confirm we actually wrote to THIS bound DB
    const countRow = await db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions`).first();

    return NextResponse.json({
      ok: true,
      endpoint,
      username: username || null,
      draftCount: Array.isArray(draftIds) ? draftIds.length : 0,
      dbCount: Number(countRow?.c ?? 0),
    });
  } catch (e) {
    return new NextResponse(e?.message || "Bad request.", { status: 400 });
  }
}
