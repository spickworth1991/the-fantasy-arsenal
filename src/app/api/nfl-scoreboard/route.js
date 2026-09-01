import { NextResponse } from "next/server";
import stadiumData from "../../../data/nfl-stadiums.json";

export const runtime = "edge";

const stadiumByTeam = new Map(
  stadiumData.stadiums.flatMap((stadium) =>
    [...stadium.teams, ...(stadium.aliases || [])].map((team) => [team, stadium])
  )
);

function weatherSummary(code) {
  if (code === 0) return "Clear";
  if ([1, 2].includes(code)) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Forecast available";
}

function nearestForecast(hourly, kickoff) {
  if (!hourly?.time?.length || !kickoff) return null;
  const target = new Date(kickoff).getTime();
  let bestIndex = -1;
  let bestDistance = Infinity;
  hourly.time.forEach((time, index) => {
    const distance = Math.abs(new Date(`${time}Z`).getTime() - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  if (bestIndex < 0 || bestDistance > 90 * 60 * 1000) return null;
  return {
    source:"open-meteo",
    summary:weatherSummary(Number(hourly.weather_code?.[bestIndex])),
    temperature:Number(hourly.temperature_2m?.[bestIndex]),
    feelsLike:Number(hourly.apparent_temperature?.[bestIndex]),
    precipitationProbability:Number(hourly.precipitation_probability?.[bestIndex]),
    precipitation:Number(hourly.precipitation?.[bestIndex]),
    windSpeed:Number(hourly.wind_speed_10m?.[bestIndex]),
    windGusts:Number(hourly.wind_gusts_10m?.[bestIndex]),
    forecastTime:hourly.time[bestIndex],
  };
}

async function addForecasts(games) {
  const candidates = games.filter((game) => {
    const daysAway = (new Date(game.date).getTime() - Date.now()) / 86400000;
    return game.stadium && game.stadium.roofType !== "fixed" && daysAway >= -1 && daysAway <= 16;
  });
  if (!candidates.length) return games;

  const latitude = candidates.map((game) => game.stadium.latitude).join(",");
  const longitude = candidates.map((game) => game.stadium.longitude).join(",");
  const params = new URLSearchParams({
    latitude,
    longitude,
    hourly:"temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
    temperature_unit:"fahrenheit",
    wind_speed_unit:"mph",
    precipitation_unit:"inch",
    timezone:"GMT",
    forecast_days:"16",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { next:{ revalidate:1800 } });
    if (!response.ok) return games;
    const payload = await response.json();
    const forecasts = Array.isArray(payload) ? payload : [payload];
    const forecastById = new Map(
      candidates.map((game, index) => [game.id, nearestForecast(forecasts[index]?.hourly, game.date)])
    );
    return games.map((game) => {
      const forecast = forecastById.get(game.id);
      return forecast ? { ...game, weather:forecast } : game;
    });
  } catch {
    return games;
  }
}

async function fetchEspnScoreboard({ season, seasonTypeCode, week }) {
  const query = `limit=100&dates=${encodeURIComponent(season)}&seasontype=${seasonTypeCode}&week=${encodeURIComponent(week)}`;
  const endpoints = [
    ["espn-site-web", `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${query}`],
    ["espn-site", `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${query}`],
    ["espn-cdn", `https://cdn.espn.com/core/nfl/scoreboard?xhr=1&${query}`],
  ];
  let emptyPayload = null;
  let lastStatus = 0;
  for (const [source, url] of endpoints) {
    try {
      const response = await fetch(url, {
        cache:"no-store",
        headers:{ accept:"application/json" },
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const rawPayload = await response.json();
      const events = Array.isArray(rawPayload?.events)
        ? rawPayload.events
        : rawPayload?.content?.sbData?.events;
      if (!Array.isArray(events)) continue;
      const payload = events === rawPayload.events ? rawPayload : { ...rawPayload, events };
      if (events.length) return { payload, source };
      emptyPayload = { payload, source };
    } catch {}
  }
  if (emptyPayload) return emptyPayload;
  throw new Error(`ESPN scoreboard unavailable${lastStatus ? ` (HTTP ${lastStatus})` : ""}`);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season") || String(new Date().getFullYear());
  const week = searchParams.get("week") || "1";
  const requestedSeasonType = String(searchParams.get("seasonType") || "regular").toLowerCase();
  const seasonTypeCode = requestedSeasonType === "preseason" || requestedSeasonType === "pre" || requestedSeasonType === "1"
    ? 1
    : requestedSeasonType === "postseason" || requestedSeasonType === "post" || requestedSeasonType === "3"
      ? 3
      : 2;
  const seasonType = seasonTypeCode === 1 ? "preseason" : seasonTypeCode === 3 ? "postseason" : "regular";
  try {
    const { payload, source } = await fetchEspnScoreboard({ season, seasonTypeCode, week });
    const matchingEvents = (payload.events || []).filter((event) => {
      const returnedType = Number(event?.season?.type || 0);
      return returnedType ? returnedType === seasonTypeCode : true;
    });
    const games = matchingEvents.map((event) => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      const weather = competition.weather || null;
      const venue = competition.venue || {};
      const homeTeam = competitors.find((row) => row.homeAway === "home")?.team?.abbreviation;
      const stadium = stadiumByTeam.get(homeTeam) || null;
      const venueName = venue.fullName || stadium?.name || "";
      const regularHomeVenue = !venue.fullName || !stadium || venue.fullName.toLowerCase() === stadium.name.toLowerCase();
      const activeStadium = regularHomeVenue ? stadium : null;
      return {
        id:event.id,
        season:Number(event.season?.year || season),
        seasonTypeCode:Number(event.season?.type || seasonTypeCode),
        week:Number(event.week?.number || week),
        date:event.date,
        name:event.name,
        status:event.status?.type?.shortDetail || event.status?.type?.description || "Scheduled",
        statusState:event.status?.type?.state || "pre",
        period:Number(event.status?.period || 0),
        clock:event.status?.displayClock || "",
        teams:competitors.map((row) => row.team?.abbreviation).filter(Boolean),
        competitors:competitors.map((row) => ({
          team:row.team?.abbreviation || "",
          name:row.team?.displayName || row.team?.shortDisplayName || "",
          homeAway:row.homeAway || "",
          score:Number(row.score || 0),
          winner:Boolean(row.winner),
        })),
        venue:{
          name:venueName,
          city:venue.address?.city || activeStadium?.city || "",
          state:venue.address?.state || activeStadium?.state || "",
          indoor:activeStadium?.roofType === "fixed" || Boolean(venue.indoor),
          roofType:activeStadium?.roofType || (venue.indoor ? "fixed" : "unknown"),
        },
        stadium:activeStadium,
        weather:weather ? {
          source:"espn",
          summary:weather.displayValue || weather.conditionId || "Forecast available",
          temperature:Number.isFinite(Number(weather.temperature)) ? Number(weather.temperature) : null,
          highTemperature:Number.isFinite(Number(weather.highTemperature)) ? Number(weather.highTemperature) : null,
        } : null,
      };
    });
    const returnedSeasonTypeCode = Number(games[0]?.seasonTypeCode || seasonTypeCode);
    const returnedSeasonType = returnedSeasonTypeCode === 1 ? "preseason" : returnedSeasonTypeCode === 3 ? "postseason" : "regular";
    const returnedWeek = Number(games[0]?.week || week);
    const returnedSeason = Number(games[0]?.season || season);
    return NextResponse.json(
      { season:returnedSeason, week:returnedWeek, seasonType:returnedSeasonType, seasonTypeCode:returnedSeasonTypeCode, requested:{ season:Number(season), week:Number(week), seasonType }, source, games:await addForecasts(games) },
      { headers:{ "Cache-Control":"no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { season:Number(season), week:Number(week), seasonType, seasonTypeCode, source:"unavailable", error:error?.message || "NFL scoreboard unavailable", games:[] },
      { status:200, headers:{ "Cache-Control":"no-store, max-age=0" } },
    );
  }
}
