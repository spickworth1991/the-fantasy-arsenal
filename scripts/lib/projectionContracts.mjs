const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export const FIELD_LEVEL_PROJECTION_CONTRACTS = new Set([
  "full_season",
  "rest_of_season",
]);

export const SEASON_POINT_PROJECTION_CONTRACTS = new Set([
  "full_season",
  "full_season_sum_of_explicit_weeks",
  "ytd_actual_plus_rest_of_season",
  "rest_of_season",
]);

export function normalizeProjectedStatLine({
  rawLine = {},
  contract,
  actualLine = {},
  remainingGames,
  activeGames,
  fields = [],
}) {
  if (!FIELD_LEVEL_PROJECTION_CONTRACTS.has(contract))
    throw new Error(`Unsupported field-level projection contract: ${contract || "missing"}`);
  const scheduled = Math.max(1, finite(activeGames));
  const remaining = Math.max(1, finite(remainingGames));
  const sourceGames = clamp(finite(rawLine.games, scheduled) || scheduled, 1, 18);
  const normalized = { games: scheduled };
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(rawLine, field)) continue;
    const raw = finite(rawLine[field]);
    normalized[field] =
      contract === "rest_of_season"
        ? (raw / sourceGames) * scheduled
        : (Math.max(0, raw - finite(actualLine[field])) / remaining) * scheduled;
  }
  return normalized;
}

export function normalizeSeasonProjectionPoints(value, contract, actualPoints = 0) {
  if (!SEASON_POINT_PROJECTION_CONTRACTS.has(contract))
    throw new Error(`Unsupported season-point projection contract: ${contract || "missing"}`);
  const projection = Number(value);
  if (!Number.isFinite(projection) || projection <= 0) return projection;
  return contract === "rest_of_season"
    ? projection + finite(actualPoints)
    : projection;
}
