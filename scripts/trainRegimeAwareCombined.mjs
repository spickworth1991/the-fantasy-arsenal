import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  REGIME_FEATURE_GROUPS,
  regimeFeatureVector,
  predictRegimeResidual,
} from "./lib/regimeAwareCombined.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = "") =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const reportFile = path.resolve(root, arg(
  "report",
  "scripts/_stat_backtests/replays/regime-aware-development/report.json",
));
const challengerDirectory = path.join(root, "data", "model-challengers", "manual-stat-trend-v1");
const definition = JSON.parse(fs.readFileSync(path.join(challengerDirectory, "definition.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const rows = (report.records || []).filter((row) =>
  ["QB", "RB", "WR", "TE"].includes(row.position) &&
  Number.isFinite(Number(row.actual)) &&
  Number.isFinite(Number(row.b)) &&
  Number.isFinite(Number(row.c)) &&
  Number(row.b) >= 5,
);
const years = [...new Set(rows.map((row) => Number(row.year)))].sort();
if (![2022, 2023, 2024, 2025].every((year) => years.includes(year)))
  throw new Error(`Regime training requires 2022-2025 replay rows; found ${years.join(", ")}. Run npm run model:regime:prepare first.`);

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, places = 5) => Number.isFinite(value) ? Number(value.toFixed(places)) : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const adaptationFields = {
  QB: { volume: ["pass_att", "rush_att"], rates: [["pass_cmp", "pass_att"], ["pass_yd", "pass_att"], ["pass_td", "pass_att"], ["pass_int", "pass_att"], ["rush_yd", "rush_att"], ["rush_td", "rush_att"]] },
  RB: { volume: ["rush_att", "rec_tgt"], rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  WR: { volume: ["rush_att", "rec_tgt"], rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  TE: { volume: ["rec_tgt"], rates: [["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
};

function scoreLine(position, line = {}) {
  if (position === "QB") return finite(line.pass_yd) * 0.04 + finite(line.pass_td) * 4 - finite(line.pass_int) * 2 + finite(line.rush_yd) * 0.1 + finite(line.rush_td) * 6 - finite(line.fum_lost) * 2;
  return finite(line.rush_yd) * 0.1 + finite(line.rush_td) * 6 + finite(line.rec) + finite(line.rec_yd) * 0.1 + finite(line.rec_td) * 6 - finite(line.fum_lost) * 2;
}

function adaptationProjection(row) {
  const base = finite(row.b);
  const settings = definition.in_season_adaptation?.arms?.in_season_adaptation?.settings_by_position?.[row.position] || {};
  const fields = adaptationFields[row.position];
  const current = row.adaptation_context?.current_per_game;
  const prior = row.adaptation_context?.prior_per_game;
  const games = finite(row.adaptation_context?.current_games);
  if (!settings.enabled || !fields || !current || !prior || games < finite(definition.in_season_adaptation?.minimum_games, 3)) return base;
  const next = { ...prior };
  const volumeReliability = games / (games + finite(settings.volume_prior_games, 4));
  const efficiencyReliability = games / (games + finite(settings.efficiency_prior_games, 16));
  for (const field of fields.volume) {
    const before = finite(prior[field]);
    if (!(before > 0)) continue;
    const factor = clamp(1 + (finite(current[field]) / before - 1) * volumeReliability * finite(settings.volume_strength, 1), 1 - finite(settings.maximum_field_shift, 0.3), 1 + finite(settings.maximum_field_shift, 0.3));
    next[field] = before * factor;
  }
  for (const [numerator, denominator] of fields.rates) {
    const priorDenominator = finite(prior[denominator]);
    const currentDenominator = finite(current[denominator]);
    const priorRate = finite(prior[numerator]) / Math.max(0.01, priorDenominator);
    const currentRate = finite(current[numerator]) / Math.max(0.01, currentDenominator);
    if (!(priorRate > 0) || !(currentDenominator > 0)) continue;
    const factor = clamp(1 + (currentRate / priorRate - 1) * efficiencyReliability * finite(settings.efficiency_strength, 1), 1 - finite(settings.maximum_rate_shift, 0.16), 1 + finite(settings.maximum_rate_shift, 0.16));
    next[numerator] = finite(next[denominator]) * priorRate * factor;
  }
  const priorPoints = scoreLine(row.position, prior);
  const nextPoints = scoreLine(row.position, next);
  return priorPoints > 0 ? base * clamp(nextPoints / priorPoints, 1 - finite(settings.maximum_field_shift, 0.3), 1 + finite(settings.maximum_field_shift, 0.3)) : base;
}

function enrich(row) {
  const incumbent = finite(row.b);
  const manual = finite(row.c, incumbent);
  const adaptation = adaptationProjection(row);
  const maximum = finite(definition.manual_stat_trend?.settings?.positions?.[row.position]?.max_total_move_pct, 0.4);
  const combined = new Set(definition.manual_stat_trend?.combined_positions || []).has(row.position)
    ? clamp(incumbent + (manual - incumbent) + (adaptation - incumbent), Math.max(0, incumbent * (1 - maximum)), incumbent * (1 + maximum))
    : manual;
  return {
    ...row,
    incumbent,
    manual,
    adaptation,
    combined,
    regime_features: regimeFeatureVector({
      sourceFeatures: row.features || {},
      completedGames: row.adaptation_context?.current_games,
      incumbent,
      manual,
      adaptation,
      combined,
    }),
  };
}

const enriched = rows.map(enrich);

function fitRidge(sample, featureNames, lambda, targetOf) {
  if (!sample.length || !featureNames.length) return null;
  const means = {}, scales = {};
  for (const name of featureNames) {
    const values = sample.map((row) => Number(row.regime_features?.[name])).filter(Number.isFinite);
    means[name] = mean(values);
    scales[name] = Math.sqrt(mean(values.map((value) => (value - means[name]) ** 2))) || 1;
  }
  const matrix = sample.map((row) => featureNames.map((name) => {
    const value = Number(row.regime_features?.[name]);
    return ((Number.isFinite(value) ? value : means[name]) - means[name]) / scales[name];
  }));
  const targets = sample.map(targetOf);
  const intercept = mean(targets);
  const residuals = targets.map((value) => value - intercept);
  const coefficients = Array(featureNames.length).fill(0);
  for (let iteration = 0; iteration < 160; iteration += 1) {
    let largest = 0;
    for (let column = 0; column < featureNames.length; column += 1) {
      const previous = coefficients[column];
      for (let index = 0; index < sample.length; index += 1)
        residuals[index] += matrix[index][column] * previous;
      let numerator = 0, denominator = lambda;
      for (let index = 0; index < sample.length; index += 1) {
        numerator += matrix[index][column] * residuals[index];
        denominator += matrix[index][column] ** 2;
      }
      const next = denominator ? numerator / denominator : 0;
      for (let index = 0; index < sample.length; index += 1)
        residuals[index] -= matrix[index][column] * next;
      coefficients[column] = next;
      largest = Math.max(largest, Math.abs(next - previous));
    }
    if (largest < 1e-7) break;
  }
  return { features: featureNames, means, scales, intercept, coefficients };
}

function fitBoostedStumps(sample, featureNames, { treeCount, learningRate, minimumLeaf }, targetOf) {
  if (!sample.length || !featureNames.length) return null;
  const targets = sample.map(targetOf);
  const intercept = mean(targets);
  const predictions = Array(sample.length).fill(intercept);
  const trees = [];
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const residuals = targets.map((target, index) => target - predictions[index]);
    let best = null;
    for (const feature of featureNames) {
      const observed = sample.map((row) => Number(row.regime_features?.[feature])).filter(Number.isFinite).sort((a, b) => a - b);
      if (observed.length < minimumLeaf * 2 || observed[0] === observed.at(-1)) continue;
      const missingValue = mean(observed);
      const thresholds = [...new Set([0.1, 0.25, 0.5, 0.75, 0.9].map((quantile) => observed[Math.floor((observed.length - 1) * quantile)]))];
      for (const threshold of thresholds) {
        const left = [], right = [];
        sample.forEach((row, index) => {
          const raw = Number(row.regime_features?.[feature]);
          (Number.isFinite(raw) ? raw : missingValue) <= threshold ? left.push(index) : right.push(index);
        });
        if (left.length < minimumLeaf || right.length < minimumLeaf) continue;
        const leftMean = mean(left.map((index) => residuals[index]));
        const rightMean = mean(right.map((index) => residuals[index]));
        const loss = left.reduce((sum, index) => sum + (residuals[index] - leftMean) ** 2, 0)
          + right.reduce((sum, index) => sum + (residuals[index] - rightMean) ** 2, 0);
        if (!best || loss < best.loss)
          best = { feature, threshold, missing_value: missingValue, left_value: leftMean * learningRate, right_value: rightMean * learningRate, loss };
      }
    }
    if (!best) break;
    sample.forEach((row, index) => {
      const raw = Number(row.regime_features?.[best.feature]);
      const value = Number.isFinite(raw) ? raw : best.missing_value;
      predictions[index] += value <= best.threshold ? best.left_value : best.right_value;
    });
    trees.push(best);
  }
  return { model_type: "boosted_stumps", features: featureNames, intercept, trees };
}

function pointMetrics(sample, valueOf) {
  const errors = sample.map((row) => valueOf(row) - finite(row.actual));
  return {
    sample: sample.length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((value) => value ** 2))),
    bias: mean(errors),
  };
}

function guardedBase(row, shrink) {
  return row.regime_features.arm_disagreement
    ? row.incumbent + (row.combined - row.incumbent) * shrink
    : row.combined;
}

function scoreCandidate(row, model) {
  const guarded = guardedBase(row, model.disagreement_shrink);
  const ratio = predictRegimeResidual(model, row.regime_features);
  const maximum = finite(definition.manual_stat_trend?.settings?.positions?.[row.position]?.max_total_move_pct, 0.4);
  return clamp(guarded * (1 + ratio), Math.max(0, row.incumbent * (1 - maximum)), row.incumbent * (1 + maximum));
}

function improvement(base, candidate) {
  return {
    mae_improvement_rate: (base.mae - candidate.mae) / Math.max(0.001, base.mae),
    rmse_change_rate: (candidate.rmse - base.rmse) / Math.max(0.001, base.rmse),
    bias_absolute_change: Math.abs(candidate.bias) - Math.abs(base.bias),
  };
}

function bootstrapWeeks(sample, valueOf, repetitions = 500) {
  const byWeek = new Map();
  for (const row of sample) {
    const key = `${row.year}:${row.week}`;
    const values = byWeek.get(key) || [];
    values.push(row);
    byWeek.set(key, values);
  }
  const groups = [...byWeek.values()];
  let state = 0x5f3759df;
  const next = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  const estimates = [];
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const drawn = [];
    for (let index = 0; index < groups.length; index += 1)
      drawn.push(...groups[Math.floor(next() * groups.length)]);
    const base = pointMetrics(drawn, (row) => row.combined);
    const candidate = pointMetrics(drawn, valueOf);
    estimates.push((base.mae - candidate.mae) / Math.max(0.001, base.mae));
  }
  estimates.sort((left, right) => left - right);
  return {
    lower_95: round(estimates[Math.floor(estimates.length * 0.025)]),
    median: round(estimates[Math.floor(estimates.length * 0.5)]),
    upper_95: round(estimates[Math.floor(estimates.length * 0.975)]),
  };
}

const featureSets = {
  core: REGIME_FEATURE_GROUPS.core,
  role: [...REGIME_FEATURE_GROUPS.core, ...REGIME_FEATURE_GROUPS.role],
  full: [...REGIME_FEATURE_GROUPS.core, ...REGIME_FEATURE_GROUPS.role, ...REGIME_FEATURE_GROUPS.context],
};
const output = {
  source: "The Fantasy Arsenal local regime-aware combined trainer",
  generated_at: new Date().toISOString(),
  version: "regime-aware-combined-v1",
  feature_version: "regime-features-v1",
  local_only: true,
  site_exposed: false,
  development_warning: "The locked manual model was tuned with 2024-2025 evidence. Historical results screen this fourth arm but do not replace untouched forward verification.",
  data_source: path.relative(root, reportFile),
  split: { train: [2022, 2023], tune: [2024], validation: [2025] },
  thresholds: {
    minimum_validation_mae_improvement_rate: 0.0075,
    maximum_validation_rmse_deterioration_rate: 0.0025,
    maximum_absolute_bias_deterioration: 0.1,
  },
  by_position: {},
};

for (const position of ["QB", "RB", "WR", "TE"]) {
  const train = enriched.filter((row) => row.position === position && row.year <= 2023);
  const tune = enriched.filter((row) => row.position === position && row.year === 2024);
  const validation = enriched.filter((row) => row.position === position && row.year === 2025);
  let best = null;
  for (const [featureSet, requestedFeatures] of Object.entries(featureSets)) {
    const features = requestedFeatures.filter((name) => {
      const values = train.map((row) => Number(row.regime_features?.[name])).filter(Number.isFinite);
      return values.length >= Math.max(50, train.length * 0.5) && Math.max(...values) - Math.min(...values) > 1e-8;
    });
    for (const disagreementShrink of [0, 0.25, 0.5, 1])
      for (const lambda of [5, 15, 40, 100]) {
        const fitted = fitRidge(train, features, lambda, (row) => {
          const base = guardedBase(row, disagreementShrink);
          return clamp(finite(row.actual) / Math.max(5, base) - 1, -0.35, 0.35);
        });
        for (const strength of [0.25, 0.5, 0.75, 1])
          for (const maximumResidualShift of [0.06, 0.1, 0.14]) {
            const model = {
              ...fitted,
              strength,
              maximum_residual_shift: maximumResidualShift,
              disagreement_shrink: disagreementShrink,
            };
            const baseMetrics = pointMetrics(tune, (row) => row.combined);
            const candidateMetrics = pointMetrics(tune, (row) => scoreCandidate(row, model));
            const delta = improvement(baseMetrics, candidateMetrics);
            const objective = candidateMetrics.mae + Math.max(0, delta.rmse_change_rate - 0.0025) * 20 + Math.max(0, delta.bias_absolute_change - 0.1) * 2;
            if (!best || objective < best.objective)
              best = { feature_set: featureSet, lambda, model, tune_base: baseMetrics, tune_candidate: candidateMetrics, tune_delta: delta, objective };
          }
      }
    if (position === "TE") {
      for (const treeCount of [12, 24, 40])
        for (const learningRate of [0.03, 0.06, 0.1]) {
          const fitted = fitBoostedStumps(train, features, { treeCount, learningRate, minimumLeaf: 40 }, (row) => {
            const base = guardedBase(row, 0);
            return clamp(finite(row.actual) / Math.max(5, base) - 1, -0.35, 0.35);
          });
          for (const strength of [0.5, 0.75, 1])
            for (const maximumResidualShift of [0.06, 0.1, 0.14]) {
              const model = { ...fitted, strength, maximum_residual_shift: maximumResidualShift, disagreement_shrink: 0 };
              const baseMetrics = pointMetrics(tune, (row) => row.combined);
              const candidateMetrics = pointMetrics(tune, (row) => scoreCandidate(row, model));
              const delta = improvement(baseMetrics, candidateMetrics);
              const objective = candidateMetrics.mae + Math.max(0, delta.rmse_change_rate - 0.0025) * 20 + Math.max(0, delta.bias_absolute_change - 0.1) * 2;
              if (!best || objective < best.objective)
                best = { feature_set: featureSet, tree_count: treeCount, learning_rate: learningRate, minimum_leaf: 40, model, tune_base: baseMetrics, tune_candidate: candidateMetrics, tune_delta: delta, objective };
            }
        }
    }
  }
  const validationBase = pointMetrics(validation, (row) => row.combined);
  const validationCandidate = pointMetrics(validation, (row) => scoreCandidate(row, best.model));
  const validationDelta = improvement(validationBase, validationCandidate);
  const enabled =
    validationDelta.mae_improvement_rate >= output.thresholds.minimum_validation_mae_improvement_rate &&
    validationDelta.rmse_change_rate <= output.thresholds.maximum_validation_rmse_deterioration_rate &&
    validationDelta.bias_absolute_change <= output.thresholds.maximum_absolute_bias_deterioration;
  const finalRows = enriched.filter((row) => row.position === position && row.year <= 2025);
  const targetOf = (row) => {
    const base = guardedBase(row, best.model.disagreement_shrink);
    return clamp(finite(row.actual) / Math.max(5, base) - 1, -0.35, 0.35);
  };
  const finalModel = best.model.model_type === "boosted_stumps"
    ? fitBoostedStumps(finalRows, best.model.features, {
        treeCount: best.tree_count,
        learningRate: best.learning_rate,
        minimumLeaf: best.minimum_leaf,
      }, targetOf)
    : fitRidge(finalRows, best.model.features, best.lambda, targetOf);
  const serializedModel = best.model.model_type === "boosted_stumps"
    ? {
        model_type: "boosted_stumps",
        intercept: round(finalModel.intercept, 8),
        trees: finalModel.trees.map(({ loss, ...tree }) => Object.fromEntries(Object.entries(tree).map(([key, value]) => [key, typeof value === "number" ? round(value, 8) : value]))),
      }
    : {
        features: finalModel.features,
        means: Object.fromEntries(Object.entries(finalModel.means).map(([key, value]) => [key, round(value, 8)])),
        scales: Object.fromEntries(Object.entries(finalModel.scales).map(([key, value]) => [key, round(value, 8)])),
        intercept: round(finalModel.intercept, 8),
        coefficients: finalModel.coefficients.map((value) => round(value, 8)),
      };
  output.by_position[position] = {
    enabled,
    feature_set: best.feature_set,
    lambda: best.lambda,
    tree_count: best.tree_count,
    learning_rate: best.learning_rate,
    minimum_leaf: best.minimum_leaf,
    strength: best.model.strength,
    maximum_residual_shift: best.model.maximum_residual_shift,
    maximum_total_shift: finite(definition.manual_stat_trend?.settings?.positions?.[position]?.max_total_move_pct, 0.4),
    disagreement_shrink: best.model.disagreement_shrink,
    ...serializedModel,
    samples: { train: train.length, tune: tune.length, validation: validation.length },
    tune: {
      combined: Object.fromEntries(Object.entries(best.tune_base).map(([key, value]) => [key, round(value)])),
      candidate: Object.fromEntries(Object.entries(best.tune_candidate).map(([key, value]) => [key, round(value)])),
      ...Object.fromEntries(Object.entries(best.tune_delta).map(([key, value]) => [key, round(value)])),
    },
    validation: {
      combined: Object.fromEntries(Object.entries(validationBase).map(([key, value]) => [key, round(value)])),
      candidate: Object.fromEntries(Object.entries(validationCandidate).map(([key, value]) => [key, round(value)])),
      ...Object.fromEntries(Object.entries(validationDelta).map(([key, value]) => [key, round(value)])),
      uncertainty: bootstrapWeeks(validation, (row) => scoreCandidate(row, best.model)),
    },
  };
}

const validationRows = enriched.filter((row) => row.year === 2025);
const candidateValue = (row) => {
  const model = output.by_position[row.position];
  return model?.enabled ? scoreCandidate(row, model) : row.combined;
};
const overallBase = pointMetrics(validationRows, (row) => row.combined);
const overallCandidate = pointMetrics(validationRows, candidateValue);
const overallDelta = improvement(overallBase, overallCandidate);
output.validation_overall = {
  combined: Object.fromEntries(Object.entries(overallBase).map(([key, value]) => [key, round(value)])),
  candidate: Object.fromEntries(Object.entries(overallCandidate).map(([key, value]) => [key, round(value)])),
  ...Object.fromEntries(Object.entries(overallDelta).map(([key, value]) => [key, round(value)])),
  uncertainty: bootstrapWeeks(validationRows, candidateValue),
};
output.eligible_for_forward_test =
  Object.values(output.by_position).some((row) => row.enabled) &&
  overallDelta.mae_improvement_rate >= output.thresholds.minimum_validation_mae_improvement_rate &&
  overallDelta.rmse_change_rate <= output.thresholds.maximum_validation_rmse_deterioration_rate &&
  overallDelta.bias_absolute_change <= output.thresholds.maximum_absolute_bias_deterioration;
output.recommendation = output.eligible_for_forward_test
  ? "lock_as_fourth_shadow_arm"
  : "keep_three_arms_and_do_not_start_fourth";

const outputFile = path.join(challengerDirectory, "regime-calibration.json");
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log("\nREGIME-AWARE COMBINED DEVELOPMENT SCREEN");
console.log("=".repeat(48));
for (const [position, row] of Object.entries(output.by_position))
  console.log(`${position}: ${row.enabled ? "PASS" : "pass-through"} | validation MAE ${(row.validation.mae_improvement_rate * 100).toFixed(2)}% | RMSE ${(row.validation.rmse_change_rate * 100).toFixed(2)}% | bias delta ${row.validation.bias_absolute_change.toFixed(3)}`);
console.log(`Overall selective candidate: ${(overallDelta.mae_improvement_rate * 100).toFixed(2)}% MAE | ${(overallDelta.rmse_change_rate * 100).toFixed(2)}% RMSE | ${output.recommendation}`);
console.log(`Saved: ${outputFile}`);
