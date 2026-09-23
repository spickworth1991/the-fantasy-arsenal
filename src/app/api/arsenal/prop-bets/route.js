export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  arsenalDb,
  authenticateArsenal,
  ensureArsenalSchema,
} from "../../../../lib/arsenalAccountServer";

export async function ensurePropSchema(db) {
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_prop_tickets (
    ticket_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    recommendation_id TEXT,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    sportsbook TEXT,
    leg_count INTEGER NOT NULL,
    model_probability REAL NOT NULL,
    evidence_score REAL,
    sportsbook_odds INTEGER,
    stake REAL NOT NULL DEFAULT 10,
    result TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS arsenal_prop_tickets_account
    ON arsenal_prop_tickets(account_id, created_at DESC)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_prop_ticket_legs (
    ticket_id TEXT NOT NULL,
    leg_index INTEGER NOT NULL,
    prediction_id TEXT NOT NULL,
    event_id TEXT,
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
    evidence_score REAL,
    historical_sample INTEGER,
    sportsbook_odds INTEGER,
    model_version TEXT,
    captured_at TEXT,
    actual REAL,
    result TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY (ticket_id, leg_index)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_prop_recommendations (
    recommendation_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    ticket_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS arsenal_prop_recommendations_account
    ON arsenal_prop_recommendations(account_id, created_at DESC)`).run();
}

export async function propContext(request) {
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
    const { db, account } = await propContext(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const rows = await db
      .prepare("SELECT * FROM arsenal_prop_bets WHERE account_id=? ORDER BY created_at DESC LIMIT 500")
      .bind(account.account_id)
      .all();
    const tickets = await db.prepare("SELECT * FROM arsenal_prop_tickets WHERE account_id=? ORDER BY created_at DESC LIMIT 250").bind(account.account_id).all();
    const legs = await db.prepare(`SELECT l.* FROM arsenal_prop_ticket_legs l
      JOIN arsenal_prop_tickets t ON t.ticket_id=l.ticket_id WHERE t.account_id=? ORDER BY t.created_at DESC,l.leg_index`).bind(account.account_id).all();
    const legsByTicket = new Map();
    for (const leg of legs.results || []) {
      if (!legsByTicket.has(leg.ticket_id)) legsByTicket.set(leg.ticket_id, []);
      legsByTicket.get(leg.ticket_id).push(leg);
    }
    return NextResponse.json({ bets: rows.results || [], tickets: (tickets.results || []).map((ticket) => ({ ...ticket, legs: legsByTicket.get(ticket.ticket_id) || [] })) });
  } catch (error) {
    return new NextResponse(error?.message || "Prop bets could not be loaded.", { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { db, account } = await propContext(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const body = await request.json();
    const now = Date.now();
    const id = crypto.randomUUID();
    const legs = Array.isArray(body.legs) ? body.legs.slice(0, 25) : [];
    if (legs.length > 1) {
      const recommendationId = String(body.recommendationId || body.id || "").slice(0, 160) || null;
      const season = Number(body.season);
      const week = Number(body.week);
      const probability = Number(body.probability);
      const capturedAt = Date.parse(body.capturedAt || "");
      if (!Number.isFinite(capturedAt) || now - capturedAt < 0 || now - capturedAt > 30 * 60 * 1000)
        return new NextResponse("Refresh sportsbook data before saving this ticket.", { status: 409 });
      if (!Number.isFinite(season) || !Number.isFinite(week) || !Number.isFinite(probability) || legs.some((leg) => !leg.playerId || !leg.statKey || !["over", "under"].includes(leg.direction) || !Number.isFinite(Number(leg.line)) || Date.parse(leg.kickoff || "") <= now))
        return new NextResponse("Invalid structured prop ticket.", { status: 400 });
      const ticketStatements = [db.prepare(`INSERT INTO arsenal_prop_tickets
        (ticket_id,account_id,recommendation_id,season,week,sportsbook,leg_count,model_probability,evidence_score,sportsbook_odds,stake,result,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, account.account_id, recommendationId, season, week, String(body.sportsbook || "DraftKings").slice(0, 40), legs.length, probability, Number(body.evidenceScore || 0), body.actualTicketOdds == null || body.actualTicketOdds === "" ? null : Math.round(Number(body.actualTicketOdds)), Math.max(0.01, Number(body.stake) || 10), "pending", now)];
      legs.forEach((leg, index) => ticketStatements.push(db.prepare(`INSERT INTO arsenal_prop_ticket_legs
        (ticket_id,leg_index,prediction_id,event_id,kickoff,player_id,player_name,team,opponent,stat_key,stat_label,direction,line,model_projection,model_probability,evidence_score,historical_sample,sportsbook_odds,model_version,captured_at,result)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, index, String(leg.id || "").slice(0, 160), String(leg.eventId || "").slice(0, 100), String(leg.kickoff || ""), String(leg.playerId), String(leg.playerName || "").slice(0, 100), String(leg.team || "").slice(0, 10), String(leg.opponent || "").slice(0, 10), String(leg.statKey).slice(0, 40), String(leg.statLabel || "").slice(0, 80), leg.direction, Number(leg.line), Number(leg.projection || 0), Number(leg.probability || 0), Number(leg.evidenceScore || 0), Number(leg.historicalSample || 0), Number(leg.sportsbookOdds || 0), String(leg.modelVersion || body.modelVersion || "").slice(0, 80), String(leg.capturedAt || body.capturedAt || ""), "pending")));
      await db.batch(ticketStatements);
      return NextResponse.json({ ok: true, ticketId: id });
    }
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
    const { db, account } = await propContext(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const body = await request.json();
    const result = cleanResult(String(body.result || "pending"));
    const actual = body.actual == null || body.actual === "" ? null : Number(body.actual);
    const ticketId = String(body.ticketId || "");
    if (ticketId) {
      await db.prepare(`UPDATE arsenal_prop_tickets SET result=?,sportsbook_odds=COALESCE(?,sportsbook_odds),stake=COALESCE(?,stake),settled_at=? WHERE ticket_id=? AND account_id=?`)
        .bind(result, body.sportsbookOdds == null ? null : Math.round(Number(body.sportsbookOdds)), body.stake == null ? null : Math.max(0.01, Number(body.stake)), result === "pending" ? null : Date.now(), ticketId, account.account_id).run();
      return NextResponse.json({ ok: true });
    }
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
    const { db, account } = await propContext(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const id = new URL(request.url).searchParams.get("id") || "";
    await db.prepare("DELETE FROM arsenal_prop_ticket_legs WHERE ticket_id IN (SELECT ticket_id FROM arsenal_prop_tickets WHERE ticket_id=? AND account_id=?)").bind(id, account.account_id).run();
    await db.prepare("DELETE FROM arsenal_prop_tickets WHERE ticket_id=? AND account_id=?").bind(id, account.account_id).run();
    await db.prepare("DELETE FROM arsenal_prop_bets WHERE bet_id=? AND account_id=?").bind(id, account.account_id).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return new NextResponse(error?.message || "Prop bet could not be removed.", { status: 500 });
  }
}
