export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, authenticateArsenal, ensureArsenalSchema, publicAccount, publicProfile } from "../../../../lib/arsenalAccountServer";

const number = (value) => Number(value || 0);
const getJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal:controller.signal });
    if (!response.ok) throw new Error(`Sleeper HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
};

export async function GET() {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const season = new Date().getUTCFullYear();
    const rows = await db.prepare(`SELECT * FROM arsenal_accounts
      WHERE leaderboard_visible=1 AND profile_public=1
      ORDER BY CASE WHEN record_season=? THEN 0 ELSE 1 END,
      ((record_wins + record_ties * 0.5) * 1.0 / MAX(1, record_wins + record_losses + record_ties)) DESC,
      record_wins DESC, record_points_for DESC LIMIT 250`).bind(season).all();
    return NextResponse.json({
      ok:true,
      season,
      accounts:(rows?.results || []).map((row) => {
        const profile = publicProfile(row);
        if (Number(row.record_season) === season) return profile;
        return {
          ...profile,
          record:{ season, wins:0, losses:0, ties:0, pointsFor:0, leagues:0, updatedAt:0 },
        };
      }),
    });
  } catch (error) {
    return new NextResponse(error?.message || "Leaderboard unavailable.", { status:503 });
  }
}

export async function POST(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Sign in to refresh your verified record.", { status:401 });
    const season = new Date().getUTCFullYear();
    const sleeper = await getJson(`https://api.sleeper.app/v1/user/${encodeURIComponent(account.sleeper_username)}`);
    const leagues = await getJson(`https://api.sleeper.app/v1/user/${sleeper.user_id}/leagues/nfl/${season}`);
    let wins=0, losses=0, ties=0, pointsFor=0, leagueCount=0;
    for (let start=0; start<(leagues || []).length; start+=12) {
      const group=(leagues || []).slice(start,start+12);
      const rosterGroups=await Promise.all(group.map((league)=>getJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(()=>[])));
      rosterGroups.forEach((rosters)=>{
        const roster=(rosters || []).find((row)=>String(row.owner_id)===String(sleeper.user_id));
        if(!roster)return;
        const settings=roster.settings || {};
        wins+=number(settings.wins);
        losses+=number(settings.losses);
        ties+=number(settings.ties);
        pointsFor+=number(settings.fpts)+number(settings.fpts_decimal)/100;
        leagueCount+=1;
      });
    }
    const now=Date.now();
    await db.prepare(`UPDATE arsenal_accounts SET record_season=?, record_wins=?, record_losses=?, record_ties=?, record_points_for=?, record_leagues=?, record_updated_at=?, updated_at=? WHERE account_id=?`)
      .bind(season,wins,losses,ties,pointsFor,leagueCount,now,now,account.account_id).run();
    const updated=await db.prepare(`SELECT * FROM arsenal_accounts WHERE account_id=?`).bind(account.account_id).first();
    return NextResponse.json({ok:true,account:publicAccount(updated)});
  } catch (error) {
    return new NextResponse(error?.message || "Verified record could not be refreshed.", { status:500 });
  }
}
