import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import crypto from "crypto";
import { evaluateSerializedPositionModel } from "./lib/trainedProjectionModel.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const historyRoot = path.join(root, "public", "stats", "history");
const outputRoot = path.join(root, "scripts", "_stat_backtests");
const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }),
);
const candidateName = String(args.candidate === true ? "current" : args.candidate || "")
  .replace(/[^a-z0-9_-]/gi, "");
const seasons = String(args.seasons || "2023,2024,2025")
  .split(",")
  .map(Number)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const scoring = ["ppr", "half", "std"].includes(String(args.scoring))
  ? String(args.scoring)
  : "ppr";
const minimumHistory = Math.max(1, Number(args["min-history"] || 3));
const minimumProjection = Math.max(0, Number(args["min-projection"] || 1));
const positions = ["QB", "RB", "WR", "TE", "K"];
const validationYear = Math.max(...seasons);
const defenseStrengths = [0, 0.15, 0.25, 0.35, 0.45, 0.6];
const riskAmplifications = [0, 1.5, 2, 2.5, 3, 3.5, 4];
const defaultDefenseStrength = 0.35;
const defaultRiskAmplification = 3;
const rawFields = [
  "pass_att",
  "pass_yd",
  "pass_td",
  "pass_int",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rec_tgt",
  "rec",
  "rec_yd",
  "rec_td",
  "fga",
  "fgm",
  "xpa",
  "xpm",
  "kick_pts",
];
const fieldsByPosition = {
  QB: ["fantasy_points_allowed", "pass_att", "pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td"],
  RB: ["fantasy_points_allowed", "rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td"],
  WR: ["fantasy_points_allowed", "rec_tgt", "rec", "rec_yd", "rec_td"],
  TE: ["fantasy_points_allowed", "rec_tgt", "rec", "rec_yd", "rec_td"],
  K: ["fantasy_points_allowed", "fga", "fgm", "xpa", "xpm", "kick_pts"],
};
const trainedFeatureNames = [
  "baseline_points",
  "log_baseline",
  "week_fraction",
  "early_season",
  "recent_form_delta",
  "snap_share",
  "snap_trend",
  "opportunity_share",
  "opportunity_trend",
  "red_zone_share",
  "air_yard_share",
  "target_share",
  "target_share_trend",
  "carry_share",
  "carry_share_trend",
  "weighted_opportunity_share",
  "weighted_opportunity_trend",
  "high_value_touch_rate",
  "two_minute_opportunity_rate",
  "third_down_opportunity_rate",
  "opportunity_volatility",
  "receiving_epa_per_target",
  "rushing_epa_per_carry",
  "ngs_cpoe",
  "ngs_separation",
  "ngs_yac_over_expected",
  "ngs_ryoe_per_carry",
  "ngs_box_eight_rate",
  "team_pace_delta",
  "home",
  "defense_points_delta",
  "defense_volume_delta",
  "personal_delta",
  "history_reliability",
  "defense_reliability",
  "personal_reliability",
  "protection_pressure_rate",
  "protection_sack_rate",
  "opponent_pressure_rate",
  "opponent_sack_rate",
  "pressure_mismatch",
  "opponent_blitz_rate",
  "ol_stability",
  "ol_continuity",
  "time_to_throw",
  "offense_motion_rate",
  "offense_play_action_rate",
  "offense_screen_rate",
  "offense_rpo_rate",
  "opponent_man_rate",
  "opponent_zone_rate",
  "offense_epa_per_play",
  "offense_success_rate",
  "offense_pass_rate",
  "offense_red_zone_play_rate",
  "opponent_epa_per_play_allowed",
  "opponent_success_rate_allowed",
  "opponent_pass_rate_faced",
  "opponent_red_zone_play_rate_allowed",
  "epa_matchup",
  "success_matchup",
  "offense_neutral_pass_rate",
  "offense_two_minute_rate",
  "offense_third_down_success_rate",
  "offense_play_volume_delta",
  "market_implied_points_delta",
  "market_spread_scaled",
  "advanced_reliability",
];
const opportunityCandidateNames = [
  "baseline_points",
  "log_baseline",
  "week_fraction",
  "early_season",
  "recent_form_delta",
  "snap_share",
  "snap_trend",
  "opportunity_share",
  "opportunity_trend",
  "red_zone_share",
  "air_yard_share",
  "target_share",
  "target_share_trend",
  "carry_share",
  "carry_share_trend",
  "weighted_opportunity_share",
  "weighted_opportunity_trend",
  "high_value_touch_rate",
  "two_minute_opportunity_rate",
  "third_down_opportunity_rate",
  "opportunity_volatility",
  "team_pace_delta",
  "home",
  "defense_points_delta",
  "defense_volume_delta",
  "personal_delta",
  "history_reliability",
  "defense_reliability",
  "personal_reliability",
];
const environmentCandidateNames = [
  ...opportunityCandidateNames,
  "offense_neutral_pass_rate",
  "offense_two_minute_rate",
  "offense_third_down_success_rate",
  "offense_play_volume_delta",
  "market_implied_points_delta",
  "market_spread_scaled",
  "receiving_epa_per_target",
  "rushing_epa_per_carry",
  "ngs_cpoe",
  "ngs_separation",
  "ngs_yac_over_expected",
  "ngs_ryoe_per_carry",
  "ngs_box_eight_rate",
];

const number = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : 0;
const finite = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const round = (value, places = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(places)) : null;
const normalizeTeam = (team) =>
  ({ OAK: "LV", SD: "LAC", STL: "LAR", JAX: "JAC", WSH: "WAS" })[
    String(team || "").toUpperCase()
  ] || String(team || "").toUpperCase();
const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const playerKey = (player) =>
  player?.player_id
    ? `id:${player.player_id}`
    : `${normalizeName(player?.name)}|${String(player?.position || "").toUpperCase()}`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readGitJson = (commit, file) =>
  JSON.parse(
    execFileSync("git", ["show", `${commit}:${file}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }),
  );
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
};
const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function rank(values) {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => right.value - left.value);
  const result = Array(values.length).fill(0);
  let cursor = 0;
  while (cursor < ordered.length) {
    let end = cursor;
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[cursor].value)
      end += 1;
    const value = (cursor + end) / 2 + 1;
    for (let index = cursor; index <= end; index += 1)
      result[ordered[index].index] = value;
    cursor = end + 1;
  }
  return result;
}

function correlation(left, right) {
  if (left.length < 20 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  left.forEach((value, index) => {
    const x = value - leftMean;
    const y = right[index] - rightMean;
    covariance += x * y;
    leftVariance += x ** 2;
    rightVariance += y ** 2;
  });
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator ? covariance / denominator : null;
}

function metrics(rows, projectionField) {
  const usable = rows.filter(
    (row) => Number.isFinite(row.actual) && Number.isFinite(row[projectionField]),
  );
  if (!usable.length) return null;
  const errors = usable.map((row) => row[projectionField] - row.actual);
  const absolute = errors.map(Math.abs);
  const ranked = correlation(
    rank(usable.map((row) => row[projectionField])),
    rank(usable.map((row) => row.actual)),
  );
  return {
    sample: usable.length,
    mae: round(mean(absolute), 3),
    rmse: round(Math.sqrt(mean(errors.map((error) => error ** 2))), 3),
    bias: round(mean(errors), 3),
    rank_correlation: round(ranked, 4),
    within_3: round(usable.filter((row) => Math.abs(row[projectionField] - row.actual) <= 3).length / usable.length, 4),
    within_5: round(usable.filter((row) => Math.abs(row[projectionField] - row.actual) <= 5).length / usable.length, 4),
  };
}

function classification(rows, factorField = "risk_factor") {
  const outcomes = [
    { key: "boom", actual: (row) => row.actual_ratio >= 1.3, predicted: (row) => row[factorField] >= 1.22 },
    { key: "bust", actual: (row) => row.actual_ratio <= 0.7, predicted: (row) => row[factorField] <= 0.78 },
  ];
  const result = {};
  for (const outcome of outcomes) {
    const tp = rows.filter((row) => outcome.actual(row) && outcome.predicted(row)).length;
    const fp = rows.filter((row) => !outcome.actual(row) && outcome.predicted(row)).length;
    const fn = rows.filter((row) => outcome.actual(row) && !outcome.predicted(row)).length;
    const tn = rows.length - tp - fp - fn;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    result[outcome.key] = {
      actual: tp + fn,
      predicted: tp + fp,
      true_positive: tp,
      false_positive: fp,
      false_negative: fn,
      true_negative: tn,
      precision: round(precision, 4),
      recall: round(recall, 4),
      f1: round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0, 4),
    };
  }
  result.macro_f1 = round(mean([result.boom.f1, result.bust.f1]), 4);
  return result;
}

function loadSeason(year) {
  const sleeperFile = path.join(historyRoot, String(year), "sleeper.json");
  const scheduleFile = path.join(historyRoot, String(year), "schedule.json");
  if (!fs.existsSync(sleeperFile) || !fs.existsSync(scheduleFile)) return null;
  const sleeper = readJson(sleeperFile);
  const schedule = readJson(scheduleFile);
  const fantasyProsFile = path.join(historyRoot, String(year), "fantasypros.json");
  const fantasyPros = fs.existsSync(fantasyProsFile)
    ? readJson(fantasyProsFile)
    : { players: [] };
  const advancedFile = path.join(
    root,
    "public",
    "stats",
    "advanced",
    String(year),
    "context.json",
  );
  const advanced = fs.existsSync(advancedFile)
    ? readJson(advancedFile)
    : { team_weeks: [], player_weeks: [] };
  const opponent = new Map();
  const home = new Map();
  const forecastCutoff = new Map();
  const resultsAvailableAt = new Map();
  for (const entry of schedule.weeks || []) {
    const kickoffs = (entry.games || [])
      .map((game) => Date.parse(game.date || game.kickoff))
      .filter(Number.isFinite);
    if (kickoffs.length) {
      const earliest = Math.min(...kickoffs);
      const date = new Date(earliest);
      const daysSinceWednesday = (date.getUTCDay() - 3 + 7) % 7;
      const cutoff = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() - daysSinceWednesday,
        12,
      );
      forecastCutoff.set(Number(entry.week), cutoff);
      // Historical result files do not preserve their publication time. Use
      // the declared conservative rule: the whole week's results become
      // eligible 48 hours after its latest game's six-hour finality window.
      resultsAvailableAt.set(Number(entry.week), Math.max(...kickoffs) + 54 * 60 * 60 * 1000);
    }
    for (const game of entry.games || []) {
      const homeTeam = normalizeTeam(game.home);
      const awayTeam = normalizeTeam(game.away);
      opponent.set(`${entry.week}|${homeTeam}`, awayTeam);
      opponent.set(`${entry.week}|${awayTeam}`, homeTeam);
      home.set(`${entry.week}|${homeTeam}`, true);
      home.set(`${entry.week}|${awayTeam}`, false);
    }
  }
  const seasonTeam = new Map(
    (fantasyPros.players || []).map((row) => [playerKey(row), normalizeTeam(row.team)]),
  );
  const advancedPlayers = new Map(
    (advanced.player_weeks || []).map((row) => [
      `${Number(row.week)}|${normalizeTeam(row.team)}|${normalizeName(row.name)}|${String(row.position || "").toUpperCase()}`,
      row,
    ]),
  );
  const advancedTeamByPlayerWeek = new Map(
    (advanced.player_weeks || []).map((row) => [
      `${Number(row.week)}|${normalizeName(row.name)}|${String(row.position || "").toUpperCase()}`,
      normalizeTeam(row.team),
    ]),
  );
  const advancedTeams = new Map(
    (advanced.team_weeks || []).map((row) => [
      `${Number(row.week)}|${normalizeTeam(row.team)}`,
      row,
    ]),
  );
  return {
    year,
    sleeper,
    schedule,
    opponent,
    home,
    forecastCutoff,
    resultsAvailableAt,
    advanced,
    seasonTeam,
    advancedPlayers,
    advancedTeamByPlayerWeek,
    advancedTeams,
  };
}

function activeGame(player, week, stats, points) {
  if (!positions.includes(String(player.position || "").toUpperCase())) return false;
  if (!stats || typeof stats !== "object") return false;
  if (!number(stats.gp || stats.gms_active)) return false;
  if (player.position === "K")
    return number(stats.fga) + number(stats.xpa) + number(stats.kick_pts) > 0 || points !== 0;
  const usage =
    number(stats.off_snp) +
    number(stats.pass_att) +
    number(stats.rush_att) +
    number(stats.rec_tgt);
  return usage > 0 || points !== 0;
}

function gameRecords(loadedSeasons) {
  const games = [];
  for (const data of loadedSeasons.values()) {
    for (const player of data.sleeper.players || []) {
      const position = String(player.position || "").toUpperCase();
      const seasonTeam = data.seasonTeam.get(playerKey(player)) || normalizeTeam(player.team);
      if (!positions.includes(position)) continue;
      for (const [weekText, scoringRow] of Object.entries(player.weeks || {})) {
        const week = Number(weekText);
        // Advanced history supplies identity only here. It prevents a player's
        // final team from being assigned to every earlier week after a trade.
        const team =
          data.advancedTeamByPlayerWeek.get(
            `${week}|${normalizeName(player.name)}|${position}`,
          ) || seasonTeam;
        if (!team) continue;
        const opponent = data.opponent.get(`${week}|${team}`);
        if (!opponent) continue;
        const stats = player.weekly_stats?.[weekText] || {};
        const points = finite(scoringRow?.[scoring] ?? stats?.[`pts_${scoring === "half" ? "half_ppr" : scoring}`]);
        if (!Number.isFinite(points) || !activeGame(player, week, stats, points)) continue;
        games.push({
          year: data.year,
          week,
          key: playerKey(player),
          player_id: player.player_id || null,
          name: player.name,
          position,
          team,
          opponent,
          home: Boolean(data.home.get(`${week}|${team}`)),
          results_available_at: data.resultsAvailableAt.get(week) || null,
          points,
          stats,
          advanced:
            data.advancedPlayers.get(
              `${week}|${team}|${normalizeName(player.name)}|${position}`,
            ) || null,
          advanced_team: data.advancedTeams.get(`${week}|${team}`) || null,
        });
      }
    }
  }
  return games.sort((left, right) => left.year - right.year || left.week - right.week);
}

function beforeTarget(game, year, week) {
  return game.year < year || (game.year === year && game.week < week);
}

function availableBeforeForecast(game, targetData, year, week) {
  if (!beforeTarget(game, year, week)) return false;
  if (game.year < year) return true;
  const cutoff = targetData?.forecastCutoff?.get(week);
  return Number.isFinite(cutoff) &&
    Number.isFinite(game.results_available_at) &&
    game.results_available_at <= cutoff;
}

function evidenceWeight(game, year, week) {
  if (game.year === year) return 1.5 * 0.88 ** Math.max(0, week - game.week - 1);
  if (game.year === year - 1) return 0.65;
  if (game.year === year - 2) return 0.32;
  return 0;
}

function playerProfile(history, positionGames, year, week) {
  let weightedPoints = 0;
  let totalWeight = 0;
  for (const game of history) {
    const weight = evidenceWeight(game, year, week);
    weightedPoints += game.points * weight;
    totalWeight += weight;
  }
  const observed = totalWeight ? weightedPoints / totalWeight : 0;
  const positionMedian = median(positionGames.map((game) => game.points));
  const reliability = history.length / (history.length + 3);
  const baseline = observed * reliability + positionMedian * (1 - reliability);
  const ratios = history
    .map((game) => (baseline ? clamp(game.points / baseline, 0, 3) : null))
    .filter(Number.isFinite);
  const ratioMean = mean(ratios);
  const cv = ratios.length
    ? clamp(Math.sqrt(mean(ratios.map((ratio) => (ratio - ratioMean) ** 2))), 0.12, 1.15)
    : 0.35;
  const volatilityReliability = history.length / (history.length + 8);
  return {
    baseline,
    games: history.length,
    cv,
    matchupSensitivity: clamp(0.88 + cv * 0.72 * volatilityReliability, 0.88, 1.48),
    historicalBoomRate: ratios.length ? ratios.filter((ratio) => ratio >= 1.3).length / ratios.length : 0.2,
    historicalBustRate: ratios.length ? ratios.filter((ratio) => ratio <= 0.7).length / ratios.length : 0.2,
  };
}

function buildTeamUsage(evidence) {
  const rows = new Map();
  for (const game of evidence) {
    const key = `${game.year}|${game.week}|${game.team}`;
    const row = rows.get(key) || {
      team: game.team,
      year: game.year,
      week: game.week,
      plays: 0,
      pass_att: 0,
      rush_att: 0,
      targets: 0,
      red_zone: 0,
      air_yards: 0,
      two_minute_plays: 0,
      third_down_plays: 0,
    };
    row.plays = Math.max(row.plays, number(game.stats?.tm_off_snp));
    row.pass_att += game.position === "QB" ? number(game.stats?.pass_att) : 0;
    row.rush_att += number(game.stats?.rush_att);
    row.targets += number(game.stats?.rec_tgt);
    row.red_zone +=
      number(game.stats?.pass_rz_att) +
      number(game.stats?.rush_rz_att) +
      number(game.stats?.rec_rz_tgt);
    row.air_yards += number(game.stats?.rec_air_yd);
    row.two_minute_plays = Math.max(
      row.two_minute_plays,
      number(game.advanced_team?.offense?.samples?.two_minute),
    );
    row.third_down_plays = Math.max(
      row.third_down_plays,
      number(game.advanced_team?.offense?.samples?.third_down),
    );
    rows.set(key, row);
  }
  const paceRows = [...rows.values()].map((row) => row.plays).filter((value) => value > 0);
  return { rows, leaguePace: mean(paceRows) || 64 };
}

function playerOpportunity(game) {
  if (game.position === "QB")
    return number(game.stats?.pass_att) + number(game.stats?.rush_att);
  if (game.position === "K")
    return number(game.stats?.fga) + number(game.stats?.xpa);
  return number(game.stats?.rush_att) + number(game.stats?.rec_tgt);
}

function teamOpportunity(game, teamRow) {
  if (game.position === "QB") return teamRow?.pass_att + teamRow?.rush_att;
  if (game.position === "K") return 0;
  return teamRow?.rush_att + teamRow?.targets;
}

function weightedAverage(rows, accessor, year, week) {
  let total = 0;
  let weightTotal = 0;
  for (const row of rows) {
    const value = accessor(row);
    if (!Number.isFinite(value)) continue;
    const weight = evidenceWeight(row, year, week);
    if (!weight) continue;
    total += value * weight;
    weightTotal += weight;
  }
  return weightTotal ? total / weightTotal : null;
}

function roleFeatures(history, teamUsage, profile, year, week) {
  const recent = history.slice(-3);
  const earlier = history.slice(0, -3);
  const share = (game) => {
    const team = teamUsage.rows.get(`${game.year}|${game.week}|${game.team}`);
    const denominator = teamOpportunity(game, team);
    return denominator > 0 ? playerOpportunity(game) / denominator : null;
  };
  const snaps = (game) => {
    const teamSnaps = number(game.stats?.tm_off_snp);
    return teamSnaps > 0 ? number(game.stats?.off_snp) / teamSnaps : null;
  };
  const redZone = (game) => {
    const team = teamUsage.rows.get(`${game.year}|${game.week}|${game.team}`);
    const value =
      number(game.stats?.pass_rz_att) +
      number(game.stats?.rush_rz_att) +
      number(game.stats?.rec_rz_tgt);
    return team?.red_zone > 0 ? value / team.red_zone : null;
  };
  const airYards = (game) => {
    const team = teamUsage.rows.get(`${game.year}|${game.week}|${game.team}`);
    return team?.air_yards > 0 ? number(game.stats?.rec_air_yd) / team.air_yards : null;
  };
  const pace = (game) => {
    const team = teamUsage.rows.get(`${game.year}|${game.week}|${game.team}`);
    return team?.plays > 0 ? team.plays / teamUsage.leaguePace - 1 : null;
  };
  const advancedValue = (field, nested) => (game) => {
    const value = nested ? game.advanced?.[field]?.[nested] : game.advanced?.[field];
    return value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const highValueTouchRate = (game) => {
    const opportunities = number(game.advanced?.targets) + number(game.advanced?.carries);
    return opportunities > 0
      ? number(game.advanced?.high_value_touches) / opportunities
      : null;
  };
  const situationalRate = (game, playerField, teamField) => {
    const team = teamUsage.rows.get(`${game.year}|${game.week}|${game.team}`);
    return number(team?.[teamField]) > 0
      ? number(game.advanced?.[playerField]) / number(team[teamField])
      : null;
  };
  const recentPoints = weightedAverage(recent, (game) => game.points, year, week);
  const snapShare = weightedAverage(history, snaps, year, week);
  const recentSnap = weightedAverage(recent, snaps, year, week);
  const earlierSnap = weightedAverage(earlier, snaps, year, week);
  const opportunityShare = weightedAverage(history, share, year, week);
  const recentOpportunity = weightedAverage(recent, share, year, week);
  const earlierOpportunity = weightedAverage(earlier, share, year, week);
  const targetShare = advancedValue("target_share");
  const carryShare = advancedValue("carry_share");
  const recentTargetShare = weightedAverage(recent, targetShare, year, week);
  const earlierTargetShare = weightedAverage(earlier, targetShare, year, week);
  const recentCarryShare = weightedAverage(recent, carryShare, year, week);
  const earlierCarryShare = weightedAverage(earlier, carryShare, year, week);
  const opportunityRows = history
    .map((game) => ({ game, value: advancedValue("opportunity_share")(game) }))
    .filter((row) => Number.isFinite(row.value));
  const opportunityMean = weightedAverage(
    opportunityRows.map(({ game, value }) => ({ ...game, opportunity_value: value })),
    (game) => game.opportunity_value,
    year,
    week,
  );
  const opportunityVolatility = opportunityRows.length > 1 && Number.isFinite(opportunityMean)
    ? Math.sqrt(
        mean(opportunityRows.map(({ value }) => (value - opportunityMean) ** 2)),
      )
    : null;
  return {
    recent_form_delta: Number.isFinite(recentPoints)
      ? clamp(recentPoints / Math.max(0.1, profile.baseline) - 1, -0.75, 1)
      : null,
    snap_share: snapShare,
    snap_trend:
      Number.isFinite(recentSnap) && Number.isFinite(earlierSnap)
        ? clamp(recentSnap - earlierSnap, -0.5, 0.5)
        : null,
    opportunity_share: opportunityShare,
    opportunity_trend:
      Number.isFinite(recentOpportunity) && Number.isFinite(earlierOpportunity)
        ? clamp(recentOpportunity - earlierOpportunity, -0.5, 0.5)
        : null,
    red_zone_share: weightedAverage(history, redZone, year, week),
    air_yard_share: weightedAverage(history, airYards, year, week),
    target_share: weightedAverage(history, targetShare, year, week),
    target_share_trend:
      Number.isFinite(recentTargetShare) && Number.isFinite(earlierTargetShare)
        ? clamp(recentTargetShare - earlierTargetShare, -0.5, 0.5)
        : null,
    carry_share: weightedAverage(history, carryShare, year, week),
    carry_share_trend:
      Number.isFinite(recentCarryShare) && Number.isFinite(earlierCarryShare)
        ? clamp(recentCarryShare - earlierCarryShare, -0.5, 0.5)
        : null,
    weighted_opportunity_share: opportunityMean,
    weighted_opportunity_trend:
      Number.isFinite(recentOpportunity) && Number.isFinite(earlierOpportunity)
        ? clamp(recentOpportunity - earlierOpportunity, -0.5, 0.5)
        : null,
    high_value_touch_rate: weightedAverage(history, highValueTouchRate, year, week),
    two_minute_opportunity_rate: weightedAverage(
      history,
      (game) => situationalRate(game, "two_minute_opportunities", "two_minute_plays"),
      year,
      week,
    ),
    third_down_opportunity_rate: weightedAverage(
      history,
      (game) => situationalRate(game, "third_down_opportunities", "third_down_plays"),
      year,
      week,
    ),
    opportunity_volatility: opportunityVolatility,
    receiving_epa_per_target: weightedAverage(
      history,
      advancedValue("receiving_epa_per_target"),
      year,
      week,
    ),
    rushing_epa_per_carry: weightedAverage(
      history,
      advancedValue("rushing_epa_per_carry"),
      year,
      week,
    ),
    ngs_cpoe: weightedAverage(history, advancedValue("ngs", "cpoe"), year, week),
    ngs_separation: weightedAverage(
      history,
      advancedValue("ngs", "separation"),
      year,
      week,
    ),
    ngs_yac_over_expected: weightedAverage(
      history,
      advancedValue("ngs", "yac_over_expected"),
      year,
      week,
    ),
    ngs_ryoe_per_carry: weightedAverage(
      history,
      advancedValue("ngs", "ryoe_per_carry"),
      year,
      week,
    ),
    ngs_box_eight_rate: weightedAverage(
      history,
      advancedValue("ngs", "box_eight_rate"),
      year,
      week,
    ),
    team_pace_delta: weightedAverage(history, pace, year, week),
    history_reliability: history.length / (history.length + 6),
  };
}

function advancedMatchupFeatures(advancedHistory, offenseTeam, defenseTeam, year, week) {
  const averageSide = (team, side, field) => {
    let weighted = 0;
    let weightTotal = 0;
    let samples = 0;
    for (const row of advancedHistory.get(team) || []) {
      if (
        row.year < year - 2 ||
        row.year > year ||
        (row.year === year && Number(row.week) >= week)
      )
        continue;
      const value = finite(row?.[side]?.[field]);
      if (!Number.isFinite(value)) continue;
      const weight = evidenceWeight(row, year, week);
      if (!weight) continue;
      weighted += value * weight;
      weightTotal += weight;
      samples += 1;
    }
    return { value: weightTotal ? weighted / weightTotal : null, samples };
  };
  const offense = (field) => averageSide(offenseTeam, "offense", field);
  const defense = (field) => averageSide(defenseTeam, "defense", field);
  const snap = (field) => averageSide(offenseTeam, "snaps", field);
  const protectionPressure = offense("pressure_rate");
  const opponentPressure = defense("pressure_rate");
  const offenseEpa = offense("epa_per_play");
  const offenseSuccess = offense("success_rate");
  const opponentEpa = defense("epa_per_play_allowed");
  const opponentSuccess = defense("success_rate_allowed");
  const offensePlayVolume = offense("play_volume");
  const sample = Math.min(
    protectionPressure.samples || 0,
    opponentPressure.samples || 0,
  );
  return {
    protection_pressure_rate: protectionPressure.value,
    protection_sack_rate: offense("sack_rate").value,
    opponent_pressure_rate: opponentPressure.value,
    opponent_sack_rate: defense("sack_rate").value,
    pressure_mismatch:
      Number.isFinite(protectionPressure.value) &&
      Number.isFinite(opponentPressure.value)
        ? opponentPressure.value - protectionPressure.value
        : null,
    opponent_blitz_rate: defense("blitz_rate").value,
    ol_stability: snap("ol_stability").value,
    ol_continuity: snap("ol_continuity").value,
    time_to_throw: offense("average_time_to_throw").value,
    offense_motion_rate: offense("motion_rate").value,
    offense_play_action_rate: offense("play_action_rate").value,
    offense_screen_rate: offense("screen_rate").value,
    offense_rpo_rate: offense("rpo_rate").value,
    opponent_man_rate: defense("man_rate").value,
    opponent_zone_rate: defense("zone_rate").value,
    offense_epa_per_play: offenseEpa.value,
    offense_success_rate: offenseSuccess.value,
    offense_pass_rate: offense("pass_rate").value,
    offense_red_zone_play_rate: offense("red_zone_play_rate").value,
    opponent_epa_per_play_allowed: opponentEpa.value,
    opponent_success_rate_allowed: opponentSuccess.value,
    opponent_pass_rate_faced: defense("pass_rate_faced").value,
    opponent_red_zone_play_rate_allowed: defense("red_zone_play_rate_allowed").value,
    epa_matchup:
      Number.isFinite(offenseEpa.value) && Number.isFinite(opponentEpa.value)
        ? offenseEpa.value + opponentEpa.value
        : null,
    success_matchup:
      Number.isFinite(offenseSuccess.value) && Number.isFinite(opponentSuccess.value)
        ? offenseSuccess.value + opponentSuccess.value - 1
        : null,
    offense_neutral_pass_rate: offense("neutral_pass_rate").value,
    offense_two_minute_rate: offense("two_minute_rate").value,
    offense_third_down_success_rate: offense("third_down_success_rate").value,
    offense_play_volume_delta: Number.isFinite(offensePlayVolume.value)
      ? offensePlayVolume.value / 64 - 1
      : null,
    advanced_reliability: sample / (sample + 8),
  };
}

function buildDefenseEvidence(evidence) {
  const teamGames = new Map();
  for (const game of evidence) {
    const key = `${game.year}|${game.week}|${game.team}|${game.opponent}|${game.position}`;
    const row = teamGames.get(key) || {
      defense: game.opponent,
      position: game.position,
      points: 0,
      stats: Object.fromEntries(rawFields.map((field) => [field, 0])),
    };
    row.points += game.points;
    for (const field of rawFields) row.stats[field] += number(game.stats?.[field]);
    teamGames.set(key, row);
  }
  const league = new Map();
  const defenses = new Map();
  for (const row of teamGames.values()) {
    const leagueRow = league.get(row.position) || {
      games: 0,
      points: 0,
      stats: Object.fromEntries(rawFields.map((field) => [field, 0])),
    };
    leagueRow.games += 1;
    leagueRow.points += row.points;
    for (const field of rawFields) leagueRow.stats[field] += row.stats[field];
    league.set(row.position, leagueRow);
    const key = `${row.defense}|${row.position}`;
    const defenseRow = defenses.get(key) || {
      games: 0,
      points: 0,
      stats: Object.fromEntries(rawFields.map((field) => [field, 0])),
    };
    defenseRow.games += 1;
    defenseRow.points += row.points;
    for (const field of rawFields) defenseRow.stats[field] += row.stats[field];
    defenses.set(key, defenseRow);
  }
  return { league, defenses };
}

function defenseProfile(aggregate, defense, position) {
  const league = aggregate.league.get(position);
  const row = aggregate.defenses.get(`${defense}|${position}`);
  if (!league?.games || !row?.games)
    return { games: 0, reliability: 0, ratios: { fantasy_points_allowed: 1 } };
  const ratios = {
    fantasy_points_allowed:
      row.points / row.games / Math.max(0.01, league.points / league.games),
  };
  for (const field of rawFields) {
    const leagueAverage = league.stats[field] / league.games;
    if (leagueAverage > 0)
      ratios[field] = row.stats[field] / row.games / leagueAverage;
  }
  return {
    games: row.games,
    reliability: row.games / (row.games + 8),
    ratios,
  };
}

function personalFactor(history, opponent, profile) {
  const matches = history.filter((game) => game.opponent === opponent);
  const other = history.filter((game) => game.opponent !== opponent);
  if (matches.length < 2 || !other.length) return { factor: 1, games: matches.length };
  const ratio = mean(matches.map((game) => game.points)) / Math.max(0.1, mean(other.map((game) => game.points)));
  const reliability = matches.length / (matches.length + 6);
  return {
    games: matches.length,
    factor: clamp(1 + (clamp(ratio, 0.6, 1.4) - 1) * reliability * 0.3 * profile.matchupSensitivity, 0.94, 1.06),
  };
}

function safeForecast(profile, defense, personal, strength = defaultDefenseStrength) {
  const defenseFactor = clamp(
    1 + (number(defense.ratios.fantasy_points_allowed) - 1) * defense.reliability * strength,
    0.82,
    1.18,
  );
  return {
    projection: profile.baseline * defenseFactor * personal.factor,
    defenseFactor,
  };
}

function futureRiskPath({ data, game, profile, history, aggregate, amplification }) {
  const future = [];
  for (let futureWeek = game.week; futureWeek <= 18; futureWeek += 1) {
    const opponent = data.opponent.get(`${futureWeek}|${game.team}`);
    if (!opponent) continue;
    const defense = defenseProfile(aggregate, opponent, game.position);
    const personal = personalFactor(history, opponent, profile);
    const safe = safeForecast(profile, defense, personal);
    future.push({
      week: futureWeek,
      opponent,
      safe: safe.projection,
      factor: profile.baseline ? safe.projection / profile.baseline : 1,
      home: Boolean(data.home.get(`${futureWeek}|${game.team}`)),
    });
  }
  if (!future.length) return { projection: null, factor: 1 };
  const safeTotal = future.reduce((sum, row) => sum + row.safe, 0);
  const weightedMeanFactor = safeTotal
    ? future.reduce((sum, row) => sum + row.factor * row.safe, 0) / safeTotal
    : 1;
  const raw = future.map((row) => {
    const factor = clamp(
      1 + (row.factor - weightedMeanFactor) * amplification + (row.home ? 0.012 : -0.012),
      0.52,
      1.7,
    );
    return { ...row, raw: row.safe * factor };
  });
  const rawTotal = raw.reduce((sum, row) => sum + row.raw, 0);
  const normalization = rawTotal ? safeTotal / rawTotal : 1;
  const current = raw.find((row) => row.week === game.week);
  const projection = current ? current.raw * normalization : null;
  return {
    projection,
    factor: current?.safe ? projection / current.safe : 1,
  };
}

function predictorResults(rows) {
  const results = [];
  for (const position of positions) {
    const positionRows = rows.filter((row) => row.position === position);
    for (const field of fieldsByPosition[position]) {
      const usable = positionRows.filter(
        (row) =>
          Number.isFinite(row.features?.[`defense_${field}`]) &&
          row.features[`defense_${field}`] > 0,
      );
      const feature = usable.map((row) => row.features[`defense_${field}`]);
      const outcome = usable.map((row) => row.actual_ratio);
      const pearson = correlation(feature, outcome);
      const rankCorrelation = correlation(rank(feature), rank(outcome));
      const directionAccuracy = usable.length
        ? usable.filter(
            (row) =>
              (row.features[`defense_${field}`] >= 1 && row.actual_ratio >= 1) ||
              (row.features[`defense_${field}`] < 1 && row.actual_ratio < 1),
          ).length / usable.length
        : 0;
      results.push({
        position,
        field,
        sample: usable.length,
        pearson: round(pearson, 4),
        rank_correlation: round(rankCorrelation, 4),
        direction_accuracy: round(directionAccuracy, 4),
      });
    }
  }
  return results.sort(
    (left, right) => Math.abs(number(right.rank_correlation)) - Math.abs(number(left.rank_correlation)),
  );
}

function tableMetrics(rows, dimension) {
  const values = [...new Set(rows.map((row) => row[dimension]))];
  return values.map((value) => {
    const subset = rows.filter((row) => row[dimension] === value);
    const safe = metrics(subset, "safe");
    const risky = metrics(subset, "risky");
    return {
      [dimension]: value,
      sample: subset.length,
      safe_mae: safe?.mae,
      risky_mae: risky?.mae,
      safe_rmse: safe?.rmse,
      risky_rmse: risky?.rmse,
      risk_wins: round(
        subset.filter((row) => Math.abs(row.risky - row.actual) < Math.abs(row.safe - row.actual)).length /
          Math.max(1, subset.length),
        4,
      ),
    };
  });
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function fitRidge(rows, featureNames, lambda) {
  const means = {};
  const scales = {};
  for (const feature of featureNames) {
    const values = rows
      .map((row) => finite(row.features?.[feature]))
      .filter(Number.isFinite);
    means[feature] = mean(values);
    const variance = mean(values.map((value) => (value - means[feature]) ** 2));
    scales[feature] = Math.sqrt(variance) || 1;
  }
  const matrix = rows.map((row) =>
    featureNames.map((feature) => {
      const raw = finite(row.features?.[feature]);
      return ((Number.isFinite(raw) ? raw : means[feature]) - means[feature]) /
        scales[feature];
    }),
  );
  const target = rows.map((row) =>
    clamp(row.actual / Math.max(0.1, row.baseline) - 1, -0.95, 2),
  );
  const intercept = mean(target);
  const coefficients = Array(featureNames.length).fill(0);
  const residuals = target.map((value) => value - intercept);
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let largestChange = 0;
    for (let column = 0; column < featureNames.length; column += 1) {
      const previous = coefficients[column];
      let numerator = 0;
      let denominator = lambda;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const x = matrix[rowIndex][column];
        residuals[rowIndex] += x * previous;
        numerator += x * residuals[rowIndex];
        denominator += x * x;
      }
      const next = denominator ? numerator / denominator : 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1)
        residuals[rowIndex] -= matrix[rowIndex][column] * next;
      largestChange = Math.max(largestChange, Math.abs(next - previous));
      coefficients[column] = next;
    }
    if (largestChange < 1e-7) break;
  }
  return {
    feature_names: featureNames,
    means,
    scales,
    intercept,
    coefficients: Object.fromEntries(
      featureNames.map((feature, index) => [feature, coefficients[index]]),
    ),
  };
}

function predictRidge(model, row) {
  let delta = model.intercept;
  for (const feature of model.feature_names) {
    const raw = finite(row.features?.[feature]);
    const normalized =
      ((Number.isFinite(raw) ? raw : model.means[feature]) - model.means[feature]) /
      model.scales[feature];
    delta += normalized * model.coefficients[feature];
  }
  return clamp(delta, -0.35, 0.45);
}

function fitBoostedStumps(rows, featureNames, rounds = 40, learningRate = 0.06) {
  const means = {};
  const thresholds = {};
  for (const feature of featureNames) {
    const values = rows
      .map((row) => finite(row.features?.[feature]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    means[feature] = mean(values);
    thresholds[feature] = [...new Set(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
        .map((probability) => quantile(values, probability))
        .filter(Number.isFinite),
    )];
  }
  const matrix = rows.map((row) =>
    Object.fromEntries(
      featureNames.map((feature) => {
        const raw = finite(row.features?.[feature]);
        return [feature, Number.isFinite(raw) ? raw : means[feature]];
      }),
    ),
  );
  const target = rows.map((row) =>
    clamp(row.actual / Math.max(0.1, row.baseline) - 1, -0.95, 2),
  );
  const intercept = mean(target);
  const predictions = Array(rows.length).fill(intercept);
  const trees = [];
  const minimumLeaf = Math.max(30, Math.floor(rows.length * 0.025));
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const residuals = target.map((value, index) => value - predictions[index]);
    let best = null;
    for (const feature of featureNames) {
      for (const threshold of thresholds[feature]) {
        let leftSum = 0;
        let rightSum = 0;
        let leftCount = 0;
        let rightCount = 0;
        for (let index = 0; index < rows.length; index += 1) {
          if (matrix[index][feature] <= threshold) {
            leftSum += residuals[index];
            leftCount += 1;
          } else {
            rightSum += residuals[index];
            rightCount += 1;
          }
        }
        if (leftCount < minimumLeaf || rightCount < minimumLeaf) continue;
        const leftValue = leftSum / leftCount;
        const rightValue = rightSum / rightCount;
        const gain =
          leftCount * leftValue ** 2 + rightCount * rightValue ** 2;
        if (!best || gain > best.gain)
          best = {
            feature,
            threshold,
            leftValue,
            rightValue,
            leftCount,
            rightCount,
            gain,
          };
      }
    }
    if (!best || best.gain < 1e-8) break;
    const tree = {
      feature: best.feature,
      threshold: best.threshold,
      left: clamp(best.leftValue * learningRate, -0.08, 0.08),
      right: clamp(best.rightValue * learningRate, -0.08, 0.08),
      left_sample: best.leftCount,
      right_sample: best.rightCount,
    };
    trees.push(tree);
    for (let index = 0; index < rows.length; index += 1)
      predictions[index] +=
        matrix[index][tree.feature] <= tree.threshold ? tree.left : tree.right;
  }
  return {
    model_type: "boosted_stumps",
    feature_names: featureNames,
    means,
    intercept,
    learning_rate: learningRate,
    trees,
  };
}

function predictBoostedStumps(model, row, treeLimit = null) {
  let delta = model.intercept;
  const trees = Number.isFinite(treeLimit)
    ? model.trees.slice(0, treeLimit)
    : model.trees;
  for (const tree of trees) {
    const raw = finite(row.features?.[tree.feature]);
    const value = Number.isFinite(raw) ? raw : model.means[tree.feature];
    delta += value <= tree.threshold ? tree.left : tree.right;
  }
  return clamp(delta, -0.35, 0.45);
}

function predictPublishedPositionModel(model, row) {
  return evaluateSerializedPositionModel(model, row.features).bounded_delta;
}

function trainedModelArtifact(rows) {
  const lambdas = [10, 30, 100, 300];
  const strengths = [0, 0.25, 0.5, 0.75, 1];
  const treeLimits = [10, 20, 40, 60, 80];
  const learningRate = 0.06;
  let incumbentCalibration = null;
  try {
    const incumbentFile = args.incumbent
      ? path.resolve(root, String(args.incumbent))
      : path.join(root, "public", "stats", "projections", "model-calibration.json");
    const loadedIncumbent = readJson(incumbentFile);
    incumbentCalibration =
      loadedIncumbent?.trained_adjustments || loadedIncumbent;
  } catch {}
  const byPosition = {};
  for (const position of positions) {
    const eligible = rows.filter(
      (row) => row.position === position && row.baseline >= minimumProjection,
    );
    const development = eligible.filter((row) => row.year < validationYear);
    const holdout = eligible.filter((row) => row.year === validationYear);
    const developmentYears = [...new Set(development.map((row) => row.year))].sort();
    const tuningYear = developmentYears.at(-1);
    const training = development.filter((row) => row.year < tuningYear);
    const tuning = development.filter((row) => row.year === tuningYear);
    if (training.length < 250 || tuning.length < 100 || holdout.length < 100)
      continue;
    const incumbentPosition = incumbentCalibration?.by_position?.[position] || null;
    const incumbentStrength = number(incumbentPosition?.application_strength);
    const incumbentFeatures = Object.keys(incumbentPosition?.features || {});
    const incumbentModelType = incumbentPosition?.model_type || "ridge";
    const fitIncumbent = (sample) => {
      if (!incumbentPosition) return null;
      if (incumbentModelType === "boosted_stumps")
        return fitBoostedStumps(
          sample,
          incumbentFeatures,
          Math.max(1, Number(incumbentPosition.trees?.length || incumbentPosition.rounds || 40)),
          number(incumbentPosition.learning_rate) || learningRate,
        );
      return fitRidge(sample, incumbentFeatures, number(incumbentPosition.lambda) || 100);
    };
    const predictIncumbent = (model, row) =>
      incumbentModelType === "boosted_stumps"
        ? predictBoostedStumps(model, row)
        : predictRidge(model, row);
    const ridgeFeatureSets = [
      { key: "expanded", names: trainedFeatureNames },
      { key: "opportunity", names: opportunityCandidateNames },
      { key: "role_environment", names: environmentCandidateNames },
      ...(incumbentFeatures.length &&
      incumbentFeatures.join("|") !== trainedFeatureNames.join("|")
        ? [{ key: "incumbent_compatible", names: incumbentFeatures }]
        : []),
    ];
    const candidates = [];
    for (const featureSet of ridgeFeatureSets) {
      for (const lambda of lambdas) {
        const model = fitRidge(training, featureSet.names, lambda);
        for (const strength of strengths) {
          const scored = tuning.map((row) => ({
            ...row,
            trained:
              row.baseline *
              clamp(1 + predictRidge(model, row) * strength, 0.65, 1.45),
          }));
          candidates.push({
            model_type: "ridge",
            feature_set: featureSet.key,
            feature_names: featureSet.names,
            lambda,
            strength,
            model,
            metrics: metrics(scored, "trained"),
            baseline_metrics: metrics(tuning, "safe"),
          });
        }
      }
    }
    const boostedModel = fitBoostedStumps(
      training,
      trainedFeatureNames,
      Math.max(...treeLimits),
      learningRate,
    );
    for (const rounds of treeLimits.filter(
      (limit) => limit <= boostedModel.trees.length,
    )) {
      for (const strength of strengths) {
        const scored = tuning.map((row) => ({
          ...row,
          trained:
            row.baseline *
            clamp(
              1 + predictBoostedStumps(boostedModel, row, rounds) * strength,
              0.65,
              1.45,
            ),
        }));
        candidates.push({
          model_type: "boosted_stumps",
          feature_set: "expanded",
          feature_names: trainedFeatureNames,
          rounds,
          learning_rate: learningRate,
          strength,
          model: boostedModel,
          metrics: metrics(scored, "trained"),
          baseline_metrics: metrics(tuning, "safe"),
        });
      }
    }
    const researchWinner = [...candidates].sort(
      (left, right) =>
        left.metrics.mae - right.metrics.mae ||
        left.metrics.rmse - right.metrics.rmse,
    )[0];
    // Expanded-context candidates can challenge the incumbent, but the strict
    // untouched 2025 MAE/RMSE gate below still controls deployment.
    const deploymentCandidates = candidates;
    const winner = [...deploymentCandidates].sort(
      (left, right) =>
        left.metrics.mae - right.metrics.mae ||
        left.metrics.rmse - right.metrics.rmse,
    )[0];
    const fitCandidate = (sample) =>
      winner.model_type === "boosted_stumps"
        ? fitBoostedStumps(
            sample,
            winner.feature_names,
            winner.rounds,
            winner.learning_rate,
          )
        : fitRidge(sample, winner.feature_names, winner.lambda);
    const predictCandidate = (model, row) =>
      winner.model_type === "boosted_stumps"
        ? predictBoostedStumps(model, row)
        : predictRidge(model, row);
    const gateModel = fitCandidate(development);
    const gateRows = holdout.map((row) => ({
      ...row,
      trained:
        row.baseline *
        clamp(1 + predictCandidate(gateModel, row) * winner.strength, 0.65, 1.45),
    }));
    const challengerMetrics = metrics(gateRows, "trained");
    const baselineHoldoutMetrics = metrics(holdout, "safe");
    // Refit the incumbent architecture only on pre-holdout rows. Reusing the
    // published coefficients (or their saved summary metrics) would allow the
    // validation season to influence its own score and can compare different
    // player populations.
    const incumbentGateModel = fitIncumbent(development);
    const incumbentRows = holdout.map((row) => ({
      ...row,
      incumbent: incumbentGateModel
        ? row.baseline *
          clamp(
            1 + predictIncumbent(incumbentGateModel, row) * incumbentStrength,
            0.65,
            1.45,
          )
        : row.safe,
    }));
    const incumbentMetrics = metrics(incumbentRows, "incumbent");
    if (
      incumbentMetrics?.sample !== challengerMetrics?.sample ||
      incumbentMetrics?.sample !== holdout.length
    )
      throw new Error(
        `${position} paired comparison mismatch: incumbent=${incumbentMetrics?.sample || 0}, challenger=${challengerMetrics?.sample || 0}, eligible=${holdout.length}.`,
      );
    const challengerPromoted =
      challengerMetrics.mae < incumbentMetrics.mae - 0.01 &&
      challengerMetrics.rmse < incumbentMetrics.rmse - 0.001 &&
      challengerMetrics.mae < baselineHoldoutMetrics.mae;
    const selectedType = challengerPromoted
      ? winner.model_type
      : incumbentPosition
        ? "incumbent"
        : winner.model_type;
    const finalModel = challengerPromoted || !incumbentPosition
      ? fitCandidate(eligible)
      : incumbentPosition;
    const finalStrength = selectedType === "incumbent"
      ? incumbentStrength
      : winner.strength;
    const finalPredict = (row) =>
      selectedType === "incumbent"
        ? predictPublishedPositionModel(finalModel, row)
        : predictCandidate(finalModel, row);
    const fitted = eligible.map((row) => {
      const projection =
        row.baseline *
        clamp(1 + finalPredict(row) * finalStrength, 0.65, 1.45);
      return {
        ...row,
        trained: projection,
        trained_factor: projection / Math.max(0.1, row.baseline),
        residual_ratio: row.actual / Math.max(0.1, projection),
      };
    });
    // Distribution calibration must remain out-of-sample. Point coefficients
    // may be refit on all eligible history after the architecture passes its
    // gate, but ranges and event probabilities are learned only from the
    // untouched chronological holdout forecasts.
    const uncertaintyCalibrationRows = holdout.map((row) => {
      const prediction = selectedType === "incumbent"
        ? row.baseline * clamp(
            1 + predictIncumbent(incumbentGateModel, row) * incumbentStrength,
            0.65,
            1.45,
          )
        : row.baseline * clamp(
            1 + predictCandidate(gateModel, row) * winner.strength,
            0.65,
            1.45,
          );
      return {
        ...row,
        trained: prediction,
        trained_factor: prediction / Math.max(0.1, row.baseline),
        residual_ratio: row.actual / Math.max(0.1, prediction),
      };
    });
    const uncertaintyOf = (sample) => {
      const residuals = sample.map((row) => row.residual_ratio);
      return {
        p10: round(quantile(residuals, 0.1), 4),
        p25: round(quantile(residuals, 0.25), 4),
        p50: round(quantile(residuals, 0.5), 4),
        p75: round(quantile(residuals, 0.75), 4),
        p90: round(quantile(residuals, 0.9), 4),
      };
    };
    const teamOutcomeCorrelation = (() => {
      const groups = new Map();
      uncertaintyCalibrationRows.forEach((row) => {
        const key = `${row.year}:${row.week}:${row.team}`;
        const values = groups.get(key) || [];
        values.push(row.actual - row.trained);
        groups.set(key, values);
      });
      const eligibleGroups = [...groups.values()].filter((values) => values.length >= 2);
      const all = eligibleGroups.flat();
      if (eligibleGroups.length < 20 || all.length < 50)
        return { value: 0.25, sample: all.length, groups: eligibleGroups.length, provisional: true };
      const overallMean = all.reduce((sum, value) => sum + value, 0) / all.length;
      const totalVariance = all.reduce((sum, value) => sum + (value - overallMean) ** 2, 0) / all.length;
      const betweenVariance = eligibleGroups.reduce((sum, values) => {
        const mean = values.reduce((subtotal, value) => subtotal + value, 0) / values.length;
        return sum + values.length * (mean - overallMean) ** 2;
      }, 0) / all.length;
      return {
        value: round(clamp(totalVariance ? betweenVariance / totalVariance : 0.25, 0.05, 0.65), 4),
        sample: all.length,
        groups: eligibleGroups.length,
        provisional: false,
      };
    })();
    const probabilityBinsOf = (sampleRows) => {
      const sortedByFactor = [...sampleRows].sort(
        (left, right) => left.trained_factor - right.trained_factor,
      );
      return Array.from({ length: 5 }, (_, index) => {
      const start = Math.floor((index * sortedByFactor.length) / 5);
      const end = Math.floor(((index + 1) * sortedByFactor.length) / 5);
      const sample = sortedByFactor.slice(start, end);
      return {
        minimum_factor: round(sample[0]?.trained_factor, 4),
        maximum_factor: round(sample.at(-1)?.trained_factor, 4),
        sample: sample.length,
        boom_probability: round(
          sample.filter((row) => row.actual / Math.max(0.1, row.baseline) >= 1.3)
            .length / Math.max(1, sample.length),
          4,
        ),
        bust_probability: round(
          sample.filter((row) => row.actual / Math.max(0.1, row.baseline) <= 0.7)
            .length / Math.max(1, sample.length),
          4,
        ),
      };
      });
    };
    const baselineValues = uncertaintyCalibrationRows.map((row) => row.baseline);
    const lowerBaseline = quantile(baselineValues, 1 / 3);
    const upperBaseline = quantile(baselineValues, 2 / 3);
    const baselineTiers = [
      { key: "low", minimum: 0, maximum: lowerBaseline },
      { key: "mid", minimum: lowerBaseline, maximum: upperBaseline },
      { key: "high", minimum: upperBaseline, maximum: Number.POSITIVE_INFINITY },
    ].map((tier) => {
      const sample = uncertaintyCalibrationRows.filter(
        (row) => row.baseline >= tier.minimum && row.baseline <= tier.maximum,
      );
      return {
        key: tier.key,
        minimum_baseline: round(tier.minimum, 4),
        maximum_baseline: Number.isFinite(tier.maximum)
          ? round(tier.maximum, 4)
          : null,
        sample: sample.length,
        uncertainty: uncertaintyOf(sample),
        probability_bins: probabilityBinsOf(sample),
      };
    });
    const serializedModel = selectedType === "incumbent"
      ? {
          model_type: incumbentPosition.model_type || "ridge",
          intercept: incumbentPosition.intercept,
          features: incumbentPosition.features,
          ...(incumbentPosition.trees ? { trees: incumbentPosition.trees } : {}),
          ...(incumbentPosition.learning_rate
            ? { learning_rate: incumbentPosition.learning_rate }
            : {}),
        }
      : winner.model_type === "boosted_stumps"
        ? {
            model_type: "boosted_stumps",
            intercept: round(finalModel.intercept, 8),
            learning_rate: winner.learning_rate,
            trees: finalModel.trees.map((tree) => ({
              ...tree,
              threshold: round(tree.threshold, 8),
              left: round(tree.left, 8),
              right: round(tree.right, 8),
            })),
            features: Object.fromEntries(
              winner.feature_names.map((feature) => [
                feature,
                { mean: round(finalModel.means[feature], 8) },
              ]),
            ),
          }
        : {
            model_type: "ridge",
            intercept: round(finalModel.intercept, 8),
            features: Object.fromEntries(
              winner.feature_names.map((feature) => [
                feature,
                {
                  mean: round(finalModel.means[feature], 8),
                  scale: round(finalModel.scales[feature], 8),
                  coefficient: round(finalModel.coefficients[feature], 8),
                },
              ]),
            ),
          };
    byPosition[position] = {
      training_seasons: [...new Set(training.map((row) => row.year))].sort(),
      tuning_season: tuningYear,
      validation_season: validationYear,
      final_fit_seasons: [...new Set(eligible.map((row) => row.year))].sort(),
      training_sample: training.length,
      tuning_sample: tuning.length,
      validation_sample: holdout.length,
      final_sample: eligible.length,
      selected_model: selectedType,
      selected_feature_set:
        selectedType === "incumbent"
          ? incumbentPosition?.selected_feature_set ||
            incumbentPosition?.tuned_feature_set ||
            "incumbent"
          : winner.feature_set,
      tuned_challenger: winner.model_type,
      tuned_feature_set: winner.feature_set,
      research_winner: {
        model_type: researchWinner.model_type,
        feature_set: researchWinner.feature_set,
        ...(researchWinner.lambda ? { lambda: researchWinner.lambda } : {}),
        ...(researchWinner.rounds ? { rounds: researchWinner.rounds } : {}),
        strength: researchWinner.strength,
        tuning_metrics: researchWinner.metrics,
        deployment_eligible: true,
      },
      ...(winner.lambda ? { lambda: winner.lambda } : {}),
      ...(winner.rounds ? { rounds: winner.rounds } : {}),
      application_strength: finalStrength,
      tuning_baseline: winner.baseline_metrics,
      tuning_challenger: winner.metrics,
      holdout_baseline: baselineHoldoutMetrics,
      holdout_incumbent: incumbentMetrics,
      holdout_challenger: challengerMetrics,
      holdout_trained: challengerPromoted || !incumbentPosition
        ? challengerMetrics
        : incumbentMetrics,
      holdout_mae_improvement: round(
        baselineHoldoutMetrics.mae -
          (challengerPromoted || !incumbentPosition
            ? challengerMetrics.mae
            : incumbentMetrics.mae),
        4,
      ),
      promotion: {
        promoted: challengerPromoted,
        rule: "Historical candidate gate: lower 2025 MAE than incumbent by at least 0.01, improve 2025 RMSE by at least 0.001, and lower MAE than the neutral baseline. This reused historical period is not a release holdout; publication additionally requires four frozen future weeks and owner review.",
        mae_vs_incumbent: round(incumbentMetrics.mae - challengerMetrics.mae, 4),
        rmse_vs_incumbent: round(incumbentMetrics.rmse - challengerMetrics.rmse, 4),
      },
      candidate_leaderboard: [...candidates]
        .sort(
          (left, right) =>
            left.metrics.mae - right.metrics.mae ||
            left.metrics.rmse - right.metrics.rmse,
        )
        .slice(0, 8)
        .map((candidate) => ({
          model_type: candidate.model_type,
          feature_set: candidate.feature_set,
          ...(candidate.lambda ? { lambda: candidate.lambda } : {}),
          ...(candidate.rounds ? { rounds: candidate.rounds } : {}),
          strength: candidate.strength,
          metrics: candidate.metrics,
        })),
      ...serializedModel,
      uncertainty: uncertaintyOf(uncertaintyCalibrationRows),
      uncertainty_calibration: {
        method: "chronological_holdout",
        season: validationYear,
        sample: uncertaintyCalibrationRows.length,
        coefficient_training_cutoff_season: validationYear - 1,
      },
      team_outcome_correlation: teamOutcomeCorrelation,
      probability_bins: probabilityBinsOf(uncertaintyCalibrationRows),
      baseline_tiers: baselineTiers,
    };
  }
  return {
    source: "The Fantasy Arsenal local walk-forward trainer",
    generated_at: new Date().toISOString(),
    version: "arsenal-trained-adjustments-v3.0",
    target: "weekly PPR points relative to a leakage-safe rolling player baseline",
    features: trainedFeatureNames,
    validation: {
      method: `Strict rolling-origin feature construction; tune architecture before the ${validationYear} historical benchmark, refit both incumbent and challenger on identical pre-${validationYear} rows, then require at least four newly frozen future weeks before any release recommendation.`,
      no_future_games: true,
      paired_holdout_population: true,
      incumbent_refit_before_holdout: true,
      weather_excluded: true,
      position_level_promotion_gate: true,
      historical_benchmark_reused: true,
      forward_release_gate_weeks: 4,
    },
    by_position: byPosition,
  };
}

function savedProjectionBenchmarks(rows) {
  if (scoring !== "ppr")
    return {
      results: [],
      excluded: [
        `Saved 2025 source files do not declare alternate scoring formats, so they were not compared to ${scoring.toUpperCase()}.`,
      ],
    };
  const target = rows.filter((row) => row.year === 2025);
  if (!target.length) return { results: [], excluded: [] };
  const eligiblePlayers = new Set(
    target.map((row) => `${normalizeName(row.player)}|${row.position}`),
  );
  const preseasonCommit = "503c61e8ed0cbc698f6a1efaf4ab70d866f004c8";
  const sources = [
    {
      key: "ffa_preseason",
      label: "FFA - frozen preseason",
      git: { commit: preseasonCommit, file: "public/projections_2025.json" },
      authenticity: "verified frozen preseason snapshot from Git history",
    },
    {
      key: "espn_preseason",
      label: "ESPN - frozen preseason",
      git: { commit: preseasonCommit, file: "public/projections_espn_2025.json" },
      authenticity: "verified frozen preseason snapshot from Git history",
    },
    {
      key: "cbs_preseason",
      label: "CBS - frozen preseason",
      git: { commit: preseasonCommit, file: "public/projections_cbs_2025.json" },
      authenticity: "verified frozen preseason snapshot from Git history; CBS QB scoring appears different from Sleeper PPR",
    },
    ...(args["include-leakage-demonstrations"] ? [{
      key: "ffa_backup",
      label: "FFA - backup/postseason",
      file: "backup/projections_2025.json",
      authenticity: "postseason backup; included for curiosity, not a valid forecast score",
    },
    {
      key: "espn_backup",
      label: "ESPN - backup/postseason",
      file: "backup/projections_espn_2025.json",
      authenticity: "postseason backup; included for curiosity, not a valid forecast score",
    },
    {
      key: "cbs_backup",
      label: "CBS - backup/postseason leakage",
      file: "backup/projections_cbs_2025.json",
      authenticity: "contains completed-season information; deliberately scored only as a leakage demonstration",
    }] : []),
  ];
  const results = [];
  const excluded = [];
  for (const source of sources) {
    let saved;
    try {
      saved = source.git
        ? readGitJson(source.git.commit, source.git.file)
        : readJson(path.join(root, source.file));
    } catch (error) {
      excluded.push(`${source.label}: ${error.message}`);
      continue;
    }
    const index = new Map();
    for (const player of saved.rows || []) {
      const points = number(player.points);
      if (!points) continue;
      const position = String(player.position || "").toUpperCase();
      index.set(`${normalizeName(player.name)}|${position}`, points);
    }
    const matched = target
      .map((row) => {
        const seasonTotal = index.get(`${normalizeName(row.player)}|${row.position}`);
        if (!Number.isFinite(seasonTotal)) return null;
        return {
          ...row,
          saved_source: seasonTotal / 17,
        };
      })
      .filter(Boolean);
    const matchedPlayers = new Set(
      matched.map((row) => `${normalizeName(row.player)}|${row.position}`),
    );
    const sourceMetrics = metrics(matched, "saved_source");
    const safeMetrics = metrics(matched, "safe");
    const playerSeasons = new Map();
    for (const row of matched) {
      const key = `${normalizeName(row.player)}|${row.position}`;
      const total = playerSeasons.get(key) || {
        player: row.player,
        position: row.position,
        eligible_games: 0,
        actual: 0,
        saved_source: 0,
        safe: 0,
        risky: 0,
      };
      total.eligible_games += 1;
      total.actual += row.actual;
      total.saved_source += row.saved_source;
      total.safe += row.safe;
      total.risky += row.risky;
      playerSeasons.set(key, total);
    }
    const seasonRows = [...playerSeasons.values()];
    const seasonRollup = {
      sample: seasonRows.length,
      source: metrics(seasonRows, "saved_source"),
      safe: metrics(seasonRows, "safe"),
      risky: metrics(seasonRows, "risky"),
      rows: seasonRows.map((row) => ({
        ...row,
        actual: round(row.actual, 3),
        saved_source: round(row.saved_source, 3),
        safe: round(row.safe, 3),
        risky: round(row.risky, 3),
      })),
    };
    const byPosition = positions
      .map((position) => {
        const subset = matched.filter((row) => row.position === position);
        if (!subset.length) return null;
        const external = metrics(subset, "saved_source");
        const safe = metrics(subset, "safe");
        return {
          position,
          sample: subset.length,
          source_mae: external.mae,
          safe_mae: safe.mae,
          source_rmse: external.rmse,
          safe_rmse: safe.rmse,
          source_bias: external.bias,
        };
      })
      .filter(Boolean);
    results.push({
      key: source.key,
      source: source.label,
      saved_file: source.git
        ? `${source.git.commit}:${source.git.file}`
        : source.file,
      saved_file_updated: saved.updated || null,
      comparison_type: "saved season-total divided by 17 scheduled games",
      authenticity: source.authenticity,
      players: matchedPlayers.size,
      eligible_players: eligiblePlayers.size,
      player_coverage: round(matchedPlayers.size / Math.max(1, eligiblePlayers.size), 4),
      games: matched.length,
      source_metrics: sourceMetrics,
      safe_same_games: safeMetrics,
      mae_vs_safe: round(sourceMetrics.mae - safeMetrics.mae, 3),
      accumulated_season: seasonRollup,
      by_position: byPosition,
    });
  }
  return { results, excluded };
}

function markdownTable(rows, columns) {
  if (!rows.length) return "_No results._";
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) => `| ${columns.map((column) => row[column] ?? "-").join(" | ")} |`,
  );
  return [header, divider, ...body].join("\n");
}

console.log("\nTHE FANTASY ARSENAL - LOCAL WALK-FORWARD STAT MODEL BACKTEST");
console.log("=".repeat(74));
console.log(`Seasons: ${seasons.join(", ")} | Scoring: ${scoring.toUpperCase()} | Minimum prior games: ${minimumHistory}`);
console.log("Loading saved schedules, player results, and raw weekly statistics...\n");

const requiredYears = [];
for (let year = Math.min(...seasons) - 2; year <= Math.max(...seasons); year += 1)
  requiredYears.push(year);
const loadedSeasons = new Map(
  requiredYears.map((year) => [year, loadSeason(year)]).filter(([, data]) => data),
);
const advancedHistory = new Map();
for (const seasonRow of loadedSeasons.values()) {
  for (const row of seasonRow?.advanced?.team_weeks || []) {
    const team = normalizeTeam(row.team);
    const current = advancedHistory.get(team) || [];
    current.push({ ...row, year: seasonRow.year });
    advancedHistory.set(team, current);
  }
}
const games = gameRecords(loadedSeasons);
const gamesByTarget = new Map();
for (const game of games) {
  const key = `${game.year}|${game.week}`;
  const rows = gamesByTarget.get(key) || [];
  rows.push(game);
  gamesByTarget.set(key, rows);
}
const records = [];

for (const year of seasons) {
  const data = loadedSeasons.get(year);
  if (!data) throw new Error(`Missing saved ${year} Sleeper or schedule archive.`);
  process.stdout.write(`Backtesting ${year}: `);
  for (let week = 1; week <= 18; week += 1) {
    const actualGames = gamesByTarget.get(`${year}|${week}`) || [];
    if (!actualGames.length) continue;
    const evidence = games.filter(
      (game) =>
        game.year >= year - 2 &&
        availableBeforeForecast(game, data, year, week),
    );
    const aggregate = buildDefenseEvidence(evidence);
    const teamUsage = buildTeamUsage(evidence);
    const positionEvidence = Object.fromEntries(
      positions.map((position) => [position, evidence.filter((game) => game.position === position)]),
    );
    for (const game of actualGames) {
      const history = evidence.filter((row) => row.key === game.key);
      if (history.length < minimumHistory) continue;
      const profile = playerProfile(history, positionEvidence[game.position], year, week);
      if (profile.baseline < minimumProjection) continue;
      const defense = defenseProfile(aggregate, game.opponent, game.position);
      const personal = personalFactor(history, game.opponent, profile);
      const role = roleFeatures(history, teamUsage, profile, year, week);
      const advanced = advancedMatchupFeatures(
        advancedHistory,
        game.team,
        game.opponent,
        year,
        week,
      );
      const defenseVolumeValues = (fieldsByPosition[game.position] || [])
        .filter((field) => field !== "fantasy_points_allowed")
        .map((field) => finite(defense.ratios[field]))
        .filter(Number.isFinite);
      const safe = safeForecast(profile, defense, personal);
      const riskSweeps = Object.fromEntries(
        riskAmplifications.map((amplification) => {
          const forecast = futureRiskPath({
            data,
            game,
            profile,
            history,
            aggregate,
            amplification,
          });
          return [String(amplification), forecast];
        }),
      );
      const risky = riskSweeps[String(defaultRiskAmplification)];
      const strengthSweeps = Object.fromEntries(
        defenseStrengths.map((strength) => [
          String(strength),
          safeForecast(profile, defense, personal, strength).projection,
        ]),
      );
      records.push({
        forecast_id: `${year}:${week}:${game.player_id || `${normalizeName(game.name)}:${game.position}`}`,
        forecast_cutoff: Number.isFinite(data.forecastCutoff.get(week))
          ? new Date(data.forecastCutoff.get(week)).toISOString()
          : null,
        results_available_at: Number.isFinite(game.results_available_at)
          ? new Date(game.results_available_at).toISOString()
          : null,
        year,
        week,
        player: game.name,
        player_id: game.player_id,
        position: game.position,
        team: game.team,
        opponent: game.opponent,
        home: game.home,
        history_games: history.length,
        defense_games: defense.games,
        personal_games: personal.games,
        baseline: round(profile.baseline, 4),
        safe: round(safe.projection, 4),
        risky: round(risky?.projection, 4),
        risk_factor: round(risky?.factor || 1, 4),
        actual: game.points,
        actual_ratio: round(game.points / Math.max(0.1, profile.baseline), 4),
        safe_error: round(safe.projection - game.points, 4),
        risky_error: round((risky?.projection ?? safe.projection) - game.points, 4),
        strength_sweeps: strengthSweeps,
        risk_sweeps: Object.fromEntries(
          Object.entries(riskSweeps).map(([key, value]) => [key, {
            projection: round(value.projection, 4),
            factor: round(value.factor, 4),
          }]),
        ),
        features: {
          baseline_points: profile.baseline,
          log_baseline: Math.log1p(profile.baseline),
          week_fraction: game.week / 18,
          early_season: game.week <= 4 ? 1 : 0,
          ...role,
          ...advanced,
          home: game.home ? 1 : 0,
          defense_points_delta:
            number(defense.ratios.fantasy_points_allowed) - 1,
          defense_volume_delta: defenseVolumeValues.length
            ? mean(defenseVolumeValues) - 1
            : null,
          personal_delta: number(personal.factor) - 1,
          defense_reliability: defense.reliability,
          personal_reliability: personal.games / (personal.games + 4),
          // The advanced archive is a finalized-results dataset, not an
          // as-of market archive. Target-week market fields are unavailable
          // to a valid historical forecast and must remain missing.
          market_implied_points_delta: null,
          market_spread_scaled: null,
          ...Object.fromEntries(
            Object.entries(defense.ratios).map(([key, value]) => [
              `defense_${key}`,
              value,
            ]),
          ),
        },
      });
    }
    process.stdout.write(".");
  }
  process.stdout.write(" done\n");
}

if (!records.length)
  throw new Error("No eligible walk-forward player-games were produced.");

const overallSafe = metrics(records, "safe");
const overallRisky = metrics(records, "risky");
const byPosition = tableMetrics(records, "position");
const bySeason = tableMetrics(records, "year");
const labels = classification(records);
const predictors = predictorResults(records);
const savedSources = args["skip-saved-sources"]
  ? { results: [], excluded: ["Saved-source comparison skipped for this local run."] }
  : savedProjectionBenchmarks(records);
const strengthResults = defenseStrengths.map((strength) => {
  const field = `strength_${strength}`;
  const rows = records.map((row) => ({ ...row, [field]: row.strength_sweeps[String(strength)] }));
  return { strength, ...metrics(rows, field) };
});
const riskResults = riskAmplifications.map((amplification) => {
  const field = `risk_${amplification}`;
  const factorField = `factor_${amplification}`;
  const rows = records.map((row) => ({
    ...row,
    [field]: row.risk_sweeps[String(amplification)]?.projection,
    [factorField]: row.risk_sweeps[String(amplification)]?.factor,
  }));
  return {
    amplification,
    ...metrics(rows, field),
    label_macro_f1: classification(rows, factorField).macro_f1,
  };
});
const bestStrength = [...strengthResults].sort((a, b) => a.mae - b.mae)[0];
const bestRiskMae = [...riskResults].sort((a, b) => a.mae - b.mae)[0];
const bestRiskLabels = [...riskResults].sort(
  (a, b) => b.label_macro_f1 - a.label_macro_f1,
)[0];
const riskyWinRate =
  records.filter((row) => Math.abs(row.risky_error) < Math.abs(row.safe_error)).length /
  records.length;
const ties =
  records.filter((row) => Math.abs(row.risky_error) === Math.abs(row.safe_error)).length /
  records.length;
const safeMaeAdvantage = overallRisky.mae - overallSafe.mae;
const safeMaeAdvantagePercent = overallRisky.mae
  ? (safeMaeAdvantage / overallRisky.mae) * 100
  : 0;
const defaultStrengthResult = strengthResults.find(
  (row) => row.strength === defaultDefenseStrength,
);
const defenseStrengthGain = defaultStrengthResult
  ? defaultStrengthResult.mae - bestStrength.mae
  : 0;
const strongestPredictor = predictors[0];
const trainedArtifact = trainedModelArtifact(records);
const duplicateForecastIds = [...records.reduce((counts, row) => {
  counts.set(row.forecast_id, (counts.get(row.forecast_id) || 0) + 1);
  return counts;
}, new Map()).entries()].filter(([, count]) => count > 1);
const pairedPositionChecks = Object.entries(trainedArtifact.by_position).map(
  ([position, row]) => ({
    position,
    incumbent: row.holdout_incumbent?.sample || 0,
    challenger: row.holdout_challenger?.sample || 0,
    expected: row.validation_sample || 0,
    pass:
      row.holdout_incumbent?.sample === row.holdout_challenger?.sample &&
      row.holdout_incumbent?.sample === row.validation_sample,
  }),
);
const backtestAudit = {
  status:
    !duplicateForecastIds.length &&
    pairedPositionChecks.every((row) => row.pass) &&
    records.every((row) => Boolean(row.forecast_cutoff)) &&
    records.every(
      (row) =>
        row.features?.market_implied_points_delta == null &&
        row.features?.market_spread_scaled == null,
    )
      ? "PASS"
      : "FAIL",
  validation_season: validationYear,
  duplicate_forecast_ids: duplicateForecastIds.map(([id, count]) => ({ id, count })),
  paired_position_checks: pairedPositionChecks,
  target_week_market_fields_excluded: records.every(
    (row) =>
      row.features?.market_implied_points_delta == null &&
      row.features?.market_spread_scaled == null,
  ),
  incumbent_coefficients_refit_through: validationYear - 1,
  uncertainty_coefficients_refit_through: validationYear - 1,
  historical_cutoff_policy:
    "Wednesday 12:00 UTC before the target week; current-season evidence is admitted only after the entire source week's latest kickoff plus 54 hours (six-hour finality window plus 48-hour publication delay).",
  cutoff_rows_present: records.every((row) => Boolean(row.forecast_cutoff)),
};
if (backtestAudit.status !== "PASS")
  throw new Error(`Historical comparison audit failed: ${JSON.stringify(backtestAudit)}`);
const evidenceSummary = [
  `Safe / Expected lowered MAE by ${safeMaeAdvantage.toFixed(3)} points (${safeMaeAdvantagePercent.toFixed(1)}%) versus Risky.`,
  `The best tested defensive strength was ${bestStrength.strength}; its MAE advantage over ${defaultDefenseStrength} was ${defenseStrengthGain.toFixed(3)} points.`,
  strongestPredictor
    ? `The strongest single defensive input was ${strongestPredictor.position} ${strongestPredictor.field}, with absolute rank correlation ${Math.abs(strongestPredictor.rank_correlation).toFixed(4)}.`
    : "No defensive input had enough observations to evaluate.",
  `Boom recall was ${(labels.boom.recall * 100).toFixed(1)}% and bust recall was ${(labels.bust.recall * 100).toFixed(1)}%; the current labels are selective but miss most extreme outcomes.`,
];

console.log("\n1) HEADLINE ACCURACY");
console.table([
  { mode: "Safe / Expected", ...overallSafe },
  { mode: "Risky", ...overallRisky },
]);
console.log(
  `Risky beat Safe / Expected in ${(riskyWinRate * 100).toFixed(1)}% of player-games; ${(ties * 100).toFixed(1)}% tied.`,
);

console.log("\n2) ACCURACY BY POSITION");
console.table(byPosition);
console.log("\n3) ACCURACY BY SEASON");
console.table(bySeason);

console.log("\n4) MATCHUP-STRENGTH SWEEP (lower MAE/RMSE is better)");
console.table(
  strengthResults.map(({ strength, sample, mae, rmse, bias, rank_correlation }) => ({
    strength,
    sample,
    mae,
    rmse,
    bias,
    rank_correlation,
  })),
);
console.log(
  `Best tested defensive strength: ${bestStrength.strength} (MAE ${bestStrength.mae}). Current backtest default: ${defaultDefenseStrength}.`,
);

console.log("\n5) RISK AMPLIFICATION SWEEP");
console.table(
  riskResults.map(({ amplification, sample, mae, rmse, bias, rank_correlation, label_macro_f1 }) => ({
    amplification,
    sample,
    mae,
    rmse,
    bias,
    rank_correlation,
    label_macro_f1,
  })),
);
console.log(
  `Best Risky MAE: ${bestRiskMae.amplification}x. Best boom/bust macro-F1: ${bestRiskLabels.amplification}x. Current backtest default: ${defaultRiskAmplification}x.`,
);

console.log("\n6) BOOM / BUST LABEL CALIBRATION");
console.table([
  { label: "Boom", ...labels.boom },
  { label: "Bust", ...labels.bust },
]);
console.log(`Macro-F1: ${labels.macro_f1}`);

console.log("\n7) MOST PREDICTIVE DEFENSIVE INPUTS");
console.table(
  predictors.slice(0, 20).map((row) => ({
    position: row.position,
    statistic: row.field,
    sample: row.sample,
    rank_correlation: row.rank_correlation,
    direction_accuracy: `${(row.direction_accuracy * 100).toFixed(1)}%`,
  })),
);

console.log("\n8) SAVED 2025 SOURCE BASELINES");
if (savedSources.results.length) {
  console.table(
    savedSources.results.map((row) => ({
      source: row.source,
      players: row.players,
      games: row.games,
      player_coverage: `${(row.player_coverage * 100).toFixed(1)}%`,
      source_mae: row.source_metrics.mae,
      safe_same_games_mae: row.safe_same_games.mae,
      mae_vs_safe: row.mae_vs_safe,
      source_rmse: row.source_metrics.rmse,
      source_bias: row.source_metrics.bias,
      rank_correlation: row.source_metrics.rank_correlation,
    })),
  );
  console.log("Position detail:");
  console.table(
    savedSources.results.flatMap((row) =>
      row.by_position.map((position) => ({ source: row.source, ...position })),
    ),
  );
  console.log("Accumulated season accuracy (same players and eligible weeks):");
  console.table(
    savedSources.results.flatMap((row) => [
      {
        comparison_set: row.source,
        model: row.source,
        players: row.accumulated_season.sample,
        ...row.accumulated_season.source,
      },
      {
        comparison_set: row.source,
        model: "Arsenal Safe / Expected",
        players: row.accumulated_season.sample,
        ...row.accumulated_season.safe,
      },
      {
        comparison_set: row.source,
        model: "Arsenal Risky",
        players: row.accumulated_season.sample,
        ...row.accumulated_season.risky,
      },
    ]),
  );
  console.log(
    "These are season-total baselines divided by 17 games, not archived weekly projections. Frozen Git snapshots are valid preseason baselines; backup/postseason rows are leakage demonstrations only.",
  );
}
savedSources.excluded.forEach((line) => console.log(`- ${line}`));

console.log("\n9) EVIDENCE-BACKED TAKEAWAYS");
evidenceSummary.forEach((line) => console.log(`- ${line}`));
console.log("\n10) POSITION-SPECIFIC TRAINED ADJUSTMENTS");
console.table(
  Object.entries(trainedArtifact.by_position).map(([position, row]) => ({
    position,
    selected: row.selected_model,
    challenger: row.tuned_challenger,
    promoted: row.promotion?.promoted,
    training: row.training_sample,
    holdout: row.validation_sample,
    lambda: row.lambda,
    strength: row.application_strength,
    baseline_mae: row.holdout_baseline?.mae,
    trained_mae: row.holdout_trained?.mae,
    improvement: row.holdout_mae_improvement,
  })),
);
console.log(`\nHistorical comparison audit: ${backtestAudit.status}`);

const report = {
  title: "The Fantasy Arsenal local walk-forward stat model backtest",
  generated_at: new Date().toISOString(),
  local_only: true,
  configuration: {
    seasons,
    scoring,
    minimum_history_games: minimumHistory,
    minimum_projection: minimumProjection,
    default_defense_strength: defaultDefenseStrength,
    default_risk_amplification: defaultRiskAmplification,
  },
  methodology: {
    walk_forward:
      "Every forecast is frozen at Wednesday 12:00 UTC. Current-season results enter only after the entire source week is final and a conservative 48-hour publication delay has elapsed; target-week and future results are excluded.",
    population:
      "Accuracy is active-game conditional. A player-game is included only when saved raw usage indicates the player participated and at least the configured number of earlier games exists.",
    safe_expected:
      "A recency-weighted player baseline is sample-shrunk toward the position median, then adjusted using pre-week defense-vs-position evidence and sample-regressed personal opponent history.",
    risky:
      "The frozen Safe / Expected schedule path is centered and amplified using player volatility, matchup differences, and home/away context, then normalized back to the same remaining-season expectation.",
    defense_predictors:
      "Each defensive statistic is calculated per team-game using only pre-week raw stats. Correlations compare the frozen defensive index with the player's actual result relative to their frozen baseline.",
    weather:
      "Historical kickoff weather was not saved in the local archive and is therefore excluded instead of reconstructed or invented.",
    limitations: [
      "Historical season-level team identity can misattribute pre-trade games for players who changed teams during a season.",
      "The test evaluates current model mechanics using rolling historical baselines; equivalent archived preseason projection-source boards do not exist for every tested season.",
      "Active-game conditional accuracy does not measure the separate problem of predicting inactive players or surprise workload changes.",
    ],
  },
  headline: {
    safe_expected: overallSafe,
    risky: overallRisky,
    risky_win_rate: round(riskyWinRate, 4),
    tie_rate: round(ties, 4),
  },
  by_position: byPosition,
  by_season: bySeason,
  matchup_strength_sweep: strengthResults,
  risk_amplification_sweep: riskResults,
  recommended_tested_settings: {
    lowest_mae_defense_strength: bestStrength,
    lowest_mae_risk_amplification: bestRiskMae,
    best_label_f1_risk_amplification: bestRiskLabels,
  },
  label_calibration: labels,
  defensive_predictors: predictors,
  saved_2025_projection_baselines: savedSources,
  evidence_summary: evidenceSummary,
  trained_adjustments: trainedArtifact,
  historical_comparison_audit: backtestAudit,
  records,
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const requestedOutputRoot = args["output-dir"]
  ? path.resolve(root, String(args["output-dir"]))
  : outputRoot;
const outputName = String(args["output-name"] || stamp).replace(/[^a-z0-9_.-]/gi, "-");
fs.mkdirSync(requestedOutputRoot, { recursive: true });
const jsonFile = path.join(requestedOutputRoot, `${outputName}.json`);
const markdownFile = path.join(requestedOutputRoot, `${outputName}.md`);
fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));

const markdown = `# The Fantasy Arsenal - Local Stat Model Backtest

Generated: ${report.generated_at}

## Scope

- Seasons: ${seasons.join(", ")}
- Scoring: ${scoring.toUpperCase()}
- Eligible active player-games: ${records.length.toLocaleString()}
- Minimum prior games: ${minimumHistory}
- Strict walk-forward cutoff: **yes**
- Historical weather: **not archived; excluded**

## Headline accuracy

${markdownTable(
  [
    { mode: "Safe / Expected", ...overallSafe },
    { mode: "Risky", ...overallRisky },
  ],
  ["mode", "sample", "mae", "rmse", "bias", "rank_correlation", "within_3", "within_5"],
)}

Risky beat Safe / Expected in **${(riskyWinRate * 100).toFixed(1)}%** of eligible player-games.

## By position

${markdownTable(byPosition, ["position", "sample", "safe_mae", "risky_mae", "safe_rmse", "risky_rmse", "risk_wins"])}

## By season

${markdownTable(bySeason, ["year", "sample", "safe_mae", "risky_mae", "safe_rmse", "risky_rmse", "risk_wins"])}

## Defensive adjustment sweep

${markdownTable(strengthResults, ["strength", "sample", "mae", "rmse", "bias", "rank_correlation"])}

Best tested defensive strength by MAE: **${bestStrength.strength}**.

## Risk amplification sweep

${markdownTable(riskResults, ["amplification", "sample", "mae", "rmse", "bias", "rank_correlation", "label_macro_f1"])}

Best Risky MAE: **${bestRiskMae.amplification}x**. Best boom/bust label macro-F1: **${bestRiskLabels.amplification}x**.

## Boom / bust calibration

${markdownTable(
  [
    { label: "Boom", ...labels.boom },
    { label: "Bust", ...labels.bust },
  ],
  ["label", "actual", "predicted", "true_positive", "false_positive", "false_negative", "precision", "recall", "f1"],
)}

## Most predictive defensive inputs

${markdownTable(predictors.slice(0, 30), ["position", "field", "sample", "pearson", "rank_correlation", "direction_accuracy"])}

## Saved 2025 source baselines

These comparisons convert each saved season-total projection into a flat per-game baseline by dividing by 17. They are **not** archived weekly projections. Frozen Git snapshots are valid preseason baselines. Backup/postseason rows are intentionally included as leakage demonstrations and must not be ranked as forecasts.

${markdownTable(
  savedSources.results.map((row) => ({
    source: row.source,
    players: row.players,
    games: row.games,
    player_coverage: row.player_coverage,
    source_mae: row.source_metrics.mae,
    safe_same_games_mae: row.safe_same_games.mae,
    mae_vs_safe: row.mae_vs_safe,
    source_rmse: row.source_metrics.rmse,
    source_bias: row.source_metrics.bias,
    rank_correlation: row.source_metrics.rank_correlation,
  })),
  ["source", "players", "games", "player_coverage", "source_mae", "safe_same_games_mae", "mae_vs_safe", "source_rmse", "source_bias", "rank_correlation"],
)}

### Source baseline accuracy by position

${markdownTable(
  savedSources.results.flatMap((row) =>
    row.by_position.map((position) => ({ source: row.source, ...position })),
  ),
  ["source", "position", "sample", "source_mae", "safe_mae", "source_rmse", "safe_rmse", "source_bias"],
)}

### Accumulated season accuracy

Each row sums actual points and every model's weekly projection over the same eligible games for each player. This compares player-season totals without allowing different source coverage to change the population.

${markdownTable(
  savedSources.results.flatMap((row) => [
    {
      comparison_set: row.source,
      model: row.source,
      players: row.accumulated_season.sample,
      ...row.accumulated_season.source,
    },
    {
      comparison_set: row.source,
      model: "Arsenal Safe / Expected",
      players: row.accumulated_season.sample,
      ...row.accumulated_season.safe,
    },
    {
      comparison_set: row.source,
      model: "Arsenal Risky",
      players: row.accumulated_season.sample,
      ...row.accumulated_season.risky,
    },
  ]),
  ["comparison_set", "model", "players", "mae", "rmse", "bias", "rank_correlation", "within_3", "within_5"],
)}

### Excluded saved sources

${savedSources.excluded.length ? savedSources.excluded.map((line) => `- ${line}`).join("\n") : "- None."}

## Evidence-backed takeaways

${evidenceSummary.map((line) => `- ${line}`).join("\n")}

## Methodology and limitations

${Object.values(report.methodology)
  .flat()
  .map((line) => `- ${line}`)
  .join("\n")}
`;
fs.writeFileSync(markdownFile, markdown);

if (candidateName) {
  const candidateDirectory = path.join(root, "data", "model-challengers", candidateName);
  fs.mkdirSync(candidateDirectory, { recursive: true });
  const definition = {
    ...trainedArtifact,
    challenger_name: candidateName,
    frozen_at: report.generated_at,
    training_cutoff_season: Math.max(...seasons),
    forward_test_required_weeks: 4,
    publication_status: "candidate",
  };
  definition.definition_sha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(definition))
    .digest("hex");
  fs.writeFileSync(
    path.join(candidateDirectory, "calibration.json"),
    JSON.stringify(definition, null, 2),
  );
  fs.writeFileSync(
    path.join(candidateDirectory, "training-report.json"),
    JSON.stringify(
      {
        ...report,
        records: undefined,
        note: "The full player-game ledger remains in ignored scripts/_stat_backtests; this review artifact intentionally retains summaries and all candidate leaderboards without duplicating that ledger.",
      },
      null,
      2,
    ),
  );
  console.log(`Frozen challenger '${candidateName}' in ${candidateDirectory}.`);
}

if (args.publish) {
  const publishedFile = path.join(
    root,
    "public",
    "stats",
    "projections",
    "model-calibration.json",
  );
  fs.mkdirSync(path.dirname(publishedFile), { recursive: true });
  fs.writeFileSync(publishedFile, JSON.stringify(trainedArtifact, null, 2));
  console.log(`Published validated calibration: ${publishedFile}`);
}

console.log("\n11) LOCAL REPORT FILES");
console.log(`Readable report: ${markdownFile}`);
console.log(`Full audit data: ${jsonFile}`);
console.log(
  args.publish
    ? "\nOnly the compact validated calibration was published; detailed player-game backtests remain local.\n"
    : "\nNothing was written to public/ and nothing is exposed to the website.\n",
);
