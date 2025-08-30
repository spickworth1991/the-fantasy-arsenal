// src/utils/byes.js
import byes2025 from "../../public/byes/2025.json";

/** Get bye week number for a team abbreviation (ARI, BUF, etc.) */
export function getTeamBye(team, season = "2025") {
  const data = season === "2025" ? byes2025 : null;
  if (!data) return null;
  return data.by_team?.[team] ? data.by_team[team][0] : null;
}

/** True if team is on bye that week */
export function isTeamOnBye(team, week, season = "2025") {
  const bye = getTeamBye(team, season);
  return bye === week;
}

/** Zero out players on bye */
export function filterByePlayers(players, week, season = "2025") {
  return players.filter(p => !isTeamOnBye(p.team, week, season));
}

/** Bye-aware points sum */
export function byeAwareTotal(players, week, season = "2025") {
  return players.reduce((sum, p) => {
    if (isTeamOnBye(p.team, week, season)) return sum;
    return sum + (p.proj ?? p.points ?? 0);
  }, 0);
}
