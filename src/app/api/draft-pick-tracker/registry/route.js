export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

function parseIds(urlStr) {
  try {
    const u = new URL(urlStr);
    const idsRaw = u.searchParams.get("ids") || "";
    return idsRaw
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 250); // avoid huge queries
  } catch {
    return [];
  }
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export async function GET(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;
    if (!db?.prepare) return NextResponse.json({ ok: false, error: "PUSH_DB binding not found" }, { status: 500 });

    const ids = parseIds(req.url);
    if (!ids.length) return NextResponse.json({ ok: true, drafts: {} });

    // Build an IN (?, ?, ...) query
    const placeholders = ids.map(() => "?").join(",");
    const q = `SELECT draft_id, league_id, league_name, league_avatar, best_ball, status,
                     draft_json, pick_count, last_picked, updated_at
              FROM push_draft_registry
              WHERE draft_id IN (${placeholders})`;

    const res = await db.prepare(q).bind(...ids).all();
    const rows = res?.results || [];

    const out = {};
    for (const id of ids) out[id] = null;

    for (const r of rows) {
      const draft = safeJsonParse(r.draft_json || "null");
      out[String(r.draft_id)] = {
        draftId: String(r.draft_id),
        leagueId: r.league_id ? String(r.league_id) : null,
        leagueName: r.league_name || null,
        leagueAvatar: r.league_avatar || null,
        bestBall: Number(r.best_ball || 0),
        status: r.status || null,
        lastPicked: Number(r.last_picked || 0),
        pickCount: Number.isFinite(Number(r.pick_count)) ? Number(r.pick_count) : null,
        teams: Number(draft?.settings?.teams || 0) || null,
        timerSec: Number(draft?.settings?.pick_timer || 0) || null,
        draft, // full draft JSON for client-side logic (draft_order, metadata, etc.)
        updatedAt: Number(r.updated_at || 0),
      };
    }

    return NextResponse.json({ ok: true, drafts: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || "registry failed" }, { status: 500 });
  }
}
