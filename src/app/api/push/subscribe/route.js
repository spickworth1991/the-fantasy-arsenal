export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../lib/webpush";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env?.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

async function ensureTable(db, table, createSql, columnsToEnsure = []) {
  await db.prepare(createSql).run();

  if (!columnsToEnsure.length) return;

  let info;
  try {
    info = await db.prepare(`PRAGMA table_info(${table})`).all();
  } catch {
    return;
  }
  const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
  for (const col of columnsToEnsure) {
    const name = String(col?.name || "").trim();
    const type = String(col?.type || "TEXT").trim();
    if (!name || existing.has(name)) continue;
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
  }
}

async function ensurePushTables(db) {
  await ensureTable(
    db,
    "push_subscriptions",
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription_json TEXT,
      draft_ids_json TEXT,
      username TEXT,
      league_count INTEGER,
      updated_at INTEGER,
      created_at INTEGER
    )`,
    [
      { name: "subscription_json", type: "TEXT" },
      { name: "draft_ids_json", type: "TEXT" },
      { name: "username", type: "TEXT" },
      { name: "league_count", type: "INTEGER" },
      { name: "updated_at", type: "INTEGER" },
      { name: "created_at", type: "INTEGER" },
    ]
  );

  await ensureTable(
    db,
    "push_clock_state",
    `CREATE TABLE IF NOT EXISTS push_clock_state (
      endpoint TEXT,
      draft_id TEXT,
      pick_no INTEGER,
      last_status TEXT,
      sent_onclock INTEGER,
      sent_25 INTEGER,
      sent_50 INTEGER,
      sent_10min INTEGER,
      sent_final INTEGER,
      sent_paused INTEGER,
      sent_unpaused INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (endpoint, draft_id)
    )`,
    [
      { name: "pick_no", type: "INTEGER" },
      { name: "last_status", type: "TEXT" },
      { name: "sent_onclock", type: "INTEGER" },
      { name: "sent_25", type: "INTEGER" },
      { name: "sent_50", type: "INTEGER" },
      { name: "sent_10min", type: "INTEGER" },
      { name: "sent_final", type: "INTEGER" },
      { name: "sent_paused", type: "INTEGER" },
      { name: "sent_unpaused", type: "INTEGER" },
      { name: "updated_at", type: "INTEGER" },
    ]
  );

  await ensureTable(
    db,
    "push_draft_state",
    `CREATE TABLE IF NOT EXISTS push_draft_state (
      draft_id TEXT PRIMARY KEY,
      last_picked INTEGER,
      pick_count INTEGER,
      league_id TEXT,
      league_name TEXT,
      league_avatar TEXT,
      updated_at INTEGER
    )`,
    [
      { name: "last_picked", type: "INTEGER" },
      { name: "pick_count", type: "INTEGER" },
      { name: "league_id", type: "TEXT" },
      { name: "league_name", type: "TEXT" },
      { name: "league_avatar", type: "TEXT" },
      { name: "updated_at", type: "INTEGER" },
    ]
  );
}

async function getUserId(username) {
  const res = await fetch(
    `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.user_id || null;
}

async function getUserLeagues(userId, season) {
  if (!userId) return [];
  const year = String(season || new Date().getFullYear());
  const res = await fetch(
    `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${year}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const leagues = await res.json().catch(() => []);
  return Array.isArray(leagues) ? leagues : [];
}

async function computeDraftIdsForUsername(username, season) {
  const userId = await getUserId(username);
  if (!userId) return { draftIds: [], leagueCount: 0 };
  const leagues = await getUserLeagues(userId, season);
  const leagueCount = leagues.length;
  const draftIds = leagues
    .map((lg) => lg?.draft_id)
    .filter(Boolean)
    .map(String);
  return { draftIds: Array.from(new Set(draftIds)), leagueCount };
}

function hashEndpoint(endpoint) {
  let h = 5381;
  const s = String(endpoint || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export async function POST(req) {
  try {
    const { env } = getRequestContext();
    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });
    await ensurePushTables(db);

    const body = await req.json().catch(() => ({}));
    const subscription = body?.subscription || null;
    const username = body?.username ? String(body.username) : null;
    const season = body?.season ? String(body.season) : null;

    if (!subscription?.endpoint) {
      return new NextResponse("Missing subscription endpoint.", { status: 400 });
    }

    const endpoint = String(subscription.endpoint);
    const now = Date.now();

    // Always compute draft IDs server-side so users never have to re-enable
    // when they join a new league.
    const server = username
      ? await computeDraftIdsForUsername(username, season)
      : { draftIds: [], leagueCount: 0 };
    const clientDraftIds = Array.isArray(body?.draftIds)
      ? body.draftIds.map(String)
      : [];
    const merged = Array.from(new Set([...(server.draftIds || []), ...clientDraftIds]));

    await db
      .prepare(
        `INSERT OR REPLACE INTO push_subscriptions
          (endpoint, subscription_json, draft_ids_json, username, league_count, updated_at, created_at)
         VALUES
          (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM push_subscriptions WHERE endpoint=?), ?))`
      )
      .bind(
        endpoint,
        JSON.stringify(subscription),
        JSON.stringify(merged),
        username,
        Number(server.leagueCount || 0),
        now,
        endpoint,
        now
      )
      .run();

    // Send immediate confirmation push (so you can verify delivery on iOS + Chrome).
    const vapidPrivateRaw = env?.VAPID_PRIVATE_KEY;
    const vapidSubject = env?.VAPID_SUBJECT;
    if (vapidPrivateRaw && vapidSubject) {
      try {
        const vapidPrivateJwk = JSON.parse(vapidPrivateRaw);
        const { endpoint: pushEndpoint, fetchInit } = await buildWebPushRequest({
          subscription,
          payload: {
            title: "Alerts enabled ✅",
            body: `Draft Pick Tracker alerts are ON${username ? ` for ${username}` : ""}.`,
            url: "/draft-pick-tracker",
            tag: `push-enabled:${hashEndpoint(endpoint)}`,
            renotify: true,
            icon: "/android-chrome-192x192.png",
            badge: "/android-chrome-192x192.png",
            data: { url: "/draft-pick-tracker" },
            actions: [{ action: "open_tracker", title: "Open Tracker" }],
          },
          vapidSubject,
          vapidPrivateJwk,
        });
        await fetch(pushEndpoint, fetchInit);
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      ok: true,
      draftIdsSaved: merged.length,
      leagueCount: Number(server.leagueCount || 0),
    });
  } catch (e) {
    return new NextResponse(e?.message || "Subscribe failed", { status: 500 });
  }
}
