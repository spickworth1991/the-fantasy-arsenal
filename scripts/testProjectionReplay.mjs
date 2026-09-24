import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateSerializedPositionModel,
  trainedAdjustmentFromCalibration,
} from "./lib/trainedProjectionModel.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }),
);
const runId = String(args["run-id"] || "2024-2025-validation").replace(
  /[^a-z0-9_.-]/gi,
  "-",
);
const reportFile = path.join(
  root,
  "scripts",
  "_stat_backtests",
  "replays",
  runId,
  "report.json",
);
if (!fs.existsSync(reportFile))
  throw new Error(`Replay report not found: ${reportFile}. Run npm run model:replay first.`);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const records = report.records || [];
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const close = (left, right, tolerance = 0.0006) =>
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const intervalScore = (actual, lower, upper, alpha) => {
  let value = upper - lower;
  if (actual < lower) value += (2 / alpha) * (lower - actual);
  if (actual > upper) value += (2 / alpha) * (actual - upper);
  return value;
};
const wis = (actual, p10, p25, p50, p75, p90) =>
  (0.5 * Math.abs(actual - p50) +
    0.25 * intervalScore(actual, p25, p75, 0.5) +
    0.1 * intervalScore(actual, p10, p90, 0.2)) /
  2.5;

check(report.local_only === true, "report must be local-only");
check(report.audit?.status === "PASS", "replay audit must pass");
check(
  report.audit?.historical_input_audit?.status === "PASS",
  "historical input audit must pass",
);
check(report.audit?.protected_files_unchanged === true, "protected files changed");
check(records.length === report.sample && records.length > 0, "sample count mismatch");
check(
  new Set(records.map((row) => row.forecast_id)).size === records.length,
  "duplicate forecast IDs found",
);
check(
  records.every(
    (row) =>
      Number.isFinite(Date.parse(row.forecast_cutoff)) &&
      Number.isFinite(Date.parse(row.results_available_at)),
  ),
  "historical timing metadata is incomplete",
);
for (const row of report.model_audit || []) {
  if (row.status !== "scored") continue;
  check(
    row.incumbent_training_cutoff < row.year &&
      row.challenger_training_cutoff < row.year &&
      row.uncertainty_fit_season < row.year,
    `${row.position} ${row.year} has a future-data cutoff`,
  );
}

check(close(wis(12, 5, 8, 10, 12, 15), 1.2, 1e-12), "hand-calculated WIS failed");
const ridgeFixture = {
  model_type: "ridge",
  intercept: 0.05,
  application_strength: 0.5,
  holdout_mae_improvement: 0.1,
  features: {
    workload: { mean: 0.4, scale: 0.2, coefficient: 0.1 },
  },
};
const ridgeEvaluation = evaluateSerializedPositionModel(ridgeFixture, {
  workload: 0.6,
});
check(close(ridgeEvaluation.raw_delta, 0.15, 1e-12), "shared ridge inference failed");
check(
  close(
    trainedAdjustmentFromCalibration(
      "RB",
      { by_position: { RB: ridgeFixture } },
      { workload: 0.6 },
    ).factor,
    1.075,
    1e-12,
  ),
  "shared calibration adjustment failed",
);
const stumpEvaluation = evaluateSerializedPositionModel(
  {
    model_type: "boosted_stumps",
    intercept: 0,
    features: { workload: { mean: 0.4 } },
    trees: [{ feature: "workload", threshold: 0.5, left: -0.1, right: 0.2 }],
  },
  { workload: 0.7 },
);
check(close(stumpEvaluation.raw_delta, 0.2, 1e-12), "shared tree inference failed");
for (const arm of ["a", "b", "c", "d"]) {
  const point = report.headline?.[arm]?.point;
  const distribution = report.headline?.[arm]?.distribution;
  check(point?.sample === records.length, `${arm} does not use the paired sample`);
  const errors = records.map((row) => row[arm] - row.actual);
  check(close(mean(errors.map(Math.abs)), point?.mae), `${arm} MAE mismatch`);
  check(
    close(Math.sqrt(mean(errors.map((value) => value ** 2))), point?.rmse),
    `${arm} RMSE mismatch`,
  );
  const recomputedWis = mean(
    records.map((row) =>
      wis(
        row.actual,
        row[`${arm}_p10`],
        row[`${arm}_p25`],
        row[`${arm}_p50`],
        row[`${arm}_p75`],
        row[`${arm}_p90`],
      ),
    ),
  );
  check(
    close(recomputedWis, distribution?.weighted_interval_score),
    `${arm} weighted interval score mismatch`,
  );
  check(
    records.every(
      (row) =>
        row[`${arm}_p10`] <= row[`${arm}_p25`] &&
        row[`${arm}_p25`] <= row[`${arm}_p50`] &&
        row[`${arm}_p50`] <= row[`${arm}_p75`] &&
        row[`${arm}_p75`] <= row[`${arm}_p90`],
    ),
    `${arm} has crossed quantiles`,
  );
}

if (failures.length) {
  console.error("Projection replay tests: FAIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Projection replay tests: PASS (${records.length.toLocaleString()} paired player-games).`);
console.log(`Validated: ${reportFile}`);
