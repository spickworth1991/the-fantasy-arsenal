import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const labDir = path.join(root, "data", "model-challengers", "position-model-lab-v1");
const historyFile = path.join(root, "scripts", "_stat_backtests", "replays", "position-model-lab-history", "report.json");
const feature2026File = path.join(root, "scripts", "_stat_backtests", "replays", "position-model-lab-2026-features", "report.json");
const exactFile = path.join(root, "data", "model-challengers", "manual-stat-trend-v1", "retrospective-2026.json");
const accuracyDir = path.join(root, "public", "stats", "projections", "2026", "accuracy-results");
const positions = ["QB", "RB", "WR", "TE", "K"];
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, places = 5) => Number.isFinite(value) ? Number(value.toFixed(places)) : null;
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q, lower = Math.floor(at), upper = Math.ceil(at);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const identity = (row) => String(row.player_id || `${normalize(row.player || row.name)}|${row.position}`);

const fieldsByPosition = {
  QB: ["pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "fum_lost"],
  RB: ["rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"],
  WR: ["rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"],
  TE: ["rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"],
  K: ["fga", "fgm", "xpa", "xpm", "kick_pts"],
};
const commonFeatures = [
  "projection", "log_projection", "week_fraction", "early_season", "recent_form_delta",
  "snap_share", "snap_trend", "opportunity_share", "opportunity_trend", "red_zone_share",
  "weighted_opportunity_share", "weighted_opportunity_trend", "opportunity_volatility",
  "history_reliability", "advanced_reliability", "team_pace_delta", "offense_play_volume_delta",
  "offense_epa_per_play", "offense_success_rate", "opponent_epa_per_play_allowed",
  "opponent_success_rate_allowed", "home", "defense_points_delta", "defense_volume_delta",
  "personal_delta", "defense_reliability", "personal_reliability", "market_implied_points_delta",
  "market_spread_scaled",
];
const positionFeatures = {
  QB: [...commonFeatures, "offense_pass_rate", "offense_neutral_pass_rate", "protection_pressure_rate", "protection_sack_rate", "opponent_pressure_rate", "opponent_sack_rate", "pressure_mismatch", "opponent_blitz_rate", "time_to_throw", "ngs_cpoe", "carry_share", "carry_share_trend"],
  RB: [...commonFeatures, "carry_share", "carry_share_trend", "target_share", "target_share_trend", "high_value_touch_rate", "ngs_ryoe_per_carry", "ngs_box_eight_rate", "offense_red_zone_play_rate", "opponent_red_zone_play_rate_allowed"],
  WR: [...commonFeatures, "target_share", "target_share_trend", "air_yard_share", "high_value_touch_rate", "ngs_separation", "ngs_yac_over_expected", "receiving_epa_per_target", "opponent_man_rate", "opponent_zone_rate", "offense_pass_rate"],
  TE: [...commonFeatures, "target_share", "target_share_trend", "air_yard_share", "high_value_touch_rate", "ngs_separation", "receiving_epa_per_target", "opponent_man_rate", "opponent_zone_rate", "offense_red_zone_play_rate"],
  K: [...commonFeatures, "offense_red_zone_play_rate", "opponent_red_zone_play_rate_allowed", "offense_third_down_success_rate", "defense_fga", "defense_fgm", "defense_xpa", "defense_xpm"],
};
const armNames = {
  QB: ["qb_component_ridge", "qb_component_boosted"],
  RB: ["rb_opportunity_ridge", "rb_opportunity_boosted"],
  WR: ["wr_usage_ridge", "wr_usage_boosted"],
  TE: ["te_role_mixture_ridge", "te_role_mixture_boosted"],
  K: ["k_opportunity_ridge", "k_opportunity_boosted"],
};
const adjustmentStrengths = [.25, .5, .75];
const correctionStrengths = [.25, .5, .75, 1.05, 1.1, 1.15, 1.2, 1.25, 1.5];
const componentBlendStrengths = [.1, .2, .25, .35, .4, .5, .6, .75];
function expandModelVariants(predictions, position) {
  const next = { ...predictions };
  for (const strength of adjustmentStrengths) {
    const suffix = String(Math.round(strength * 100));
    next[`manual_adjustment_${suffix}`] = predictions.safe + strength * (predictions.manual_stat_trend - predictions.safe);
    next[`combined_adjustment_${suffix}`] = predictions.safe + strength * (predictions.original_combined - predictions.safe);
  }
  for (const strength of correctionStrengths) {
    const suffix = String(Math.round(strength * 100));
    next[`bias_corrected_manual_${suffix}`] = predictions.manual_stat_trend + strength * (predictions.bias_calibrated_manual - predictions.manual_stat_trend);
    next[`residual_corrected_combined_${suffix}`] = predictions.original_combined + strength * (predictions.residual_corrected_combined - predictions.original_combined);
  }
  for (const strength of componentBlendStrengths) {
    const suffix = String(Math.round(strength * 100));
    for (const arm of armNames[position])
      next[`${arm}_over_manual_${suffix}`] = predictions.manual_stat_trend + strength * (predictions[arm] - predictions.manual_stat_trend);
  }
  return next;
}
function eligibleArmNames(position) {
  const general = ["manual_stat_trend", "original_combined", "bias_calibrated_manual", "residual_corrected_combined"];
  const adjustmentVariants = adjustmentStrengths.flatMap((strength) => {
    const suffix = String(Math.round(strength * 100));
    return [`manual_adjustment_${suffix}`, `combined_adjustment_${suffix}`];
  });
  const correctionVariants = correctionStrengths.flatMap((strength) => {
    const suffix = String(Math.round(strength * 100));
    return [`bias_corrected_manual_${suffix}`, `residual_corrected_combined_${suffix}`];
  });
  const componentVariants = componentBlendStrengths.flatMap((strength) => {
    const suffix = String(Math.round(strength * 100));
    return armNames[position].map((arm) => `${arm}_over_manual_${suffix}`);
  });
  return [...general, ...armNames[position].flatMap((arm) => [arm, `${arm}_calibrated`]), ...adjustmentVariants, ...correctionVariants, ...componentVariants];
}

function scoreLine(position, line = {}) {
  if (position === "QB") return finite(line.pass_yd) * .04 + finite(line.pass_td) * 4 - finite(line.pass_int) * 2 + finite(line.rush_yd) * .1 + finite(line.rush_td) * 6 - finite(line.fum_lost) * 2;
  if (position === "K") return finite(line.kick_pts, finite(line.fgm) * 3 + finite(line.xpm));
  return finite(line.rush_yd) * .1 + finite(line.rush_td) * 6 + finite(line.rec) + finite(line.rec_yd) * .1 + finite(line.rec_td) * 6 - finite(line.fum_lost) * 2;
}
function coherent(position, input) {
  const line = Object.fromEntries(Object.entries(input || {}).map(([key, value]) => [key, Math.max(0, finite(value))]));
  if (position === "QB") line.pass_cmp = Math.min(finite(line.pass_cmp), finite(line.pass_att));
  if (["RB", "WR", "TE"].includes(position)) line.rec = Math.min(finite(line.rec), finite(line.rec_tgt));
  if (position === "K") {
    line.fgm = Math.min(finite(line.fgm), finite(line.fga));
    line.xpm = Math.min(finite(line.xpm), finite(line.xpa));
  }
  return line;
}
function alignedLine(row) {
  const source = row.baseline_line || {};
  const before = scoreLine(row.position, source);
  const factor = before > .25 ? clamp(row.safe / before, .65, 1.35) : 1;
  return coherent(row.position, Object.fromEntries(fieldsByPosition[row.position].map((field) => [field, finite(source[field]) * factor])));
}
function vector(row, names, extra = {}) {
  return names.map((name) => {
    if (name === "projection") return finite(row.safe);
    if (name === "log_projection") return Math.log1p(Math.max(0, finite(row.safe)));
    if (name.startsWith("baseline_")) return finite(extra[name.slice(9)]);
    if (name.startsWith("role_")) return row.role_cohort === name.slice(5) ? 1 : 0;
    return finite(row.features?.[name]);
  });
}
function solve(matrix, target) {
  const n = target.length, a = matrix.map((row, index) => [...row, target[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = Math.abs(a[column][column]) < 1e-10 ? 1e-10 : a[column][column];
    for (let value = column; value <= n; value += 1) a[column][value] /= divisor;
    for (let row = 0; row < n; row += 1) if (row !== column) {
      const factor = a[row][column];
      for (let value = column; value <= n; value += 1) a[row][value] -= factor * a[column][value];
    }
  }
  return a.map((row) => row[n]);
}
function fitRidge(samples, names, target, lambda = 30) {
  const raw = samples.map((row) => vector(row, names, alignedLine(row)));
  const means = names.map((_, index) => mean(raw.map((row) => row[index])));
  const scales = names.map((_, index) => Math.sqrt(mean(raw.map((row) => (row[index] - means[index]) ** 2))) || 1);
  const x = raw.map((row) => [1, ...row.map((value, index) => (value - means[index]) / scales[index])]);
  const rawTargets = samples.map(target), low = quantile(rawTargets, .02), high = quantile(rawTargets, .98);
  const y = rawTargets.map((value) => clamp(value, low, high));
  const p = names.length + 1, xtx = Array.from({ length: p }, () => Array(p).fill(0)), xty = Array(p).fill(0);
  for (let row = 0; row < x.length; row += 1) for (let left = 0; left < p; left += 1) {
    xty[left] += x[row][left] * y[row];
    for (let right = 0; right < p; right += 1) xtx[left][right] += x[row][left] * x[row][right];
  }
  for (let index = 1; index < p; index += 1) xtx[index][index] += lambda;
  return { kind: "ridge", names, means, scales, coefficients: solve(xtx, xty) };
}
function predictRidge(model, row, extra = {}) {
  const values = vector(row, model.names, extra);
  return model.coefficients[0] + values.reduce((sum, value, index) => sum + ((value - model.means[index]) / model.scales[index]) * model.coefficients[index + 1], 0);
}
function fitBoosted(samples, names, target, rounds = 28, learningRate = .08) {
  const values = samples.map((row) => vector(row, names, alignedLine(row)));
  const rawTargets = samples.map(target), low = quantile(rawTargets, .02), high = quantile(rawTargets, .98);
  const y = rawTargets.map((value) => clamp(value, low, high)), base = mean(y), predictions = y.map(() => base), trees = [];
  const thresholds = names.map((_, feature) => [0.1, .25, .4, .55, .7, .85, .95].map((q) => quantile(values.map((row) => row[feature]), q)).filter((value, index, all) => index === 0 || value !== all[index - 1]));
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const residuals = y.map((value, index) => value - predictions[index]);
    let best = null;
    for (let feature = 0; feature < names.length; feature += 1) for (const threshold of thresholds[feature]) {
      const left = [], right = [];
      values.forEach((row, index) => (row[feature] <= threshold ? left : right).push(residuals[index]));
      if (left.length < 20 || right.length < 20) continue;
      const leftMean = mean(left), rightMean = mean(right);
      const loss = values.reduce((sum, row, index) => sum + (residuals[index] - (row[feature] <= threshold ? leftMean : rightMean)) ** 2, 0);
      if (!best || loss < best.loss) best = { feature, threshold, left: leftMean * learningRate, right: rightMean * learningRate, loss };
    }
    if (!best) break;
    trees.push(best);
    values.forEach((row, index) => { predictions[index] += row[best.feature] <= best.threshold ? best.left : best.right; });
  }
  return { kind: "boosted", names, base, trees };
}
function predictBoosted(model, row, extra = {}) {
  const values = vector(row, model.names, extra);
  return model.base + model.trees.reduce((sum, tree) => sum + (values[tree.feature] <= tree.threshold ? tree.left : tree.right), 0);
}
const predictModel = (model, row, extra) => model.kind === "ridge" ? predictRidge(model, row, extra) : predictBoosted(model, row, extra);

function adaptation(row) {
  const current = row.adaptation_context?.current_per_game, prior = row.adaptation_context?.prior_per_game, games = finite(row.adaptation_context?.current_games);
  if (!current || !prior || games < 3 || !["QB", "RB", "WR"].includes(row.position)) return row.safe;
  const volume = row.position === "QB" ? ["pass_att", "rush_att"] : ["rush_att", "rec_tgt"];
  const next = { ...prior }, reliability = games / (games + 4);
  for (const field of volume) if (finite(prior[field]) > 0) next[field] = finite(prior[field]) * clamp(1 + (finite(current[field]) / finite(prior[field]) - 1) * reliability * .5, .75, 1.25);
  const before = scoreLine(row.position, prior), after = scoreLine(row.position, next);
  return before > 0 ? row.safe * clamp(after / before, .75, 1.25) : row.safe;
}
function combined(row) {
  const adapted = adaptation(row), manual = row.manual;
  return ["QB", "RB"].includes(row.position)
    ? clamp(row.safe + (adapted - row.safe) + (manual - row.safe), Math.max(0, row.safe * .4), row.safe * 1.6)
    : manual;
}
function fitPositionModels(position, training) {
  const rows = training.filter((row) => row.position === position && row.actual_line && row.baseline_line);
  const names = positionFeatures[position];
  const fields = fieldsByPosition[position];
  const component = (kind) => Object.fromEntries(fields.map((field) => {
    const target = (row) => {
      const base = finite(alignedLine(row)[field]), divisor = Math.max(.25, Math.abs(base));
      return clamp((finite(row.actual_line[field]) - base) / divisor, -2, 3);
    };
    const expanded = [...names, `baseline_${field}`];
    return [field, kind === "ridge" ? fitRidge(rows, expanded, target, 50) : fitBoosted(rows, expanded, target)];
  }));
  const residualNames = [...names, "manual_delta", "combined_delta"];
  const residualRows = rows.map((row) => ({ ...row, features: { ...row.features, manual_delta: row.manual - row.safe, combined_delta: row.combined - row.safe } }));
  const residual = fitRidge(residualRows, residualNames, (row) => row.actual - row.combined, 80);
  const bands = new Map();
  for (const row of rows) {
    const key = `${Math.floor(row.manual / 5) * 5}|${row.role_cohort || "unknown"}`;
    const list = bands.get(key) || [];
    list.push(row.actual - row.manual);
    bands.set(key, list);
  }
  const bias = Object.fromEntries([...bands].map(([key, values]) => [key, mean(values) * values.length / (values.length + 40)]));
  return { ridge: component("ridge"), boosted: component("boosted"), residual, bias };
}
function componentPrediction(row, models, kind) {
  const base = alignedLine(row), next = { ...base };
  for (const field of fieldsByPosition[row.position]) {
    const divisor = Math.max(.25, Math.abs(finite(base[field])));
    const delta = clamp(predictModel(models[kind][field], row, base), -1.25, 2);
    next[field] = Math.max(0, finite(base[field]) + delta * divisor);
  }
  const points = scoreLine(row.position, coherent(row.position, next));
  return clamp(points, Math.max(0, row.safe * .5), row.safe * 1.55);
}
function predictArms(row, models) {
  const biasKey = `${Math.floor(row.manual / 5) * 5}|${row.role_cohort || "unknown"}`;
  const residualRow = { ...row, features: { ...row.features, manual_delta: row.manual - row.safe, combined_delta: row.combined - row.safe } };
  const prefix = { QB: "qb_component", RB: "rb_opportunity", WR: "wr_usage", TE: "te_role_mixture", K: "k_opportunity" }[row.position];
  return {
    safe: row.safe,
    manual_stat_trend: row.manual,
    original_combined: row.combined,
    bias_calibrated_manual: clamp(row.manual + finite(models.bias[biasKey]), Math.max(0, row.manual * .75), row.manual * 1.25),
    residual_corrected_combined: clamp(row.combined + predictRidge(models.residual, residualRow, alignedLine(row)), Math.max(0, row.combined * .75), row.combined * 1.25),
    [`${prefix}_ridge`]: componentPrediction(row, models, "ridge"),
    [`${prefix}_boosted`]: componentPrediction(row, models, "boosted"),
  };
}

function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value), result = Array(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let index = start; index <= end; index += 1) result[order[index].index] = rank;
    start = end + 1;
  }
  return result;
}
function correlation(left, right) {
  const lm = mean(left), rm = mean(right), numerator = left.reduce((sum, value, index) => sum + (value - lm) * (right[index] - rm), 0);
  const denominator = Math.sqrt(left.reduce((sum, value) => sum + (value - lm) ** 2, 0) * right.reduce((sum, value) => sum + (value - rm) ** 2, 0));
  return denominator ? numerator / denominator : null;
}
function closeCalls(rows, arm) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.year}:${row.week}:${row.position}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const decisions = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => b.predictions[arm] - a.predictions[arm]);
    for (let index = 0; index + 1 < sorted.length; index += 1) {
      const high = sorted[index], low = sorted[index + 1];
      if (high.predictions[arm] - low.predictions[arm] > 3) continue;
      decisions.push({ correct: high.actual >= low.actual ? 1 : 0, lost: Math.max(0, low.actual - high.actual) });
    }
  }
  return { sample: decisions.length, accuracy: mean(decisions.map((row) => row.correct)), average_points_lost: mean(decisions.map((row) => row.lost)) };
}
function metrics(rows, arm) {
  const missing = rows.filter((row) => !Number.isFinite(Number(row.predictions?.[arm])));
  if (missing.length) throw new Error(`${arm} is missing ${missing.length} finite predictions; refusing to score an incomplete model arm.`);
  const errors = rows.map((row) => row.predictions[arm] - row.actual), absolute = errors.map(Math.abs);
  const calibrated = rows.filter((row) => row.intervals?.[arm]);
  const widths = calibrated.map((row) => row.intervals[arm].p90 - row.intervals[arm].p10);
  const wis = mean(rows.map((row) => {
    const interval = row.intervals?.[arm];
    if (!interval) return 0;
    const low = row.predictions[arm] + interval.p10, high = row.predictions[arm] + interval.p90, width = high - low;
    return width + (row.actual < low ? 10 * (low - row.actual) : 0) + (row.actual > high ? 10 * (row.actual - high) : 0);
  }));
  const boomBrier = mean(calibrated.map((row) => (row.intervals[arm].boom_probability - (row.actual >= row.predictions[arm] + 5 ? 1 : 0)) ** 2));
  const bustBrier = mean(calibrated.map((row) => (row.intervals[arm].bust_probability - (row.actual <= row.predictions[arm] - 5 ? 1 : 0)) ** 2));
  return {
    sample: rows.length, mae: round(mean(absolute)), rmse: round(Math.sqrt(mean(errors.map((value) => value ** 2)))), bias: round(mean(errors)),
    median_absolute_error: round(quantile(absolute, .5)), p90_absolute_error: round(quantile(absolute, .9)),
    within_2_rate: round(absolute.filter((value) => value <= 2).length / rows.length), within_5_rate: round(absolute.filter((value) => value <= 5).length / rows.length),
    rank_correlation: round(correlation(ranks(rows.map((row) => row.predictions[arm])), ranks(rows.map((row) => row.actual)))),
    p10_p90_coverage: calibrated.length ? round(calibrated.filter((row) => row.actual >= row.predictions[arm] + row.intervals[arm].p10 && row.actual <= row.predictions[arm] + row.intervals[arm].p90).length / calibrated.length) : null,
    interval_width: round(mean(widths)), weighted_interval_score: round(wis), boom_brier: round(boomBrier), bust_brier: round(bustBrier), close_call: closeCalls(rows, arm),
  };
}
function clusteredInterval(rows, baseline, candidate, repetitions = 1000) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.year}:${row.week}:${[row.team, row.opponent].sort().join("-")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const values = [...groups.values()], results = [];
  let state = 0x9e3779b9;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    let before = 0, after = 0;
    for (let index = 0; index < values.length; index += 1) for (const row of values[Math.floor(random() * values.length)]) {
      before += Math.abs(row.predictions[baseline] - row.actual);
      after += Math.abs(row.predictions[candidate] - row.actual);
    }
    results.push((before - after) / Math.max(.001, before));
  }
  return { clusters: values.length, lower_95: round(quantile(results, .025)), upper_95: round(quantile(results, .975)) };
}
function summarize(rows) {
  const positionsReport = {};
  for (const position of positions) {
    const sample = rows.filter((row) => row.position === position), arms = sample.length ? Object.keys(sample[0].predictions) : [];
    const safe = metrics(sample, "safe");
    positionsReport[position] = Object.fromEntries(arms.map((arm) => {
      const result = metrics(sample, arm), interval = arm === "safe" ? null : clusteredInterval(sample, "safe", arm);
      return [arm, { ...result, mae_improvement_rate: arm === "safe" ? 0 : round((safe.mae - result.mae) / safe.mae), rmse_improvement_rate: arm === "safe" ? 0 : round((safe.rmse - result.rmse) / safe.rmse), bias_improvement_points: arm === "safe" ? 0 : round(Math.abs(safe.bias) - Math.abs(result.bias)), confidence_95: interval }];
    }));
  }
  return positionsReport;
}

function historyRows() {
  const report = JSON.parse(fs.readFileSync(historyFile, "utf8"));
  return (report.records || []).filter((row) => positions.includes(row.position) && Number.isFinite(Number(row.actual))).map((row) => {
    const mapped = {
      year: Number(row.year), week: Number(row.week), player_id: row.player_id, name: row.player, position: row.position, team: row.team, opponent: row.opponent,
      safe: finite(row.b), manual: finite(row.c, finite(row.b)), actual: finite(row.actual), actual_line: row.actual_stat_line,
      baseline_line: row.adaptation_context?.prior_per_game, features: row.features || {}, adaptation_context: row.adaptation_context, role_cohort: row.role_cohort,
    };
    mapped.combined = combined(mapped);
    return mapped;
  });
}
function exact2026Rows() {
  const exact = JSON.parse(fs.readFileSync(exactFile, "utf8")), feature = JSON.parse(fs.readFileSync(feature2026File, "utf8"));
  const final = new Set(exact.fully_final_weeks || []);
  const featureMap = new Map((feature.records || []).filter((row) => Number(row.year) === 2026).map((row) => [`${row.week}:${identity(row)}`, row]));
  const statMap = new Map();
  for (const file of fs.readdirSync(accuracyDir).filter((name) => /^week-\d+\.json$/.test(name))) {
    const payload = JSON.parse(fs.readFileSync(path.join(accuracyDir, file), "utf8"));
    for (const row of payload.player_results || []) if (row.scoring === "ppr" && row.lens === "safe_expected" && row.stat_line) statMap.set(`${row.week}:${identity(row)}`, row.stat_line);
  }
  return (exact.records || []).filter((row) => final.has(Number(row.week))).flatMap((row) => {
    const context = featureMap.get(`${row.week}:${identity(row)}`), baseline = statMap.get(`${row.week}:${identity(row)}`);
    if (!context || !baseline) return [];
    return [{ year: 2026, week: Number(row.week), player_id: row.player_id, name: row.name, position: row.position, team: row.team, opponent: row.opponent, safe: finite(row.incumbent), manual: finite(row.manual_stat_trend), combined: finite(row.combined_adaptation_manual), actual: finite(row.actual), actual_line: context.actual_stat_line, baseline_line: baseline, features: context.features || {}, adaptation_context: context.adaptation_context, role_cohort: context.role_cohort }];
  });
}
function predictFold(training, evaluation) {
  const models = Object.fromEntries(positions.map((position) => [position, fitPositionModels(position, training)]));
  const calibration = {};
  const pointCorrections = {};
  for (const position of positions) {
    const trainRows = training.filter((row) => row.position === position && row.safe >= 5).map((row) => ({ ...row, predictions: expandModelVariants(predictArms(row, models[position]), position) }));
    pointCorrections[position] = Object.fromEntries(armNames[position].map((arm) => {
      const residual = mean(trainRows.map((row) => row.actual - row.predictions[arm]));
      return [arm, residual * trainRows.length / (trainRows.length + 100)];
    }));
    for (const row of trainRows) for (const arm of armNames[position])
      row.predictions[`${arm}_calibrated`] = row.predictions[arm] + pointCorrections[position][arm];
    calibration[position] = {};
    for (const arm of Object.keys(trainRows[0]?.predictions || {})) {
      const residuals = trainRows.map((row) => row.actual - row.predictions[arm]);
      calibration[position][arm] = {
        p10: quantile(residuals, .1), p50: quantile(residuals, .5), p90: quantile(residuals, .9),
        boom_probability: residuals.filter((value) => value >= 5).length / Math.max(1, residuals.length),
        bust_probability: residuals.filter((value) => value <= -5).length / Math.max(1, residuals.length),
        sample: residuals.length,
      };
    }
  }
  return evaluation.filter((row) => row.safe >= 5).map((row) => {
    const predictions = expandModelVariants(predictArms(row, models[row.position]), row.position);
    for (const arm of armNames[row.position]) predictions[`${arm}_calibrated`] = predictions[arm] + pointCorrections[row.position][arm];
    return { ...row, predictions, intervals: calibration[row.position] };
  });
}

const historical = historyRows();
const proxyRows = [];
for (const year of [2022, 2023, 2024, 2025]) proxyRows.push(...predictFold(historical.filter((row) => row.year < year), historical.filter((row) => row.year === year)));
const chronologicalRows = proxyRows.filter((row) => [2024, 2025].includes(row.year));
const exactRows = predictFold(historical.filter((row) => row.year <= 2025), exact2026Rows());
const searchBudgetSeconds = Math.max(0, Number(process.argv.filter((value) => value.startsWith("--search-budget=")).at(-1)?.split("=")[1] || 0));
const searchSeed = Number(process.argv.filter((value) => value.startsWith("--seed=")).at(-1)?.split("=")[1] || 20261028);
const requestedSearchPositions = process.argv.filter((value) => value.startsWith("--position=")).at(-1)?.split("=")[1]?.toUpperCase().split(",").filter((position) => positions.includes(position));
const activeSearchPositions = requestedSearchPositions?.length ? requestedSearchPositions : positions;
const reuseSearchLedger = process.argv.includes("--reuse-ledger");
const requestedSearchFamily = process.argv.filter((value) => value.startsWith("--family=")).at(-1)?.split("=")[1];
const searchStartedAt = Date.now(), searchDeadline = searchStartedAt + searchBudgetSeconds * 1000;
const searchFeatureGroups = {
  compact: ["projection", "log_projection", "week_fraction", "early_season", "recent_form_delta", "history_reliability", "advanced_reliability"],
  role: ["projection", "log_projection", "week_fraction", "recent_form_delta", "snap_share", "snap_trend", "opportunity_share", "opportunity_trend", "weighted_opportunity_share", "weighted_opportunity_trend", "opportunity_volatility", "history_reliability", "role_role_expansion", "role_established_starter", "role_established_reserve"],
  context: ["projection", "log_projection", "week_fraction", "recent_form_delta", "team_pace_delta", "offense_play_volume_delta", "offense_epa_per_play", "offense_success_rate", "opponent_epa_per_play_allowed", "opponent_success_rate_allowed", "defense_points_delta", "defense_volume_delta", "market_implied_points_delta", "market_spread_scaled", "home"],
};
const searchBase = (row, base) => base === "safe" ? row.safe : base === "manual" ? row.manual : row.combined;
const quickMetrics = (rows, predictions) => {
  const errors = rows.map((row, index) => predictions[index] - row.actual), safeErrors = rows.map((row) => row.safe - row.actual);
  const mae = mean(errors.map(Math.abs)), safeMae = mean(safeErrors.map(Math.abs));
  const rmse = Math.sqrt(mean(errors.map((value) => value ** 2))), safeRmse = Math.sqrt(mean(safeErrors.map((value) => value ** 2)));
  return { sample: rows.length, mae, rmse, bias: mean(errors), maeImprovement: (safeMae - mae) / safeMae, rmseImprovement: (safeRmse - rmse) / safeRmse, biasImprovement: Math.abs(mean(safeErrors)) - Math.abs(mean(errors)) };
};
function searchModel(config, training) {
  const target = (row) => {
    const residual = row.actual - searchBase(row, config.base);
    const cap = Math.max(2, row.safe * config.targetCap);
    return clamp(residual, -cap, cap);
  };
  if (config.family === "cohort") {
    const globalResiduals = training.map(target), global = mean(globalResiduals), cells = new Map();
    for (const row of training) {
      const key = searchCohortKey(row, config), values = cells.get(key) || [];
      values.push(target(row)); cells.set(key, values);
    }
    return { kind: "cohort", global, cells: Object.fromEntries([...cells].map(([key, values]) => [key, { sample: values.length, residual: (mean(values) * values.length + global * config.prior) / (values.length + config.prior) }])) };
  }
  if (config.family === "volume_ridge" || config.family === "volume_boosted") {
    const fit = (field) => {
      const target = (row) => {
        const base = finite(alignedLine(row)[field]), actual = finite(row.actual_line?.[field]);
        return clamp((actual - base) / Math.max(2, base), -config.targetCap, config.targetCap);
      };
      return config.family === "volume_ridge" ? fitRidge(training, config.features, target, config.lambda) : fitBoosted(training, config.features, target, config.rounds, config.learningRate);
    };
    return { kind: "rb_volume", rush_att: fit("rush_att"), rec_tgt: fit("rec_tgt") };
  }
  if (config.family === "switch_ridge" || config.family === "switch_boosted") {
    const target = (row) => Math.abs(row.safe - row.actual) - Math.abs(searchBase(row, config.base) - row.actual);
    const predictor = config.family === "switch_ridge" ? fitRidge(training, config.features, target, config.lambda) : fitBoosted(training, config.features, target, config.rounds, config.learningRate);
    return { kind: "rb_switch", predictor };
  }
  return config.family === "ridge"
    ? fitRidge(training, config.features, target, config.lambda)
    : fitBoosted(training, config.features, target, config.rounds, config.learningRate);
}
function searchCohortKey(row, config) {
  const role = row.role_cohort || "unknown", band = Math.floor(searchBase(row, config.base) / config.bandSize) * config.bandSize;
  const trend = finite(row.features?.opportunity_trend) > config.trendThreshold ? "up" : finite(row.features?.opportunity_trend) < -config.trendThreshold ? "down" : "flat";
  if (config.grouping === "role_band") return `${role}|${band}`;
  if (config.grouping === "band_trend") return `${band}|${trend}`;
  return `${role}|${band}|${trend}`;
}
function searchPredict(config, model, row) {
  if (model.kind === "rb_switch") {
    const advantage = predictModel(model.predictor, row, alignedLine(row));
    const adjustment = advantage > config.threshold ? config.strength * (searchBase(row, config.base) - row.safe) : 0;
    return clamp(row.safe + adjustment + finite(model.biasCorrection), Math.max(0, row.safe * .55), row.safe * 1.5);
  }
  if (model.kind === "rb_volume") {
    const line = alignedLine(row), next = { ...line };
    const rushDelta = clamp(predictModel(model.rush_att, row, line), -config.predictionCap, config.predictionCap);
    const targetDelta = clamp(predictModel(model.rec_tgt, row, line), -config.predictionCap, config.predictionCap);
    const rushAtt = Math.max(0, finite(line.rush_att)), recTgt = Math.max(0, finite(line.rec_tgt));
    next.rush_att = rushAtt * (1 + config.strength * rushDelta);
    next.rec_tgt = recTgt * (1 + config.strength * targetDelta);
    const rushScale = rushAtt > .25 ? next.rush_att / rushAtt : 1, targetScale = recTgt > .25 ? next.rec_tgt / recTgt : 1;
    for (const field of ["rush_yd", "rush_td"]) next[field] = finite(line[field]) * rushScale;
    for (const field of ["rec", "rec_yd", "rec_td"]) next[field] = finite(line[field]) * targetScale;
    const componentPoints = scoreLine("RB", coherent("RB", next)), base = searchBase(row, config.base);
    return clamp(base + (componentPoints - row.safe) + finite(model.biasCorrection), Math.max(0, row.safe * .55), row.safe * 1.5);
  }
  const base = searchBase(row, config.base), residual = model.kind === "cohort" ? finite(model.cells[searchCohortKey(row, config)]?.residual, model.global) : predictModel(model, row, alignedLine(row));
  const cap = Math.max(1.5, row.safe * config.predictionCap);
  return clamp(base + config.strength * clamp(residual, -cap, cap) + finite(model.biasCorrection), Math.max(0, row.safe * .55), row.safe * 1.5);
}
function fitCalibratedSearchModel(config, training) {
  const model = searchModel(config, training);
  model.biasCorrection = 0;
  if (finite(config.calibrationStrength) > 0) {
    const trainingBias = mean(training.map((row) => searchPredict(config, model, row) - row.actual));
    model.biasCorrection = -trainingBias * config.calibrationStrength;
  }
  return model;
}
function evaluateSearchConfig(config, evaluationYears) {
  const rows = [], predictions = [];
  for (const year of evaluationYears) {
    const training = historical.filter((row) => row.position === config.position && row.year < year && row.safe >= 5);
    const evaluation = historical.filter((row) => row.position === config.position && row.year === year && row.safe >= 5);
    if (training.length < 100 || !evaluation.length) continue;
    const model = fitCalibratedSearchModel(config, training);
    for (const row of evaluation) { rows.push(row); predictions.push(searchPredict(config, model, row)); }
  }
  return { rows, predictions, metrics: quickMetrics(rows, predictions) };
}
function seededShuffle(values, seed) {
  const result = [...values]; let state = seed >>> 0;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [result[index], result[swap]] = [result[swap], result[index]]; }
  return result;
}
const previousSearchEvaluation = fs.existsSync(path.join(labDir, "evaluation.json")) ? JSON.parse(fs.readFileSync(path.join(labDir, "evaluation.json"), "utf8")) : null;
const previousSearchModels = fs.existsSync(path.join(labDir, "models.json")) ? JSON.parse(fs.readFileSync(path.join(labDir, "models.json"), "utf8")) : null;
const previousSearchLedger = fs.existsSync(path.join(labDir, "search-ledger.json")) ? JSON.parse(fs.readFileSync(path.join(labDir, "search-ledger.json"), "utf8")) : null;
const searchResults = { enabled: searchBudgetSeconds > 0, budget_seconds: searchBudgetSeconds, seed: searchSeed, positions: activeSearchPositions, elapsed_seconds: 0, candidates_tested: 0, current_run_candidates_tested: 0, by_position: {} };
const searchLedger = { version: "position-model-search-v1", seed: searchSeed, budget_seconds: searchBudgetSeconds, generated_at: null, by_position: {} };
const searchDeploymentModels = Object.fromEntries(positions.map((position) => [position, activeSearchPositions.includes(position) ? {} : (previousSearchModels?.search_models?.[position] || {})]));
if (searchBudgetSeconds > 0) {
  const families = ["ridge", "boosted"], bases = ["safe", "manual", "combined"], strengths = [.25, .5, .75, 1], caps = [.12, .2, .3], targetCaps = [.2, .35, .5];
  const configurations = Object.fromEntries(activeSearchPositions.map((position, positionIndex) => {
    const groups = { ...searchFeatureGroups, full: positionFeatures[position] };
    const configs = [];
    for (const family of families) for (const base of bases) for (const [featureGroup, features] of Object.entries(groups)) for (const strength of strengths) for (const predictionCap of caps) for (const targetCap of targetCaps) {
      if (family === "ridge") for (const lambda of [10, 30, 80, 180]) configs.push({ position, family, base, featureGroup, features, strength, predictionCap, targetCap, lambda });
      else for (const [rounds, learningRate] of [[12, .05], [20, .06], [28, .08]]) configs.push({ position, family, base, featureGroup, features, strength, predictionCap, targetCap, rounds, learningRate });
    }
    if (position === "RB") for (const base of bases) for (const strength of [.25, .5, .75, 1, 1.25]) for (const predictionCap of [.12, .2, .3]) for (const targetCap of [.2, .35, .5]) for (const prior of [10, 25, 50, 100]) for (const bandSize of [5, 10]) for (const trendThreshold of [.05, .1]) for (const grouping of ["role_band_trend", "role_band", "band_trend"]) for (const calibrationStrength of [0, .5, .75, 1])
      configs.push({ position, family: "cohort", base, featureGroup: "hierarchical_cohort", features: [], strength, predictionCap, targetCap, prior, bandSize, trendThreshold, grouping, calibrationStrength });
    if (position === "RB") for (const family of ["volume_ridge", "volume_boosted"]) for (const base of bases) for (const [featureGroup, features] of Object.entries(groups)) for (const strength of [.25, .5, .75, 1]) for (const predictionCap of [.15, .25, .4]) for (const targetCap of [.5, .75, 1]) for (const calibrationStrength of [0, .5, .75, 1]) {
      if (family === "volume_ridge") for (const lambda of [10, 30, 80, 180]) configs.push({ position, family, base, featureGroup, features, strength, predictionCap, targetCap, lambda, calibrationStrength });
      else for (const [rounds, learningRate] of [[12, .05], [20, .06], [28, .08]]) configs.push({ position, family, base, featureGroup, features, strength, predictionCap, targetCap, rounds, learningRate, calibrationStrength });
    }
    if (position === "RB") for (const family of ["switch_ridge", "switch_boosted"]) for (const base of ["manual", "combined"]) for (const [featureGroup, features] of Object.entries(groups)) for (const strength of [.25, .35, .4, .45, .5, .55, .6, .75, 1]) for (const threshold of [-.5, 0, .25, .4, .5, .6, .75, 1]) for (const calibrationStrength of [0, .5, 1]) {
      if (family === "switch_ridge") for (const lambda of [10, 30, 80, 180]) configs.push({ position, family, base, featureGroup, features, strength, threshold, predictionCap: .3, targetCap: .5, lambda, calibrationStrength });
      else for (const [rounds, learningRate] of [[12, .05], [20, .06], [28, .08]]) configs.push({ position, family, base, featureGroup, features, strength, threshold, predictionCap: .3, targetCap: .5, rounds, learningRate, calibrationStrength });
    }
    const filtered = requestedSearchFamily ? configs.filter((config) => config.family.includes(requestedSearchFamily)) : configs;
    return [position, seededShuffle(filtered, searchSeed + positionIndex * 7919)];
  }));
  const discovery = Object.fromEntries(activeSearchPositions.map((position) => {
    const groups = { ...searchFeatureGroups, full: positionFeatures[position] };
    const reused = reuseSearchLedger ? (previousSearchLedger?.by_position?.[position] || []).map((entry) => ({ config: { ...entry.config, features: groups[entry.config.featureGroup] || [] }, discovery: entry.discovery })) : [];
    return [position, reused];
  }));
  let cursor = 0;
  while (Date.now() < searchDeadline) {
    let evaluatedAny = false;
    for (const position of activeSearchPositions) {
      const config = configurations[position][cursor];
      if (!config || Date.now() >= searchDeadline) continue;
      const result = evaluateSearchConfig(config, [2022, 2023, 2024]);
      if (result.metrics.sample) discovery[position].push({ config, discovery: result.metrics });
      searchResults.current_run_candidates_tested += 1; evaluatedAny = true;
    }
    if (!evaluatedAny) break;
    cursor += 1;
  }
  for (const position of activeSearchPositions) {
    const eligible = discovery[position]
      .filter((entry) => entry.discovery.maeImprovement > 0 && entry.discovery.rmseImprovement >= -.005 && entry.discovery.biasImprovement >= -.2);
    const score = (entry) => entry.discovery.maeImprovement * .55 + entry.discovery.rmseImprovement * .35 + Math.max(-.01, Math.min(.01, entry.discovery.biasImprovement / 20));
    const selected = new Map();
    const add = (entry) => selected.set(JSON.stringify({ ...entry.config, features: undefined }), entry);
    eligible.sort((left, right) => score(right) - score(left)).slice(0, 8).forEach(add);
    for (const family of [...new Set(eligible.map((entry) => entry.config.family))])
      eligible.filter((entry) => entry.config.family === family).sort((left, right) => score(right) - score(left)).slice(0, 4).forEach(add);
    eligible.sort((left, right) => right.discovery.biasImprovement - left.discovery.biasImprovement || score(right) - score(left)).slice(0, 4).forEach(add);
    const shortlist = [...selected.values()].sort((left, right) => score(right) - score(left)).slice(0, 28);
    const verified = shortlist.map((entry, index) => {
      const selection = evaluateSearchConfig(entry.config, [2025]);
      const training = historical.filter((row) => row.position === position && row.year <= 2025 && row.safe >= 5);
      const exact = exactRows.filter((row) => row.position === position), model = fitCalibratedSearchModel(entry.config, training);
      const exactPredictions = exact.map((row) => searchPredict(entry.config, model, row));
      return { ...entry, id: `searched_${position.toLowerCase()}_${index + 1}`, selection: selection.metrics, exact: quickMetrics(exact, exactPredictions), exactRows: exact, exactPredictions };
    }).sort((left, right) => {
      const score = (entry) => entry.discovery.maeImprovement * .25 + entry.selection.maeImprovement * .4 + entry.exact.maeImprovement * .2 + entry.selection.rmseImprovement * .15;
      return score(right) - score(left);
    });
    const finalists = verified.filter((entry) => entry.selection.maeImprovement > 0 && entry.selection.rmseImprovement >= 0 && entry.selection.biasImprovement >= -.15 && entry.exact.maeImprovement > 0 && entry.exact.rmseImprovement >= 0 && entry.exact.biasImprovement >= -.15).slice(0, 3);
    searchDeploymentModels[position] = {};
    for (const finalist of finalists) {
      for (const year of [2022, 2023, 2024, 2025]) {
        const training = historical.filter((row) => row.position === position && row.year < year && row.safe >= 5), model = fitCalibratedSearchModel(finalist.config, training);
        const trainingResiduals = training.map((row) => row.actual - searchPredict(finalist.config, model, row));
        const interval = { p10: quantile(trainingResiduals, .1), p50: quantile(trainingResiduals, .5), p90: quantile(trainingResiduals, .9), boom_probability: trainingResiduals.filter((value) => value >= 5).length / trainingResiduals.length, bust_probability: trainingResiduals.filter((value) => value <= -5).length / trainingResiduals.length, sample: trainingResiduals.length };
        for (const row of proxyRows.filter((candidate) => candidate.position === position && candidate.year === year)) { row.predictions[finalist.id] = searchPredict(finalist.config, model, row); row.intervals[finalist.id] = interval; }
      }
      const deploymentTraining = historical.filter((row) => row.position === position && row.year <= 2025 && row.safe >= 5), deploymentModel = fitCalibratedSearchModel(finalist.config, deploymentTraining);
      const deploymentResiduals = deploymentTraining.map((row) => row.actual - searchPredict(finalist.config, deploymentModel, row));
      const exactInterval = { p10: quantile(deploymentResiduals, .1), p50: quantile(deploymentResiduals, .5), p90: quantile(deploymentResiduals, .9), boom_probability: deploymentResiduals.filter((value) => value >= 5).length / deploymentResiduals.length, bust_probability: deploymentResiduals.filter((value) => value <= -5).length / deploymentResiduals.length, sample: deploymentResiduals.length };
      finalist.exactRows.forEach((row, index) => { row.predictions[finalist.id] = finalist.exactPredictions[index]; row.intervals[finalist.id] = exactInterval; });
      searchDeploymentModels[position][finalist.id] = { config: finalist.config, model: deploymentModel, interval: exactInterval };
    }
    searchResults.by_position[position] = {
      tested: discovery[position].length,
      shortlisted: shortlist.length,
      finalists: finalists.map(({ id, config, discovery: discoveryMetrics, selection, exact }) => ({ id, config: { ...config, features: undefined }, discovery: discoveryMetrics, selection, exact })),
      near_misses: verified.filter((entry) => !finalists.includes(entry)).slice(0, 3).map(({ id, config, discovery: discoveryMetrics, selection, exact }) => ({ id, config: { ...config, features: undefined }, discovery: discoveryMetrics, selection, exact })),
    };
    searchLedger.by_position[position] = discovery[position].map(({ config, discovery: metrics }) => ({ config: { ...config, features: undefined }, discovery: metrics }));
  }
  for (const position of positions.filter((position) => !activeSearchPositions.includes(position))) {
    searchResults.by_position[position] = previousSearchEvaluation?.position_search?.by_position?.[position] || { tested: 0, shortlisted: 0, finalists: [], near_misses: [] };
    searchLedger.by_position[position] = previousSearchLedger?.by_position?.[position] || [];
  }
  searchResults.candidates_tested = Object.values(searchLedger.by_position).reduce((sum, rows) => sum + rows.length, 0);
  searchResults.elapsed_seconds = round((Date.now() - searchStartedAt) / 1000, 2);
  searchLedger.generated_at = new Date().toISOString();
}
const proxySummary = summarize(proxyRows), chronologicalSummary = summarize(chronologicalRows), exactSummary = summarize(exactRows);
const chronologicalByYear = Object.fromEntries([2024, 2025].map((year) => [year, summarize(chronologicalRows.filter((row) => row.year === year))]));
const finalistAssessment = Object.fromEntries(positions.map((position) => {
  const candidates = Object.keys(exactSummary[position] || {}).filter((arm) => arm !== "safe");
  return [position, Object.fromEntries(candidates.map((arm) => {
    const chronological = chronologicalSummary[position][arm], exact = exactSummary[position][arm], safeExact = exactSummary[position].safe;
    const yearResults = [2024, 2025].map((year) => chronologicalByYear[year]?.[position]?.[arm]).filter(Boolean);
    const checks = {
      chronological_mae_at_least_one_percent: chronological.mae_improvement_rate >= .01,
      chronological_rmse_not_worse: chronological.rmse_improvement_rate >= 0,
      chronological_clustered_interval_positive: chronological.confidence_95?.lower_95 > 0,
      chronological_bias_within_limit: chronological.bias_improvement_points >= -.15,
      no_year_worse_than_half_percent: yearResults.every((row) => row.mae_improvement_rate >= -.005),
      exact_2026_mae_positive: exact.mae_improvement_rate > 0,
      exact_2026_rmse_not_worse: exact.rmse_improvement_rate >= 0,
      exact_bias_within_limit: exact.bias_improvement_points >= -.15,
      rank_correlation_within_limit: finite(exact.rank_correlation) - finite(safeExact.rank_correlation) >= -.01,
      close_call_accuracy_within_limit: finite(exact.close_call?.accuracy) - finite(safeExact.close_call?.accuracy) >= -.01,
      interval_score_within_limit: finite(exact.weighted_interval_score, Infinity) <= finite(safeExact.weighted_interval_score, Infinity) * 1.02,
      interval_coverage_within_limit: Math.abs(finite(exact.p10_p90_coverage) - .8) <= Math.abs(finite(safeExact.p10_p90_coverage) - .8) + .02,
      boom_probability_within_limit: finite(exact.boom_brier, Infinity) <= finite(safeExact.boom_brier, Infinity) + .02,
      bust_probability_within_limit: finite(exact.bust_brier, Infinity) <= finite(safeExact.bust_brier, Infinity) + .02,
      minimum_samples: chronological.sample >= (position === "K" ? 150 : position === "TE" ? 400 : 500) && exact.sample >= (position === "K" ? 30 : position === "TE" ? 100 : 150),
    };
    const finalist = Object.values(checks).every(Boolean);
    const allAroundScore = 100 * (
      .35 * chronological.mae_improvement_rate +
      .25 * exact.mae_improvement_rate +
      .20 * chronological.rmse_improvement_rate +
      .15 * exact.rmse_improvement_rate +
      .05 * chronological.confidence_95.lower_95
    );
    return [arm, {
      checks,
      finalist,
      all_around_score: round(allAroundScore),
      bias_tiebreaker: round(chronological.bias_improvement_points + exact.bias_improvement_points),
    }];
  }))];
}));
const positionSelections = Object.fromEntries(positions.map((position) => {
  const qualified = Object.entries(finalistAssessment[position])
    .filter(([, assessment]) => assessment.finalist)
    .sort(([, left], [, right]) => right.all_around_score - left.all_around_score || right.bias_tiebreaker - left.bias_tiebreaker);
  return [position, qualified.length ? {
    status: "qualified_all_around_finalist",
    model: qualified[0][0],
    all_around_score: qualified[0][1].all_around_score,
    alternatives: qualified.slice(1).map(([model, assessment]) => ({ model, all_around_score: assessment.all_around_score })),
  } : { status: "no_model_clears_all_around_gate", model: null, all_around_score: null, alternatives: [] }];
}));
const report = {
  generated_at: new Date().toISOString(), version: "position-model-lab-v1", site_exposed: false, promotion_automatic: false,
  sources: { history: path.relative(root, historyFile), exact_features_2026: path.relative(root, feature2026File), exact_frozen_2026: path.relative(root, exactFile) },
  methodology: "Arsenal-only position models. Historical forecasts are expanding-window and leakage-safe. Exact 2026 uses frozen pre-kickoff Safe/stat lines joined to pregame feature rows.",
  evidence: {
    historical_2022_2025_proxy: { rows: proxyRows.length, by_position: proxySummary },
    chronological_2024_2025: { rows: chronologicalRows.length, by_position: chronologicalSummary, by_year: chronologicalByYear },
    exact_2026: { rows: exactRows.length, source_rows: exact2026Rows().length, coverage_rate: round(exactRows.length / Math.max(1, exact2026Rows().length)), weeks: [...new Set(exactRows.map((row) => row.week))].sort((a, b) => a - b), by_position: exactSummary },
  },
  finalist_assessment: finalistAssessment,
  position_selections: positionSelections,
  position_search: searchResults,
};
const deploymentModels = Object.fromEntries(positions.map((position) => {
  const training = historical.filter((row) => row.position === position && row.safe >= 5);
  const models = fitPositionModels(position, historical);
  const trainingPredictions = training.map((row) => ({ row, predictions: predictArms(row, models) }));
  const point_corrections = Object.fromEntries(armNames[position].map((arm) => {
    const residual = mean(trainingPredictions.map(({ row, predictions }) => row.actual - predictions[arm]));
    return [arm, residual * trainingPredictions.length / (trainingPredictions.length + 100)];
  }));
  return [position, { models, point_corrections, training_sample: training.length }];
}));
const modelBundle = {
  version: "position-model-lab-v1", trained_at: report.generated_at,
  training_seasons: [2020, 2021, 2022, 2023, 2024, 2025],
  position_features: positionFeatures, fields_by_position: fieldsByPosition,
  positions: deploymentModels,
  search_models: searchDeploymentModels,
};
modelBundle.sha256 = crypto.createHash("sha256").update(JSON.stringify(modelBundle)).digest("hex");
const definition = {
  version: report.version, model_type: "private_position_model_lab", generated_at: report.generated_at, site_exposed: false, capture_enabled: false,
  controls: ["safe", "manual_stat_trend", "original_combined", "boom_bust", "average_of_all"],
  experimental_arms: [...new Set([...positions.flatMap(eligibleArmNames), ...Object.values(searchDeploymentModels).flatMap((models) => Object.keys(models))])],
  eligible_positions: Object.fromEntries(positions.map((position) => [position, [...eligibleArmNames(position), ...Object.keys(searchDeploymentModels[position] || {})]])),
  data_policy: "No competitor projection is a model input. Historical missingness remains explicit; no future game may enter a target forecast.",
  model_bundle_sha256: modelBundle.sha256,
  definition_sha256: null,
};
definition.definition_sha256 = crypto.createHash("sha256").update(JSON.stringify(definition)).digest("hex");
fs.mkdirSync(labDir, { recursive: true });
fs.writeFileSync(path.join(labDir, "definition.json"), JSON.stringify(definition, null, 2));
fs.writeFileSync(path.join(labDir, "evaluation.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(labDir, "models.json"), JSON.stringify(modelBundle, null, 2));
if (searchResults.enabled) {
  const searchRunDirectory = path.join(labDir, "search-runs");
  fs.mkdirSync(searchRunDirectory, { recursive: true });
  fs.writeFileSync(path.join(labDir, "search-ledger.json"), JSON.stringify(searchLedger, null, 2));
  fs.writeFileSync(path.join(searchRunDirectory, `seed-${searchSeed}.json`), JSON.stringify({ search: searchResults, ledger: searchLedger }, null, 2));
}
const lines = ["# Position Model Lab", "", `Generated: ${report.generated_at}`, "", "Positive changes mean better than Safe."];
for (const [evidenceName, evidence] of Object.entries(report.evidence)) {
  lines.push("", `## ${evidenceName}`, "", "| Position | Model | MAE change | RMSE change | Bias improvement | 95% MAE range |", "|---|---|---:|---:|---:|---:|");
  for (const position of positions) for (const [arm, row] of Object.entries(evidence.by_position[position] || {})) {
    if (arm === "safe") continue;
    lines.push(`| ${position} | ${arm} | ${(row.mae_improvement_rate * 100).toFixed(2)}% | ${(row.rmse_improvement_rate * 100).toFixed(2)}% | ${row.bias_improvement_points.toFixed(3)} | ${row.confidence_95 ? `${(row.confidence_95.lower_95 * 100).toFixed(2)}% to ${(row.confidence_95.upper_95 * 100).toFixed(2)}%` : "—"} |`);
  }
}
lines.push("", "## Current finalist gate", "", "Passing means the arm cleared every predeclared accuracy, stability, decision, and sample check. It does not publish the model.", "", "| Position | Model | Result |", "|---|---|---:|");
for (const position of positions) for (const [arm, assessment] of Object.entries(finalistAssessment[position]))
  lines.push(`| ${position} | ${arm} | ${assessment.finalist ? "FINALIST" : "HOLD"} |`);
lines.push("", "## All-around position selections", "", "A selection is made only from models that passed every gate. The score weights chronological MAE 35%, exact-2026 MAE 25%, chronological RMSE 20%, exact-2026 RMSE 15%, and the lower confidence bound 5%. Bias, yearly stability, ranking, close-call accuracy, and sample size are mandatory gates rather than tradeable score points.", "", "| Position | Qualified selection | All-around score |", "|---|---|---:|");
for (const position of positions) {
  const selection = positionSelections[position];
  lines.push(`| ${position} | ${selection.model || "None — retain Safe while testing"} | ${selection.all_around_score ?? "—"} |`);
}
if (searchResults.enabled) {
  lines.push("", "## Five-minute position search", "", `Tested ${searchResults.candidates_tested} configurations in ${searchResults.elapsed_seconds} seconds using seed ${searchResults.seed}.`, "", "| Position | Tested | Shortlisted | Search finalists |", "|---|---:|---:|---:|");
  for (const position of positions) {
    const result = searchResults.by_position[position];
    lines.push(`| ${position} | ${result.tested} | ${result.shortlisted} | ${result.finalists.length} |`);
  }
  lines.push("", "### Search finalists and closest misses", "", "| Position | Candidate | Status | Discovery MAE | 2025 MAE | Exact 2026 MAE |", "|---|---|---|---:|---:|---:|");
  for (const position of positions) {
    const result = searchResults.by_position[position];
    for (const candidate of result.finalists)
      lines.push(`| ${position} | ${candidate.id} | Search finalist | ${(candidate.discovery.maeImprovement * 100).toFixed(2)}% | ${(candidate.selection.maeImprovement * 100).toFixed(2)}% | ${(candidate.exact.maeImprovement * 100).toFixed(2)}% |`);
    for (const candidate of result.near_misses)
      lines.push(`| ${position} | ${candidate.id} | Near miss | ${(candidate.discovery.maeImprovement * 100).toFixed(2)}% | ${(candidate.selection.maeImprovement * 100).toFixed(2)}% | ${(candidate.exact.maeImprovement * 100).toFixed(2)}% |`);
  }
}
fs.writeFileSync(path.join(labDir, "report.md"), `${lines.join("\n")}\n`);
console.log(`Position Model Lab complete: ${proxyRows.length} historical proxy, ${chronologicalRows.length} chronological, and ${exactRows.length} exact 2026 player-games.`);
for (const position of positions) {
  const selection = positionSelections[position];
  console.log(selection.model
    ? `${position}: ${selection.model} is the qualified all-around leader (score ${selection.all_around_score}).`
    : `${position}: no candidate clears the all-around gate; retain Safe while testing.`);
}
console.log(`Report: ${path.join(labDir, "report.md")}`);
console.log("Nothing was published or connected to the live projection feed.");
