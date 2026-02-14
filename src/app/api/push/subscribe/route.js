import { NextResponse } from "next/server";

function getDb() {
  // Cloudflare Pages D1 binding (set in Pages → Settings → Bindings)
  return process.env.PUSH_DB;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { username, draftIds, subscription } = body || {};

    if (!subscription?.endpoint) {
      return new NextResponse("Missing subscription endpoint.", { status: 400 });
    }

    const endpoint = subscription.endpoint;
    const now = Date.now();

    const db = getDb();
    if (!db?.prepare) {
      return new NextResponse(
        "PUSH_DB binding not found. Add a D1 binding named PUSH_DB in Cloudflare Pages.",
        { status: 500 }
      );
    }

    await db
      .prepare(
        `
        INSERT INTO push_subscriptions (endpoint, subscription_json, username, draft_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          subscription_json=excluded.subscription_json,
          username=excluded.username,
          draft_ids_json=excluded.draft_ids_json,
          updated_at=excluded.updated_at
      `
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

    return NextResponse.json({ ok: true });
  } catch {
    return new NextResponse("Bad request.", { status: 400 });
  }
}
