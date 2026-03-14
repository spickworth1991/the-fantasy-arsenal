export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

function getDb(env) {
  return env?.PUSH_DB || env?.DB || env?.D1 || env?.DRAFT_DB || null;
}

async function ensureDraftRegistryTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_draft_registry (
        draft_id TEXT PRIMARY KEY,
        active INTEGER,
        status TEXT,
        last_checked_at INTEGER,
        last_active_at INTEGER,
        last_inactive_at INTEGER,
        last_picked INTEGER,
        pick_count INTEGER,
        draft_order_json TEXT,
        draft_json TEXT,
        slot_to_roster_json TEXT,
        roster_names_json TEXT,
        roster_by_username_json TEXT,
        traded_pick_owner_json TEXT,
        teams INTEGER,
        rounds INTEGER,
        timer_sec INTEGER,
        reversal_round INTEGER,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT,
        best_ball INTEGER,
        completed_at INTEGER
      )`
    )
    .run();
}

async function loadExistingRowsMap(db, draftIds) {
  const ids = Array.from(new Set((draftIds || []).map((x) => String(x || "").trim()).filter(Boolean)));
  const out = new Map();
  if (!ids.length) return out;

  for (let i = 0; i < ids.length; i += 50) {
    const group = ids.slice(i, i + 50);
    const qs = group.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT draft_id, status, league_id, league_name, league_avatar, best_ball
         FROM push_draft_registry
         WHERE draft_id IN (${qs})`
      )
      .bind(...group)
      .all();

    for (const row of res?.results || []) {
      if (row?.draft_id) out.set(String(row.draft_id), row);
    }
  }

  return out;
}

function shouldRefreshSeedRow(existingRow, nextMeta) {
  if (!existingRow) return true;
  const status = String(existingRow?.status || "").trim().toLowerCase();
  if (!status || status === "unknown") return true;
  if (!existingRow?.league_id && nextMeta?.leagueId) return true;
  if (!existingRow?.league_name && nextMeta?.leagueName) return true;
  if (!existingRow?.league_avatar && nextMeta?.leagueAvatar) return true;
  if (existingRow?.best_ball == null && nextMeta?.bestBall != null) return true;
  return false;
}

/**
 * Lightweight discovery endpoint.
 * Seeds missing draft ids into the shared registry without touching push subscriptions.
 */
export async function POST(request) {
  try {
    const ctx = getRequestContext();
    const { env } = ctx;
    const db = getDb(env);
    if (!db) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "D1 binding not found. Expected one of: PUSH_DB, DB, D1, DRAFT_DB.",
        },
        { status: 500 }
      );
    }

    await ensureDraftRegistryTable(db);

    const body = await request.json().catch(() => ({}));
    const leagues = Array.isArray(body?.leagues) ? body.leagues : [];

    let inserted = 0;
    let updated = 0;

    const draftIds = leagues.map((item) => String(item?.draft_id || "").trim()).filter(Boolean);
    const existingRows = await loadExistingRowsMap(db, draftIds);

    for (const item of leagues) {
      const draftId = String(item?.draft_id || "").trim();
      if (!draftId) continue;

      const leagueId = item?.league_id ? String(item.league_id) : null;
      const leagueName = item?.league_name ? String(item.league_name) : (item?.name ? String(item.name) : null);
      const leagueAvatar = item?.league_avatar ? String(item.league_avatar) : (item?.avatar ? String(item.avatar) : null);
      const bestBall = Number(item?.best_ball || item?.settings?.best_ball || 0) === 1 ? 1 : 0;
      const existingRow = existingRows.get(draftId) || null;

      if (!shouldRefreshSeedRow(existingRow, { leagueId, leagueName, leagueAvatar, bestBall })) {
        continue;
      }

      await db
        .prepare(
          `INSERT INTO push_draft_registry (
            draft_id, active, status, last_checked_at,
            league_id, league_name, league_avatar, best_ball
          ) VALUES (?, 0, 'pre_draft', 0, ?, ?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            status=CASE
              WHEN push_draft_registry.status IS NULL OR push_draft_registry.status='' OR push_draft_registry.status='unknown'
              THEN 'pre_draft'
              ELSE push_draft_registry.status
            END,
            last_checked_at=CASE
              WHEN push_draft_registry.status IS NULL OR push_draft_registry.status='' OR push_draft_registry.status='unknown'
              THEN 0
              ELSE COALESCE(push_draft_registry.last_checked_at, 0)
            END,
            league_id=COALESCE(push_draft_registry.league_id, excluded.league_id),
            league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
            league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
            best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball)`
        )
        .bind(draftId, leagueId, leagueName, leagueAvatar, bestBall)
        .run();

      if (existingRow) updated += 1;
      else inserted += 1;
    }

    if (inserted || updated) {
      try {
        const id = env.DRAFT_REGISTRY.idFromName("master");
        const stub = env.DRAFT_REGISTRY.get(id);
        (ctx?.waitUntil
          ? ctx.waitUntil(stub.fetch("https://draft-registry.internal/kick"))
          : stub.fetch("https://draft-registry.internal/kick").catch(() => {}));
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ ok: true, inserted, updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}