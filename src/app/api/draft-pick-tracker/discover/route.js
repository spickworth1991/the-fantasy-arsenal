export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

const SLEEPER = "https://api.sleeper.app/v1";

async function sleeperJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Sleeper ${r.status} for ${url}`);
  return r.json();
}

async function ensureRegistryTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_draft_registry (
        draft_id TEXT PRIMARY KEY,
        active INTEGER DEFAULT 1,
        status TEXT,
        league_id TEXT,
        league_name TEXT,
        league_avatar TEXT,
        best_ball INTEGER,
        last_checked_at INTEGER,
        last_pick_number INTEGER,
        picks_made INTEGER,
        picks_total INTEGER,
        updated_at INTEGER
      )`
    )
    .run();

  try {
    const info = await db.prepare("PRAGMA table_info(push_draft_registry)").all();
    const cols = new Set((info?.results || []).map((r) => String(r?.name || "")));
    const maybeAdd = async (name, type) => {
      if (cols.has(name)) return;
      await db.prepare(`ALTER TABLE push_draft_registry ADD COLUMN ${name} ${type}`).run();
    };
    await maybeAdd("league_id", "TEXT");
    await maybeAdd("league_name", "TEXT");
    await maybeAdd("league_avatar", "TEXT");
    await maybeAdd("best_ball", "INTEGER");
    await maybeAdd("updated_at", "INTEGER");
  } catch {
    // ignore
  }
}

async function getDraftRegistryStub(env) {
  try {
    const ns = env?.DRAFT_REGISTRY;
    if (!ns?.idFromName) return null;
    const id = ns.idFromName("master");
    return ns.get(id);
  } catch {
    return null;
  }
}

async function upsertDraft(db, d, now) {
  const draftId = d?.draft_id != null ? String(d.draft_id).trim() : "";
  const leagueId = d?.league_id != null ? String(d.league_id).trim() : "";
  if (!draftId || !leagueId) return false;

  const leagueName = d?.league_name != null ? String(d.league_name) : null;
  const leagueAvatar = d?.league_avatar != null ? String(d.league_avatar) : null;
  const bestBall = d?.best_ball == null ? null : Number(d.best_ball) ? 1 : 0;
  const status = d?.status != null ? String(d.status).toLowerCase() : null;
  const forceActive = status === "drafting" || status === "paused" || status === "in_progress";
  const requestedActive = d?.active == null ? 1 : Number(d.active) ? 1 : 0;
  const active = forceActive ? 1 : requestedActive;

  await db
    .prepare(
      `INSERT INTO push_draft_registry (
        draft_id, active, status, last_checked_at,
        league_id, league_name, league_avatar, best_ball
      ) VALUES (?, ?, COALESCE(?, 'unknown'), ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        league_id=COALESCE(push_draft_registry.league_id, excluded.league_id),
        league_name=COALESCE(push_draft_registry.league_name, excluded.league_name),
        league_avatar=COALESCE(push_draft_registry.league_avatar, excluded.league_avatar),
        best_ball=COALESCE(push_draft_registry.best_ball, excluded.best_ball),
        active=CASE WHEN excluded.active=1 THEN 1 ELSE push_draft_registry.active END,
        status=COALESCE(excluded.status, push_draft_registry.status),
        last_checked_at=MAX(COALESCE(push_draft_registry.last_checked_at, 0), excluded.last_checked_at)`
    )
    .bind(draftId, active, status, now, leagueId, leagueName, leagueAvatar, bestBall)
    .run();

  return { draft_id: draftId, league_id: leagueId, league_name: leagueName, league_avatar: leagueAvatar, best_ball: bestBall, status, active };
}

// This route is called by the tracker client to discover new/changed draft IDs
// and ensure they are added to the master registry (D1 + Durable Object).
export async function GET(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB || env?.DB || env?.D1 || env?.DRAFT_DB;
    if (!db?.prepare) {
      // Don't hard-crash the page if a Preview env is missing a D1 binding.
      // Return a graceful empty result so the client can still render.
      return NextResponse.json({ ok: false, error: "D1 binding not found (expected PUSH_DB/DB/D1).", added: 0, drafts: [] }, { status: 200 });
    }
    await ensureRegistryTable(db);

    const url = new URL(req.url);
    const username = (url.searchParams.get("username") || "").trim();
    if (!username) return NextResponse.json({ ok: false, error: "username required" }, { status: 400 });

    const now = Date.now();
    const season = String(new Date().getFullYear());

    const user = await sleeperJson(`${SLEEPER}/user/${encodeURIComponent(username)}`);
    const leagues = await sleeperJson(`${SLEEPER}/user/${encodeURIComponent(user.user_id)}/leagues/nfl/${season}`);

    // Map known drafts in registry (by draft_id) so we only fetch Sleeper draft objects when needed.
    const existing = await db
      .prepare("SELECT draft_id, active, status, league_id FROM push_draft_registry")
      .all();
    const byDraftId = new Map((existing?.results || []).map((r) => [String(r.draft_id), r]));
    const byLeagueId = new Map((existing?.results || []).map((r) => [String(r.league_id || ""), r]));

    const toAddOrUpdate = [];
    for (const lg of Array.isArray(leagues) ? leagues : []) {
      const leagueId = String(lg?.league_id || "");
      const draftId = String(lg?.draft_id || "");
      if (!leagueId || !draftId) continue;

      const rowByDraft = byDraftId.get(draftId);
      const rowByLeague = byLeagueId.get(leagueId);

      const needsAdd = !rowByDraft;
      const suspiciousInactive = rowByLeague && Number(rowByLeague.active) === 0;
      const suspiciousStatus = rowByLeague && !["drafting", "in_progress", "paused"].includes(String(rowByLeague.status || "").toLowerCase());

      if (!needsAdd && !suspiciousInactive && !suspiciousStatus) continue;

      // Pull the real draft object so we can set status/active correctly.
      let draft;
      try {
        draft = await sleeperJson(`${SLEEPER}/draft/${encodeURIComponent(draftId)}`);
      } catch {
        // If the draft lookup fails, still record the draft_id/league_id so the DO can retry later.
        draft = { draft_id: draftId, league_id: leagueId, status: "unknown" };
      }

      toAddOrUpdate.push({
        draft_id: draftId,
        league_id: leagueId,
        league_name: lg?.name ?? null,
        league_avatar: lg?.avatar ?? null,
        best_ball: lg?.settings?.best_ball ?? null,
        status: draft?.status ?? lg?.status ?? null,
        active: 1,
      });
    }

    const did = [];
    for (const d of toAddOrUpdate) {
      const res = await upsertDraft(db, d, now);
      if (res) did.push(res);
    }

    const stub = await getDraftRegistryStub(env);
    if (stub && did.length) {
      for (const d of did) {
        await stub.fetch("https://do/add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draft: d }),
        });
      }
      await stub.fetch("https://do/kick", { method: "POST" });
      await stub.fetch("https://do/tick", { method: "POST" });
    }

    return NextResponse.json({
      ok: true,
      season,
      checked_leagues: Array.isArray(leagues) ? leagues.length : 0,
      upserted: did.length,
      drafts: did,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
