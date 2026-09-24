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
const round = (value, places = 4) =>
  Number.isFinite(Number(value)) ? Number(Number(value).toFixed(places)) : null;
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
const arms = Array.isArray(candidate.arms) && candidate.arms.length
  ? candidate.arms
  : ["incumbent", "challenger"];
const pairs = [...latest.entries()].flatMap(([key, entry]) => {
  const actual = actualByKey.get(key);
  const armValues = Object.fromEntries(
    arms.map((arm) => [
      arm,
      Number(
        entry.player.forecast_arms?.[arm]?.ppr ??
          (arm === "incumbent"
            ? entry.player.forecast?.projections?.ppr
            : entry.player.forecast?.projections?.ppr),
      ),
    ]),
  );
  if (
    !actual ||
    !fullyFinalWeeks.has(Number(actual.week)) ||
    arms.some((arm) => !Number.isFinite(armValues[arm])) ||
    armValues.incumbent < 5
  ) return [];
  const roleContext = entry.player.shadow_context?.role_redistribution || {};
  return [{
    week: Number(actual.week),
    player_id: actual.player_id,
    name: actual.name,
    position: actual.position,
    team: entry.player.team,
    actual: Number(actual.actual),
    ...armValues,
    role_redistribution_triggered: roleContext.triggered === true,
    absent_players: roleContext.absent_players || [],
    added_targets: Number(roleContext.added_targets || 0),
    added_carries: Number(roleContext.added_carries || 0),
    snapshot_generated_at: entry.snapshot.generated_at,
    model_build_id: entry.snapshot.model_build_id,
  }];
});
const weeks = [...new Set(pairs.map((row) => row.week))].sort((a, b) => a - b);
const metricsByArm = Object.fromEntries(
  arms.map((arm) => [arm, metrics(pairs, arm)]),
);
const incumbent = metricsByArm.incumbent;
const affectedRows = pairs.filter((row) => row.role_redistribution_triggered);
const affectedMetricsByArm = Object.fromEntries(
  arms.map((arm) => [arm, metrics(affectedRows, arm)]),
);
const absenceEvents = [...new Set(
  affectedRows.map(
    (row) => `${row.week}:${row.team}:${[...row.absent_players].sort().join(",")}`,
  ),
)].sort();
const byPosition = Object.fromEntries(["QB", "RB", "WR", "TE", "K"].map((position) => {
  const rows = pairs.filter((row) => row.position === position);
  return [
    position,
    Object.fromEntries(arms.map((arm) => [arm, metrics(rows, arm)])),
  ];
}));
const eligible = weeks.length >= Number(candidate.forward_test_required_weeks || 4);
const requiredWeeks = Number(candidate.forward_test_required_weeks || 4);
const requiredAbsenceEvents = Number(candidate.minimum_role_absence_events || 8);
const requiredAffectedGames = Number(candidate.minimum_role_affected_player_games || 30);
const roleEvidenceReady =
  absenceEvents.length >= requiredAbsenceEvents &&
  affectedRows.length >= requiredAffectedGames;
const armDecisions = Object.fromEntries(
  arms
    .filter((arm) => arm !== "incumbent")
    .map((arm) => {
      const armMetrics = metricsByArm[arm];
      const maeImprovement = incumbent && armMetrics
        ? round(incumbent.mae - armMetrics.mae)
        : null;
      const rmseChange = incumbent && armMetrics
        ? round(armMetrics.rmse - incumbent.rmse)
        : null;
      const maeImprovementRate = incumbent && armMetrics
        ? maeImprovement / Math.max(0.001, incumbent.mae)
        : null;
      const rmseChangeRate = incumbent && armMetrics
        ? rmseChange / Math.max(0.001, incumbent.rmse)
        : null;
      const positionRegressions = Object.entries(byPosition)
        .filter(([, row]) =>
          row.incumbent?.sample >= 200 &&
          row[arm] &&
          (row[arm].mae - row.incumbent.mae) /
            Math.max(0.001, row.incumbent.mae) > 0.03,
        )
        .map(([position, row]) => ({
          position,
          sample: row.incumbent.sample,
          mae_change_rate: round(
            (row[arm].mae - row.incumbent.mae) /
              Math.max(0.001, row.incumbent.mae),
          ),
        }));
      const affectedIncumbent = affectedMetricsByArm.incumbent;
      const affectedArm = affectedMetricsByArm[arm];
      const affectedMaeChangeRate = affectedIncumbent && affectedArm
        ? (affectedArm.mae - affectedIncumbent.mae) /
          Math.max(0.001, affectedIncumbent.mae)
        : null;
      const affectedRmseChangeRate = affectedIncumbent && affectedArm
        ? (affectedArm.rmse - affectedIncumbent.rmse) /
          Math.max(0.001, affectedIncumbent.rmse)
        : null;
      const usesRoleRedistribution = ["role_redistribution", "combined"].includes(arm);
      const pointGate = arm === "role_redistribution"
        ? affectedMaeChangeRate <= -0.01 && affectedRmseChangeRate <= 0.01
        : maeImprovementRate >= 0.01 && rmseChangeRate <= 0.01;
      const passed =
        eligible &&
        pointGate &&
        positionRegressions.length === 0 &&
        (!usesRoleRedistribution ||
          (roleEvidenceReady && affectedMaeChangeRate <= -0.01));
      return [
        arm,
        {
          metrics: armMetrics,
          mae_improvement: maeImprovement,
          mae_improvement_rate: round(maeImprovementRate),
          rmse_change: rmseChange,
          rmse_change_rate: round(rmseChangeRate),
          position_regressions: positionRegressions,
          affected_metrics: affectedArm,
          affected_mae_change_rate: round(affectedMaeChangeRate),
          affected_rmse_change_rate: round(affectedRmseChangeRate),
          role_evidence_ready: usesRoleRedistribution ? roleEvidenceReady : null,
          accuracy_gate_passed: passed,
          recommendation: passed
            ? "review_for_promotion"
            : usesRoleRedistribution && !roleEvidenceReady
              ? "continue_role_collection"
              : "keep_incumbent",
        },
      ];
    }),
);
const reviewableArms = Object.entries(armDecisions)
  .filter(([, row]) => row.accuracy_gate_passed)
  .map(([arm]) => arm);
const report = {
  source: "The Fantasy Arsenal forward challenger evaluator",
  generated_at: new Date().toISOString(),
  challenger,
  season,
  definition_sha256: candidate.definition_sha256 || null,
  rejected_definition_snapshots: rejectedDefinitionSnapshots,
  population: "identical frozen player-games where every arm produced a forecast and the incumbent projected at least 5 PPR points",
  arms,
  completed_forward_test_weeks: weeks,
  completed_forward_test_week_count: weeks.length,
  required_forward_test_weeks: requiredWeeks,
  remaining_forward_test_weeks: Math.max(0, requiredWeeks - weeks.length),
  paired_games: pairs.length,
  metrics_by_arm: metricsByArm,
  by_position: byPosition,
  role_redistribution_evidence: {
    absence_events: absenceEvents,
    absence_event_count: absenceEvents.length,
    affected_player_games: affectedRows.length,
    required_absence_events: requiredAbsenceEvents,
    required_affected_player_games: requiredAffectedGames,
    evidence_ready: roleEvidenceReady,
    metrics_by_arm: affectedMetricsByArm,
  },
  arm_decisions: armDecisions,
  minimum_completed_weeks_met: eligible,
  eligible_for_review: reviewableArms.length > 0,
  reviewable_arms: reviewableArms,
  recommendation: reviewableArms.length
    ? "review_selected_arms"
    : !eligible
      ? "collect_forward_weeks"
      : !roleEvidenceReady
        ? "continue_role_collection"
        : "keep_incumbent",
  gate: {
    minimum_mae_improvement_rate: 0.01,
    maximum_rmse_deterioration_rate: 0.01,
    maximum_position_mae_deterioration_rate: 0.03,
    minimum_position_sample: 200,
    completed_weeks_must_be_fully_final: true,
    role_arms_require_affected_mae_improvement_rate: 0.01,
    minimum_role_absence_events: requiredAbsenceEvents,
    minimum_role_affected_player_games: requiredAffectedGames,
  },
  note: reviewableArms.length
    ? `Reviewable arms: ${reviewableArms.join(", ")}. Promotion still requires an explicit owner review.`
    : !eligible
      ? `${weeks.length}/${requiredWeeks} fully final completed weeks captured; ${Math.max(0, requiredWeeks - weeks.length)} remaining.`
      : !roleEvidenceReady
        ? `The four-week test is complete, but role redistribution needs ${Math.max(0, requiredAbsenceEvents - absenceEvents.length)} more qualifying absence events and ${Math.max(0, requiredAffectedGames - affectedRows.length)} more affected player-games.`
        : "No experimental arm passed every paired accuracy safety threshold.",
};
const output = path.join(root, "data", "model-challengers", challenger, "forward-report.json");
fs.writeFileSync(output, JSON.stringify(report, null, 2));
if (candidate.site_exposed !== false) {
  const publicOutput = path.join(root, "public", "stats", "projections", "challengers", `${challenger}.json`);
  fs.mkdirSync(path.dirname(publicOutput), { recursive: true });
  fs.writeFileSync(publicOutput, JSON.stringify(report, null, 2));
}
console.log(`${challenger}: ${pairs.length} paired games across ${weeks.length} completed weeks, ${absenceEvents.length} qualifying absence events; ${report.recommendation}.`);
