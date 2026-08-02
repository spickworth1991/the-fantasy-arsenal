const finite = (value) => Number.isFinite(Number(value));
const number = (value) => (finite(value) ? Number(value) : 0);

const POSITION_RECEPTION_BONUS = /^bonus_rec_(qb|rb|wr|te)$/i;
const YARDAGE_THRESHOLD_BONUS = /^bonus_(pass|rush|rec)_yd_(\d+)$/i;
const GENERIC_THRESHOLD_BONUS = /^bonus_(.+)_(\d+)$/i;

function derivedValue(key, stats, position) {
  const threshold = key.match(YARDAGE_THRESHOLD_BONUS);
  if (threshold) {
    const field = `${threshold[1].toLowerCase()}_yd`;
    return number(stats?.[field]) >= Number(threshold[2]) ? 1 : 0;
  }
  const receptionBonus = key.match(POSITION_RECEPTION_BONUS);
  if (receptionBonus)
    return String(position || "").toUpperCase() === receptionBonus[1].toUpperCase()
      ? number(stats?.rec)
      : 0;
  const genericThreshold = key.match(GENERIC_THRESHOLD_BONUS);
  if (genericThreshold && finite(stats?.[genericThreshold[1]]))
    return number(stats[genericThreshold[1]]) >= Number(genericThreshold[2])
      ? 1
      : 0;
  return null;
}

export function scoreSleeperStats(stats = {}, scoringSettings = {}, position = "") {
  return Object.entries(scoringSettings || {}).reduce((total, [key, multiplier]) => {
    if (!finite(multiplier) || Number(multiplier) === 0) return total;
    const direct = finite(stats?.[key]) ? Number(stats[key]) : null;
    const value = direct ?? derivedValue(key, stats, position);
    return value == null ? total : total + value * Number(multiplier);
  }, 0);
}

export function sleeperScoringCoverage(stats = {}, scoringSettings = {}, position = "") {
  const active = Object.entries(scoringSettings || {}).filter(([, value]) => finite(value) && Number(value) !== 0);
  const supported = [];
  const unsupported = [];
  for (const [key] of active) {
    if (finite(stats?.[key]) || derivedValue(key, stats, position) != null) supported.push(key);
    else unsupported.push(key);
  }
  return {
    active: active.length,
    supported,
    unsupported,
    percentage: active.length ? Math.round((supported.length / active.length) * 100) : 0,
  };
}

export function leagueScoringLabel(league) {
  return league?.name ? `${league.name} scoring` : "League scoring";
}
