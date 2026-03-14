export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

const DEFAULT_SETTINGS = {
  onClock: true,
  progress: true,
  paused: true,
  badges: true,
};

async function ensureTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
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

    const add = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_subscriptions ADD COLUMN ${name} ${type}`).run();
      }
    };

    await add("settings_json", "TEXT");
    await add("last_badge_count", "INTEGER");
    await add("last_badge_synced_at", "INTEGER");
  } catch {
    // ignore
  }
}

function normalizeSettings(input) {
  return {
    ...DEFAULT_SETTINGS,
    ...(input && typeof input === "object" ? input : {}),
  };
}

function stableJson(value, fallback = null) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return fallback;
  }
}

export async function GET(req) {
  const { env } = getRequestContext();
  const db = env?.PUSH_DB;

  if (!db?.prepare) {
    return NextResponse.json(
      { ok: false, error: "PUSH_DB binding not found" },
      { status: 500 }
    );
  }

  await ensureTable(db);

  const { searchParams } = new URL(req.url);
  const endpoint = String(searchParams.get("endpoint") || "").trim();

  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: "Missing endpoint" },
      { status: 400 }
    );
  }

  const row = await db
    .prepare(`SELECT endpoint, settings_json FROM push_subscriptions WHERE endpoint=?`)
    .bind(endpoint)
    .first();

  if (!row?.endpoint) {
    return NextResponse.json(
      { ok: false, error: "Subscription endpoint not found", settings: DEFAULT_SETTINGS },
      { status: 404 }
    );
  }

  let settings = DEFAULT_SETTINGS;
  try {
    settings = normalizeSettings(JSON.parse(row?.settings_json || "{}"));
  } catch {
    settings = DEFAULT_SETTINGS;
  }

  return NextResponse.json({ ok: true, settings });
}

export async function POST(req) {
  const { env } = getRequestContext();
  const db = env?.PUSH_DB;

  if (!db?.prepare) {
    return NextResponse.json(
      { ok: false, error: "PUSH_DB binding not found" },
      { status: 500 }
    );
  }

  await ensureTable(db);

  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.endpoint || "").trim();

  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: "Missing endpoint" },
      { status: 400 }
    );
  }

  const existing = await db
    .prepare(`SELECT endpoint, settings_json FROM push_subscriptions WHERE endpoint=?`)
    .bind(endpoint)
    .first();

  if (!existing?.endpoint) {
    return NextResponse.json(
      { ok: false, error: "Subscription endpoint not found" },
      { status: 404 }
    );
  }

  const settings = normalizeSettings(body?.settings);
  const settingsJson = JSON.stringify(settings);
  const existingSettingsJson = stableJson(existing?.settings_json, null);
  if (existingSettingsJson === stableJson(settingsJson, null)) {
    return NextResponse.json({ ok: true, settings });
  }

  const now = Date.now();

  await db
    .prepare(
      `UPDATE push_subscriptions
       SET settings_json=?, updated_at=?
       WHERE endpoint=?`
    )
    .bind(settingsJson, now, endpoint)
    .run();

  return NextResponse.json({ ok: true, settings });
}
