export const runtime = "edge";

import { NextResponse } from "next/server";

const fetchWeek = async (season, week) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`, {
      signal:controller.signal,
      cf:{ cacheTtl:86400, cacheEverything:true },
    });
    if (!response.ok) return { week, rows:{}, status:response.status };
    const rows = await response.json();
    return { week, rows:rows && typeof rows === "object" ? rows : {}, status:200 };
  } catch (error) {
    return { week, rows:{}, status:0, error:error?.name === "AbortError" ? "Timed out" : "Unavailable" };
  } finally {
    clearTimeout(timer);
  }
};

export async function GET(request) {
  const requested = Number(new URL(request.url).searchParams.get("season"));
  const current = new Date().getUTCFullYear();
  const season = Number.isInteger(requested) && requested >= 2018 && requested <= current ? requested : current - 1;
  const weeks = await Promise.all(Array.from({ length:18 }, (_, index) => fetchWeek(season, index + 1)));
  const successful = weeks.filter((row) => Object.keys(row.rows).length > 0);
  if (!successful.length) {
    return NextResponse.json({ ok:false, season, message:"Sleeper actual scoring was unavailable for every week.", weeks }, { status:502 });
  }
  const totals = {};
  successful.forEach((week) => {
    Object.entries(week.rows || {}).forEach(([playerId, row]) => {
      const stats = row?.stats && typeof row.stats === "object" ? row.stats : row;
      const currentStats = totals[playerId] || {};
      Object.entries(stats || {}).forEach(([key, value]) => {
        const number = Number(value);
        if (Number.isFinite(number)) currentStats[key] = Number(currentStats[key] || 0) + number;
      });
      totals[playerId] = currentStats;
    });
  });
  return NextResponse.json(
    {
      ok:true,
      season,
      completedWeeks:successful.length,
      partial:successful.length < 18,
      failedWeeks:weeks.filter((row) => !Object.keys(row.rows).length).map((row) => ({ week:row.week, status:row.status, error:row.error || "" })),
      totals,
    },
    { headers:{ "Cache-Control":"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
