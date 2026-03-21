export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

const DEFAULT_SETTINGS = {
  onClock: true,
  half: true,
  quarter: true,
  tenMin: true,
  fiveMin: true,
  urgent: true,
  final: true,
  paused: true,
  resumed: true,
  badges: true,
};

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
    const add = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_subscriptions ADD COLUMN ${name} ${type}`).run();
      }
    };
    await add("subscription_json", "TEXT");
    await add("client_id", "TEXT");
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

async function ensurePushClockStateTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_clock_state (
        endpoint TEXT,
        draft_id TEXT,
        pick_no INTEGER,
        last_status TEXT,
        sent_onclock INTEGER,
        sent_25 INTEGER,
        sent_50 INTEGER,
        sent_10min INTEGER,
        sent_5min INTEGER,
        sent_urgent INTEGER,
        sent_final INTEGER,
        sent_paused INTEGER,
        sent_unpaused INTEGER,
        last_visible_stage TEXT,
        last_visible_sent_at INTEGER,
        visible_retry_count INTEGER,
        paused_remaining_ms INTEGER,
        paused_at_ms INTEGER,
        resume_clock_start_ms INTEGER,
        updated_at INTEGER,
        PRIMARY KEY (endpoint, draft_id)
      )`
    )
    .run();
}

function uniqNonEmptyStrings(arr) {
  return Array.from(new Set((arr || []).map((v) => String(v || "").trim()).filter(Boolean)));
}

function buildMigrateClockStateStmt(db, fromEndpoint, toEndpoint) {
  return db.prepare(
    `INSERT INTO push_clock_state (
       endpoint, draft_id, pick_no, last_status,
       sent_onclock, sent_25, sent_50, sent_10min, sent_5min, sent_urgent, sent_final, sent_paused, sent_unpaused,
       last_visible_stage, last_visible_sent_at, visible_retry_count,
       paused_remaining_ms, paused_at_ms, resume_clock_start_ms, updated_at
     )
     SELECT
       ?, draft_id, pick_no, last_status,
       sent_onclock, sent_25, sent_50, sent_10min, sent_5min, sent_urgent, sent_final, sent_paused, sent_unpaused,
       last_visible_stage, last_visible_sent_at, visible_retry_count,
       paused_remaining_ms, paused_at_ms, resume_clock_start_ms, updated_at
     FROM push_clock_state
     WHERE endpoint=?
     ON CONFLICT(endpoint, draft_id) DO UPDATE SET
       pick_no=excluded.pick_no,
       last_status=excluded.last_status,
       sent_onclock=excluded.sent_onclock,
       sent_25=excluded.sent_25,
       sent_50=excluded.sent_50,
       sent_10min=excluded.sent_10min,
       sent_5min=excluded.sent_5min,
       sent_urgent=excluded.sent_urgent,
       sent_final=excluded.sent_final,
       sent_paused=excluded.sent_paused,
       sent_unpaused=excluded.sent_unpaused,
       last_visible_stage=excluded.last_visible_stage,
       last_visible_sent_at=excluded.last_visible_sent_at,
       visible_retry_count=excluded.visible_retry_count,
       paused_remaining_ms=excluded.paused_remaining_ms,
       paused_at_ms=excluded.paused_at_ms,
       resume_clock_start_ms=excluded.resume_clock_start_ms,
       updated_at=excluded.updated_at`
  ).bind(toEndpoint, fromEndpoint);
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
  const source = input && typeof input === "object" ? input : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const legacyProgress = has("progress") ? !!source.progress : null;
  const legacyPaused = has("paused") ? !!source.paused : null;

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    half: has("half") ? !!source.half : legacyProgress ?? DEFAULT_SETTINGS.half,
    quarter: has("quarter") ? !!source.quarter : legacyProgress ?? DEFAULT_SETTINGS.quarter,
    tenMin: has("tenMin") ? !!source.tenMin : legacyProgress ?? DEFAULT_SETTINGS.tenMin,
    fiveMin: has("fiveMin") ? !!source.fiveMin : legacyProgress ?? DEFAULT_SETTINGS.fiveMin,
    urgent: has("urgent") ? !!source.urgent : legacyProgress ?? DEFAULT_SETTINGS.urgent,
    final: has("final") ? !!source.final : legacyProgress ?? DEFAULT_SETTINGS.final,
    paused: has("paused") ? !!source.paused : legacyPaused ?? DEFAULT_SETTINGS.paused,
    resumed: has("resumed") ? !!source.resumed : legacyPaused ?? DEFAULT_SETTINGS.resumed,
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
  const clientId = String(body?.clientId || "").trim();
  const previousEndpoint = String(body?.previousEndpoint || "").trim();

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
              client_id, last_badge_count, last_badge_synced_at, created_at
       FROM push_subscriptions
       WHERE endpoint=?`
    )
    .bind(endpoint)
    .first();
  const priorClientRow =
    clientId
      ? await db
          .prepare(
            `SELECT endpoint, subscription_json, draft_ids_json, username, league_count, settings_json,
                    client_id, last_badge_count, last_badge_synced_at, created_at
             FROM push_subscriptions
             WHERE client_id=? AND endpoint<>?
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1`
          )
          .bind(clientId, endpoint)
          .first()
      : null;
  const priorClientRows =
    clientId
      ? await db
          .prepare(
            `SELECT endpoint
             FROM push_subscriptions
             WHERE client_id=? AND endpoint<>?
             ORDER BY updated_at DESC, created_at DESC`
          )
          .bind(clientId, endpoint)
          .all()
      : null;
  const nextUsername = usernameIn || normalizeUsername(existingRow?.username || "") || null;

  const sameEndpointRow =
    !!existingRow?.endpoint &&
    stableJson(existingRow?.subscription_json, null) === stableJson(subscriptionJson, null) &&
    JSON.stringify(stableDraftIds(parseJsonArray(existingRow?.draft_ids_json))) === draftIdsJson &&
    normalizeUsername(existingRow?.username || "") === normalizeUsername(nextUsername || "") &&
    String(existingRow?.client_id || "") === clientId &&
    Number(existingRow?.league_count || 0) === draftIds.length &&
    stableJson(existingRow?.settings_json, null) === stableJson(settingsJson, null);
  if (!sameEndpointRow) {
    await db
      .prepare(
        `INSERT INTO push_subscriptions (
          endpoint,
          client_id,
          subscription_json,
          draft_ids_json,
          username,
          league_count,
          settings_json,
          last_badge_count,
          last_badge_synced_at,
          updated_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          client_id=excluded.client_id,
          subscription_json=excluded.subscription_json,
          draft_ids_json=excluded.draft_ids_json,
          league_count=excluded.league_count,
          settings_json=excluded.settings_json,
          updated_at=excluded.updated_at,
          username=excluded.username`
      )
      .bind(
        endpoint,
        clientId || null,
        subscriptionJson,
        draftIdsJson,
        nextUsername,
        draftIds.length,
        settingsJson,
        Number(existingRow?.last_badge_count || priorClientRow?.last_badge_count || 0) || 0,
        existingRow?.last_badge_synced_at ?? priorClientRow?.last_badge_synced_at ?? null,
        now,
        Number(existingRow?.created_at || priorClientRow?.created_at || 0) || now
      )
      .run();
  }

  const endpointsToReplace = uniqNonEmptyStrings([
    previousEndpoint && previousEndpoint !== endpoint ? previousEndpoint : "",
    priorClientRow?.endpoint && priorClientRow.endpoint !== endpoint ? priorClientRow.endpoint : "",
    ...((priorClientRows?.results || []).map((row) =>
      row?.endpoint && row.endpoint !== endpoint ? String(row.endpoint) : ""
    )),
  ]);

  const cleanupStatements = [];
  if (endpointsToReplace.length) {
    await ensurePushClockStateTable(db);
    for (const oldEndpoint of endpointsToReplace) {
      cleanupStatements.push(buildMigrateClockStateStmt(db, oldEndpoint, endpoint));
      cleanupStatements.push(
        db.prepare(`DELETE FROM push_clock_state WHERE endpoint=?`).bind(oldEndpoint)
      );
      cleanupStatements.push(
        db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(oldEndpoint)
      );
    }
  } else if (clientId) {
    cleanupStatements.push(
      db.prepare(`DELETE FROM push_subscriptions WHERE client_id=? AND endpoint<>?`).bind(clientId, endpoint)
    );
  }
  if (cleanupStatements.length) {
    await db.batch(cleanupStatements);
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
