const number = (value) => Number(value || 0);

export function normalizeNflSeasonType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "pre" || type === "preseason" || type === "1") return "preseason";
  if (type === "post" || type === "postseason" || type === "3") return "postseason";
  return "regular";
}

export function fantasyWeekFromNflState(state, fallback = 1) {
  const seasonType = normalizeNflSeasonType(state?.season_type ?? state?.seasonType);
  if (seasonType === "preseason") return 1;
  return Math.max(1, Math.min(18, number(state?.week) || number(fallback) || 1));
}

export function nflWeekContext(state, fallback = 1) {
  const seasonType = normalizeNflSeasonType(state?.season_type ?? state?.seasonType);
  const nflWeek = Math.max(1, number(state?.week) || 1);
  const fantasyWeek = fantasyWeekFromNflState(state, fallback);
  return {
    seasonType,
    nflWeek,
    fantasyWeek,
    label: seasonType === "preseason" ? `Preseason Week ${nflWeek}` : `Week ${fantasyWeek}`,
  };
}
