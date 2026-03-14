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
    const s = v == null ? "" : String(v).trim();
    if (!s) continue;
    const key = s;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function stableDraftIds(arr) {
  return uniqStrings(arr).map(String).sort();
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stableJson(value, fallback = null) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return fallback;
  }
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
  const endpoint = String(sub?.endpoint || "").trim();
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: "Missing subscription endpoint" }, { status: 400 });
  }

  const now = Date.now();
  const usernameIn = body?.username != null ? normalizeUsername(body.username) : "";
  const draftIdsIn = Array.isArray(body?.draftIds) ? body.draftIds : [];
  const draftIds = stableDraftIds(draftIdsIn);

  let settings = normalizeSettings(body?.settings);

  // If this looks like a new endpoint for the same user/device family,
  // carry forward their most recent saved settings so iOS endpoint rotation
  // does not feel like a fresh setup.
  if (usernameIn) {
    const prior = await db
      .prepare(
        `SELECT endpoint, settings_json
         FROM push_subscriptions
         WHERE LOWER(username)=?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`
      )
      .bind(usernameIn)
      .first();

    if (prior?.settings_json) {
      try {
        const priorSettings = normalizeSettings(JSON.parse(prior.settings_json || "{}"));
        settings = normalizeSettings({
          ...priorSettings,
          ...(body?.settings && typeof body.settings === "object" ? body.settings : {}),
        });
      } catch {
        // ignore
      }
    }
  }

  const subscriptionJson = JSON.stringify(sub || {});
  const draftIdsJson = JSON.stringify(draftIds);
  const settingsJson = JSON.stringify(settings);

  const existingRow = await db
    .prepare(
      `SELECT endpoint, subscription_json, draft_ids_json, username, league_count, settings_json,
              last_badge_count, last_badge_synced_at, created_at
       FROM push_subscriptions
       WHERE endpoint=?`
    )
    .bind(endpoint)
    .first();
  const nextUsername = usernameIn || normalizeUsername(existingRow?.username || "") || null;

  const sameEndpointRow =
    !!existingRow?.endpoint &&
    stableJson(existingRow?.subscription_json, null) === stableJson(subscriptionJson, null) &&
    JSON.stringify(stableDraftIds(parseJsonArray(existingRow?.draft_ids_json))) === draftIdsJson &&
    normalizeUsername(existingRow?.username || "") === normalizeUsername(nextUsername || "") &&
    Number(existingRow?.league_count || 0) === draftIds.length &&
    stableJson(existingRow?.settings_json, null) === stableJson(settingsJson, null);
  if (!sameEndpointRow) {
    await db
      .prepare(
        `INSERT INTO push_subscriptions (
          endpoint,
          subscription_json,
          draft_ids_json,
          username,
          league_count,
          settings_json,
          last_badge_count,
          last_badge_synced_at,
          updated_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          subscription_json=excluded.subscription_json,
          draft_ids_json=excluded.draft_ids_json,
          league_count=excluded.league_count,
          settings_json=excluded.settings_json,
          updated_at=excluded.updated_at,
          username=excluded.username`
      )
      .bind(
        endpoint,
        subscriptionJson,
        draftIdsJson,
        nextUsername,
        draftIds.length,
        settingsJson,
        Number(existingRow?.last_badge_count || 0) || 0,
        existingRow?.last_badge_synced_at ?? null,
        now,
        Number(existingRow?.created_at || 0) || now
      )
      .run();
  }

  if (usernameIn) {
    const siblingRows = await db
      .prepare(
        `SELECT endpoint, draft_ids_json
         FROM push_subscriptions
         WHERE LOWER(username)=? AND endpoint<>?`
      )
      .bind(usernameIn, endpoint)
      .all();

    const siblingNeedsSync = (siblingRows?.results || []).some((row) => {
      const existingDraftIdsJson = JSON.stringify(stableDraftIds(parseJsonArray(row?.draft_ids_json)));
      return existingDraftIdsJson !== draftIdsJson;
    });

    if (siblingNeedsSync) {
      await db
        .prepare(
          `UPDATE push_subscriptions
           SET draft_ids_json=?, league_count=?, updated_at=?
           WHERE LOWER(username)=? AND endpoint<>?`
        )
        .bind(draftIdsJson, draftIds.length, now, usernameIn, endpoint)
        .run();
    }
  }

  return NextResponse.json({
    ok: true,
    endpoint,
    draftCount: draftIds.length,
    settings,
  });
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

  const endpoint = String(body?.endpoint || "").trim();
  const username = normalizeUsername(body?.username || "");
  if (!endpoint || !username) {
    return NextResponse.json({ ok: false, error: "Missing endpoint or username" }, { status: 400 });
  }

  const existing = await db
    .prepare(`SELECT username FROM push_subscriptions WHERE endpoint=?`)
    .bind(endpoint)
    .first();

  if (!existing?.username || normalizeUsername(existing.username) !== username) {
    const now = Date.now();
    await db
      .prepare(`UPDATE push_subscriptions SET username=?, updated_at=? WHERE endpoint=?`)
      .bind(username, now, endpoint)
      .run();
  }

  return NextResponse.json({ ok: true });
}
