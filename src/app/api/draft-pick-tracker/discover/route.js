export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

function getDb(env) {
  // Support multiple binding names (Cloudflare dashboard vs local wrangler, etc.)
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

/**
 * Lightweight discovery endpoint.
 *
 * The client calls this every ~60s with the user's known league + draft IDs.
 * This route:
 *  - upserts missing draft_ids into the shared registry (D1)
 *  - triggers the Durable Object to hydrate/refresh separately (does NOT block UI)
 */
export async function POST(request) {
  try {
    const { env, ctx } = getRequestContext();
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
    const now = Date.now();

    for (const item of leagues) {
      const draftId = String(item?.draft_id || "").trim();
      if (!draftId) continue;

      const leagueId = item?.league_id ? String(item.league_id) : null;
      const leagueName = item?.league_name ? String(item.league_name) : null;
      const leagueAvatar = item?.league_avatar ? String(item.league_avatar) : null;
      const bestBall = Number(item?.best_ball || 0) === 1 ? 1 : 0;

      // Upsert minimal metadata; DO will fill in everything else.
      const res = await db.prepare(
        `INSERT INTO push_draft_registry (
          draft_id, active, status, last_checked_at,
          league_id, league_name, league_avatar, best_ball
        ) VALUES (?, 1, 'unknown', ?, ?, ?, ?, ?)
        ON CONFLICT(draft_id) DO UPDATE SET
          active=1,
          last_checked_at=COALESCE(push_draft_registry.last_checked_at, excluded.last_checked_at),
          league_id=COALESCE(excluded.league_id, push_draft_registry.league_id),
          league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
          league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
          best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball)`
      )
        .bind(draftId, now, leagueId, leagueName, leagueAvatar, bestBall)
        .run();

      if (res?.meta?.changes === 1) inserted += 1;
      else updated += 1;
    }

    // Kick the DO to hydrate asynchronously (do not block UI)
    try {
      const id = env.DRAFT_REGISTRY.idFromName("master");
      const stub = env.DRAFT_REGISTRY.get(id);
      ctx.waitUntil(stub.fetch("https://draft-registry.internal/kick"));
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, inserted, updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
