// src/app/api/player-stock/route.js
import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username");
    const year = searchParams.get("year") || new Date().getFullYear().toString();

    // optional filters, mutually exclusive
    const onlyBestBall = searchParams.get("only_bestball") === "1";
    const excludeBestBall = searchParams.get("exclude_bestball") === "1";

    if (!username) {
      return NextResponse.json({ error: "Missing username" }, { status: 400 });
    }

    // 1) user lookup
    const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
    if (!userRes.ok) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const user = await userRes.json();
    const userId = user.user_id;

    // 2) user leagues
    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${year}`
    );
    const leagues = await leaguesRes.json();

    // filter (mirror original)
    const filteredLeagues = leagues.filter((league) => {
      // you can loosen this if you also want pre-season:
      if (league.status !== "in_season") return false;
      const isBestBall = league?.settings?.best_ball === 1;
      if (onlyBestBall && !isBestBall) return false;
      if (excludeBestBall && isBestBall) return false;
      return true;
    });

    // 3) players catalog (for names/positions/teams)
    const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
    const playersData = await playersRes.json();

    // 4) count how many leagues you roster each player
    const playerCounts = {};
    const playerLeagues = {};

    for (const league of filteredLeagues) {
      const rosterRes = await fetch(
        `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
      );
      const rosters = await rosterRes.json();

      const myRoster = rosters.find((r) => r.owner_id === userId);
      if (!myRoster?.players) continue;

      const starters = new Set(myRoster.starters || []);

      for (const pid of myRoster.players) {
        playerCounts[pid] = (playerCounts[pid] || 0) + 1;

        if (!playerLeagues[pid]) playerLeagues[pid] = [];
        playerLeagues[pid].push({
          id: league.league_id,
          name: league.name,
          isStarter: starters.has(pid),
        });
      }
    }

    // 5) shape response (sorted desc by count)
    const players = Object.entries(playerCounts)
      .map(([pid, count]) => {
        const leagues = playerLeagues[pid] || [];
        const p = playersData?.[pid] || null;

        return {
          player_id: pid,
          count,
          name: p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`.trim() || "Unknown",
          team: (p?.team || "").toUpperCase(),
          position: (p?.position || "").toUpperCase(),
          avatar: p?.avatar || null,
          leagues, // [{ id, name, isStarter }]
        };
      })
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      leagueCount: filteredLeagues.length,
      players,
    });
  } catch (err) {
    console.error("player-stock error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
