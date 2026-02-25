import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

async function kickDraftRegistry(env) {
  try {
    const ns = env?.DRAFT_REGISTRY;
    if (!ns?.idFromName) return;
    const id = ns.idFromName("master");
    const stub = ns.get(id);
    // Runs a tick immediately and schedules the alarm loop.
    await stub.fetch("https://do/kick", { method: "POST" });
  } catch {
    // ignore
  }
}

export async function GET(request) {
  try {
    const { env } = getRequestContext();
    const url = new URL(request.url);

    const idsRaw = url.searchParams.get("ids") || "";
    const ids = idsRaw
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 200);

    // Optional: kick the registry DO to hydrate missing draft data.
    // Only do this when explicitly requested AND ids are provided.
    if (ids.length && url.searchParams.get("kick") === "1") {
      await kickDraftRegistry(env);
    }

    if (!ids.length) {
      return NextResponse.json({ ok: true, drafts: {} });
    }

    const db = env.D1;
    const qs = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT
          draft_id,
          league_id,
          league_name,
          league_avatar,
          best_ball,
          status,
          active,
          updated_at,
          draft_json,
          pick_count,
          last_picked,
          current_pick,
          current_owner_name,
          next_owner_name,
          clock_ends_at,
          timer_sec,
          teams,
          rounds,
          reversal_round,
          slot_to_roster_json,
          roster_names_json,
          roster_by_username_json,
          traded_pick_owner_json
        FROM draft_registry
        WHERE draft_id IN (${qs})`
      )
      .bind(...ids)
      .all();

    const out = {};
    for (const row of results || []) {
      let draft = null;
      try {
        draft = row?.draft_json ? JSON.parse(row.draft_json) : null;
      } catch {}

      let slotToRoster = null;
      try {
        slotToRoster = row?.slot_to_roster_json ? JSON.parse(row.slot_to_roster_json) : null;
      } catch {}

      let rosterNames = null;
      try {
        rosterNames = row?.roster_names_json ? JSON.parse(row.roster_names_json) : null;
      } catch {}

      let rosterByUsername = null;
      try {
        rosterByUsername = row?.roster_by_username_json ? JSON.parse(row.roster_by_username_json) : null;
      } catch {}

      let tradedPickOwners = null;
      try {
        tradedPickOwners = row?.traded_pick_owner_json ? JSON.parse(row.traded_pick_owner_json) : null;
      } catch {}

      out[String(row.draft_id)] = {
        draft_id: String(row.draft_id),
        league_id: row.league_id ? String(row.league_id) : null,
        league_name: row.league_name || null,
        league_avatar: row.league_avatar || null,
        best_ball: Number(row.best_ball || 0),
        status: row.status || null,
        active: Number(row.active || 0),
        updated_at: row.updated_at || null,

        // hydrated
        draft,
        pick_count: Number(row.pick_count || 0),
        last_picked: row.last_picked != null ? Number(row.last_picked) : null,
        current_pick: row.current_pick != null ? Number(row.current_pick) : null,
        current_owner_name: row.current_owner_name || null,
        next_owner_name: row.next_owner_name || null,
        clock_ends_at: row.clock_ends_at != null ? Number(row.clock_ends_at) : null,
        timer_sec: row.timer_sec != null ? Number(row.timer_sec) : null,
        teams: row.teams != null ? Number(row.teams) : null,
        rounds: row.rounds != null ? Number(row.rounds) : null,
        reversal_round: row.reversal_round != null ? Number(row.reversal_round) : null,

        // context maps
        slot_to_roster: slotToRoster,
        roster_names: rosterNames,
        roster_by_username: rosterByUsername,
        traded_pick_owners: tradedPickOwners,
      };
    }

    return NextResponse.json({ ok: true, drafts: out });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "registry_get_failed" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { env } = getRequestContext();
    const db = env.D1;

    const body = await request.json().catch(() => null);
    const drafts = Array.isArray(body?.drafts) ? body.drafts : [];

    if (!drafts.length) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const now = Date.now();
    let inserted = 0;

    for (const d of drafts) {
      const draftId = String(d?.draft_id || "").trim();
      if (!draftId) continue;

      const leagueId = d?.league_id != null ? String(d.league_id) : null;
      const leagueName = d?.league_name != null ? String(d.league_name) : null;
      const leagueAvatar = d?.league_avatar != null ? String(d.league_avatar) : null;
      const bestBall = Number(d?.best_ball || 0) ? 1 : 0;

      await db
        .prepare(
          `INSERT INTO draft_registry (draft_id, league_id, league_name, league_avatar, best_ball, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(draft_id) DO UPDATE SET
             league_id=COALESCE(excluded.league_id, draft_registry.league_id),
             league_name=COALESCE(excluded.league_name, draft_registry.league_name),
             league_avatar=COALESCE(excluded.league_avatar, draft_registry.league_avatar),
             best_ball=COALESCE(excluded.best_ball, draft_registry.best_ball),
             updated_at=excluded.updated_at`
        )
        .bind(draftId, leagueId, leagueName, leagueAvatar, bestBall, now)
        .run();

      inserted++;
    }

    // kick the DO to hydrate + start its alarm loop
    try {
      const ns = env?.DRAFT_REGISTRY;
      const id = ns.idFromName("master");
      const stub = ns.get(id);
      await stub.fetch("https://do/tick", { method: "POST" });
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "registry_post_failed" },
      { status: 500 }
    );
  }
}