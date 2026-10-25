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
if (!new Set(["workload", "team-volume", "qb-adaptation", "stat-adaptation", "weighted-stat-trend", "manual-stat-trend"]).has(experiment))
  throw new Error("--experiment must be workload, team-volume, qb-adaptation, stat-adaptation, weighted-stat-trend, or manual-stat-trend.");
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
const settingsFile = args.settings
  ? path.resolve(root, String(args.settings))
  : null;
if (settingsFile && !settingsFile.startsWith(`${root}${path.sep}`))
  throw new Error("The tuning settings file must be inside the project.");
const manualConfig = settingsFile
  ? JSON.parse(fs.readFileSync(settingsFile, "utf8"))
  : null;
if (experiment === "manual-stat-trend" && !manualConfig)
  throw new Error("manual-stat-trend requires --settings=path/to/settings.json.");

function validateManualConfig(config) {
  const errors = [];
  const warnings = [];
  const allowedPriorGames = new Set([1, 2, 3, 4, 6, 8, 12, 16, 24]);
  const requireNumber = (value, label, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum)
      errors.push(`${label} must be between ${minimum} and ${maximum}.`);
    return parsed;
  };
  for (const [position, positionConfig] of Object.entries(config?.positions || {})) {
    if (positionConfig.enabled !== true) continue;
    const minimumGames = requireNumber(
      positionConfig.minimum_games ?? config.minimum_games ?? 3,
      `${position}.minimum_games`,
      1,
      8,
    );
    if (Number.isFinite(minimumGames) && !Number.isInteger(minimumGames))
      errors.push(`${position}.minimum_games must be a whole number.`);
    requireNumber(positionConfig.overall_weight ?? 0, `${position}.overall_weight`, 0, 2);
    const totalCap = requireNumber(positionConfig.max_total_move_pct ?? 0.2, `${position}.max_total_move_pct`, 0, 1);
    if (Number.isFinite(totalCap) && totalCap > 0.4)
      warnings.push(`${position}.max_total_move_pct=${totalCap} exceeds the recommended 40% tuning cap.`);
    for (const [field, entry] of Object.entries(positionConfig.stats || {})) {
      if (entry.enabled !== true) continue;
      const componentMinimumGames = requireNumber(
        entry.minimum_games ?? positionConfig.minimum_games ?? config.minimum_games ?? 3,
        `${position}.${field}.minimum_games`,
        1,
        8,
      );
      if (Number.isFinite(componentMinimumGames) && !Number.isInteger(componentMinimumGames))
        errors.push(`${position}.${field}.minimum_games must be a whole number.`);
      requireNumber(entry.weight ?? 1, `${position}.${field}.weight`, 0, 3);
      if (entry.up_weight != null) requireNumber(entry.up_weight, `${position}.${field}.up_weight`, 0, 3);
      if (entry.down_weight != null) requireNumber(entry.down_weight, `${position}.${field}.down_weight`, 0, 3);
      const priorGames = requireNumber(entry.prior_games ?? 8, `${position}.${field}.prior_games`, 0.1, 40);
      if (Number.isFinite(priorGames) && !allowedPriorGames.has(priorGames))
        warnings.push(`${position}.${field}.prior_games=${priorGames} is an advanced value; standard presets reduce search risk.`);
      const statCap = requireNumber(entry.max_stat_move_pct ?? 0.25, `${position}.${field}.max_stat_move_pct`, 0, 1);
      if (Number.isFinite(statCap) && statCap > 0.4)
        warnings.push(`${position}.${field}.max_stat_move_pct=${statCap} exceeds the recommended 40% tuning cap.`);
      if (entry.max_up_move_pct != null) requireNumber(entry.max_up_move_pct, `${position}.${field}.max_up_move_pct`, 0, 1);
      if (entry.max_down_move_pct != null) requireNumber(entry.max_down_move_pct, `${position}.${field}.max_down_move_pct`, 0, 1);
    }
    for (const [cohort, multiplier] of Object.entries(positionConfig.role_multipliers || {}))
      requireNumber(multiplier, `${position}.role_multipliers.${cohort}`, 0, 2);
  }
  if (config.team_volume_reconciliation?.enabled === true) {
    requireNumber(config.team_volume_reconciliation.share_strength ?? 0.5, "team_volume_reconciliation.share_strength", 0, 1);
    requireNumber(config.team_volume_reconciliation.pace_strength ?? 0.5, "team_volume_reconciliation.pace_strength", 0, 1);
  }
  if (errors.length) throw new Error(`Invalid manual tuning settings:\n- ${errors.join("\n- ")}`);
  return warnings;
}

const manualConfigWarnings = experiment === "manual-stat-trend"
  ? validateManualConfig(manualConfig)
  : [];

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
const inputFile = path.join(runDirectory, "walk-forward-input.json");
if (args["reuse-input"] && fs.existsSync(inputFile)) {
  console.log("Reusing the cached leakage-audited historical input. Use npm run tune:refresh after historical-data or backtest-code changes.");
} else {
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
}
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
  K: {
    volume: ["fga", "xpa", "kick_pts"],
    rates: [["fgm", "fga"], ["xpm", "xpa"]],
  },
};

const allMeasuredStatFields = [
  "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int",
  "rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd",
  "rec_td", "fum_lost", "fga", "fgm", "xpa", "xpm", "kick_pts",
];

function scoreAdaptationLine(position, line = {}) {
  if (position === "QB") return scoreQbLine(line);
  if (position === "K")
    return Number(line.kick_pts || 0);
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

function manualRoleCohort(row) {
  const context = row.adaptation_context || {};
  if (context.team_changed) return "team_change";
  if (Number(row.features?.opportunity_trend || 0) >= 0.15 || Number(row.features?.snap_trend || 0) >= 0.15)
    return "role_expansion";
  const limitedHistory = Number(row.history_games || 0) < 8;
  const starter = row.position === "QB"
    ? Number(row.features?.opportunity_share || 0) >= 0.4
    : Number(row.features?.snap_share || 0) >= 0.55 || Number(row.features?.opportunity_share || 0) >= 0.15;
  return `${limitedHistory ? "newcomer" : "established"}_${starter ? "starter" : "reserve"}`;
}

function weightedStatTrendLine(row, settings = {}) {
  const fields = adaptationFieldsByPosition[row.position];
  const context = row.adaptation_context || {};
  const current = context.current_per_game;
  const prior = context.prior_per_game;
  const games = Number(context.current_games || 0);
  if (!fields || !current || !prior)
    return prior ? { ...prior } : null;
  const next = { ...prior };
  const cohort = manualRoleCohort(row);
  const roleMultiplier = Number(settings.role_multipliers?.[cohort] ?? 1);
  for (const field of fields.volume) {
    const config = settings.components?.[field];
    const priorValue = Number(prior[field] || 0);
    const currentValue = Number(current[field] || 0);
    if (
      !config ||
      !(Number(config.strength) > 0) ||
      games < Number(config.minimum_games ?? settings.minimum_games ?? 3) ||
      priorValue <= 0 ||
      currentValue < 0
    ) continue;
    const reliability = games / (games + Number(config.prior_games || 4));
    const direction = currentValue >= priorValue ? "up" : "down";
    const strength = Number(
      direction === "up" ? config.up_strength ?? config.strength : config.down_strength ?? config.strength,
    ) * roleMultiplier;
    const maximumShift = Number(
      direction === "up" ? config.up_maximum_shift ?? config.maximum_shift : config.down_maximum_shift ?? config.maximum_shift,
    );
    const factor = clamp(
      1 + (currentValue / priorValue - 1) * reliability * strength,
      1 - maximumShift,
      1 + maximumShift,
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
    const enabled =
      Number(config.strength) > 0 &&
      games >= Number(config.minimum_games ?? settings.minimum_games ?? 3);
    const reliability = games / (games + Number(config.prior_games || 12));
    const direction = currentRate >= priorRate ? "up" : "down";
    const strength = Number(
      direction === "up" ? config.up_strength ?? config.strength : config.down_strength ?? config.strength,
    ) * roleMultiplier;
    const maximumShift = Number(
      direction === "up" ? config.up_maximum_shift ?? config.maximum_shift : config.down_maximum_shift ?? config.maximum_shift,
    );
    const factor = enabled
      ? clamp(
          1 + (currentRate / priorRate - 1) * reliability * strength,
          1 - maximumShift,
          1 + maximumShift,
        )
      : 1;
    // A disabled rate stays fixed, but its total remains linked to changed volume.
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

function weightedStatTrendProjection(base, row, settings = {}, opportunityGroups = null) {
  const prior = row.adaptation_context?.prior_per_game;
  const next = weightedStatTrendLine(row, settings);
  if (!prior || !next) return base;
  const priorPoints = scoreAdaptationLine(row.position, prior);
  const adaptedPoints = scoreAdaptationLine(row.position, next);
  if (priorPoints <= 0 || adaptedPoints <= 0) return base;
  const applicationStrength = Number(settings.application_strength ?? 1);
  const maximumTotalShift = Number(settings.maximum_total_shift ?? 0.45);
  const adjusted = base + (adaptedPoints - priorPoints) * applicationStrength;
  const teamAdjusted = settings.team_volume?.enabled && opportunityGroups
    ? teamVolumeProjection(adjusted, row, opportunityGroups, settings.team_volume)
    : adjusted;
  return clamp(
    teamAdjusted,
    Math.max(0, base * (1 - maximumTotalShift)),
    base * (1 + maximumTotalShift),
  );
}

function manualStatTrendSettings(config, position) {
  const positionConfig = config?.positions?.[position] || {};
  const fields = adaptationFieldsByPosition[position];
  if (!fields || positionConfig.enabled !== true)
    return { passthrough: true, application_strength: 0, components: {} };
  const statSettings = positionConfig.stats || {};
  const components = {};
  const convert = (field, key) => {
    const entry = statSettings[field] || {};
    components[key] = {
      minimum_games: Math.max(1, Math.round(Number(
        entry.minimum_games ?? positionConfig.minimum_games ?? config.minimum_games ?? 3,
      ))),
      prior_games: Math.max(0.1, Number(entry.prior_games ?? 8)),
      strength: entry.enabled === true ? Math.max(0, Number(entry.weight ?? 1)) : 0,
      up_strength: entry.enabled === true ? Math.max(0, Number(entry.up_weight ?? entry.weight ?? 1)) : 0,
      down_strength: entry.enabled === true ? Math.max(0, Number(entry.down_weight ?? entry.weight ?? 1)) : 0,
      maximum_shift: clamp(Number(entry.max_stat_move_pct ?? 0.25), 0, 1),
      up_maximum_shift: clamp(Number(entry.max_up_move_pct ?? entry.max_stat_move_pct ?? 0.25), 0, 1),
      down_maximum_shift: clamp(Number(entry.max_down_move_pct ?? entry.max_stat_move_pct ?? 0.25), 0, 1),
      enabled: entry.enabled === true,
      field,
      kind: key.includes("_per_") ? "rate" : "volume",
    };
  };
  for (const field of fields.volume) convert(field, field);
  for (const [numerator, denominator] of fields.rates)
    convert(numerator, `${numerator}_per_${denominator}`);
  return {
    minimum_games: Math.max(1, Number(positionConfig.minimum_games ?? config.minimum_games ?? 3)),
    application_strength: Math.max(0, Number(positionConfig.overall_weight ?? 0)),
    maximum_total_shift: clamp(Number(positionConfig.max_total_move_pct ?? 0.2), 0, 1),
    components,
    role_multipliers: {
      newcomer_starter: Number(positionConfig.role_multipliers?.newcomer_starter ?? 1),
      newcomer_reserve: Number(positionConfig.role_multipliers?.newcomer_reserve ?? 1),
      established_starter: Number(positionConfig.role_multipliers?.established_starter ?? 1),
      established_reserve: Number(positionConfig.role_multipliers?.established_reserve ?? 1),
      team_change: Number(positionConfig.role_multipliers?.team_change ?? 1),
      role_expansion: Number(positionConfig.role_multipliers?.role_expansion ?? 1),
    },
    team_volume: {
      enabled: config.team_volume_reconciliation?.enabled === true,
      share_strength: Number(config.team_volume_reconciliation?.share_strength ?? 0.5),
      pace_strength: Number(config.team_volume_reconciliation?.pace_strength ?? 0.5),
    },
    source: "manual_tuning_file",
    projection_method: "additive_stat_delta_on_safe",
  };
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
  if (experiment === "manual-stat-trend") {
    settings[position] = manualStatTrendSettings(manualConfig, position);
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
                tuningGroups,
              )
          : experiment === "manual-stat-trend"
            ? (row) => weightedStatTrendProjection(
                calibrationBaseForecast(row),
                row,
                settings[position],
                tuningGroups,
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
            : experiment === "manual-stat-trend"
              ? weightedStatTrendProjection(b, row, settings[position], targetGroups)
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
            : experiment === "manual-stat-trend"
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
          ...(experiment === "manual-stat-trend" ? { role_cohort: manualRoleCohort(row) } : {}),
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
        : ["qb-adaptation", "stat-adaptation", "weighted-stat-trend", "manual-stat-trend"].includes(experiment)
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
} : ["qb-adaptation", "stat-adaptation", "weighted-stat-trend", "manual-stat-trend"].includes(experiment) ? {
  a: "Preseason frozen",
  b: "Arsenal incumbent with weekly evidence",
  c: experiment === "qb-adaptation" ? "QB stat-specific in-season adaptation" : experiment === "manual-stat-trend" ? "Your manual stat-trend settings" : experiment === "weighted-stat-trend" ? "Reliability-weighted stat trend adaptation" : "Position-specific in-season stat adaptation",
  d: experiment === "qb-adaptation" ? "QB stat-specific in-season adaptation (repeatability check)" : experiment === "manual-stat-trend" ? "Your manual stat-trend settings (repeatability check)" : experiment === "weighted-stat-trend" ? "Reliability-weighted stat trend adaptation (repeatability check)" : "Position-specific in-season stat adaptation (repeatability check)",
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
const byRoleCohort = experiment === "manual-stat-trend" ? breakdown("role_cohort") : null;
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
const enabledManualPositions = positions.filter((position) =>
  adaptationFieldsByPosition[position] &&
  Number(settings[position]?.application_strength || 0) > 0
);
if (experiment === "manual-stat-trend" && !enabledManualPositions.length)
  throw new Error("Enable at least one adjustable position with overall_weight greater than zero in the tuning settings.");
const primaryRows = experiment === "qb-adaptation"
  ? scoredRows.filter((row) => row.position === "QB")
  : experiment === "manual-stat-trend"
    ? scoredRows.filter((row) => enabledManualPositions.includes(row.position))
  : ["stat-adaptation", "weighted-stat-trend", "manual-stat-trend"].includes(experiment)
    ? scoredRows.filter((row) => adaptationFieldsByPosition[row.position])
    : scoredRows;
const primaryHeadline = ["qb-adaptation", "stat-adaptation", "weighted-stat-trend", "manual-stat-trend"].includes(experiment)
  ? summarize(primaryRows)
  : headline;
const primaryCVsB = ["qb-adaptation", "stat-adaptation", "weighted-stat-trend", "manual-stat-trend"].includes(experiment)
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
const componentHoldout = ["weighted-stat-trend", "manual-stat-trend"].includes(experiment)
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
const manualAblations = experiment === "manual-stat-trend"
  ? Object.fromEntries(enabledManualPositions.map((position) => {
      const rows = scoredRows.filter((row) => row.position === position);
      const opportunityGroups = teamOpportunityGroups(records.filter((row) => evaluationYears.includes(row.year)));
      const fullSettings = settings[position];
      const safeMetrics = pointMetrics(rows, "b");
      const fullMetrics = pointMetrics(rows, "c");
      const evaluate = (candidateSettings) => pointMetrics(
        rows.map((row) => ({
          ...row,
          candidate: weightedStatTrendProjection(row.b, row, candidateSettings, opportunityGroups),
        })),
        "candidate",
      );
      const without = {};
      for (const [key, component] of Object.entries(fullSettings.components || {})) {
        if (!(Number(component.strength) > 0)) continue;
        const candidateSettings = structuredClone(fullSettings);
        candidateSettings.components[key].strength = 0;
        const metrics = evaluate(candidateSettings);
        without[key] = {
          kind: component.kind,
          field: component.field,
          mae: round(metrics.mae, 5),
          marginal_mae_points: round(metrics.mae - fullMetrics.mae, 5),
          marginal_improvement_rate: round(
            (metrics.mae - fullMetrics.mae) / Math.max(0.001, safeMetrics.mae),
            6,
          ),
        };
      }
      const volumeOnly = structuredClone(fullSettings);
      const rateOnly = structuredClone(fullSettings);
      for (const component of Object.values(volumeOnly.components || {}))
        if (component.kind !== "volume") component.strength = 0;
      for (const component of Object.values(rateOnly.components || {}))
        if (component.kind !== "rate") component.strength = 0;
      const volumeMetrics = evaluate(volumeOnly);
      const rateMetrics = evaluate(rateOnly);
      return [position, {
        safe_mae: round(safeMetrics.mae, 5),
        full_mae: round(fullMetrics.mae, 5),
        volume_only_mae: round(volumeMetrics.mae, 5),
        rate_only_mae: round(rateMetrics.mae, 5),
        interaction_mae_points: round(
          fullMetrics.mae - (volumeMetrics.mae + rateMetrics.mae - safeMetrics.mae),
          5,
        ),
        leave_one_component_out: without,
      }];
    }))
  : null;
const manualPositionDiagnostics = experiment === "manual-stat-trend"
  ? enabledManualPositions.map((position) => {
      const rows = scoredRows.filter((row) => row.position === position);
      const summary = summarize(rows);
      const seasons = bySeason.map((season) => {
        const sample = rows.filter((row) => row.year === season.value);
        const metrics = summarize(sample);
        return {
          season: season.value,
          sample: metrics.b.point.sample,
          safe_mae: metrics.b.point.mae,
          tuned_mae: metrics.c.point.mae,
          mae_improvement_rate: round(
            (metrics.b.point.mae - metrics.c.point.mae) / Math.max(0.001, metrics.b.point.mae),
            6,
          ),
          rmse_change_rate: round(
            (metrics.c.point.rmse - metrics.b.point.rmse) / Math.max(0.001, metrics.b.point.rmse),
            6,
          ),
        };
      });
      const uncertainty = pairedBootstrap(rows, "b", "c");
      const maeImprovement = (summary.b.point.mae - summary.c.point.mae) / Math.max(0.001, summary.b.point.mae);
      const rmseChange = (summary.c.point.rmse - summary.b.point.rmse) / Math.max(0.001, summary.b.point.rmse);
      const stable = seasons.every((season) => season.mae_improvement_rate >= -0.01);
      const shadowReady = maeImprovement >= 0.0025 && stable && rmseChange <= 0.005;
      return {
        position,
        sample: summary.b.point.sample,
        safe_mae: summary.b.point.mae,
        tuned_mae: summary.c.point.mae,
        mae_improvement_rate: round(maeImprovement, 6),
        rmse_change_rate: round(rmseChange, 6),
        seasons,
        uncertainty,
        stable_across_seasons: stable,
        development_shadow_ready: shadowReady,
        status: shadowReady ? "LOCK_FOR_FORWARD_TEST" : "KEEP_TUNING",
      };
    })
  : null;
const manualSearch = experiment === "manual-stat-trend" && args.search
  ? Object.fromEntries(enabledManualPositions.map((position) => {
      const rows = scoredRows.filter((row) => row.position === position);
      const groups = teamOpportunityGroups(records.filter((row) => evaluationYears.includes(row.year)));
      const safe = pointMetrics(rows, "b");
      const evaluate = (candidateSettings) => {
        const candidateRows = rows.map((row) => ({
          ...row,
          candidate: weightedStatTrendProjection(row.b, row, candidateSettings, groups),
        }));
        const metrics = pointMetrics(candidateRows, "candidate");
        const seasons = evaluationYears.map((year) => ({
          year,
          safe: pointMetrics(rows.filter((row) => row.year === year), "b"),
          candidate: pointMetrics(candidateRows.filter((row) => row.year === year), "candidate"),
        }));
        const seasonPenalty = seasons.reduce((sum, season) => {
          const regression = (season.candidate.mae - season.safe.mae) / Math.max(0.001, season.safe.mae);
          return sum + Math.max(0, regression - 0.01) * safe.mae * 2;
        }, 0);
        const rmsePenalty = Math.max(0, metrics.rmse - safe.rmse * 1.005) * 0.5;
        return { metrics, seasons, objective: metrics.mae + seasonPenalty + rmsePenalty };
      };
      const initialSettings = structuredClone(settings[position]);
      let selected = structuredClone(settings[position]);
      let selectedEvaluation = evaluate(selected);
      const tryValues = (target, key, values, label) => {
        let best = { value: target[key], settings: selected, evaluation: selectedEvaluation };
        for (const value of values) {
          const candidate = structuredClone(selected);
          const path = target.__path;
          let candidateTarget = candidate;
          for (const segment of path) candidateTarget = candidateTarget[segment];
          candidateTarget[key] = value;
          const evaluation = evaluate(candidate);
          if (evaluation.objective < best.evaluation.objective - 1e-9)
            best = { value, settings: candidate, evaluation };
        }
        selected = best.settings;
        selectedEvaluation = best.evaluation;
      };
      for (let pass = 0; pass < 2; pass += 1) {
        for (const [component, original] of Object.entries(selected.components || {})) {
          if (!(Number(original.strength) > 0)) continue;
          const current = () => ({ ...selected.components[component], __path: ["components", component] });
          tryValues(current(), "minimum_games", [1, 2, 3, 4, 5], `${component}.minimum_games`);
          tryValues(current(), "prior_games", [1, 2, 3, 4, 6, 8, 12, 16, 24], `${component}.prior_games`);
          tryValues(current(), "up_strength", [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5], `${component}.up_weight`);
          tryValues(current(), "down_strength", [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5], `${component}.down_weight`);
          tryValues(current(), "up_maximum_shift", [0.1, 0.15, 0.2, 0.25, 0.3, 0.4], `${component}.max_up_move_pct`);
          tryValues(current(), "down_maximum_shift", [0.1, 0.15, 0.2, 0.25, 0.3, 0.4], `${component}.max_down_move_pct`);
        }
        for (const cohort of Object.keys(selected.role_multipliers || {})) {
          const cohortSample = rows.filter((row) => row.role_cohort === cohort).length;
          if (cohortSample >= 100)
            tryValues({ ...selected.role_multipliers, __path: ["role_multipliers"] }, cohort, [0.75, 1, 1.25], `role_multipliers.${cohort}`);
        }
        tryValues({ ...selected, __path: [] }, "application_strength", [0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1], "overall_weight");
        tryValues({ ...selected, __path: [] }, "maximum_total_shift", [0.1, 0.15, 0.2, 0.25, 0.3, 0.4], "max_total_move_pct");
      }
      const start = pointMetrics(rows, "c");
      const changes = [];
      const comparedKeys = [
        ["minimum_games", "minimum_games"],
        ["prior_games", "prior_games"],
        ["up_strength", "up_weight"],
        ["down_strength", "down_weight"],
        ["up_maximum_shift", "max_up_move_pct"],
        ["down_maximum_shift", "max_down_move_pct"],
      ];
      for (const component of Object.keys(selected.components || {})) {
        const publicComponent = selected.components[component]?.field || component.split("_per_")[0];
        for (const [internalKey, publicKey] of comparedKeys) {
          const from = initialSettings.components?.[component]?.[internalKey];
          const to = selected.components?.[component]?.[internalKey];
          if (from !== to) changes.push({
            setting: `${publicComponent}.${publicKey}`,
            internal_component: component,
            from,
            to,
          });
        }
      }
      for (const cohort of Object.keys(selected.role_multipliers || {})) {
        const from = initialSettings.role_multipliers?.[cohort];
        const to = selected.role_multipliers?.[cohort];
        if (from !== to) changes.push({ setting: `role_multipliers.${cohort}`, from, to });
      }
      for (const [internalKey, publicKey] of [["application_strength", "overall_weight"], ["maximum_total_shift", "max_total_move_pct"]]) {
        const from = initialSettings[internalKey];
        const to = selected[internalKey];
        if (from !== to) changes.push({ setting: publicKey, from, to });
      }
      return [position, {
        local_development_only: true,
        method: "two-pass constrained coordinate search with season and RMSE penalties",
        starting_mae: round(start.mae, 6),
        suggested_mae: round(selectedEvaluation.metrics.mae, 6),
        suggested_improvement_vs_safe: round((safe.mae - selectedEvaluation.metrics.mae) / Math.max(0.001, safe.mae), 6),
        changes,
        transformed_settings: selected,
      }];
    }))
  : null;
const manualGlobalSearch = experiment === "manual-stat-trend" && args.search
  ? (() => {
      const rows = primaryRows;
      const groups = teamOpportunityGroups(records.filter((row) => evaluationYears.includes(row.year)));
      const currentByPosition = Object.fromEntries(enabledManualPositions.map((position) => [
        position,
        pointMetrics(rows.filter((row) => row.position === position), "c"),
      ]));
      const evaluate = (teamVolume) => {
        const candidateRows = rows.map((row) => {
          const candidateSettings = structuredClone(settings[row.position]);
          candidateSettings.team_volume = teamVolume;
          return { ...row, candidate: weightedStatTrendProjection(row.b, row, candidateSettings, groups) };
        });
        const metrics = pointMetrics(candidateRows, "candidate");
        const positionMetrics = Object.fromEntries(enabledManualPositions.map((position) => [
          position,
          pointMetrics(candidateRows.filter((row) => row.position === position), "candidate"),
        ]));
        const regressionPenalty = enabledManualPositions.reduce((sum, position) =>
          sum + Math.max(0, positionMetrics[position].mae - currentByPosition[position].mae) * 2,
        0);
        return { metrics, positionMetrics, objective: metrics.mae + regressionPenalty };
      };
      const current = structuredClone(settings[enabledManualPositions[0]]?.team_volume || { enabled: false, share_strength: 0.5, pace_strength: 0.5 });
      let best = { team_volume: current, evaluation: evaluate(current) };
      for (const enabled of [false, true])
        for (const share_strength of [0, 0.25, 0.5, 0.75, 1])
          for (const pace_strength of [0, 0.25, 0.5, 0.75, 1]) {
            const teamVolume = { enabled, share_strength, pace_strength };
            const evaluation = evaluate(teamVolume);
            if (evaluation.objective < best.evaluation.objective - 1e-9)
              best = { team_volume: teamVolume, evaluation };
          }
      const changes = Object.keys(current).flatMap((key) => current[key] === best.team_volume[key] ? [] : [{
        setting: `team_volume_reconciliation.${key}`,
        from: current[key],
        to: best.team_volume[key],
      }]);
      return {
        method: "global search across all enabled positions with position-regression penalties",
        starting_mae: round(pointMetrics(rows, "c").mae, 6),
        suggested_mae: round(best.evaluation.metrics.mae, 6),
        changes,
        suggested_settings: best.team_volume,
      };
    })()
  : null;
const eligibleForForwardTest =
  experiment !== "manual-stat-trend" &&
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
  tuning_headline: experiment === "manual-stat-trend" ? primaryHeadline : null,
  enabled_tuning_positions: experiment === "manual-stat-trend" ? enabledManualPositions : null,
  by_season: bySeason,
  by_position: byPosition,
  by_stage: byStage,
  by_week: byWeek,
  by_role_cohort: byRoleCohort,
  uncertainty: { c_vs_b: cVsB, d_vs_c: dVsC },
  model_selection: settings,
  manual_settings: settingsFile ? {
    file: path.relative(root, settingsFile),
    sha256: fileSha(settingsFile),
    warning: "Repeated tuning on these seasons makes them development data. Verify chosen settings on separate future or otherwise untouched games before promotion.",
    validation_warnings: manualConfigWarnings,
    projection_method: "The tuned fantasy score adds the bounded fantasy-point delta from the proxy stat line to Arsenal Safe. It no longer multiplies Safe by a proxy-derived ratio.",
  } : null,
  component_holdout: componentHoldout,
  manual_ablations: manualAblations,
  manual_position_diagnostics: manualPositionDiagnostics,
  manual_search: manualSearch,
  manual_global_search: manualGlobalSearch,
  model_audit: modelAudit,
  decision: {
    eligible_for_forward_test: eligibleForForwardTest,
    recommendation: experiment === "manual-stat-trend"
      ? manualPositionDiagnostics?.some((row) => row.development_shadow_ready)
        ? "lock_qualifying_positions_for_forward_test"
        : "keep_tuning"
      : quick
      ? "mechanics_only"
      : eligibleForForwardTest
        ? "start_forward_shadow_test"
        : "keep_incumbent",
    primary_population: experiment === "qb-adaptation"
      ? "QB"
      : experiment === "manual-stat-trend"
        ? enabledManualPositions.join("/")
        : ["stat-adaptation", "weighted-stat-trend"].includes(experiment)
          ? "QB/RB/WR/TE"
          : "all positions",
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
    ...(experiment === "manual-stat-trend" ? [
      "Because you can repeatedly edit settings against 2024-2025, those seasons are tuning data after the first run and cannot serve as final proof. Save the chosen file and verify it on separate evidence.",
    ] : []),
    "The historical archive identifies active participants from finalized statistics, so this evaluates conditional scoring accuracy rather than pregame availability accuracy.",
    "Historical injuries, news, weather, and weekly publisher forecasts are excluded when no authentic pregame archive exists.",
    "Weekly team identity may use finalized advanced data strictly for identity matching; target-week performance and market fields are excluded from features.",
    experiment === "workload"
      ? "The workload experiment uses a regularized ridge overlay on the incumbent and limits its adjustment to 22% in either direction."
      : ["qb-adaptation", "stat-adaptation", "weighted-stat-trend", "manual-stat-trend"].includes(experiment)
        ? "The stat adaptation experiment updates attempts, carries, and targets faster than efficiency, applies only after three current-season games, and remains bounded. Historical source stat lines are unavailable, so prior-season per-game statistics stand in for the historical baseline; the live shadow test remains required."
        : "The team-volume experiment caps modeled target and carry shares at the team total, preserves reserve opportunity for unmodeled players, and tests a bounded pregame pace adjustment.",
  ],
};

const jsonFile = path.join(runDirectory, "report.json");
const markdownFile = path.join(runDirectory, "report.md");
const htmlFile = path.join(runDirectory, "report.html");
const searchFile = path.join(runDirectory, "search-suggestion.json");
let previousReport = null;
if (experiment === "manual-stat-trend" && fs.existsSync(jsonFile)) {
  try {
    previousReport = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    previousReport = null;
  }
}
if (previousReport) {
  report.previous_tuning_run = {
    generated_at: previousReport.generated_at,
    settings_sha256: previousReport.manual_settings?.sha256 || null,
    safe_mae: previousReport.headline?.b?.point?.mae ?? null,
    tuned_mae: previousReport.headline?.c?.point?.mae ?? null,
  };
}
fs.writeFileSync(jsonFile, JSON.stringify({ ...report, records: scoredRows }, null, 2));
if (experiment === "manual-stat-trend") {
  const historyFile = path.join(runDirectory, "tuning-history.jsonl");
  const historyEntry = {
    generated_at: report.generated_at,
    settings_sha256: report.manual_settings?.sha256,
    input_sha256: report.audit.input_sha256,
    enabled_positions: enabledManualPositions,
    combined_mae_improvement_rate: report.decision.mae_improvement_rate,
    by_position: manualPositionDiagnostics?.map((row) => ({
      position: row.position,
      sample: row.sample,
      mae_improvement_rate: row.mae_improvement_rate,
      rmse_change_rate: row.rmse_change_rate,
      status: row.status,
    })),
  };
  const existingHashes = fs.existsSync(historyFile)
    ? new Set(fs.readFileSync(historyFile, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line).settings_sha256]; } catch { return []; }
      }))
    : new Set();
  if (!existingHashes.has(historyEntry.settings_sha256))
    fs.appendFileSync(historyFile, `${JSON.stringify(historyEntry)}\n`);
  report.manual_settings.history_file = path.relative(root, historyFile);
  if (manualSearch) fs.writeFileSync(searchFile, JSON.stringify({
    generated_at: report.generated_at,
    settings_sha256: report.manual_settings?.sha256,
    input_sha256: report.audit.input_sha256,
    warning: "Development-data suggestion only. This does not edit settings or approve a model.",
    by_position: manualSearch,
    global: manualGlobalSearch,
  }, null, 2));
  fs.writeFileSync(jsonFile, JSON.stringify({ ...report, records: scoredRows }, null, 2));
}

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
if (experiment === "manual-stat-trend") {
  console.log("TUNING MODE: 2024-2025 are development data. Final model approval requires separate verification games.");
  console.log(`Integrity audit: ${report.audit.status} (the run is valid; this is not model approval)`);
  console.log(`Recommendation: ${report.decision.recommendation}`);
  console.log("Projection method: additive bounded stat-line delta on Arsenal Safe (the old proxy-ratio multiplier is removed). ");
  for (const warning of manualConfigWarnings) console.log(`SETTINGS WARNING: ${warning}`);
  console.log(`Readable report: ${markdownFile}`);
  console.log(`Browser report: ${htmlFile}`);
  console.log("No public or live challenger files were changed.\n");
}
const displayedHeadline = experiment === "manual-stat-trend" ? primaryHeadline : headline;
console.table(
  Object.entries(arms).map(([key, model]) => ({
    model,
    mae: displayedHeadline[key].point.mae,
    rmse: displayedHeadline[key].point.rmse,
    wis: displayedHeadline[key].distribution.weighted_interval_score,
  })),
);
if (experiment === "manual-stat-trend") {
  const percentImprovement = (safe, tuned) =>
    Number.isFinite(Number(safe)) && Number.isFinite(Number(tuned))
      ? (Number(safe) - Number(tuned)) / Math.max(0.001, Number(safe))
      : null;
  const formatChange = (value) =>
    Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${round(value * 100, 2)}%` : "—";
  const previousPrimaryPositions = (previousReport?.by_position || []).filter((row) =>
    enabledManualPositions.includes(row.value)
  );
  const previousPrimarySample = previousPrimaryPositions.reduce(
    (sum, row) => sum + Number(row.metrics?.b?.point?.sample || 0),
    0,
  );
  const previousPrimarySafeMae = previousPrimarySample
    ? previousPrimaryPositions.reduce(
        (sum, row) => sum + Number(row.metrics?.b?.point?.mae || 0) * Number(row.metrics?.b?.point?.sample || 0),
        0,
      ) / previousPrimarySample
    : null;
  const previousPrimaryTunedMae = previousPrimarySample
    ? previousPrimaryPositions.reduce(
        (sum, row) => sum + Number(row.metrics?.c?.point?.mae || 0) * Number(row.metrics?.c?.point?.sample || 0),
        0,
      ) / previousPrimarySample
    : null;
  const previousPrimaryChange = percentImprovement(previousPrimarySafeMae, previousPrimaryTunedMae);
  const targetGap = Math.max(0, 0.01 - primaryMaeImprovementRate);
  const enabledPositionLabel = enabledManualPositions.join(" + ");
  const positionComparisonRows = byPosition
    .filter((row) => enabledManualPositions.includes(row.value))
    .map((row) => {
    const previous = previousReport?.by_position?.find((candidate) => candidate.value === row.value);
    const change = percentImprovement(row.metrics.b.point.mae, row.metrics.c.point.mae);
    const previousChange = percentImprovement(previous?.metrics?.b?.point?.mae, previous?.metrics?.c?.point?.mae);
    return {
      scope: "POSITION",
      position: row.value,
      item: `${row.value} total (${row.metrics.b.point.sample} games)`,
      weight: "—",
      prior_games: "—",
      cap: "—",
      baseline_mae: row.metrics.b.point.mae,
      tuned_mae: row.metrics.c.point.mae,
      change: formatChange(change),
      previous_change: formatChange(previousChange),
      result: change > 0 ? "HELPED" : change < 0 ? "HURT" : "OFF / TIED",
    };
  });
  positionComparisonRows.push({
    scope: "TOTAL",
    position: enabledManualPositions.join("/"),
    item: `Enabled total (${primaryHeadline.b.point.sample} games)`,
    weight: "—",
    prior_games: "—",
    cap: "—",
    baseline_mae: primaryHeadline.b.point.mae,
    tuned_mae: primaryHeadline.c.point.mae,
    change: formatChange(primaryMaeImprovementRate),
    previous_change: formatChange(previousPrimaryChange),
    result: primaryMaeImprovementRate > 0 ? "HELPED" : primaryMaeImprovementRate < 0 ? "HURT" : "TIED",
  });
  const componentRows = [];
  for (const [position, positionSettings] of Object.entries(settings)) {
    for (const [component, componentSettings] of Object.entries(positionSettings.components || {})) {
      if (!(Number(componentSettings.strength) > 0)) continue;
      const field = component.split("_per_")[0];
      const result = componentHoldout?.[position]?.find((row) => row.field === field);
      const previousResult = previousReport?.component_holdout?.[position]?.find((row) => row.field === field);
      componentRows.push({
        scope: String(componentSettings.kind || "STAT").toUpperCase(),
        position,
        item: field,
        minimum_games: componentSettings.minimum_games,
        weight: componentSettings.strength,
        up_weight: componentSettings.up_strength,
        down_weight: componentSettings.down_strength,
        prior_games: componentSettings.prior_games,
        cap: `${round(componentSettings.maximum_shift * 100, 1)}%`,
        baseline_mae: result?.incumbent_stat_proxy?.mae,
        tuned_mae: result?.challenger?.mae,
        change: formatChange(result?.relative_mae_improvement),
        previous_change: formatChange(previousResult?.relative_mae_improvement),
        marginal_change: manualAblations?.[position]?.leave_one_component_out?.[component]?.marginal_improvement_rate,
        result: result?.relative_mae_improvement > 0 ? "HELPED" : result?.relative_mae_improvement < 0 ? "HURT" : "TIED",
      });
    }
  }
  console.log("\nEnabled stat components followed by position and combined totals:");
  console.log("PROXY is the leakage-safe historical stat baseline; SAFE is used for position and total fantasy MAE.");
  const tuningRows = [...componentRows, ...positionComparisonRows].map((row) => ({
    scope: row.scope,
    position: row.position,
    item: row.item,
    baseline: row.baseline_mae == null ? "—" : Number(row.baseline_mae).toFixed(2),
    tuned: row.tuned_mae == null ? "—" : Number(row.tuned_mae).toFixed(2),
    change: row.change,
    marginal: row.scope === "POSITION" || row.scope === "TOTAL" ? "—" : formatChange(row.marginal_change),
    previous: row.previous_change,
    settings: !["POSITION", "TOTAL"].includes(row.scope)
      ? `min:${row.minimum_games} up:${row.up_weight} dn:${row.down_weight} p:${row.prior_games}`
      : "—",
    result: row.result,
  }));
  const tuningColumns = [
    ["scope", "TYPE", 8],
    ["position", "POS", 4],
    ["item", "STAT / TOTAL", 28],
    ["baseline", "OLD MAE", 7, true],
    ["tuned", "NEW", 7, true],
    ["change", "CHANGE", 9, true],
    ["marginal", "FANTASY", 9, true],
    ["previous", "PREV", 9, true],
    ["settings", "SETTINGS", 33],
    ["result", "RESULT", 7],
  ];
  const formatCell = (value, width, right = false) => {
    const text = String(value ?? "—");
    const clipped = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
    return right ? clipped.padStart(width) : clipped.padEnd(width);
  };
  const formatTuningRow = (row) => tuningColumns
    .map(([key, , width, right]) => formatCell(row[key], width, right))
    .join("  ");
  console.log(formatTuningRow(Object.fromEntries(tuningColumns.map(([key, label]) => [key, label]))));
  console.log(tuningColumns.map(([, , width]) => "-".repeat(width)).join("  "));
  tuningRows.forEach((row) => console.log(formatTuningRow(row)));
  console.log("\nPosition stability (each position is judged separately):");
  for (const row of manualPositionDiagnostics || []) {
    const seasons = row.seasons.map((season) => `${season.season} ${formatChange(season.mae_improvement_rate)}`).join(" | ");
    console.log(`${row.position}: ${formatChange(row.mae_improvement_rate)} MAE | RMSE ${formatChange(-row.rmse_change_rate)} accuracy | 95% MAE points ${row.uncertainty.lower_95} to ${row.uncertainty.upper_95} | ${seasons} | ${row.status}`);
  }
  console.log("FANTASY is the marginal total-MAE benefit of that component after all other enabled components remain on; it is not additive because linked stats interact.");
  console.log("A disabled rate stays fixed, but its total can still move with enabled volume (for example, attempts can move interceptions at an unchanged INT rate). ");
  console.log(`\nEnabled positions (${enabledPositionLabel}) combined Safe MAE improvement: ${formatChange(primaryMaeImprovementRate)} | previous run: ${formatChange(previousPrimaryChange)} | gap to 1% target: ${round(targetGap * 100, 2)}%`);
  if (args.suggest) {
    console.log("\nNext-run suggestions (diagnostic only; settings were not changed):");
    let suggestionCount = 0;
    for (const [position, result] of Object.entries(manualAblations || {})) {
      for (const [component, marginal] of Object.entries(result.leave_one_component_out || {})) {
        if (Number(marginal.marginal_improvement_rate) >= 0) continue;
        suggestionCount += 1;
        console.log(`- ${position} ${component}: removal improved fantasy MAE by ${formatChange(-marginal.marginal_improvement_rate)}. Test a lower weight or disable it.`);
      }
      const diagnostic = manualPositionDiagnostics?.find((row) => row.position === position);
      if (diagnostic && !diagnostic.stable_across_seasons) {
        suggestionCount += 1;
        console.log(`- ${position}: aggregate improvement is not season-stable. Reduce the most harmful marginal component before increasing overall_weight.`);
      }
    }
    if (!suggestionCount)
      console.log("- No enabled component has a negative leave-one-out contribution. Keep this configuration fixed for forward testing instead of further tuning on 2024-2025.");
  }
  if (manualSearch) {
    console.log("\nConstrained search results (settings were not changed):");
    for (const [position, result] of Object.entries(manualSearch)) {
      console.log(`- ${position}: ${result.starting_mae.toFixed(3)} -> ${result.suggested_mae.toFixed(3)} MAE (${formatChange(result.suggested_improvement_vs_safe)} versus Safe)`);
      for (const change of result.changes) console.log(`  ${change.setting}: ${change.from} -> ${change.to}`);
    }
    if (manualGlobalSearch) {
      console.log(`- GLOBAL TEAM VOLUME: ${manualGlobalSearch.starting_mae.toFixed(3)} -> ${manualGlobalSearch.suggested_mae.toFixed(3)} MAE`);
      for (const change of manualGlobalSearch.changes) console.log(`  ${change.setting}: ${change.from} -> ${change.to}`);
    }
    console.log(`Suggestion file: ${searchFile}`);
  }
}
if (experiment !== "manual-stat-trend") {
  console.log(`Audit: ${report.audit.status}`);
  console.log(`Recommendation: ${report.decision.recommendation}`);
  console.log(`Readable report: ${markdownFile}`);
  console.log(`Browser report: ${htmlFile}`);
  console.log("No public or live challenger files were changed.\n");
}

async function offerToApplyManualSearch() {
  if (!manualSearch || !settingsFile) return;
  const suggestions = Object.entries(manualSearch).flatMap(([position, result]) =>
    (result.changes || []).map((change, index) => ({
      id: `${position}:${index}`,
      position,
      ...change,
      label: `${position} · ${change.setting}: ${change.from} → ${change.to}`,
    })),
  ).concat((manualGlobalSearch?.changes || []).map((change, index) => ({
    id: `GLOBAL:${index}`,
    position: "GLOBAL",
    ...change,
    label: `GLOBAL · ${change.setting}: ${change.from} → ${change.to}`,
  })));
  if (!suggestions.length) return;

  const applyMode = typeof args.apply === "string" ? args.apply.toLowerCase() : null;
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !args["no-prompt"];
  let selected = [];
  if (applyMode === "all") {
    selected = suggestions;
  } else if (applyMode === "none" || !interactive) {
    if (!interactive && !applyMode)
      console.log("Non-interactive search: suggestions were not applied. Use npm run tune:search in a terminal or pass -- --apply=all.");
    return;
  } else {
    try {
      const { default: inquirer } = await import("inquirer");
      const { action } = await inquirer.prompt([{
        type: "list",
        name: "action",
        message: "What should I do with these suggested settings?",
        default: "none",
        choices: [
          { name: "Do nothing", value: "none" },
          { name: "Apply all suggestions", value: "all" },
          { name: "Choose suggestions manually", value: "selected" },
        ],
      }]);
      if (action === "none") return;
      if (action === "all") selected = suggestions;
      else {
        const answer = await inquirer.prompt([{
          type: "checkbox",
          name: "ids",
          message: "Select the changes to apply",
          pageSize: Math.min(20, suggestions.length),
          choices: suggestions.map((suggestion) => ({ name: suggestion.label, value: suggestion.id })),
        }]);
        selected = suggestions.filter((suggestion) => answer.ids.includes(suggestion.id));
      }
    } catch (error) {
      console.log(`Interactive selector unavailable (${error.message}). No settings were changed.`);
      console.log("You can apply every suggestion non-interactively with: npm run tune:search -- --apply=all");
      return;
    }
  }
  if (!selected.length) {
    console.log("No suggestions selected; settings were not changed.");
    return;
  }

  const updated = structuredClone(manualConfig);
  for (const suggestion of selected) {
    const parts = suggestion.setting.split(".");
    if (parts[0] === "team_volume_reconciliation") {
      updated.team_volume_reconciliation ||= {};
      updated.team_volume_reconciliation[parts[1]] = suggestion.to;
    } else if (parts[0] === "role_multipliers") {
      updated.positions[suggestion.position].role_multipliers ||= {};
      updated.positions[suggestion.position].role_multipliers[parts[1]] = suggestion.to;
    } else if (["overall_weight", "max_total_move_pct"].includes(parts[0])) {
      updated.positions[suggestion.position][parts[0]] = suggestion.to;
    } else {
      const internalComponent = suggestion.internal_component || parts[0];
      const publicComponent = manualSearch?.[suggestion.position]?.transformed_settings?.components?.[internalComponent]?.field || parts[0].split("_per_")[0];
      const stat = updated.positions[suggestion.position].stats?.[publicComponent];
      if (!stat)
        throw new Error(`Cannot apply ${suggestion.label}: stat ${publicComponent} is missing from the editable settings file.`);
      stat[parts[1]] = suggestion.to;
    }
  }
  if (!selected.length) return;
  const backupFile = path.join(
    runDirectory,
    `settings-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.copyFileSync(settingsFile, backupFile);
  fs.writeFileSync(settingsFile, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`\nApplied ${selected.length} suggested change${selected.length === 1 ? "" : "s"}.`);
  console.log(`Backup: ${backupFile}`);
  console.log("Rerunning the tuner with the updated settings...\n");
  execFileSync(
    process.execPath,
    [
      "--no-warnings",
      path.join(root, "scripts", "replayStatProjectionModel.mjs"),
      "--experiment=manual-stat-trend",
      `--settings=${path.relative(root, settingsFile)}`,
      `--seasons=${evaluationYears.join(",")}`,
      `--run-id=${runId}`,
      "--reuse-input",
    ],
    { cwd: root, stdio: "inherit", maxBuffer: 40 * 1024 * 1024 },
  );
}

await offerToApplyManualSearch();
