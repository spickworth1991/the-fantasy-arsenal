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

const finiteNumber = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;

async function readSeasonArtifact(request, season, file) {
  const url = request.nextUrl.clone();
  url.pathname = `/stats/history/${season}/${file}.json`;
  url.search = "";
  url.hash = "";
  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function finalGameForLeg(schedule, leg, week) {
  const normalizeTeam = (value) =>
    String(value || "").toUpperCase() === "WAS"
      ? "WSH"
      : String(value || "").toUpperCase();
  const team = normalizeTeam(leg.team);
  const opponent = normalizeTeam(leg.opponent);
  return (schedule?.weeks || [])
    .find((row) => Number(row.week) === Number(week))
    ?.games?.find((game) => {
      const teams = [normalizeTeam(game.home), normalizeTeam(game.away)];
      return teams.includes(team) && (!opponent || teams.includes(opponent));
    });
}

function gradeLeg(leg, player, game) {
  if (!game?.completed && !String(game?.status || "").includes("FINAL"))
    return { result: "pending", actual: null };
  const stats = player?.weekly_stats?.[String(leg.week)];
  if (!stats) return { result: "pending", actual: null };
  const participation = finiteNumber(stats.gp ?? stats.gms_active);
  if (participation != null && participation <= 0)
    return { result: "void", actual: null };
  // Sleeper omits zero-valued counting fields from otherwise complete active
  // stat rows. Once the game is final and participation is confirmed, absence
  // of a supported prop field is therefore a real zero rather than missing data.
  const recorded = finiteNumber(stats[leg.stat_key]);
  const actual = recorded == null ? 0 : recorded;
  const line = Number(leg.line);
  const result = actual === line
    ? "push"
    : leg.direction === "over"
      ? actual > line ? "won" : "lost"
      : actual < line ? "won" : "lost";
  return { result, actual };
}

function ticketResult(legs) {
  if (!legs.length || legs.some((leg) => leg.result === "pending")) return "pending";
  if (legs.some((leg) => leg.result === "lost")) return "lost";
  if (legs.some((leg) => leg.result === "won")) return "won";
  if (legs.some((leg) => leg.result === "push")) return "push";
  return "void";
}

async function settleSavedTickets(request, db, tickets, legs, bets = []) {
  const seasons = [...new Set([...tickets, ...bets].map((row) => Number(row.season)).filter(Boolean))];
  const evidence = new Map();
  await Promise.all(seasons.map(async (season) => {
    const [history, schedule] = await Promise.all([
      readSeasonArtifact(request, season, "sleeper"),
      readSeasonArtifact(request, season, "schedule"),
    ]);
    if (Array.isArray(history?.players) && Array.isArray(schedule?.weeks)) {
      evidence.set(season, {
        players: new Map(history.players.map((player) => [String(player.player_id), player])),
        schedule,
      });
    }
  }));
  const ticketById = new Map(tickets.map((ticket) => [ticket.ticket_id, ticket]));
  const statements = [];
  for (const leg of legs) {
    const ticket = ticketById.get(leg.ticket_id);
    const seasonEvidence = evidence.get(Number(ticket?.season));
    if (!ticket || !seasonEvidence) continue;
    const game = finalGameForLeg(seasonEvidence.schedule, leg, ticket.week);
    const grade = gradeLeg(
      { ...leg, week: ticket.week },
      seasonEvidence.players.get(String(leg.player_id)),
      game,
    );
    // A temporarily unavailable or incomplete public stat row must never
    // erase a result that was already settled from stronger evidence.
    if (grade.result === "pending" && leg.result !== "pending") continue;
    if (grade.result !== leg.result || grade.actual !== finiteNumber(leg.actual)) {
      leg.result = grade.result;
      leg.actual = grade.actual;
      statements.push(db.prepare(`UPDATE arsenal_prop_ticket_legs
        SET result=?,actual=? WHERE ticket_id=? AND leg_index=?`)
        .bind(grade.result, grade.actual, leg.ticket_id, leg.leg_index));
    }
  }
  for (const bet of bets) {
    const seasonEvidence = evidence.get(Number(bet.season));
    if (!seasonEvidence) continue;
    const game = finalGameForLeg(seasonEvidence.schedule, bet, bet.week);
    const grade = gradeLeg(
      bet,
      seasonEvidence.players.get(String(bet.player_id)),
      game,
    );
    if (grade.result === "pending" && bet.result !== "pending") continue;
    if (grade.result !== bet.result || grade.actual !== finiteNumber(bet.actual)) {
      bet.result = grade.result;
      bet.actual = grade.actual;
      bet.settled_at = grade.result === "pending" ? null : Date.now();
      statements.push(db.prepare(`UPDATE arsenal_prop_bets
        SET result=?,actual=?,settled_at=? WHERE bet_id=?`)
        .bind(grade.result, grade.actual, bet.settled_at, bet.bet_id));
    }
  }
  const legsByTicket = new Map();
  for (const leg of legs) {
    if (!legsByTicket.has(leg.ticket_id)) legsByTicket.set(leg.ticket_id, []);
    legsByTicket.get(leg.ticket_id).push(leg);
  }
  for (const ticket of tickets) {
    const result = ticketResult(legsByTicket.get(ticket.ticket_id) || []);
    if (result !== ticket.result) {
      ticket.result = result;
      ticket.settled_at = result === "pending" ? null : Date.now();
      statements.push(db.prepare(`UPDATE arsenal_prop_tickets
        SET result=?,settled_at=? WHERE ticket_id=?`)
        .bind(result, ticket.settled_at, ticket.ticket_id));
    }
  }
  for (let index = 0; index < statements.length; index += 75)
    await db.batch(statements.slice(index, index + 75));
  return { tickets, legs, legsByTicket, bets };
}

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
    const settled = await settleSavedTickets(
      request,
      db,
      tickets.results || [],
      legs.results || [],
      rows.results || [],
    );
    return NextResponse.json({
      bets: settled.bets,
      tickets: settled.tickets.map((ticket) => ({
        ...ticket,
        legs: settled.legsByTicket.get(ticket.ticket_id) || [],
      })),
    });
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
