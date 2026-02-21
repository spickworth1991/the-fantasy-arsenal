export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

// Public read-only endpoint used by the Draft Monitor page.
// Returns the shared draft registry rows (draft_json + pick_count) so clients don't need to poll Sleeper.

export async function GET(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const url = new URL(req.url);
    const idsRaw = url.searchParams.get("ids") || "";
    const ids = idsRaw
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 200);

    if (!ids.length) {
      return NextResponse.json({ ok: true, drafts: {} });
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT draft_id, active, status, last_picked, pick_count, draft_json,
                teams, timer_sec, league_id, league_name, league_avatar
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
      };
    }

    return NextResponse.json({ ok: true, drafts: out });
  } catch (e) {
    return new NextResponse(e?.message || "Registry read failed", { status: 500 });
  }
}
