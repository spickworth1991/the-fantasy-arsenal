export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, arsenalEnv, authenticateArsenal, ensureArsenalSchema, publicAccount, publicProfile } from "../../../../lib/arsenalAccountServer";

const number = (value) => Number(value || 0);
const json = (value, fallback) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const ownsRoster = (roster, userId) => String(roster?.owner_id || "") === String(userId)
  || (Array.isArray(roster?.co_owners) && roster.co_owners.some((ownerId) => String(ownerId) === String(userId)));
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const getJson = async (url, attempts = 3) => {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(`Sleeper HTTP ${response.status}`);
      if (!retryable || attempt === attempts - 1) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    } finally {
      clearTimeout(timer);
    }
    await pause(180 * (attempt + 1));
  }
  throw lastError || new Error("Sleeper request failed.");
};

// Public leaderboard members have already opted into record visibility. Their
// Sleeper record is public data, so refresh it server-side rather than making
// the person sign in again just to keep the board current.
const refreshVerifiedRecord = async (db, account, season) => {
  const sleeper = await getJson(
    `https://api.sleeper.app/v1/user/${encodeURIComponent(account.sleeper_username)}`,
  );
  const leagues = await getJson(
    `https://api.sleeper.app/v1/user/${sleeper.user_id}/leagues/nfl/${season}`,
  );
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointsFor = 0;
  let leagueCount = 0;
  // Sleeper throttles a high fan-out portfolio scan. Four concurrent roster
  // requests stays below that limit; critically, a failed scan is never saved
  // as a fake 0-0 record.
  for (let start = 0; start < (leagues || []).length; start += 4) {
    const group = (leagues || []).slice(start, start + 4);
    const rosterGroups = await Promise.all(
      group.map((league) =>
        getJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
      ),
    );
    rosterGroups.forEach((rosters) => {
      const roster = (rosters || []).find((row) => ownsRoster(row, sleeper.user_id));
      if (!roster) return;
      const settings = roster.settings || {};
      wins += number(settings.wins);
      losses += number(settings.losses);
      ties += number(settings.ties);
      pointsFor += number(settings.fpts) + number(settings.fpts_decimal) / 100;
      leagueCount += 1;
    });
  }
  const now = Date.now();
  // The scheduled leaderboard refresh is also the authoritative daily source
  // for current-season Career & badges progress. Preserve historical scans and
  // every earned badge; only reconcile the season that was just refreshed.
  const career = json(account.career_json, {}) || {};
  const years = Array.isArray(career.years) ? [...career.years] : [];
  let currentYear = years.find((year) => number(year?.season) === number(season));
  if (!currentYear) {
    currentYear = { season, wins: 0, losses: 0, ties: 0, points: 0, leagues: 0, championships: 0, playoffs: 0 };
    years.push(currentYear);
  }
  const oldWins = number(currentYear.wins), oldLosses = number(currentYear.losses), oldTies = number(currentYear.ties);
  const oldLeagueCount = number(currentYear.leagues), oldPoints = number(currentYear.points);
  currentYear.wins = wins;
  currentYear.losses = losses;
  currentYear.ties = ties;
  currentYear.points = pointsFor;
  currentYear.leagues = leagueCount;
  const nextCareer = {
    ...career,
    updatedAt: now,
    seasons: Math.max(number(career.seasons), years.length),
    leagueSeasons: Math.max(0, number(career.leagueSeasons) - oldLeagueCount) + leagueCount,
    wins: Math.max(0, number(career.wins) - oldWins + wins),
    losses: Math.max(0, number(career.losses) - oldLosses + losses),
    ties: Math.max(0, number(career.ties) - oldTies + ties),
    points: Math.max(0, number(career.points) - oldPoints) + pointsFor,
    years,
  };
  const priorBadges = json(account.badges_json, []) || [];
  const badgeKeys = new Set(priorBadges.map((badge) => badge?.key));
  const addBadge = (badge) => { if (!badgeKeys.has(badge.key)) { priorBadges.push(badge); badgeKeys.add(badge.key); } };
  if (nextCareer.wins >= 100) addBadge({ key:"century-club", label:"Century Club", reason:`${nextCareer.wins} verified career wins found.`, verified:true, visible:true, tier:"gold" });
  if (nextCareer.wins >= 500) addBadge({ key:"five-hundred", label:"The 500 Club", reason:`${nextCareer.wins} verified career wins found.`, verified:true, visible:true, tier:"mythic" });
  await db
    .prepare(
      `UPDATE arsenal_accounts SET record_season=?, record_wins=?, record_losses=?, record_ties=?, record_points_for=?, record_leagues=?, record_updated_at=?, career_json=?, badges_json=?, updated_at=? WHERE account_id=?`,
    )
    .bind(
      season,
      wins,
      losses,
      ties,
      pointsFor,
      leagueCount,
      now,
      JSON.stringify(nextCareer),
      JSON.stringify(priorBadges),
      now,
      account.account_id,
    )
    .run();
};

const leaderboardRows = async (db, season) =>
  db
    .prepare(`SELECT * FROM arsenal_accounts
      WHERE leaderboard_visible=1 AND profile_public=1
      ORDER BY CASE WHEN record_season=? THEN 0 ELSE 1 END,
      ((record_wins + record_ties * 0.5) * 1.0 / MAX(1, record_wins + record_losses + record_ties)) DESC,
      record_wins DESC, record_points_for DESC LIMIT 250`)
    .bind(season)
    .all();

const refreshableAccounts = async (db) =>
  db.prepare(`SELECT * FROM arsenal_accounts
    WHERE sleeper_username IS NOT NULL AND TRIM(sleeper_username)<>''`).all();

export async function GET(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const season = new Date().getUTCFullYear();
    const initial = await leaderboardRows(db, season);
    const weeklyRefresh =
      new URL(request.url).searchParams.get("refresh") === "weekly";
    if (
      weeklyRefresh &&
      request.headers.get("authorization") !==
        `Bearer ${arsenalEnv().DIGEST_CRON_SECRET}`
    )
      return new NextResponse("Unauthorized.", { status: 401 });
    const refreshAfter = 6 * 60 * 60 * 1000;
    const candidates = (weeklyRefresh ? (await refreshableAccounts(db))?.results || [] : initial?.results || [])
      .filter(
        (row) =>
          weeklyRefresh ||
          Number(row.record_season) !== season ||
          Date.now() - Number(row.record_updated_at || 0) > refreshAfter,
      );
    // Public page loads only repair a few stale rows. The protected Tuesday
    // job intentionally refreshes every opted-in profile after MNF.
    const stale = weeklyRefresh ? candidates : candidates.slice(0, 4);
    let refreshed = 0;
    let refreshFailed = 0;
    // Refresh accounts one at a time. Each account can have hundreds of
    // leagues, and parallel portfolios cause Sleeper to rate-limit all of
    // them at once.
    for (const account of stale) {
      try {
        await refreshVerifiedRecord(db, account, season);
        refreshed += 1;
      } catch {
        refreshFailed += 1;
      }
    }
    const rows = stale.length ? await leaderboardRows(db, season) : initial;
    return NextResponse.json({
      ok:true,
      season,
      weeklyRefresh,
      refreshed,
      refreshFailed,
      accounts:(rows?.results || []).map((row) => {
        const profile = publicProfile(row);
        return profile;
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
    await refreshVerifiedRecord(db, account, season);
    const updated=await db.prepare(`SELECT * FROM arsenal_accounts WHERE account_id=?`).bind(account.account_id).first();
    return NextResponse.json({ok:true,account:publicAccount(updated)});
  } catch (error) {
    return new NextResponse(error?.message || "Verified record could not be refreshed.", { status:500 });
  }
}
