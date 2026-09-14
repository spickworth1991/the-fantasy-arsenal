// Projection horizon is independent of source and scoring. A weekly feed must
// never replace a season feed, and a season total must never be used as a week.
const finite = (value) => {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const firstNumber = (...values) => values.map(finite).find((value) => value != null) ?? null;

export function projectionPoints(row, scoring = "ppr", position = "") {
  if (!row) return null;
  const ppr = firstNumber(row.points_ppr, row.pointsPpr, row.ppr, row.points, row.pts);
  const half = firstNumber(row.points_half, row.pointsHalf, row.points_half_ppr, row.half_ppr);
  const standard = firstNumber(row.points_std, row.pointsStd, row.points_standard, row.standard);
  if (scoring === "std") return standard;
  if (scoring === "half") return half;
  if (scoring === "tep") {
    const tep = firstNumber(row.points_tep, row.pointsTep);
    if (tep != null) return tep;
    if (String(position).toUpperCase() === "TE") {
      // PPR - half PPR is half a point per reception, the usual TEP bonus.
      return ppr != null && half != null ? ppr + (ppr - half) : null;
    }
  }
  return ppr;
}

export function projectionWeeks(row, explicitWeek = null) {
  if (Array.isArray(row?.weeks)) return row.weeks;
  if (row?.weekly && typeof row.weekly === "object") {
    return Object.entries(row.weekly).map(([week, points]) => ({ ...points, week: Number(week) }));
  }
  return explicitWeek != null ? [{ ...row, week: Number(explicitWeek) }] : [];
}

export function isWeeklyProjectionFeed(data) {
  return data?.projection_contract === "explicit_week" ||
    (Number(data?.week) > 0 && !Array.isArray(data?.weeks_requested));
}

export function resolveWeeklyProjection({
  row, week, scoring = "ppr", position = "", seasonPoints = null,
  byeWeeks = [], season = null, dataSeason = null,
}) {
  const unavailable = { points: null, basis: "unavailable" };
  const requestedWeek = Number(week);
  if (!Number.isInteger(requestedWeek) || requestedWeek < 1 || requestedWeek > 18) return unavailable;
  if (season != null && dataSeason != null && Number(season) !== Number(dataSeason)) return unavailable;
  const weeks = projectionWeeks(row);
  const current = weeks.find((entry) => Number(entry.week) === requestedWeek);
  const byes = [...new Set(byeWeeks.map(Number).filter((value) => value >= 1 && value <= 18))];
  if (current?.bye || byes.includes(requestedWeek)) return { points: 0, basis: "bye" };
  if (current) {
    const points = projectionPoints(current, scoring, position);
    // A missing scoring variant is not zero and is not a season total.
    return points == null ? unavailable : { points, basis: "weekly" };
  }
  const total = finite(seasonPoints);
  if (total == null) return unavailable;
  const games = byes.length ? 18 - byes.length : 17;
  return { points: total / Math.max(1, games), basis: "season_estimate" };
}

export const WEEKLY_PROJECTION_NOTE = "Uses the selected week's forecast when published. If this source has no forecast for that player/week, a season-based weekly estimate is used; known byes score zero. Season totals remain separate for trades and season-long comparisons.";
