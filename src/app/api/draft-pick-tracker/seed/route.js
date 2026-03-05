export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

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
        draft_json TEXT,
        draft_order_json TEXT,
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
        current_pick INTEGER,
        current_owner_name TEXT,
        next_owner_name TEXT,
        clock_ends_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER
      )`
    )
    .run();
}

export async function POST(req) {
  const { env } = getRequestContext();
  const db = env?.PUSH_DB;

  if (!db?.prepare) {
    return NextResponse.json({ ok: false, error: "PUSH_DB binding missing" }, { status: 500 });
  }

  await ensureDraftRegistryTable(db);

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const leagues = Array.isArray(body?.leagues) ? body.leagues : [];
  if (!leagues.length) return NextResponse.json({ ok: true, seeded: 0 });

  // Only seed drafts that aren't already present
  const draftIds = leagues.map((l) => String(l?.draft_id || "")).filter(Boolean);
  if (!draftIds.length) return NextResponse.json({ ok: true, seeded: 0 });

  // load existing
  const existing = new Set();
  for (let i = 0; i < draftIds.length; i += 80) {
    const chunk = draftIds.slice(i, i + 80);
    const qs = chunk.map(() => "?").join(",");
    const res = await db
      .prepare(`SELECT draft_id FROM push_draft_registry WHERE draft_id IN (${qs})`)
      .bind(...chunk)
      .all();
    for (const r of res?.results || []) existing.add(String(r?.draft_id || ""));
  }

  const now = Date.now();
  let seeded = 0;

  // Seed minimal rows; DO tick hydrates the rest
  for (const lg of leagues) {
    const draftId = String(lg?.draft_id || "");
    if (!draftId || existing.has(draftId)) continue;

    const leagueId = lg?.league_id != null ? String(lg.league_id) : null;
    const leagueName = lg?.name != null ? String(lg.name) : null;
    const leagueAvatar = lg?.avatar != null ? String(lg.avatar) : null;
    const bestBall = lg?.settings?.best_ball ? 1 : 0;

    await db
      .prepare(
        `INSERT INTO push_draft_registry (
          draft_id, active, status, last_checked_at,
          league_id, league_name, league_avatar, best_ball,
          updated_at
        ) VALUES (
          ?, 0, 'pre_draft', ?,
          ?, ?, ?, ?,
          ?
        )
        ON CONFLICT(draft_id) DO UPDATE SET
          league_id=COALESCE(excluded.league_id, push_draft_registry.league_id),
          league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
          league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
          best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
          updated_at=excluded.updated_at`
      )
      .bind(draftId, now, leagueId, leagueName, leagueAvatar, bestBall, now)
      .run();

    seeded++;
  }

  return NextResponse.json({ ok: true, seeded });
}