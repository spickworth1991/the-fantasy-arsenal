import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }),
);
const requestedYears = String(args.season || args.seasons || "2024,2025")
  .split(",")
  .map(Number)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
if (!requestedYears.length) throw new Error("Pass a valid --season or --seasons value.");
const quick = Boolean(args.quick);
const experiment = String(args.experiment || "workload").toLowerCase();
if (!new Set(["workload", "team-volume", "qb-adaptation", "stat-adaptation", "weighted-stat-trend"]).has(experiment))
  throw new Error("--experiment must be workload, team-volume, qb-adaptation, stat-adaptation, or weighted-stat-trend.");
const evaluationYears = quick ? [requestedYears.at(-1)] : requestedYears;
const firstEvaluationYear = Math.min(...evaluationYears);
const dataYears = Array.from(
  new Set([
    firstEvaluationYear - 2,
    firstEvaluationYear - 1,
    ...evaluationYears,
  ]),
).sort((a, b) => a - b);
const runId = String(
  args["run-id"] || new Date().toISOString().replace(/[:.]/g, "-"),
).replace(/[^a-z0-9_.-]/gi, "-");
const replayRoot = path.join(root, "scripts", "_stat_backtests", "replays");
const runDirectory = path.join(replayRoot, runId);
const relativeRunDirectory = path.relative(root, runDirectory);
if (
  relativeRunDirectory.startsWith("..") ||
  path.isAbsolute(relativeRunDirectory) ||
  runDirectory.toLowerCase().includes(`${path.sep}public${path.sep}`) ||
  runDirectory.toLowerCase().includes(`${path.sep}data${path.sep}model-challengers${path.sep}`)
)
  throw new Error("Replay output must remain inside scripts/_stat_backtests/replays.");
fs.mkdirSync(runDirectory, { recursive: true });

const round = (value, digits = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const finite = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const quantile = (values, probability) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const sha = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const fileSha = (file) =>
  fs.existsSync(file) ? sha(fs.readFileSync(file)) : null;
const playerKey = (row) =>
  row.player_id || `${String(row.player || "").toLowerCase()}|${row.position}`;
const gameGroup = (row) =>
  `${row.year}:${row.week}:${[row.team, row.opponent].sort().join("-")}`;

const protectedFiles = [
  path.join(root, "public", "stats", "projections", "model-calibration.json"),
  path.join(root, "data", "model-challengers", "current", "calibration.json"),
  path.join(root, "data", "model-challengers", "current", "forward-report.json"),
];
const protectedBefore = Object.fromEntries(
  protectedFiles.map((file) => [path.relative(root, file), fileSha(file)]),
);

console.log("\nTHE FANTASY ARSENAL - LOCAL HISTORICAL PROJECTION REPLAY");
console.log("=".repeat(67));
console.log(`Evaluation seasons: ${evaluationYears.join(", ")}${quick ? " (quick mechanics check)" : ""}`);
console.log(`Experiment: ${experiment}`);
console.log("Building leakage-audited walk-forward features...");

execFileSync(
  process.execPath,
  [
    "--no-warnings",
    path.join(root, "scripts", "backtest-stat-model.mjs"),
    `--seasons=${dataYears.join(",")}`,
    "--skip-saved-sources",
    `--output-dir=${relativeRunDirectory}`,
    "--output-name=walk-forward-input",
  ],
  { cwd: root, stdio: "inherit", maxBuffer: 40 * 1024 * 1024 },
);

const inputFile = path.join(runDirectory, "walk-forward-input.json");
const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
if (input.historical_comparison_audit?.status !== "PASS")
  throw new Error("The historical comparison audit did not pass; replay aborted.");
const records = (input.records || []).filter((row) =>
  dataYears.includes(Number(row.year)),
);
const workloadFeatureNames = [
  "recent_form_delta",
  "snap_share",
  "snap_trend",
  "opportunity_share",
  "opportunity_trend",
  "target_share",
  "target_share_trend",
  "carry_share",
  "carry_share_trend",
  "weighted_opportunity_share",
  "weighted_opportunity_trend",
  "red_zone_share",
  "high_value_touch_rate",
  "two_minute_opportunity_rate",
  "third_down_opportunity_rate",
  "opportunity_volatility",
];
const positions = ["QB", "RB", "WR", "TE", "K"];
const incumbentFile = path.join(
  root,
  "public",
  "stats",
  "projections",
  "model-calibration.json",
);
const incumbentRaw = JSON.parse(fs.readFileSync(incumbentFile, "utf8"));
const incumbent = incumbentRaw.trained_adjustments || incumbentRaw;

function fitRidge(
  rows,
  names,
  lambda,
  targetOf = (row) => row.actual / Math.max(0.1, row.baseline) - 1,
) {
  if (!rows.length || !names.length) return null;
  const means = {};
  const scales = {};
  for (const name of names) {
    const values = rows.map((row) => finite(row.features?.[name])).filter(Number.isFinite);
    means[name] = mean(values);
    scales[name] = Math.sqrt(mean(values.map((value) => (value - means[name]) ** 2))) || 1;
  }
  const matrix = rows.map((row) =>
    names.map((name) => {
      const value = finite(row.features?.[name]);
      return ((Number.isFinite(value) ? value : means[name]) - means[name]) / scales[name];
    }),
  );
  const target = rows.map((row) => clamp(targetOf(row), -0.95, 2));
  const intercept = mean(target);
  const coefficients = Array(names.length).fill(0);
  const residuals = target.map((value) => value - intercept);
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let largestChange = 0;
    for (let column = 0; column < names.length; column += 1) {
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
  return { names, means, scales, intercept, coefficients };
}

function predictRidge(model, row) {
  if (!model) return 0;
  let delta = model.intercept;
  model.names.forEach((name, index) => {
    const value = finite(row.features?.[name]);
    const normalized =
      ((Number.isFinite(value) ? value : model.means[name]) - model.means[name]) /
      model.scales[name];
    delta += normalized * model.coefficients[index];
  });
  return clamp(delta, -0.35, 0.45);
}

const projection = (row, model, strength) =>
  row.baseline * clamp(1 + predictRidge(model, row) * strength, 0.65, 1.45);
const workloadProjection = (base, row, model, strength) =>
  base * clamp(1 + predictRidge(model, row) * strength, 0.78, 1.22);

function scoreQbLine(line = {}) {
  return (
    Number(line.pass_yd || 0) * 0.04 +
    Number(line.pass_td || 0) * 4 -
    Number(line.pass_int || 0) * 2 +
    Number(line.rush_yd || 0) * 0.1 +
    Number(line.rush_td || 0) * 6 -
    Number(line.fum_lost || 0) * 2
  );
}

function qbAdaptationProjection(base, row, settings = {}) {
  if (row.position !== "QB") return base;
  const context = row.adaptation_context || {};
  const current = context.current_per_game;
  const prior = context.prior_per_game;
  const games = Number(context.current_games || 0);
  if (!current || !prior || games < Number(settings.minimum_games || 3)) return base;
  const next = { ...prior };
  const volumeReliability = games / (games + Number(settings.volume_prior_games || 4));
  const efficiencyReliability = games / (games + Number(settings.efficiency_prior_games || 16));
  const volumeStrength = Number(
    settings.volume_strength ?? settings.application_strength ?? 1,
  );
  const efficiencyStrength = Number(
    settings.efficiency_strength ?? settings.application_strength ?? 1,
  );
  const maximumShift = Number(settings.maximum_field_shift || 0.3);
  const maximumRateShift = Number(settings.maximum_rate_shift || 0.16);
  for (const field of ["pass_att", "rush_att"]) {
    const priorValue = Number(prior[field] || 0);
    const currentValue = Number(current[field] || 0);
    if (priorValue <= 0) continue;
    const factor = clamp(
      1 + (currentValue / priorValue - 1) * volumeReliability * volumeStrength,
      1 - maximumShift,
      1 + maximumShift,
    );
    next[field] = priorValue * factor;
  }
  for (const [numerator, denominator] of [
    ["pass_cmp", "pass_att"],
    ["pass_yd", "pass_att"],
    ["pass_td", "pass_att"],
    ["pass_int", "pass_att"],
    ["rush_yd", "rush_att"],
    ["rush_td", "rush_att"],
  ]) {
    const priorDenominator = Number(prior[denominator] || 0);
    const currentDenominator = Number(current[denominator] || 0);
    const priorRate = Number(prior[numerator] || 0) / Math.max(0.01, priorDenominator);
    const currentRate = Number(current[numerator] || 0) / Math.max(0.01, currentDenominator);
    if (priorRate <= 0 || priorDenominator <= 0 || currentDenominator <= 0) continue;
    const factor = clamp(
      1 + (currentRate / priorRate - 1) * efficiencyReliability * efficiencyStrength,
      1 - maximumRateShift,
      1 + maximumRateShift,
    );
    next[numerator] = Number(next[denominator] || 0) * priorRate * factor;
  }
  const priorPoints = scoreQbLine(prior);
  const adaptedPoints = scoreQbLine(next);
  if (priorPoints <= 0 || adaptedPoints <= 0) return base;
  return base * clamp(
    adaptedPoints / priorPoints,
    1 - maximumShift,
    1 + maximumShift,
  );
}

function selectQbAdaptationSettings(rows, baseOf) {
  const candidates = [];
  for (const volumePriorGames of [2, 4, 6, 8])
    for (const efficiencyPriorGames of [12, 16, 24])
      for (const applicationStrength of [0.4, 0.6, 0.8, 1])
        for (const maximumFieldShift of [0.2, 0.3, 0.4]) {
          const settings = {
            minimum_games: 3,
            volume_prior_games: volumePriorGames,
            efficiency_prior_games: efficiencyPriorGames,
            application_strength: applicationStrength,
            maximum_field_shift: maximumFieldShift,
            maximum_rate_shift: Math.min(0.16, maximumFieldShift),
          };
          const scored = rows.map((row) => ({
            ...row,
            candidate: qbAdaptationProjection(baseOf(row), row, settings),
          }));
          candidates.push({ ...settings, ...pointMetrics(scored, "candidate") });
        }
  return candidates.sort(
    (left, right) => left.mae - right.mae || left.rmse - right.rmse,
  )[0];
}

const adaptationFieldsByPosition = {
  QB: {
    volume: ["pass_att", "rush_att"],
    rates: [["pass_cmp", "pass_att"], ["pass_yd", "pass_att"], ["pass_td", "pass_att"], ["pass_int", "pass_att"], ["rush_yd", "rush_att"], ["rush_td", "rush_att"]],
  },
  RB: {
    volume: ["rush_att", "rec_tgt"],
    rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]],
  },
  WR: {
    volume: ["rush_att", "rec_tgt"],
    rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]],
  },
  TE: {
    volume: ["rec_tgt"],
    rates: [["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]],
  },
};

const allMeasuredStatFields = [
  "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int",
  "rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd",
  "rec_td", "fum_lost", "fga", "fgm", "xpa", "xpm", "kick_pts",
];

function scoreAdaptationLine(position, line = {}) {
  if (position === "QB") return scoreQbLine(line);
  return (
    Number(line.rush_yd || 0) * 0.1 +
    Number(line.rush_td || 0) * 6 +
    Number(line.rec || 0) +
    Number(line.rec_yd || 0) * 0.1 +
    Number(line.rec_td || 0) * 6
  );
}

function statAdaptationProjection(base, row, settings = {}) {
  const fields = adaptationFieldsByPosition[row.position];
  if (!fields) return base;
  const context = row.adaptation_context || {};
  const current = context.current_per_game;
  const prior = context.prior_per_game;
  const games = Number(context.current_games || 0);
  if (!current || !prior || games < Number(settings.minimum_games || 3)) return base;
  const next = { ...prior };
  const volumeReliability = games / (games + Number(settings.volume_prior_games || 4));
  const efficiencyReliability = games / (games + Number(settings.efficiency_prior_games || 16));
  const volumeStrength = Number(
    settings.volume_strength ?? settings.application_strength ?? 1,
  );
  const efficiencyStrength = Number(
    settings.efficiency_strength ?? settings.application_strength ?? 1,
  );
  const maximumShift = Number(settings.maximum_field_shift || 0.3);
  const maximumRateShift = Number(settings.maximum_rate_shift || 0.16);
  for (const field of fields.volume) {
    const priorValue = Number(prior[field] || 0);
    const currentValue = Number(current[field] || 0);
    if (priorValue <= 0) continue;
    next[field] = priorValue * clamp(
      1 + (currentValue / priorValue - 1) * volumeReliability * volumeStrength,
      1 - maximumShift,
      1 + maximumShift,
    );
  }
  for (const [numerator, denominator] of fields.rates) {
    const priorDenominator = Number(prior[denominator] || 0);
    const currentDenominator = Number(current[denominator] || 0);
    const priorRate = Number(prior[numerator] || 0) / Math.max(0.01, priorDenominator);
    const currentRate = Number(current[numerator] || 0) / Math.max(0.01, currentDenominator);
    if (priorRate <= 0 || priorDenominator <= 0 || currentDenominator <= 0) continue;
    const rateFactor = clamp(
      1 + (currentRate / priorRate - 1) * efficiencyReliability * efficiencyStrength,
      1 - maximumRateShift,
      1 + maximumRateShift,
    );
    next[numerator] = Number(next[denominator] || 0) * priorRate * rateFactor;
  }
  const priorPoints = scoreAdaptationLine(row.position, prior);
  const adaptedPoints = scoreAdaptationLine(row.position, next);
  if (priorPoints <= 0 || adaptedPoints <= 0) return base;
  return base * clamp(adaptedPoints / priorPoints, 1 - maximumShift, 1 + maximumShift);
}

function weightedStatTrendLine(row, settings = {}) {
  const fields = adaptationFieldsByPosition[row.position];
  const context = row.adaptation_context || {};
  const current = context.current_per_game;
  const prior = context.prior_per_game;
  const games = Number(context.current_games || 0);
  if (!fields || !current || !prior || games < Number(settings.minimum_games || 3))
    return prior ? { ...prior } : null;
  const next = { ...prior };
  for (const field of fields.volume) {
    const config = settings.components?.[field];
    const priorValue = Number(prior[field] || 0);
    const currentValue = Number(current[field] || 0);
    if (!config || priorValue <= 0 || currentValue < 0) continue;
    const reliability = games / (games + Number(config.prior_games || 4));
    const factor = clamp(
      1 + (currentValue / priorValue - 1) * reliability * Number(config.strength || 0),
      1 - Number(config.maximum_shift || 0.4),
      1 + Number(config.maximum_shift || 0.4),
    );
    next[field] = priorValue * factor;
  }
  for (const [numerator, denominator] of fields.rates) {
    const key = `${numerator}_per_${denominator}`;
    const config = settings.components?.[key];
    const priorDenominator = Number(prior[denominator] || 0);
    const currentDenominator = Number(current[denominator] || 0);
    const priorRate = Number(prior[numerator] || 0) / Math.max(0.01, priorDenominator);
    const currentRate = Number(current[numerator] || 0) / Math.max(0.01, currentDenominator);
    if (!config || priorRate <= 0 || priorDenominator <= 0 || currentDenominator <= 0) continue;
    const reliability = games / (games + Number(config.prior_games || 12));
    const factor = clamp(
      1 + (currentRate / priorRate - 1) * reliability * Number(config.strength || 0),
      1 - Number(config.maximum_shift || 0.2),
      1 + Number(config.maximum_shift || 0.2),
    );
    next[numerator] = Number(next[denominator] || 0) * priorRate * factor;
  }
  next.pass_cmp = Math.min(Number(next.pass_cmp || 0), Number(next.pass_att || 0));
  next.rec = Math.min(Number(next.rec || 0), Number(next.rec_tgt || 0));
  return next;
}

function componentMetrics(rows, field, lineOf) {
  const samples = [];
  for (const row of rows) {
    const actual = finite(row.actual_stat_line?.[field]);
    const projected = finite(lineOf(row)?.[field]);
    if (!Number.isFinite(actual) || !Number.isFinite(projected)) continue;
    samples.push({ actual, projected });
  }
  if (!samples.length) return null;
  const mae = mean(samples.map(({ actual, projected }) => Math.abs(projected - actual)));
  const actualScale = mean(samples.map(({ actual }) => Math.abs(actual)));
  const bias = mean(samples.map(({ actual, projected }) => projected - actual));
  return {
    sample: samples.length,
    mae,
    normalized_mae: mae / Math.max(0.1, actualScale),
    bias,
    actual_mean: mean(samples.map(({ actual }) => actual)),
  };
}

function trendDiagnostics(rows, field) {
  const pairs = rows.flatMap((row) => {
    const prior = finite(row.adaptation_context?.prior_per_game?.[field]);
    const current = finite(row.adaptation_context?.current_per_game?.[field]);
    const actual = finite(row.actual_stat_line?.[field]);
    if (![prior, current, actual].every(Number.isFinite) || Math.abs(prior) < 0.01)
      return [];
    return [{ trend: (current - prior) / Math.max(0.1, Math.abs(prior)), future: (actual - prior) / Math.max(0.1, Math.abs(prior)) }];
  });
  if (pairs.length < 2) return { sample: pairs.length, correlation: null, direction_accuracy: null };
  const trendMean = mean(pairs.map((row) => row.trend));
  const futureMean = mean(pairs.map((row) => row.future));
  const covariance = mean(pairs.map((row) => (row.trend - trendMean) * (row.future - futureMean)));
  const trendSd = Math.sqrt(mean(pairs.map((row) => (row.trend - trendMean) ** 2)));
  const futureSd = Math.sqrt(mean(pairs.map((row) => (row.future - futureMean) ** 2)));
  return {
    sample: pairs.length,
    correlation: trendSd && futureSd ? covariance / (trendSd * futureSd) : null,
    direction_accuracy: mean(pairs.map((row) => Math.sign(row.trend) === Math.sign(row.future) ? 1 : 0)),
  };
}

function selectWeightedStatTrendSettings(componentRows, finalRows, position, baseOf) {
  const fields = adaptationFieldsByPosition[position];
  if (!fields) return { passthrough: true };
  const eligible = componentRows.filter((row) =>
    row.adaptation_context?.prior_per_game &&
    row.adaptation_context?.current_per_game &&
    Number(row.adaptation_context?.current_games || 0) >= 3
  );
  const settings = { minimum_games: 3, components: {}, diagnostics: {} };
  const tuneComponent = (field, key, priorGames, maximumShifts) => {
    const baseline = componentMetrics(eligible, field, (row) => row.adaptation_context?.prior_per_game);
    if (!baseline || baseline.sample < 50) return;
    let best = null;
    for (const prior_games of priorGames)
      for (const strength of [0, 0.5, 1, 1.5, 2])
        for (const maximum_shift of maximumShifts) {
          const candidateSettings = {
            ...settings,
            components: { ...settings.components, [key]: { prior_games, strength, maximum_shift } },
          };
          const metrics = componentMetrics(eligible, field, (row) => weightedStatTrendLine(row, candidateSettings));
          if (!metrics) continue;
          const candidate = { prior_games, strength, maximum_shift, ...metrics };
          if (!best || candidate.mae < best.mae || (candidate.mae === best.mae && Math.abs(candidate.bias) < Math.abs(best.bias)))
            best = candidate;
        }
    const accepted = best && best.mae < baseline.mae;
    settings.components[key] = accepted
      ? { prior_games: best.prior_games, strength: best.strength, maximum_shift: best.maximum_shift }
      : { prior_games: priorGames.at(-1), strength: 0, maximum_shift: maximumShifts[0] };
    const trend = trendDiagnostics(eligible, field);
    settings.diagnostics[field] = {
      baseline: Object.fromEntries(Object.entries(baseline).map(([name, value]) => [name, round(value, 5)])),
      selected: best ? Object.fromEntries(Object.entries(best).map(([name, value]) => [name, round(value, 5)])) : null,
      accepted,
      relative_mae_improvement: best ? round((baseline.mae - best.mae) / Math.max(0.001, baseline.mae), 5) : null,
      trend: Object.fromEntries(Object.entries(trend).map(([name, value]) => [name, round(value, 5)])),
    };
  };
  for (const field of fields.volume)
    tuneComponent(field, field, [1, 2, 3, 4, 6, 8], [0.25, 0.4, 0.6]);
  for (const [numerator, denominator] of fields.rates)
    tuneComponent(numerator, `${numerator}_per_${denominator}`, [3, 6, 10, 16, 24], [0.12, 0.2, 0.3]);
  const fantasyCandidates = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1].map((applicationStrength) => {
    const candidateSettings = { ...settings, application_strength: applicationStrength };
    const scored = finalRows.map((row) => ({
      ...row,
      candidate: weightedStatTrendProjection(baseOf(row), row, candidateSettings),
    }));
    return {
      application_strength: applicationStrength,
      ...pointMetrics(scored, "candidate"),
      early_mae: pointMetrics(scored.filter((row) => row.week <= 9), "candidate").mae,
      late_mae: pointMetrics(scored.filter((row) => row.week >= 10), "candidate").mae,
    };
  });
  const noAdjustment = fantasyCandidates.find((candidate) => candidate.application_strength === 0);
  const stableCandidates = fantasyCandidates.filter((candidate) =>
    candidate.application_strength === 0 ||
    (candidate.early_mae < noAdjustment.early_mae && candidate.late_mae < noAdjustment.late_mae)
  ).sort((left, right) => left.mae - right.mae || left.rmse - right.rmse);
  settings.application_strength = stableCandidates[0]?.application_strength || 0;
  settings.stability_gate = "The selected strength must improve both Weeks 4-9 and Weeks 10-18 in the untouched tuning season; otherwise the position is disabled.";
  settings.fantasy_selection = fantasyCandidates.map((candidate) => ({
    application_strength: candidate.application_strength,
    sample: candidate.sample,
    mae: round(candidate.mae, 5),
    rmse: round(candidate.rmse, 5),
    bias: round(candidate.bias, 5),
    early_mae: round(candidate.early_mae, 5),
    late_mae: round(candidate.late_mae, 5),
  }));
  return settings;
}

function weightedStatTrendProjection(base, row, settings = {}) {
  const prior = row.adaptation_context?.prior_per_game;
  const next = weightedStatTrendLine(row, settings);
  if (!prior || !next) return base;
  const priorPoints = scoreAdaptationLine(row.position, prior);
  const adaptedPoints = scoreAdaptationLine(row.position, next);
  if (priorPoints <= 0 || adaptedPoints <= 0) return base;
  const rawRatio = adaptedPoints / priorPoints;
  const applicationStrength = Number(settings.application_strength ?? 1);
  return base * clamp(1 + (rawRatio - 1) * applicationStrength, 0.55, 1.55);
}

function selectStatAdaptationSettings(rows, baseOf) {
  const candidates = [];
  for (const volumePriorGames of [2, 4, 6, 8])
    for (const efficiencyPriorGames of [12, 16, 24])
      for (const volumeStrength of [0, 0.25, 0.5, 0.75, 1])
        for (const efficiencyStrength of [0, 0.25, 0.5, 0.75, 1])
          for (const maximumFieldShift of [0.25, 0.35]) {
          const settings = {
            minimum_games: 3,
            volume_prior_games: volumePriorGames,
            efficiency_prior_games: efficiencyPriorGames,
            volume_strength: volumeStrength,
            efficiency_strength: efficiencyStrength,
            maximum_field_shift: maximumFieldShift,
            maximum_rate_shift: Math.min(0.16, maximumFieldShift),
          };
          const scored = rows.map((row) => ({
            ...row,
            candidate: statAdaptationProjection(baseOf(row), row, settings),
          }));
          candidates.push({ ...settings, ...pointMetrics(scored, "candidate") });
        }
  return candidates.sort((left, right) => left.mae - right.mae || left.rmse - right.rmse)[0];
}

function teamOpportunityGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.year}:${row.week}:${row.team}`;
    const group = groups.get(key) || { target_share: 0, carry_share: 0 };
    if (["RB", "WR", "TE"].includes(row.position))
      group.target_share += Math.max(0, finite(row.features?.target_share) || 0);
    if (["QB", "RB", "WR", "TE"].includes(row.position))
      group.carry_share += Math.max(0, finite(row.features?.carry_share) || 0);
    groups.set(key, group);
  }
  return groups;
}

function teamVolumeProjection(base, row, groups, settings) {
  if (row.position === "K") return base;
  const group = groups.get(`${row.year}:${row.week}:${row.team}`) || {};
  const targetShare = ["RB", "WR", "TE"].includes(row.position)
    ? Math.max(0, finite(row.features?.target_share) || 0)
    : 0;
  const carryShare = ["QB", "RB", "WR", "TE"].includes(row.position)
    ? Math.max(0, finite(row.features?.carry_share) || 0)
    : 0;
  const targetScale = group.target_share > 1 ? 1 / group.target_share : 1;
  const carryScale = group.carry_share > 1 ? 1 / group.carry_share : 1;
  const shareWeight = targetShare + carryShare;
  const reconciledShare = shareWeight
    ? (targetShare * targetScale + carryShare * carryScale) / shareWeight
    : 1;
  const shareFactor = 1 +
    (reconciledShare - 1) * Number(settings.share_strength || 0);
  const paceDelta = clamp(
    finite(row.features?.offense_play_volume_delta) || 0,
    -0.15,
    0.15,
  );
  const paceFactor = 1 + paceDelta * Number(settings.pace_strength || 0);
  return base * clamp(shareFactor * paceFactor, 0.8, 1.2);
}

function selectTeamVolumeSettings(rows, groupingRows, baseOf) {
  const groups = teamOpportunityGroups(groupingRows);
  const candidates = [];
  for (const shareStrength of [0, 0.25, 0.5, 0.75, 1])
    for (const paceStrength of [0, 0.25, 0.5, 0.75, 1]) {
      const settings = {
        share_strength: shareStrength,
        pace_strength: paceStrength,
      };
      const scored = rows.map((row) => ({
        ...row,
        candidate: teamVolumeProjection(baseOf(row), row, groups, settings),
      }));
      candidates.push({ ...settings, ...pointMetrics(scored, "candidate") });
    }
  return candidates.sort(
    (left, right) => left.mae - right.mae || left.rmse - right.rmse,
  )[0];
}

function pointMetrics(rows, field) {
  const usable = rows.filter(
    (row) => Number.isFinite(row.actual) && Number.isFinite(row[field]),
  );
  if (!usable.length) return null;
  const errors = usable.map((row) => row[field] - row.actual);
  return {
    sample: usable.length,
    mae: round(mean(errors.map(Math.abs)), 3),
    rmse: round(Math.sqrt(mean(errors.map((value) => value ** 2))), 3),
    bias: round(mean(errors), 3),
  };
}

function intervalScore(actual, lower, upper, alpha) {
  let score = upper - lower;
  if (actual < lower) score += (2 / alpha) * (lower - actual);
  if (actual > upper) score += (2 / alpha) * (actual - upper);
  return score;
}

function distributionMetrics(rows, prefix) {
  if (!rows.length) return null;
  const probabilities = [0.1, 0.25, 0.5, 0.75, 0.9];
  const quantileLoss = Object.fromEntries(
    probabilities.map((probability) => {
      const field = `${prefix}_p${Math.round(probability * 100)}`;
      const losses = rows.map((row) => {
        const forecast = row[field];
        const error = row.actual - forecast;
        return 2 * (error >= 0 ? probability * error : (1 - probability) * -error);
      });
      return [`p${Math.round(probability * 100)}`, round(mean(losses), 4)];
    }),
  );
  const coverage50 = mean(
    rows.map((row) => Number(row.actual >= row[`${prefix}_p25`] && row.actual <= row[`${prefix}_p75`])),
  );
  const coverage80 = mean(
    rows.map((row) => Number(row.actual >= row[`${prefix}_p10`] && row.actual <= row[`${prefix}_p90`])),
  );
  const wis = mean(
    rows.map((row) => {
      const medianLoss = Math.abs(row.actual - row[`${prefix}_p50`]);
      const score50 = intervalScore(
        row.actual,
        row[`${prefix}_p25`],
        row[`${prefix}_p75`],
        0.5,
      );
      const score80 = intervalScore(
        row.actual,
        row[`${prefix}_p10`],
        row[`${prefix}_p90`],
        0.2,
      );
      return (0.5 * medianLoss + 0.25 * score50 + 0.1 * score80) / 2.5;
    }),
  );
  return {
    sample: rows.length,
    quantile_loss: quantileLoss,
    coverage_50: round(coverage50, 4),
    coverage_80: round(coverage80, 4),
    width_50: round(mean(rows.map((row) => row[`${prefix}_p75`] - row[`${prefix}_p25`])), 4),
    width_80: round(mean(rows.map((row) => row[`${prefix}_p90`] - row[`${prefix}_p10`])), 4),
    weighted_interval_score: round(wis, 4),
  };
}

const selectionTrainingYear = firstEvaluationYear - 2;
const selectionTuningYear = firstEvaluationYear - 1;
const settings = {};
for (const position of positions) {
  const train = records.filter(
    (row) => row.position === position && row.year === selectionTrainingYear,
  );
  const tune = records.filter(
    (row) => row.position === position && row.year === selectionTuningYear,
  );
  if (!train.length || !tune.length) continue;
  const incumbentDefinition = incumbent.by_position?.[position];
  if (!incumbentDefinition || incumbentDefinition.model_type !== "ridge") continue;
  const incumbentNames = Object.keys(incumbentDefinition.features || {});
  const incumbentLambda = Number(incumbentDefinition.lambda || 100);
  const incumbentStrength = Number(incumbentDefinition.application_strength || 0);
  const incumbentModel = fitRidge(train, incumbentNames, incumbentLambda);
  const baseForecast = (row) => projection(row, incumbentModel, incumbentStrength);
  if (experiment === "team-volume") {
    const tuningPopulation = records.filter(
      (row) => row.year === selectionTuningYear,
    );
    settings[position] = selectTeamVolumeSettings(
      tune,
      tuningPopulation,
      baseForecast,
    );
    continue;
  }
  if (experiment === "qb-adaptation") {
    settings[position] = position === "QB"
      ? selectQbAdaptationSettings(tune, baseForecast)
      : { passthrough: true };
    continue;
  }
  if (experiment === "stat-adaptation") {
    settings[position] = adaptationFieldsByPosition[position]
      ? selectStatAdaptationSettings(tune, baseForecast)
      : { passthrough: true };
    continue;
  }
  if (experiment === "weighted-stat-trend") {
    settings[position] = adaptationFieldsByPosition[position]
      ? selectWeightedStatTrendSettings(train, tune, position, baseForecast)
      : { passthrough: true };
    continue;
  }
  const candidates = [];
  for (const lambda of [10, 30, 100, 300]) {
    const model = fitRidge(
      train,
      workloadFeatureNames,
      lambda,
      (row) => row.actual / Math.max(0.1, baseForecast(row)) - 1,
    );
    for (const strength of [0, 0.25, 0.5, 0.75, 1]) {
      const scored = tune.map((row) => ({
        ...row,
        candidate: workloadProjection(
          baseForecast(row),
          row,
          model,
          strength,
        ),
      }));
      candidates.push({
        lambda,
        strength,
        ...pointMetrics(scored, "candidate"),
      });
    }
  }
  settings[position] = candidates.sort(
    (left, right) => left.mae - right.mae || left.rmse - right.rmse,
  )[0];
}

function residualQuantiles(rows, forecastOf) {
  const ratios = rows.map((row) =>
    row.actual / Math.max(0.1, forecastOf(row)),
  );
  return Object.fromEntries(
    [0.1, 0.25, 0.5, 0.75, 0.9].map((probability) => [
      `p${Math.round(probability * 100)}`,
      clamp(quantile(ratios, probability) ?? 1, 0, 4),
    ]),
  );
}

const scoredRows = [];
const modelAudit = [];
for (const year of evaluationYears) {
  const yearRows = records.filter(
    (row) => row.year === year && (!quick || row.week <= 3),
  );
  for (const position of positions) {
    const positionRows = yearRows.filter((row) => row.position === position);
    if (!positionRows.length || !settings[position]) continue;
    const prior = records.filter(
      (row) => row.position === position && row.year < year,
    );
    const tuningRows = prior.filter((row) => row.year === year - 1);
    const preTuningRows = prior.filter((row) => row.year < year - 1);
    const incumbentDefinition = incumbent.by_position?.[position];
    if (!incumbentDefinition || incumbentDefinition.model_type !== "ridge") {
      modelAudit.push({ position, year, status: "unsupported_incumbent_model" });
      continue;
    }
    const incumbentNames = Object.keys(incumbentDefinition.features || {});
    const incumbentLambda = Number(incumbentDefinition.lambda || 100);
    const incumbentStrength = Number(incumbentDefinition.application_strength || 0);
    const incumbentModel = fitRidge(prior, incumbentNames, incumbentLambda);
    const incumbentCalibrationModel = fitRidge(
      preTuningRows,
      incumbentNames,
      incumbentLambda,
    );
    const priorBaseForecast = (row) =>
      projection(row, incumbentModel, incumbentStrength);
    const workloadModel = experiment === "workload"
      ? fitRidge(
          prior,
          workloadFeatureNames,
          settings[position].lambda,
          (row) => row.actual / Math.max(0.1, priorBaseForecast(row)) - 1,
        )
      : null;
    const calibrationBaseForecast = (row) =>
      projection(row, incumbentCalibrationModel, incumbentStrength);
    const workloadCalibrationModel = experiment === "workload"
      ? fitRidge(
          preTuningRows,
          workloadFeatureNames,
          settings[position].lambda,
          (row) => row.actual / Math.max(0.1, calibrationBaseForecast(row)) - 1,
        )
      : null;
    const incumbentQuantiles = residualQuantiles(
      tuningRows,
      calibrationBaseForecast,
    );
    const tuningGroups = teamOpportunityGroups(
      records.filter((row) => row.year === year - 1),
    );
    const workloadQuantiles = residualQuantiles(
      tuningRows,
      experiment === "workload"
        ? (row) => workloadProjection(
            calibrationBaseForecast(row),
            row,
            workloadCalibrationModel,
            settings[position].strength,
          )
        : experiment === "qb-adaptation"
          ? (row) => qbAdaptationProjection(
              calibrationBaseForecast(row),
              row,
              settings[position],
            )
          : experiment === "stat-adaptation"
            ? (row) => statAdaptationProjection(
                calibrationBaseForecast(row),
                row,
                settings[position],
              )
          : experiment === "weighted-stat-trend"
            ? (row) => weightedStatTrendProjection(
                calibrationBaseForecast(row),
                row,
                settings[position],
              )
          : (row) => teamVolumeProjection(
              calibrationBaseForecast(row),
              row,
              tuningGroups,
              settings[position],
            ),
    );
    const preseasonByPlayer = new Map();
    for (const row of prior.filter((candidate) => candidate.year === year - 1))
      preseasonByPlayer.set(playerKey(row), row.baseline);
    for (let week = 1; week <= 18; week += 1) {
      const weekRows = positionRows.filter((row) => row.week === week);
      if (!weekRows.length) continue;
      const targetCutoff = Date.parse(weekRows[0].forecast_cutoff);
      const weeklyTraining = records.filter(
        (row) =>
          row.position === position &&
          (row.year < year ||
            (row.year === year &&
              Number.isFinite(targetCutoff) &&
              Date.parse(row.results_available_at) <= targetCutoff)),
      );
      const weeklyTrainingPopulation = records.filter(
        (row) =>
          row.year < year ||
          (row.year === year &&
            Number.isFinite(targetCutoff) &&
            Date.parse(row.results_available_at) <= targetCutoff),
      );
      const weeklyWorkloadModel = experiment === "workload"
        ? fitRidge(
            weeklyTraining,
            workloadFeatureNames,
            settings[position].lambda,
            (row) => row.actual / Math.max(0.1, priorBaseForecast(row)) - 1,
          )
        : null;
      const targetGroups = teamOpportunityGroups(yearRows.filter((row) => row.week === week));
      const weeklyTeamVolumeSettings = experiment === "team-volume"
        ? selectTeamVolumeSettings(
            weeklyTraining,
            weeklyTrainingPopulation,
            priorBaseForecast,
          )
        : null;
      for (const row of weekRows) {
        const a = preseasonByPlayer.get(playerKey(row));
        const b = priorBaseForecast(row);
        const c = experiment === "workload"
          ? workloadProjection(
              b,
              row,
              workloadModel,
              settings[position].strength,
            )
          : experiment === "qb-adaptation"
            ? qbAdaptationProjection(b, row, settings[position])
            : experiment === "stat-adaptation"
              ? statAdaptationProjection(b, row, settings[position])
            : experiment === "weighted-stat-trend"
              ? weightedStatTrendProjection(b, row, settings[position])
            : teamVolumeProjection(b, row, targetGroups, settings[position]);
        const d = experiment === "workload"
          ? workloadProjection(
              b,
              row,
              weeklyWorkloadModel,
              settings[position].strength,
            )
          : experiment === "qb-adaptation"
            ? c
            : experiment === "stat-adaptation"
              ? c
            : experiment === "weighted-stat-trend"
              ? c
            : teamVolumeProjection(
                b,
                row,
                targetGroups,
                weeklyTeamVolumeSettings,
              );
        if (![a, b, c, d].every(Number.isFinite) || b < 5) continue;
        const scored = {
          ...row,
          stage: row.week <= 4 ? "weeks_1_4" : row.week <= 9 ? "weeks_5_9" : "weeks_10_18",
          a,
          b,
          c,
          d,
        };
        for (const [prefix, point, calibration] of [
          ["a", a, incumbentQuantiles],
          ["b", b, incumbentQuantiles],
          ["c", c, workloadQuantiles],
          ["d", d, workloadQuantiles],
        ])
          for (const [label, ratio] of Object.entries(calibration))
            scored[`${prefix}_${label}`] = Math.max(0, point * ratio);
        scoredRows.push(scored);
      }
    }
    modelAudit.push({
      position,
      year,
      status: "scored",
      incumbent_training_cutoff: year - 1,
      challenger_training_cutoff: year - 1,
      experiment,
      ...(experiment === "workload"
        ? { workload_features: workloadFeatureNames }
        : ["qb-adaptation", "stat-adaptation", "weighted-stat-trend"].includes(experiment)
          ? {
              adaptation: "Current-season opportunity updates faster than yardage and touchdown efficiency rates, with separately selected settings by position.",
              adaptation_settings: settings[position],
            }
          : { opportunity_budget: "Targets and carries are capped at one team share; unclaimed share remains reserved for unmodeled players." }),
      weekly_refit_latest_allowed_week:
        "only result weeks admitted by the Wednesday-noon plus 48-hour availability cutoff",
      uncertainty_fit_season: year - 1,
      selected_settings_frozen_before: firstEvaluationYear,
    });
  }
}

if (!scoredRows.length) throw new Error("Replay produced no paired player-games.");
const duplicateIds = [...scoredRows.reduce((map, row) => {
  map.set(row.forecast_id, (map.get(row.forecast_id) || 0) + 1);
  return map;
}, new Map()).entries()].filter(([, count]) => count > 1);
if (duplicateIds.length)
  throw new Error(`Replay generated duplicate forecasts: ${JSON.stringify(duplicateIds.slice(0, 5))}`);

const arms = experiment === "workload" ? {
  a: "Preseason frozen",
  b: "Arsenal incumbent with weekly evidence",
  c: "Workload adjustment with fixed preseason coefficients",
  d: "Workload adjustment with weekly coefficient refits",
} : ["qb-adaptation", "stat-adaptation", "weighted-stat-trend"].includes(experiment) ? {
  a: "Preseason frozen",
  b: "Arsenal incumbent with weekly evidence",
  c: experiment === "qb-adaptation" ? "QB stat-specific in-season adaptation" : experiment === "weighted-stat-trend" ? "Reliability-weighted stat trend adaptation" : "Position-specific in-season stat adaptation",
  d: experiment === "qb-adaptation" ? "QB stat-specific in-season adaptation (repeatability check)" : experiment === "weighted-stat-trend" ? "Reliability-weighted stat trend adaptation (repeatability check)" : "Position-specific in-season stat adaptation (repeatability check)",
} : {
  a: "Preseason frozen",
  b: "Arsenal incumbent with weekly evidence",
  c: "Team-volume reconciliation with frozen settings",
  d: "Team-volume reconciliation with weekly setting updates",
};
const summarize = (sample) =>
  Object.fromEntries(
    Object.keys(arms).map((key) => [
      key,
      {
        point: pointMetrics(sample, key),
        distribution: distributionMetrics(sample, key),
      },
    ]),
  );
const headline = summarize(scoredRows);
const breakdown = (field) =>
  [...new Set(scoredRows.map((row) => row[field]))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map((value) => ({ value, metrics: summarize(scoredRows.filter((row) => row[field] === value)) }));

function seededRandom(seedText) {
  let state = Number.parseInt(sha(seedText).slice(0, 8), 16) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pairedBootstrap(rows, baselineField, candidateField, iterations = 2000) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = gameGroup(row);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  });
  const grouped = [...groups.values()];
  const random = seededRandom(`${runId}:${baselineField}:${candidateField}`);
  const improvements = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let baselineError = 0;
    let candidateError = 0;
    let count = 0;
    for (let index = 0; index < grouped.length; index += 1) {
      const sample = grouped[Math.floor(random() * grouped.length)];
      for (const row of sample) {
        baselineError += Math.abs(row[baselineField] - row.actual);
        candidateError += Math.abs(row[candidateField] - row.actual);
        count += 1;
      }
    }
    improvements.push((baselineError - candidateError) / Math.max(1, count));
  }
  return {
    groups: grouped.length,
    iterations,
    mean_point_improvement: round(mean(improvements), 4),
    lower_95: round(quantile(improvements, 0.025), 4),
    upper_95: round(quantile(improvements, 0.975), 4),
  };
}

const cVsB = pairedBootstrap(scoredRows, "b", "c");
const dVsC = pairedBootstrap(scoredRows, "c", "d");
const bySeason = breakdown("year");
const byPosition = breakdown("position");
const byStage = breakdown("stage");
const byWeek = breakdown("week");
const positionRegressions = byPosition
  .map((row) => ({
    position: row.value,
    sample: row.metrics.b.point.sample,
    change:
      (row.metrics.c.point.mae - row.metrics.b.point.mae) /
      Math.max(0.001, row.metrics.b.point.mae),
  }))
  .filter((row) => row.sample >= 200 && row.change > 0.03);
const seasonWins = bySeason.every(
  (row) => row.metrics.c.point.mae < row.metrics.b.point.mae,
);
const maeImprovementRate =
  (headline.b.point.mae - headline.c.point.mae) /
  Math.max(0.001, headline.b.point.mae);
const rmseChangeRate =
  (headline.c.point.rmse - headline.b.point.rmse) /
  Math.max(0.001, headline.b.point.rmse);
const wisChangeRate =
  (headline.c.distribution.weighted_interval_score -
    headline.b.distribution.weighted_interval_score) /
  Math.max(0.001, headline.b.distribution.weighted_interval_score);
const primaryRows = experiment === "qb-adaptation"
  ? scoredRows.filter((row) => row.position === "QB")
  : ["stat-adaptation", "weighted-stat-trend"].includes(experiment)
    ? scoredRows.filter((row) => adaptationFieldsByPosition[row.position])
    : scoredRows;
const primaryHeadline = ["qb-adaptation", "stat-adaptation", "weighted-stat-trend"].includes(experiment)
  ? summarize(primaryRows)
  : headline;
const primaryCVsB = ["qb-adaptation", "stat-adaptation", "weighted-stat-trend"].includes(experiment)
  ? pairedBootstrap(primaryRows, "b", "c")
  : cVsB;
const primaryMaeImprovementRate =
  (primaryHeadline.b.point.mae - primaryHeadline.c.point.mae) /
  Math.max(0.001, primaryHeadline.b.point.mae);
const primaryRmseChangeRate =
  (primaryHeadline.c.point.rmse - primaryHeadline.b.point.rmse) /
  Math.max(0.001, primaryHeadline.b.point.rmse);
const primaryWisChangeRate =
  (primaryHeadline.c.distribution.weighted_interval_score -
    primaryHeadline.b.distribution.weighted_interval_score) /
  Math.max(0.001, primaryHeadline.b.distribution.weighted_interval_score);
const componentHoldout = experiment === "weighted-stat-trend"
  ? Object.fromEntries(positions.map((position) => {
      const rows = scoredRows.filter((row) => row.position === position);
      const fieldRows = allMeasuredStatFields.flatMap((field) => {
        const baseline = componentMetrics(rows, field, (row) => row.adaptation_context?.prior_per_game);
        if (!baseline || baseline.actual_mean === 0) return [];
        const challenger = componentMetrics(rows, field, (row) => weightedStatTrendLine(row, settings[position]));
        return [{
          field,
          incumbent_stat_proxy: Object.fromEntries(Object.entries(baseline).map(([name, value]) => [name, round(value, 5)])),
          challenger: challenger ? Object.fromEntries(Object.entries(challenger).map(([name, value]) => [name, round(value, 5)])) : null,
          relative_mae_improvement: challenger
            ? round((baseline.mae - challenger.mae) / Math.max(0.001, baseline.mae), 5)
            : null,
          trend: trendDiagnostics(rows, field),
        }];
      });
      return [position, fieldRows];
    }))
  : null;
const eligibleForForwardTest =
  !quick &&
  evaluationYears.length >= 2 &&
  primaryMaeImprovementRate >= 0.01 &&
  seasonWins &&
  primaryCVsB.lower_95 > 0 &&
  primaryRmseChangeRate <= 0.01 &&
  primaryWisChangeRate <= 0.01 &&
  !positionRegressions.length;

const protectedAfter = Object.fromEntries(
  protectedFiles.map((file) => [path.relative(root, file), fileSha(file)]),
);
const protectedUnchanged = Object.keys(protectedBefore).every(
  (file) => protectedBefore[file] === protectedAfter[file],
);
if (!protectedUnchanged)
  throw new Error("A protected live model file changed during the local replay.");

const report = {
  title: "The Fantasy Arsenal local historical projection replay",
  generated_at: new Date().toISOString(),
  local_only: true,
  quick_mechanics_only: quick,
  experiment,
  evaluation_seasons: evaluationYears,
  development_seasons: [selectionTrainingYear, selectionTuningYear],
  population:
    "Exact paired active player-games where all four arms produced a forecast and the frozen incumbent projected at least 5 PPR points.",
  arms,
  sample: scoredRows.length,
  headline,
  by_season: bySeason,
  by_position: byPosition,
  by_stage: byStage,
  by_week: byWeek,
  uncertainty: { c_vs_b: cVsB, d_vs_c: dVsC },
  model_selection: settings,
  component_holdout: componentHoldout,
  model_audit: modelAudit,
  decision: {
    eligible_for_forward_test: eligibleForForwardTest,
    recommendation: quick
      ? "mechanics_only"
      : eligibleForForwardTest
        ? "start_forward_shadow_test"
        : "keep_incumbent",
    primary_population: experiment === "qb-adaptation" ? "QB" : ["stat-adaptation", "weighted-stat-trend"].includes(experiment) ? "QB/RB/WR/TE" : "all positions",
    mae_improvement_rate: round(primaryMaeImprovementRate, 4),
    rmse_change_rate: round(primaryRmseChangeRate, 4),
    weighted_interval_score_change_rate: round(primaryWisChangeRate, 4),
    improved_each_evaluation_season: seasonWins,
    position_regressions: positionRegressions,
    thresholds: {
      minimum_mae_improvement: 0.01,
      maximum_rmse_deterioration: 0.01,
      maximum_wis_deterioration: 0.01,
      maximum_position_mae_deterioration: 0.03,
      minimum_position_sample: 200,
      paired_bootstrap_lower_bound_must_exceed_zero: true,
    },
    note: "A passing historical replay recommends only a future shadow test; it never promotes a model.",
  },
  audit: {
    status: duplicateIds.length || !protectedUnchanged ? "FAIL" : "PASS",
    historical_input_audit: input.historical_comparison_audit,
    duplicate_forecast_ids: duplicateIds,
    protected_files_unchanged: protectedUnchanged,
    protected_file_hashes_before: protectedBefore,
    protected_file_hashes_after: protectedAfter,
    input_sha256: fileSha(inputFile),
    deterministic_seed: sha(runId).slice(0, 16),
  },
  limitations: [
    "The historical archive identifies active participants from finalized statistics, so this evaluates conditional scoring accuracy rather than pregame availability accuracy.",
    "Historical injuries, news, weather, and weekly publisher forecasts are excluded when no authentic pregame archive exists.",
    "Weekly team identity may use finalized advanced data strictly for identity matching; target-week performance and market fields are excluded from features.",
    experiment === "workload"
      ? "The workload experiment uses a regularized ridge overlay on the incumbent and limits its adjustment to 22% in either direction."
      : ["qb-adaptation", "stat-adaptation", "weighted-stat-trend"].includes(experiment)
        ? "The stat adaptation experiment updates attempts, carries, and targets faster than efficiency, applies only after three current-season games, and remains bounded. Historical source stat lines are unavailable, so prior-season per-game statistics stand in for the historical baseline; the live shadow test remains required."
        : "The team-volume experiment caps modeled target and carry shares at the team total, preserves reserve opportunity for unmodeled players, and tests a bounded pregame pace adjustment.",
  ],
};

const jsonFile = path.join(runDirectory, "report.json");
const markdownFile = path.join(runDirectory, "report.md");
const htmlFile = path.join(runDirectory, "report.html");
fs.writeFileSync(jsonFile, JSON.stringify({ ...report, records: scoredRows }, null, 2));

const tableRows = Object.entries(arms)
  .map(([key, label]) => {
    const row = headline[key];
    return `| ${label} | ${row.point.sample} | ${row.point.mae} | ${row.point.rmse} | ${row.point.bias} | ${row.distribution.weighted_interval_score} | ${(row.distribution.coverage_80 * 100).toFixed(1)}% |`;
  })
  .join("\n");
const markdown = `# Local historical projection replay

- Generated: ${report.generated_at}
- Seasons: ${evaluationYears.join(", ")}
- Paired player-games: ${scoredRows.length.toLocaleString()}
- Audit: **${report.audit.status}**
- Recommendation: **${report.decision.recommendation}**

| Model | Sample | MAE | RMSE | Bias | WIS | 80% coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${tableRows}

## Paired uncertainty

- Revised fixed model versus incumbent: ${cVsB.mean_point_improvement} points MAE improvement; 95% interval ${cVsB.lower_95} to ${cVsB.upper_95}.
- Weekly refit versus revised fixed model: ${dVsC.mean_point_improvement} points MAE improvement; 95% interval ${dVsC.lower_95} to ${dVsC.upper_95}.

## Interpretation

${quick ? "This was a mechanics-only run and cannot support an accuracy recommendation." : report.decision.note}

## Limitations

${report.limitations.map((line) => `- ${line}`).join("\n")}
`;
fs.writeFileSync(markdownFile, markdown);
const escapedReport = JSON.stringify(report).replace(/</g, "\\u003c");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Projection replay</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 16px;color:#172033}table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #ccd3df;text-align:right}th:first-child,td:first-child{text-align:left}.pass{color:#08783f}.warn{color:#9a5b00}code{background:#eef1f5;padding:2px 5px}</style></head><body><h1>Local historical projection replay</h1><p>Seasons ${evaluationYears.join(", ")} · ${scoredRows.length.toLocaleString()} paired player-games · Audit <strong class="${report.audit.status === "PASS" ? "pass" : "warn"}">${report.audit.status}</strong></p><table><thead><tr><th>Model</th><th>MAE</th><th>RMSE</th><th>Bias</th><th>WIS</th><th>80% coverage</th></tr></thead><tbody>${Object.entries(arms).map(([key,label])=>`<tr><td>${label}</td><td>${headline[key].point.mae}</td><td>${headline[key].point.rmse}</td><td>${headline[key].point.bias}</td><td>${headline[key].distribution.weighted_interval_score}</td><td>${(headline[key].distribution.coverage_80*100).toFixed(1)}%</td></tr>`).join("")}</tbody></table><h2>Decision</h2><p><strong>${report.decision.recommendation}</strong></p><p>Revised versus incumbent paired MAE improvement: ${cVsB.mean_point_improvement}; 95% interval ${cVsB.lower_95} to ${cVsB.upper_95}.</p><h2>Important limitations</h2><ul>${report.limitations.map((line)=>`<li>${line}</li>`).join("")}</ul><details><summary>Machine-readable summary</summary><pre id="summary"></pre></details><script>const report=${escapedReport};document.getElementById('summary').textContent=JSON.stringify(report,null,2);</script></body></html>`;
fs.writeFileSync(htmlFile, html);

console.log("\nReplay complete.");
console.table(
  Object.entries(arms).map(([key, model]) => ({
    model,
    mae: headline[key].point.mae,
    rmse: headline[key].point.rmse,
    wis: headline[key].distribution.weighted_interval_score,
  })),
);
console.log(`Audit: ${report.audit.status}`);
console.log(`Recommendation: ${report.decision.recommendation}`);
console.log(`Readable report: ${markdownFile}`);
console.log(`Browser report: ${htmlFile}`);
console.log("No public or live challenger files were changed.\n");
