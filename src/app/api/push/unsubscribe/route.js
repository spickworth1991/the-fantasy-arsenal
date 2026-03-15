export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

async function ensureTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        client_id TEXT,
        subscription_json TEXT,
        draft_ids_json TEXT,
        username TEXT,
        league_count INTEGER,
        settings_json TEXT,
        last_badge_count INTEGER,
        last_badge_synced_at INTEGER,
        updated_at INTEGER,
        created_at INTEGER
      )`
    )
    .run();

  try {
    const info = await db.prepare(`PRAGMA table_info(push_subscriptions)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
    if (!existing.has("client_id")) {
      await db.prepare(`ALTER TABLE push_subscriptions ADD COLUMN client_id TEXT`).run();
    }
  } catch {
    // ignore
  }
}

export async function POST(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });
    await ensureTable(db);

    const { endpoint, clientId } = await req.json().catch(() => ({}));
    const nextEndpoint = String(endpoint || "").trim();
    const nextClientId = String(clientId || "").trim();
    if (!nextEndpoint && !nextClientId) {
      return new NextResponse("Missing endpoint or clientId.", { status: 400 });
    }

    const statements = [];
    if (nextEndpoint) {
      statements.push(db.prepare(`DELETE FROM push_clock_state WHERE endpoint=?`).bind(nextEndpoint));
      statements.push(db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(nextEndpoint));
    }
    if (nextClientId) {
      statements.push(
        db.prepare(`DELETE FROM push_clock_state WHERE endpoint IN (
            SELECT endpoint FROM push_subscriptions WHERE client_id=?
          )`).bind(nextClientId)
      );
      statements.push(
        db.prepare(`DELETE FROM push_subscriptions WHERE client_id=?`).bind(nextClientId)
      );
    }

    await db.batch(statements);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e?.message || "Unsubscribe failed.", { status: 500 });
  }
}
