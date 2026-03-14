export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function safeJsonParse(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function kickDraftRegistry(env) {
  // Best-effort: tell the DO to run a tick now.
  try {
    const id = env?.DRAFT_REGISTRY?.idFromName("master");
    const stub = env?.DRAFT_REGISTRY?.get(id);
    if (stub) await stub.fetch("https://do/tick");
  } catch {
    // ignore
  }
}

function getDb(env) {
  return env?.PUSH_DB;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req) {
  try {
    const ctx = getRequestContext();
    const { env } = ctx;
    const db = getDb(env);
    if (!db?.prepare) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing D1 binding: PUSH_DB",
        },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const idsRaw = url.searchParams.get("ids") || url.searchParams.get("draft_ids") || "";
    const activeOnly = url.searchParams.get("active") === "1";
    const lite = url.searchParams.get("lite") === "1";

    // If no ids provided, return the active registry subset (bounded)
    const ids = Array.from(
      new Set(
        String(idsRaw)
          .split(",")
          .map((s) => String(s || "").trim())
          .filter(Boolean)
      )
    ).slice(0, 1000);

    if (!ids.length) {
      const res = await db
        .prepare(
          `SELECT draft_id, active, status, last_picked, pick_count, draft_json,
                  slot_to_roster_json, roster_names_json, roster_by_username_json,
                  traded_pick_owner_json, teams, rounds, timer_sec, reversal_round,
                  league_id, league_name, league_avatar, best_ball,
                  current_pick, current_owner_name, next_owner_name, clock_ends_at,
                  completed_at, updated_at
           FROM push_draft_registry
           WHERE active = 1
           ORDER BY updated_at DESC
           LIMIT 1000`
        )
        .all();

      const out = {};
      for (const row of res?.results || []) {
        out[String(row.draft_id)] = {
          draft_id: String(row.draft_id),
          active: safeNum(row.active) === 1,
          status: row.status || null,
          last_picked: row.last_picked == null ? null : Number(row.last_picked),
          pick_count: safeNum(row.pick_count) || 0,
          draft_json: row.draft_json || null,
          slot_to_roster_json: safeJsonParse(row?.slot_to_roster_json) || {},
          roster_names_json: safeJsonParse(row?.roster_names_json) || {},
          roster_by_username_json: safeJsonParse(row?.roster_by_username_json) || {},
          traded_pick_owner_json: safeJsonParse(row?.traded_pick_owner_json) || {},
          teams: safeNum(row.teams) || null,
          rounds: safeNum(row.rounds) || null,
          timer_sec: safeNum(row.timer_sec) || null,
          reversal_round: safeNum(row.reversal_round) || null,
          league_id: row.league_id || null,
          league_name: row.league_name || null,
          league_avatar: row.league_avatar || null,
          best_ball: safeNum(row.best_ball) === 1,
          current_pick: row.current_pick == null ? null : Number(row.current_pick),
          current_owner_name: row.current_owner_name || null,
          next_owner_name: row.next_owner_name || null,
          clock_ends_at: row.clock_ends_at == null ? null : Number(row.clock_ends_at),
          completed_at: row.completed_at == null ? null : Number(row.completed_at),
          updated_at: row.updated_at == null ? null : Number(row.updated_at),
        };
      }

      return NextResponse.json({ ok: true, drafts: out });
    }

    // Fetch requested ids in chunks so D1/SQLite never exceeds variable limits
    const selectSqlFor = (count) =>
      lite
        ? `SELECT draft_id, active, status, last_picked, pick_count,
                  slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
                  teams, rounds, timer_sec, reversal_round, league_id, league_name, league_avatar,
                  best_ball,
                  current_pick, current_owner_name, next_owner_name, clock_ends_at,
                  completed_at, updated_at
           FROM push_draft_registry
           WHERE draft_id IN (${Array.from({ length: count }, () => "?").join(",")})`
        : `SELECT draft_id, active, status, last_picked, pick_count, draft_json,
                  slot_to_roster_json, roster_names_json, roster_by_username_json, traded_pick_owner_json,
                  teams, rounds, timer_sec, reversal_round, league_id, league_name, league_avatar,
                  best_ball,
                  current_pick, current_owner_name, next_owner_name, clock_ends_at,
                  completed_at, updated_at
           FROM push_draft_registry
           WHERE draft_id IN (${Array.from({ length: count }, () => "?").join(",")})`;

    const out = {};
    let needsKick = false;

    const REGISTRY_READ_CHUNK_SIZE = 50;
    for (const idGroup of chunk(ids, REGISTRY_READ_CHUNK_SIZE)) {
      const rows = await db.prepare(selectSqlFor(idGroup.length)).bind(...idGroup).all();

      for (const r of rows?.results || []) {
      let draft = null;
      if (!lite) {
        try {
          draft = r.draft_json ? JSON.parse(r.draft_json) : null;
        } catch {
          draft = null;
        }
      }

      const storedStatus = String(r.status || "").toLowerCase().trim();
      const draftStatus = String(draft?.status || "").toLowerCase().trim();
      const effectiveStatus = lite
        ? (storedStatus || null)
        : storedStatus && storedStatus !== "unknown"
        ? storedStatus
        : (draftStatus || null);

      // Derive "active" if missing
      let active = safeNum(r.active) === 1;
      if (!activeOnly && !active) {
        // allow non-active drafts through in requested id mode
      }

      out[String(r.draft_id)] = {
        draftId: String(r.draft_id),
        active,
        status: effectiveStatus,
        lastPicked: r.last_picked == null ? null : Number(r.last_picked),
        pickCount: safeNum(r.pick_count) || 0,
        teams: safeNum(r.teams) || null,
        rounds: safeNum(r.rounds) || null,
        timerSec: safeNum(r.timer_sec) || null,
        reversalRound: safeNum(r.reversal_round) || null,
        leagueId: r.league_id || null,
        leagueName: r.league_name || null,
        leagueAvatar: r.league_avatar || null,
        bestBall: safeNum(r.best_ball) === 1,
        currentPick: r.current_pick == null ? null : Number(r.current_pick),
        currentOwnerName: r.current_owner_name || null,
        nextOwnerName: r.next_owner_name || null,
        clockEndsAt: r.clock_ends_at == null ? null : Number(r.clock_ends_at),
        draft,
        // parsed maps (used by UI)
        slotToRoster: safeJsonParse(r.slot_to_roster_json) || {},
        rosterNames: safeJsonParse(r.roster_names_json) || {},
        rosterByUsername: safeJsonParse(r.roster_by_username_json) || {},
        tradedPickOwner: safeJsonParse(r.traded_pick_owner_json) || {},
        // timestamps
        completedAt: r.completed_at == null ? null : Number(r.completed_at),
        updatedAt: r.updated_at == null ? null : Number(r.updated_at),
      };

      // If not hydrated yet, kick the DO so the UI fills in quickly.
      if (
        (!lite && !r?.draft_json) ||
        !String(effectiveStatus || "").trim() ||
        !r?.roster_names_json ||
        ["null", "{}", "[]"].includes(String(r.roster_names_json)) ||
        !r?.slot_to_roster_json ||
        ["null", "{}", "[]"].includes(String(r.slot_to_roster_json))
      ) {
        needsKick = true;
      }
      }
    }

    if (needsKick) {
      // Never block the UI on a DO tick.
      // A tick can fan out to many Sleeper calls + D1 writes and take 10-30s.
      try {
        ctx.waitUntil(kickDraftRegistry(env));
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ ok: true, drafts: out });
  } catch (e) {
    return new NextResponse(e?.message || "Registry read failed", { status: 500 });
  }
}

// POST: register user drafts into the registry (so DO knows what to keep fresh).
export async function POST(req) {
  try {
    const { env } = getRequestContext();
    const db = getDb(env);
    if (!db?.prepare) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing D1 binding: PUSH_DB",
        },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    const username = String(body?.username || "").trim();
    const draftIds = Array.isArray(body?.draftIds) ? body.draftIds : [];
    const leagueIds = Array.isArray(body?.leagueIds) ? body.leagueIds : [];

    // store minimal mapping for discover/registry (idempotent)
    // NOTE: DO will hydrate details.
    const now = Date.now();

    // Ensure table exists (cheap)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS push_user_drafts (
          username TEXT PRIMARY KEY,
          draft_ids_json TEXT,
          league_ids_json TEXT,
          updated_at INTEGER
        )`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO push_user_drafts (username, draft_ids_json, league_ids_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
          draft_ids_json=excluded.draft_ids_json,
          league_ids_json=excluded.league_ids_json,
          updated_at=excluded.updated_at`
      )
      .bind(username, JSON.stringify(draftIds || []), JSON.stringify(leagueIds || []), now)
      .run();

    // Nudge the DO to tick soon.
    await kickDraftRegistry(env);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e?.message || "Registry register failed", { status: 500 });
  }
}
