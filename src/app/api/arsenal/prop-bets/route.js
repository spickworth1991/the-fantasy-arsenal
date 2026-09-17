export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  arsenalDb,
  authenticateArsenal,
  ensureArsenalSchema,
} from "../../../../lib/arsenalAccountServer";

async function ensurePropSchema(db) {
  await ensureArsenalSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_prop_bets (
    bet_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    kickoff TEXT,
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    team TEXT,
    opponent TEXT,
    stat_key TEXT NOT NULL,
    stat_label TEXT NOT NULL,
    direction TEXT NOT NULL,
    line REAL NOT NULL,
    model_projection REAL NOT NULL,
    model_probability REAL NOT NULL,
    model_fair_odds INTEGER NOT NULL,
    sportsbook_odds INTEGER,
    stake REAL NOT NULL DEFAULT 1,
    result TEXT NOT NULL DEFAULT 'pending',
    actual REAL,
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS arsenal_prop_bets_account
    ON arsenal_prop_bets(account_id, created_at DESC)`).run();
}

async function context(request) {
  const db = arsenalDb();
  await ensurePropSchema(db);
  const account = await authenticateArsenal(request, db);
  return { db, account };
}

const cleanResult = (value) =>
  ["pending", "won", "lost", "push", "void"].includes(value)
    ? value
    : "pending";

export async function GET(request) {
  try {
    const { db, account } = await context(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const rows = await db
      .prepare("SELECT * FROM arsenal_prop_bets WHERE account_id=? ORDER BY created_at DESC LIMIT 500")
      .bind(account.account_id)
      .all();
    return NextResponse.json({ bets: rows.results || [] });
  } catch (error) {
    return new NextResponse(error?.message || "Prop bets could not be loaded.", { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { db, account } = await context(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const body = await request.json();
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      season: Number(body.season), week: Number(body.week), gameKey: String(body.gameKey || ""),
      kickoff: String(body.kickoff || ""), playerId: String(body.playerId || ""),
      playerName: String(body.playerName || "").slice(0, 100), team: String(body.team || "").slice(0, 10),
      opponent: String(body.opponent || "").slice(0, 10), statKey: String(body.statKey || "").slice(0, 40),
      statLabel: String(body.statLabel || "").slice(0, 500), direction: body.direction === "sgx" ? "sgx" : body.direction === "under" ? "under" : "over",
      line: Number(body.line), projection: Number(body.projection), probability: Number(body.probability),
      fairOdds: Math.round(Number(body.fairOdds)), sportsbookOdds: body.sportsbookOdds == null || body.sportsbookOdds === "" ? null : Math.round(Number(body.sportsbookOdds)),
      stake: Math.max(0.01, Number(body.stake) || 1),
    };
    if (!row.playerId || !row.playerName || !row.statKey || !Number.isFinite(row.line) || !Number.isFinite(row.projection))
      return new NextResponse("Invalid prop bet.", { status: 400 });
    await db.prepare(`INSERT INTO arsenal_prop_bets
      (bet_id,account_id,season,week,game_key,kickoff,player_id,player_name,team,opponent,stat_key,stat_label,direction,line,model_projection,model_probability,model_fair_odds,sportsbook_odds,stake,result,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, account.account_id, row.season, row.week, row.gameKey, row.kickoff, row.playerId, row.playerName, row.team, row.opponent, row.statKey, row.statLabel, row.direction, row.line, row.projection, row.probability, row.fairOdds, row.sportsbookOdds, row.stake, "pending", now)
      .run();
    return NextResponse.json({ ok: true, betId: id });
  } catch (error) {
    return new NextResponse(error?.message || "Prop bet could not be saved.", { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { db, account } = await context(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const body = await request.json();
    const result = cleanResult(String(body.result || "pending"));
    const actual = body.actual == null || body.actual === "" ? null : Number(body.actual);
    await db.prepare(`UPDATE arsenal_prop_bets SET result=?,actual=?,sportsbook_odds=COALESCE(?,sportsbook_odds),stake=COALESCE(?,stake),settled_at=? WHERE bet_id=? AND account_id=?`)
      .bind(result, Number.isFinite(actual) ? actual : null, body.sportsbookOdds == null ? null : Math.round(Number(body.sportsbookOdds)), body.stake == null ? null : Math.max(0.01, Number(body.stake)), result === "pending" ? null : Date.now(), String(body.betId || ""), account.account_id)
      .run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return new NextResponse(error?.message || "Prop bet could not be updated.", { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { db, account } = await context(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const id = new URL(request.url).searchParams.get("id") || "";
    await db.prepare("DELETE FROM arsenal_prop_bets WHERE bet_id=? AND account_id=?").bind(id, account.account_id).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return new NextResponse(error?.message || "Prop bet could not be removed.", { status: 500 });
  }
}
