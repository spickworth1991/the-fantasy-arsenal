import { NextResponse } from "next/server";

export const runtime = "edge";

const POSITIONS = new Set(["ALL","QB","RB","WR","TE","K","DST","DL","LB","DB"]);
const SCORING = new Set(["STD","HALF","PPR"]);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

async function readSaved(requestUrl, path) {
  const url = new URL(path, requestUrl.origin);
  const response = await fetch(url, {
    cf:{ cacheTtl:31536000, cacheEverything:true },
    cache:"force-cache",
  });
  if (!response.ok) return null;
  return response.json();
}

export async function GET(request) {
  const url = new URL(request.url);
  const currentSeason = new Date().getUTCFullYear();
  const requestedSeason = number(url.searchParams.get("season"));
  const season = requestedSeason >= 2012 && requestedSeason <= currentSeason ? requestedSeason : currentSeason - 1;
  const scoringCandidate = String(url.searchParams.get("scoring") || "PPR").toUpperCase();
  const scoring = SCORING.has(scoringCandidate) ? scoringCandidate : "PPR";
  const positionCandidate = String(url.searchParams.get("position") || "ALL").toUpperCase();
  const position = POSITIONS.has(positionCandidate) ? positionCandidate : "ALL";
  const [fantasyPros, sleeper] = await Promise.all([
    readSaved(url, `/stats/history/${season}/fantasypros.json`),
    readSaved(url, `/stats/history/${season}/sleeper.json`),
  ]);
  const fantasyProsPlayers = (Array.isArray(fantasyPros?.players) ? fantasyPros.players : [])
    .filter((player) => position === "ALL" || String(player?.position || "").toUpperCase() === position)
    .map((player) => {
      const values = player?.scoring?.[scoring.toLowerCase()] || {};
      return {
        player_id:player.player_id,
        name:player.name,
        position:player.position,
        team:player.team,
        games:number(values.games),
        points:number(values.points),
        average:number(values.average),
        weeks:values.weeks && typeof values.weeks === "object" ? values.weeks : {},
      };
    })
    .filter((player) => player.games > 0);
  const sleeperPlayers = (Array.isArray(sleeper?.players) ? sleeper.players : []).map((player) => {
    const field = scoring === "STD" ? "std" : scoring === "HALF" ? "half" : "ppr";
    const weeks = Object.fromEntries(Object.entries(player?.weeks || {}).map(([week, points]) => [week, number(points?.[field])]));
    const values = Object.values(weeks).filter((value) => value !== 0);
    const points = values.reduce((sum, value) => sum + value, 0);
    return {
      ...player,
      weeks,
      games:values.length,
      points:Number(points.toFixed(3)),
      average:values.length ? Number((points / values.length).toFixed(3)) : 0,
    };
  });

  if (!fantasyProsPlayers.length && !sleeperPlayers.length) {
    return NextResponse.json({
      ok:false,
      season,
      scoring,
      position,
      message:`Saved ${season} historical data is not available yet. Run npm run update:stats to build it.`,
    }, { status:404 });
  }

  return NextResponse.json({
    ok:true,
    season,
    scoring,
    position,
    source:fantasyProsPlayers.length ? "Saved FantasyPros + Sleeper" : "Saved Sleeper fallback",
    fantasypros:{
      available:fantasyProsPlayers.length > 0,
      error:fantasyPros?.error || "",
      updated:fantasyPros?.updated || null,
      players:fantasyProsPlayers,
    },
    sleeper:{
      available:sleeperPlayers.length > 0,
      updated:sleeper?.updated || null,
      players:sleeperPlayers,
    },
    methodology:{
      fantasypros:"Saved official historical fantasy points, games, averages, and weekly scoring.",
      sleeper:"Saved weekly raw NFL statistics and scoring fields, keyed by Sleeper player ID.",
      retrieval:"Visitors read static Arsenal files. No user request calls FantasyPros or consumes API quota.",
    },
  }, {
    headers:{ "Cache-Control":"public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800" },
  });
}
