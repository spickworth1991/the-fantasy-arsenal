export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

// Public read-only endpoint used by the Draft Monitor page.
// Returns the shared draft registry rows (draft_json + pick_count) so clients don't need to poll Sleeper.

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
        teams INTEGER,
        timer_sec INTEGER,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT,
        best_ball INTEGER,
        completed_at INTEGER
      )`
    )
    .run();

  // Back-compat for older deployments.
  try {
    const info = await db.prepare(`PRAGMA table_info(push_draft_registry)`).all();
    const existing = new Set((info?.results || []).map((r) => String(r?.name || "")));
    const ensure = async (name, type) => {
      if (!existing.has(name)) {
        await db.prepare(`ALTER TABLE push_draft_registry ADD COLUMN ${name} ${type}`).run();
      }
    };
    await ensure("draft_json", "TEXT");
    await ensure("best_ball", "INTEGER");
    await ensure("completed_at", "INTEGER");
  } catch {
    // ignore
  }
}

export async function GET(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    await ensureDraftRegistryTable(db);

    const url = new URL(req.url);
    const idsRaw = url.searchParams.get("ids") || "";
    const activeOnly = url.searchParams.get("active") === "1";
    const ids = idsRaw
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 200);

    // If no ids are provided, return the shared active registry snapshot for Draft Monitor.
    // This avoids having to do per-user league discovery just to show what's currently drafting.
    if (!ids.length) {
      const where = activeOnly ? "WHERE active=1" : "";
      const rows = await db
        .prepare(
          `SELECT draft_id, active, status, last_checked_at, last_picked, pick_count, draft_json,
                  teams, timer_sec, league_id, league_name, league_avatar,
                  best_ball, completed_at
           FROM push_draft_registry
           ${where}
           ORDER BY COALESCE(last_active_at, last_checked_at) DESC
           LIMIT 500`
        )
        .all();

      const list = [];
      for (const r of rows?.results || []) {
        let draft = null;
        try {
          draft = r.draft_json ? JSON.parse(r.draft_json) : null;
        } catch {
          draft = null;
        }
        list.push({
          draftId: String(r.draft_id),
          active: Number(r.active || 0) === 1,
          status: r.status || null,
          lastCheckedAt: Number(r.last_checked_at || 0),
          lastPicked: r.last_picked == null ? null : Number(r.last_picked),
          pickCount: r.pick_count == null ? null : Number(r.pick_count),
          draft,
          teams: r.teams == null ? null : Number(r.teams),
          timerSec: r.timer_sec == null ? null : Number(r.timer_sec),
          leagueId: r.league_id || null,
          leagueName: r.league_name || null,
          leagueAvatar: r.league_avatar || null,
          bestBall: Number(r.best_ball || 0) === 1,
          completedAt: r.completed_at == null ? null : Number(r.completed_at),
        });
      }

      return NextResponse.json({ ok: true, rows: list });
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT draft_id, active, status, last_picked, pick_count, draft_json,
                teams, timer_sec, league_id, league_name, league_avatar,
                best_ball, completed_at
         FROM push_draft_registry
         WHERE draft_id IN (${placeholders})`
      )
      .bind(...ids)
      .all();

    const out = {};
    for (const r of rows?.results || []) {
      let draft = null;
      try {
        draft = r.draft_json ? JSON.parse(r.draft_json) : null;
      } catch {
        draft = null;
      }
      out[String(r.draft_id)] = {
        active: Number(r.active || 0) === 1,
        status: r.status || null,
        lastPicked: Number(r.last_picked || 0),
        pickCount: Number(r.pick_count ?? NaN),
        draft,
        teams: Number(r.teams || 0),
        timerSec: Number(r.timer_sec || 0),
        leagueId: r.league_id || null,
        leagueName: r.league_name || null,
        leagueAvatar: r.league_avatar || null,
        bestBall: Number(r.best_ball || 0) === 1,
        completedAt: r.completed_at == null ? null : Number(r.completed_at),
      };
    }

    return NextResponse.json({ ok: true, drafts: out });
  } catch (e) {
    return new NextResponse(e?.message || "Registry read failed", { status: 500 });
  }
}

// Draft Monitor + "hourly sync" uses this to register draft ids into the shared registry.
// poll-and-notify will hydrate and keep these rows current.
export async function POST(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    await ensureDraftRegistryTable(db);

    let payload = null;
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }

    const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
    const now = Date.now();

    let upserted = 0;
    for (const d of drafts) {
      const draftId = d?.draft_id != null ? String(d.draft_id).trim() : "";
      if (!draftId) continue;

      const leagueId = d?.league_id != null ? String(d.league_id) : null;
      const leagueName = d?.league_name != null ? String(d.league_name) : null;
      const leagueAvatar = d?.league_avatar != null ? String(d.league_avatar) : null;
      const bestBall = d?.best_ball == null ? null : Number(d.best_ball) ? 1 : 0;
      const status = d?.status != null ? String(d.status).toLowerCase() : null;

      // Insert (or patch missing fields) without overwriting hydrated values.
      await db
        .prepare(
          `INSERT INTO push_draft_registry (
            draft_id, active, status, last_checked_at,
            league_id, league_name, league_avatar, best_ball
          ) VALUES (?, 1, COALESCE(?, 'unknown'), ?, ?, ?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            league_id=COALESCE(push_draft_registry.league_id, excluded.league_id),
            league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
            league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
            best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
            last_checked_at=MAX(COALESCE(push_draft_registry.last_checked_at, 0), excluded.last_checked_at)`
        )
        .bind(draftId, status, now, leagueId, leagueName, leagueAvatar, bestBall)
        .run();

      upserted++;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (e) {
    return new NextResponse(e?.message || "Registry write failed", { status: 500 });
  }
}
