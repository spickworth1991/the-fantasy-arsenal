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

// FantasyPros exposes projected counting stats, but uses plural/category names
// rather than Sleeper's scoring keys. Keep only conversions whose meaning is
// equivalent; fumbles and combined two-point conversions are intentionally not
// guessed because FantasyPros does not split them into Sleeper's scoring fields.
export function fantasyProsStatsToSleeper(stats = {}) {
  const aliases = {
    pass_att: "pass_att", pass_cmp: "pass_cmp", pass_yds: "pass_yd", pass_tds: "pass_td", pass_ints: "pass_int",
    rush_att: "rush_att", rush_yds: "rush_yd", rush_tds: "rush_td",
    rec_rec: "rec", rec_tgt: "rec_tgt", rec_yds: "rec_yd", rec_tds: "rec_td",
    ret_yds: "ret_yd", ret_tds: "ret_td",
    pass_yds_300: "bonus_pass_yd_300", pass_yds_400: "bonus_pass_yd_400",
    rush_yds_100: "bonus_rush_yd_100", rush_yds_200: "bonus_rush_yd_200",
    rec_yds_100: "bonus_rec_yd_100", rec_yds_200: "bonus_rec_yd_200",
  };
  return Object.entries(aliases).reduce((result, [source, target]) => {
    if (finite(stats?.[source])) result[target] = Number(stats[source]);
    return result;
  }, {});
}

// DraftSharks exposes season counting stats under `projections`. Translate
// only fields with direct Sleeper equivalents; mismatched kicking distance
// buckets are intentionally left unsupported rather than guessed.
export function draftSharksStatsToSleeper(stats = {}, position = "") {
  const aliases = {
    pass_att: "pass_att", pass_cmp: "pass_cmp", pass_yds: "pass_yd", pass_tds: "pass_td", pass_int: "pass_int",
    rush_yds: "rush_yd", rush_tds: "rush_td", rec_catch: "rec", rec_yds: "rec_yd", rec_tds: "rec_td",
    pr_yds_total: "pr_yd", kr_yds_total: "kr_yd", return_touchdowns: "ret_td",
  };
  const result = Object.entries(aliases).reduce((mapped, [source, target]) => {
    if (finite(stats?.[source])) mapped[target] = Number(stats[source]);
    return mapped;
  }, {});
  const pos = String(position || "").toUpperCase();
  const extra = pos === "DEF" || pos === "DST"
    ? { def_sack: "sack", def_int: "int", def_fum_rec: "fum_rec", def_tds: "def_td" }
    : ["DL", "LB", "DB", "IDP"].includes(pos)
      ? { idp_solo: "tackle_solo", idp_assist: "tackle_assist", idp_sack: "sack", idp_pass_def: "pass_def", idp_int: "int", idp_fum_forced: "fum_force", idp_fum_rec: "fum_rec", idp_tds: "def_td" }
      : {};
  for (const [source, target] of Object.entries(extra)) {
    if (finite(stats?.[source])) result[target] = Number(stats[source]);
  }
  return result;
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
