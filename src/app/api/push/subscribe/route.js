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
    await add("subscription_json", "TEXT");
    await add("draft_ids_json", "TEXT");
    await add("username", "TEXT");
    await add("league_count", "INTEGER");
    await add("settings_json", "TEXT");
    await add("last_badge_count", "INTEGER");
    await add("last_badge_synced_at", "INTEGER");
    await add("updated_at", "INTEGER");
    await add("created_at", "INTEGER");
  } catch {
    // ignore
  }
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const s = v == null ? "" : String(v);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSettings(input) {
  return {
    ...DEFAULT_SETTINGS,
    ...(input && typeof input === "object" ? input : {}),
  };
}

export async function POST(req) {
  const { env } = getRequestContext();
  const db = env?.PUSH_DB;
  if (!db?.prepare) {
    return NextResponse.json({ ok: false, error: "PUSH_DB binding not found" }, { status: 500 });
  }

  await ensureTable(db);

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sub = body?.subscription || null;
  const endpoint = String(sub?.endpoint || "");
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: "Missing subscription endpoint" }, { status: 400 });
  }

  const now = Date.now();
  const usernameIn = body?.username != null ? normalizeUsername(body.username) : "";
  const draftIdsIn = Array.isArray(body?.draftIds) ? body.draftIds : [];
  const draftIds = uniqStrings(draftIdsIn).map(String);
  const settings = normalizeSettings(body?.settings);

  const subscriptionJson = JSON.stringify(sub || {});
  const draftIdsJson = JSON.stringify(draftIds);
  const settingsJson = JSON.stringify(settings);

  await db
    .prepare(
      `INSERT INTO push_subscriptions (
        endpoint, subscription_json, draft_ids_json, username, league_count, settings_json,
        last_badge_count, last_badge_synced_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        subscription_json=excluded.subscription_json,
        draft_ids_json=excluded.draft_ids_json,
        league_count=excluded.league_count,
        settings_json=excluded.settings_json,
        updated_at=excluded.updated_at,
        username=CASE
          WHEN (push_subscriptions.username IS NULL OR push_subscriptions.username='')
          THEN excluded.username
          ELSE push_subscriptions.username
        END`
    )
    .bind(
      endpoint,
      subscriptionJson,
      draftIdsJson,
      usernameIn || null,
      draftIds.length,
      settingsJson,
      0,
      null,
      now,
      now
    )
    .run();

  if (usernameIn) {
    await db
      .prepare(
        `UPDATE push_subscriptions
         SET draft_ids_json=?, league_count=?, updated_at=?
         WHERE username=? AND endpoint<>?`
      )
      .bind(draftIdsJson, draftIds.length, now, usernameIn, endpoint)
      .run();
  }

  return NextResponse.json({ ok: true, endpoint, draftCount: draftIds.length, settings });
}

export async function PUT(req) {
  const { env } = getRequestContext();
  const db = env?.PUSH_DB;
  if (!db?.prepare) {
    return NextResponse.json({ ok: false, error: "PUSH_DB binding not found" }, { status: 500 });
  }

  await ensureTable(db);

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const endpoint = String(body?.endpoint || "");
  const username = normalizeUsername(body?.username || "");
  if (!endpoint || !username) {
    return NextResponse.json({ ok: false, error: "Missing endpoint or username" }, { status: 400 });
  }

  const now = Date.now();
  await db
    .prepare(`UPDATE push_subscriptions SET username=?, updated_at=? WHERE endpoint=?`)
    .bind(username, now, endpoint)
    .run();

  return NextResponse.json({ ok: true });
}
