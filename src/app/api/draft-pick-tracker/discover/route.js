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
    const now = Date.now();

    for (const item of leagues) {
      const draftId = String(item?.draft_id || "").trim();
      if (!draftId) continue;

      const leagueId = item?.league_id ? String(item.league_id) : null;
      const leagueName = item?.league_name ? String(item.league_name) : (item?.name ? String(item.name) : null);
      const leagueAvatar = item?.league_avatar ? String(item.league_avatar) : (item?.avatar ? String(item.avatar) : null);
      const bestBall = Number(item?.best_ball || item?.settings?.best_ball || 0) === 1 ? 1 : 0;

      // Upsert minimal metadata; DO will fill in everything else.
      // IMPORTANT:
      // - Do NOT mark as active/unknown here. That can push the draft into the "inactive" bucket,
      //   which is only refreshed every ~6 hours.
      // - Seed as pre_draft with last_checked_at=0 so the DO picks it up quickly.
      const res = await db
        .prepare(
          `INSERT INTO push_draft_registry (
            draft_id, active, status, last_checked_at,
            league_id, league_name, league_avatar, best_ball
          ) VALUES (?, 0, 'pre_draft', 0, ?, ?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            -- If we only had a placeholder status, make it eligible for the DO pre_draft refresh.
            status=CASE
              WHEN push_draft_registry.status IS NULL OR push_draft_registry.status='' OR push_draft_registry.status='unknown'
              THEN 'pre_draft'
              ELSE push_draft_registry.status
            END,
            -- Force a near-immediate refresh if we were stuck in the placeholder state.
            last_checked_at=CASE
              WHEN push_draft_registry.status='unknown'
              THEN 0
              ELSE COALESCE(push_draft_registry.last_checked_at, 0)
            END,
            league_id=COALESCE(excluded.league_id, push_draft_registry.league_id),
            league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
            league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
            best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball)`
        )
        .bind(draftId, leagueId, leagueName, leagueAvatar, bestBall)
        .run();

      if (res?.meta?.changes === 1) inserted += 1;
      else updated += 1;
    }

    // Kick the DO to hydrate asynchronously (do not block UI)
    try {
      const id = env.DRAFT_REGISTRY.idFromName("master");
      const stub = env.DRAFT_REGISTRY.get(id);
      (ctx?.waitUntil ? ctx.waitUntil(stub.fetch("https://draft-registry.internal/kick")) : stub.fetch("https://draft-registry.internal/kick").catch(() => {}));
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
