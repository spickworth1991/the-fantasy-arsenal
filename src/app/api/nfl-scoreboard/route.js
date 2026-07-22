import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season") || String(new Date().getFullYear());
  const week = searchParams.get("week") || "1";
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${encodeURIComponent(season)}&seasontype=2&week=${encodeURIComponent(week)}`, { next:{ revalidate:300 } });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    const games = (payload.events || []).map((event) => ({
      id:event.id,
      date:event.date,
      name:event.name,
      status:event.status?.type?.shortDetail || event.status?.type?.description || "Scheduled",
      teams:(event.competitions?.[0]?.competitors || []).map((row) => row.team?.abbreviation).filter(Boolean),
    }));
    return NextResponse.json({ games });
  } catch {
    return NextResponse.json({ games:[] }, { status:200 });
  }
}
