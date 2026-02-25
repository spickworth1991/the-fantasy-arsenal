export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

function jsonParseSafe(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

async function ensureDraftRegistryTable(db) {
  // Keep this in sync with the DO schema (but DO will also back-fill missing cols).
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
        completed_at INTEGER
      )`
    )
    .run();

  // back-compat: add columns if missing
  let info;
  try {
    info = await db.prepare(`PRAGMA table_info(push_draft_registry)`).all();
  } catch {
    return;
  }
  const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));

  const addColumn = async (name, type) => {
    if (!existing.has(name)) {
      await db.prepare(`ALTER TABLE push_draft_registry ADD COLUMN ${name} ${type}`).run();
    }
  };

  await addColumn("pick_count", "INTEGER");
  await addColumn("draft_json", "TEXT");
  await addColumn("draft_order_json", "TEXT");
  await addColumn("slot_to_roster_json", "TEXT");
  await addColumn("roster_names_json", "TEXT");
  await addColumn("roster_by_username_json", "TEXT");
  await addColumn("traded_pick_owner_json", "TEXT");
  await addColumn("teams", "INTEGER");
  await addColumn("rounds", "INTEGER");
  await addColumn("timer_sec", "INTEGER");
  await addColumn("reversal_round", "INTEGER");
  await addColumn("league_id", "TEXT");
  await addColumn("league_name", "TEXT");
  await addColumn("league_avatar", "TEXT");
  await addColumn("best_ball", "INTEGER");
  await addColumn("current_pick", "INTEGER");
  await addColumn("current_owner_name", "TEXT");
  await addColumn("next_owner_name", "TEXT");
  await addColumn("clock_ends_at", "INTEGER");
  await addColumn("completed_at", "INTEGER");
}

function getDb() {
  const ctx = getRequestContext();
  // D1 binding name in your project is PUSH_DB.
  const db = ctx?.env?.PUSH_DB;
  if (!db) throw new Error("PUSH_DB binding not found");
  return db;
}

export async function GET(req) {
  try {
    const db = getDb();
    await ensureDraftRegistryTable(db);

    const { searchParams } = new URL(req.url);
    const draftIdsRaw = String(searchParams.get("draft_ids") || "").trim();

    const draftIds = draftIdsRaw
      ? draftIdsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (!draftIds.length) {
      return NextResponse.json({ rows: {} });
    }

    // build dynamic IN (?, ?, ?)
    const placeholders = draftIds.map(() => "?").join(",");
    const stmt = db.prepare(
      `SELECT draft_id,
              active, status,
              last_checked_at,
              last_picked,
              pick_count,
              draft_json,
              slot_to_roster_json,
              roster_names_json,
              roster_by_username_json,
              traded_pick_owner_json,
              teams, rounds, timer_sec, reversal_round,
              league_id, league_name, league_avatar,
              best_ball, current_pick, current_owner_name, next_owner_name, clock_ends_at, completed_at
       FROM push_draft_registry
       WHERE draft_id IN (${placeholders})`
    );

    const rows = await stmt.bind(...draftIds).all();

    const out = {};
    for (const r of rows?.results || []) {
      const draftId = String(r?.draft_id || "");
      if (!draftId) continue;

      out[draftId] = {
        active: Number(r.active || 0) === 1,
        status: r.status || null,
        lastCheckedAt: r.last_checked_at == null ? null : Number(r.last_checked_at),
        lastPicked: r.last_picked == null ? null : Number(r.last_picked),
        pickCount: r.pick_count == null ? null : Number(r.pick_count),

        draft: r.draft_json ? jsonParseSafe(r.draft_json, null) : null,
        slotToRoster: r.slot_to_roster_json ? jsonParseSafe(r.slot_to_roster_json, {}) : {},
        rosterNames: r.roster_names_json ? jsonParseSafe(r.roster_names_json, {}) : {},
        rosterByUsername: r.roster_by_username_json ? jsonParseSafe(r.roster_by_username_json, {}) : {},
        tradedPickOwners: r.traded_pick_owner_json ? jsonParseSafe(r.traded_pick_owner_json, {}) : {},

        teams: r.teams == null ? null : Number(r.teams),
        rounds: r.rounds == null ? null : Number(r.rounds),
        timerSec: r.timer_sec == null ? null : Number(r.timer_sec),
        reversalRound: r.reversal_round == null ? null : Number(r.reversal_round),

        leagueId: r.league_id || null,
        leagueName: r.league_name || null,
        leagueAvatar: r.league_avatar || null,

        bestBall: Number(r.best_ball || 0) === 1,
        currentPick: r.current_pick == null ? null : Number(r.current_pick),
        currentOwnerName: r.current_owner_name || null,
        nextOwnerName: r.next_owner_name || null,
        clockEndsAt: r.clock_ends_at == null ? null : Number(r.clock_ends_at),
        completedAt: r.completed_at == null ? null : Number(r.completed_at),
      };
    }

    return NextResponse.json({ rows: out });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "registry_get_failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const db = getDb();
    await ensureDraftRegistryTable(db);

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];

    // Expected item shape: { draft_id, league_id, league_name, league_avatar }
    for (const it of items) {
      const draftId = String(it?.draft_id || "").trim();
      if (!draftId) continue;

      const leagueId = it?.league_id != null ? String(it.league_id) : null;
      const leagueName = it?.league_name != null ? String(it.league_name) : null;
      const leagueAvatar = it?.league_avatar != null ? String(it.league_avatar) : null;

      await db
        .prepare(
          `INSERT INTO push_draft_registry (draft_id, active, status, last_checked_at, league_id, league_name, league_avatar)
           VALUES (?, 0, '', ?, ?, ?, ?)
           ON CONFLICT(draft_id) DO UPDATE SET
             league_id=COALESCE(push_draft_registry.league_id, excluded.league_id),
             league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
             league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar)`
        )
        .bind(draftId, Date.now(), leagueId, leagueName, leagueAvatar)
        .run();
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "registry_post_failed" }, { status: 500 });
  }
}