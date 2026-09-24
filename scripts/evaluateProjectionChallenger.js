import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { finalScheduleWeeks } from "./lib/projectionFinality.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = "") =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const season = Number(arg("season", new Date().getUTCFullYear()));
const challenger = String(arg("challenger", "current")).replace(/[^a-z0-9_-]/gi, "");
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};
const round = (value, places = 4) => Number(Number(value).toFixed(places));
const identity = (row) => String(row?.player_id || `${String(row?.name || "").toLowerCase()}|${row?.position || ""}`);
const metrics = (rows, key) => {
  if (!rows.length) return null;
  const errors = rows.map((row) => Number(row[key]) - Number(row.actual));
  return {
    sample: rows.length,
    mae: round(errors.reduce((sum, value) => sum + Math.abs(value), 0) / rows.length),
    rmse: round(Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / rows.length)),
    bias: round(errors.reduce((sum, value) => sum + value, 0) / rows.length),
  };
};

const candidateDirectory = path.join(root, "data", "model-challengers", challenger);
const definitionFile = path.join(candidateDirectory, "definition.json");
const calibrationFile = path.join(candidateDirectory, "calibration.json");
const candidateFile = fs.existsSync(definitionFile) ? definitionFile : calibrationFile;
const candidate = readJson(candidateFile);
if (!candidate) {
  console.log(`No frozen '${challenger}' challenger exists; forward evaluation skipped.`);
  process.exit(0);
}
const actualFile = path.join(root, "public", "stats", "projections", String(season), "accuracy-results.json");
const actualPayload = readJson(actualFile, {});
const actualRows = (actualPayload.player_results || []).filter(
  (row) => row.scoring === "ppr" && row.lens === "safe_expected",
);
const schedule = readJson(
  path.join(root, "public", "stats", "projections", String(season), "schedule.json"),
  { weeks: [] },
);
const fullyFinalWeeks = finalScheduleWeeks(schedule);
const actualByKey = new Map(actualRows.map((row) => [`${row.week}:${identity(row)}`, row]));
const archiveRoots = [
  path.join(candidateDirectory, "snapshots", String(season)),
  path.join(root, "public", "archive", "stat-projection-challengers", challenger, String(season)),
];
const files = archiveRoots.flatMap((archiveRoot) =>
  fs.existsSync(archiveRoot)
    ? fs
        .readdirSync(archiveRoot, { recursive: true })
        .filter((file) => String(file).endsWith(".json"))
        .map((file) => path.join(archiveRoot, file))
    : [],
);
const snapshots = files
  .map((file) => readJson(file))
  .filter(
    (snapshot) =>
      snapshot &&
      (!candidate.definition_sha256 ||
        snapshot.challenger_definition_sha256 === candidate.definition_sha256),
  );
const rejectedDefinitionSnapshots = files.length - snapshots.length;
const latest = new Map();
for (const snapshot of snapshots) {
  for (const player of snapshot.players || []) {
    const kickoff = Date.parse(player.forecast?.kickoff);
    const generated = Date.parse(snapshot.generated_at);
    if (!Number.isFinite(kickoff) || !Number.isFinite(generated) || generated >= kickoff) continue;
    const key = `${snapshot.week}:${identity(player)}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(prior.snapshot.generated_at) < generated)
      latest.set(key, { snapshot, player });
  }
}
const pairs = [...latest.entries()].flatMap(([key, entry]) => {
  const actual = actualByKey.get(key);
  const projection = Number(entry.player.forecast?.projections?.ppr);
  if (
    !actual ||
    !fullyFinalWeeks.has(Number(actual.week)) ||
    !Number.isFinite(projection) ||
    Number(actual.projection) < 5
  ) return [];
  return [{
    week: Number(actual.week),
    player_id: actual.player_id,
    name: actual.name,
    position: actual.position,
    actual: Number(actual.actual),
    incumbent: Number(actual.projection),
    challenger: projection,
    incumbent_build_id: actual.model_build_id,
    challenger_build_id: entry.snapshot.model_build_id,
  }];
});
const weeks = [...new Set(pairs.map((row) => row.week))].sort((a, b) => a - b);
const incumbent = metrics(pairs, "incumbent");
const challengerMetrics = metrics(pairs, "challenger");
const byPosition = Object.fromEntries(["QB", "RB", "WR", "TE", "K"].map((position) => {
  const rows = pairs.filter((row) => row.position === position);
  return [position, { incumbent: metrics(rows, "incumbent"), challenger: metrics(rows, "challenger") }];
}));
const maeImprovement = incumbent && challengerMetrics ? round(incumbent.mae - challengerMetrics.mae) : null;
const rmseChange = incumbent && challengerMetrics ? round(challengerMetrics.rmse - incumbent.rmse) : null;
const positionRegressions = Object.entries(byPosition)
  .filter(([, row]) =>
    row.incumbent?.sample >= 200 &&
    (row.challenger.mae - row.incumbent.mae) / Math.max(0.001, row.incumbent.mae) > 0.03,
  )
  .map(([position, row]) => ({
    position,
    sample: row.incumbent.sample,
    mae_change_rate: round(
      (row.challenger.mae - row.incumbent.mae) / Math.max(0.001, row.incumbent.mae),
    ),
  }));
const eligible = weeks.length >= Number(candidate.forward_test_required_weeks || 4);
const requiredWeeks = Number(candidate.forward_test_required_weeks || 4);
const maeImprovementRate = incumbent
  ? maeImprovement / Math.max(0.001, incumbent.mae)
  : null;
const rmseChangeRate = incumbent
  ? rmseChange / Math.max(0.001, incumbent.rmse)
  : null;
const passedAccuracyGate =
  eligible &&
  maeImprovementRate >= 0.01 &&
  rmseChangeRate <= 0.01 &&
  positionRegressions.length === 0;
const report = {
  source: "The Fantasy Arsenal forward challenger evaluator",
  generated_at: new Date().toISOString(),
  challenger,
  season,
  definition_sha256: candidate.definition_sha256 || null,
  rejected_definition_snapshots: rejectedDefinitionSnapshots,
  population: "paired player-games where the incumbent projected at least 5 PPR points",
  completed_forward_test_weeks: weeks,
  completed_forward_test_week_count: weeks.length,
  required_forward_test_weeks: requiredWeeks,
  remaining_forward_test_weeks: Math.max(0, requiredWeeks - weeks.length),
  paired_games: pairs.length,
  incumbent,
  challenger_metrics: challengerMetrics,
  mae_improvement: maeImprovement,
  mae_improvement_rate: round(maeImprovementRate),
  rmse_change: rmseChange,
  rmse_change_rate: round(rmseChangeRate),
  by_position: byPosition,
  disclosed_position_regressions: positionRegressions,
  minimum_completed_weeks_met: eligible,
  accuracy_gate_passed: passedAccuracyGate,
  eligible_for_review: passedAccuracyGate,
  recommendation:
    passedAccuracyGate
      ? "review_for_promotion"
      : "keep_incumbent",
  gate: {
    minimum_mae_improvement_rate: 0.01,
    maximum_rmse_deterioration_rate: 0.01,
    maximum_position_mae_deterioration_rate: 0.03,
    minimum_position_sample: 200,
    completed_weeks_must_be_fully_final: true,
  },
  note: passedAccuracyGate
    ? "Promotion still requires an explicit owner review and command."
    : !eligible
      ? `${weeks.length}/${requiredWeeks} fully final completed weeks captured; ${Math.max(0, requiredWeeks - weeks.length)} remaining.`
      : "The challenger did not pass the paired accuracy safety thresholds.",
};
const output = path.join(root, "data", "model-challengers", challenger, "forward-report.json");
fs.writeFileSync(output, JSON.stringify(report, null, 2));
if (candidate.site_exposed !== false) {
  const publicOutput = path.join(root, "public", "stats", "projections", "challengers", `${challenger}.json`);
  fs.mkdirSync(path.dirname(publicOutput), { recursive: true });
  fs.writeFileSync(publicOutput, JSON.stringify(report, null, 2));
}
console.log(`${challenger}: ${pairs.length} paired games across ${weeks.length} completed weeks; ${report.recommendation}.`);
