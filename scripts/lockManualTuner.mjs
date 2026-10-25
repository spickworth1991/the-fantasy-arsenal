import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalFileSha256 } from "./lib/canonicalFileHash.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsFile = path.join(root, "data", "model-tuning", "stat-trend-settings.json");
const lockFile = path.join(root, "scripts", "_stat_backtests", "replays", "manual-stat-tune", "locked-candidate.json");
const challengerDirectory = path.join(root, "data", "model-challengers", "manual-stat-trend-v1");
const definitionFile = path.join(challengerDirectory, "definition.json");
const regimeCalibrationFile = path.join(challengerDirectory, "regime-calibration.json");
const calibrationFile = path.join(root, "public", "stats", "projections", "model-calibration.json");
const implementationFile = path.join(root, "scripts", "lib", "projectionShadowArms.mjs");
const regimeImplementationFile = path.join(root, "scripts", "lib", "regimeAwareCombined.mjs");
const settingsText = fs.readFileSync(settingsFile, "utf8");
const season = new Date().getUTCFullYear();
const accuracyDirectory = path.join(root, "public", "stats", "projections", String(season), "accuracy-results");
const baselineByPlayer = {};
if (fs.existsSync(accuracyDirectory)) {
  const weekFiles = fs.readdirSync(accuracyDirectory)
    .filter((name) => /^week-\d+\.json$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  for (const name of weekFiles) {
    const payload = JSON.parse(fs.readFileSync(path.join(accuracyDirectory, name), "utf8"));
    for (const row of payload.player_results || []) {
      const id = String(row.player_id || "");
      if (!id || baselineByPlayer[id] || row.scoring !== "ppr" || row.lens !== "safe_expected" || !row.stat_line) continue;
      baselineByPlayer[id] = { week: Number(row.week), stat_line: row.stat_line };
    }
  }
}
if (!Object.keys(baselineByPlayer).length)
  throw new Error(`No exact frozen ${season} stat-line baselines were found; challenger activation stopped.`);
const document = {
  locked_at: new Date().toISOString(),
  settings_sha256: crypto.createHash("sha256").update(settingsText).digest("hex"),
  source_file: path.relative(root, settingsFile),
  local_only: true,
  note: "Only games whose frozen snapshot was created after locked_at count as prospective verification evidence.",
  settings: JSON.parse(settingsText),
};
fs.mkdirSync(path.dirname(lockFile), { recursive: true });
fs.writeFileSync(lockFile, JSON.stringify(document, null, 2));
const settings = document.settings;
const teamVolume = settings.team_volume_reconciliation || {};
const regimeCalibration = fs.existsSync(regimeCalibrationFile)
  ? JSON.parse(fs.readFileSync(regimeCalibrationFile, "utf8"))
  : null;
const regimeEnabled = regimeCalibration?.eligible_for_forward_test === true;
const definition = {
  source: "The Fantasy Arsenal locked manual stat-trend tuner",
  generated_at: document.locked_at,
  version: "manual-stat-trend-v1",
  model_type: "projection_experiment_suite",
  settings_sha256: document.settings_sha256,
  base_calibration_sha256: canonicalFileSha256(calibrationFile),
  implementation_sha256: canonicalFileSha256(implementationFile),
  regime_implementation_sha256: canonicalFileSha256(regimeImplementationFile),
  forward_test_required_weeks: 4,
  minimum_forward_player_games: 600,
  site_exposed: false,
  arms: [
    "incumbent",
    "in_season_adaptation",
    "manual_stat_trend",
    "combined_adaptation_manual",
    "dynamic_rest_of_season",
    "dynamic_ros_in_season_adaptation",
    "dynamic_ros_manual_stat_trend",
    "dynamic_ros_combined",
    ...(regimeEnabled ? ["regime_aware_combined"] : []),
  ],
  group_minimum_ppr: 1,
  settings_by_position: Object.fromEntries(
    Object.keys(settings.positions || {}).map((position) => [position, {
      share_strength: Number(teamVolume.share_strength || 0),
      pace_strength: Number(teamVolume.pace_strength || 0),
    }]),
  ),
  in_season_adaptation: {
    minimum_games: 3,
    arms: {
      in_season_adaptation: {
        settings_by_position: {
          QB: { enabled: true, volume_prior_games: 4, efficiency_prior_games: 12, volume_strength: 0.5, efficiency_strength: 0, maximum_field_shift: 0.25, maximum_rate_shift: 0.16 },
          RB: { enabled: true, volume_prior_games: 2, efficiency_prior_games: 12, volume_strength: 0.5, efficiency_strength: 1, maximum_field_shift: 0.25, maximum_rate_shift: 0.16 },
          WR: { enabled: true, volume_prior_games: 4, efficiency_prior_games: 24, volume_strength: 0.75, efficiency_strength: 0.5, maximum_field_shift: 0.35, maximum_rate_shift: 0.16 },
          TE: { enabled: false },
          K: { enabled: false },
        },
      },
    },
  },
  dynamic_rest_of_season: {
    version: "dynamic-rest-of-season-v1",
    minimum_games: 2,
    purpose: "Replace a stale fixed full-season budget with a progressively updated per-game stat expectation while heavily regressing touchdowns.",
    settings_by_position: {
      QB: { enabled: true, application_strength: 0.8, volume_prior_games: 5, efficiency_prior_games: 16, touchdown_prior_games: 28, volume_strength: 0.55, efficiency_strength: 0.25, touchdown_strength: 0.12, maximum_volume_shift: 0.3, maximum_efficiency_rate_shift: 0.12, maximum_touchdown_rate_shift: 0.12, maximum_total_shift: 0.5 },
      RB: { enabled: true, application_strength: 0.8, volume_prior_games: 4, efficiency_prior_games: 16, touchdown_prior_games: 28, volume_strength: 0.7, efficiency_strength: 0.3, touchdown_strength: 0.12, maximum_volume_shift: 0.4, maximum_efficiency_rate_shift: 0.14, maximum_touchdown_rate_shift: 0.12, maximum_total_shift: 0.65 },
      WR: { enabled: true, application_strength: 0.8, volume_prior_games: 4, efficiency_prior_games: 16, touchdown_prior_games: 28, volume_strength: 0.75, efficiency_strength: 0.35, touchdown_strength: 0.12, maximum_volume_shift: 0.4, maximum_efficiency_rate_shift: 0.16, maximum_touchdown_rate_shift: 0.12, maximum_total_shift: 0.75 },
      TE: { enabled: true, application_strength: 0.8, volume_prior_games: 4, efficiency_prior_games: 16, touchdown_prior_games: 28, volume_strength: 0.7, efficiency_strength: 0.3, touchdown_strength: 0.12, maximum_volume_shift: 0.4, maximum_efficiency_rate_shift: 0.14, maximum_touchdown_rate_shift: 0.12, maximum_total_shift: 0.65 },
      K: { enabled: false },
    },
  },
  manual_stat_trend: {
    locked_at: document.locked_at,
    settings,
    combined_positions: ["QB", "RB"],
    baseline_season: season,
    baseline_source: "earliest exact immutable pre-kickoff Safe stat line available for each player",
    baseline_player_count: Object.keys(baselineByPlayer).length,
    baseline_by_player: baselineByPlayer,
  },
  ...(regimeEnabled ? {
    regime_aware_combined: {
      ...regimeCalibration,
      calibration_source: path.relative(root, regimeCalibrationFile),
      calibration_sha256: canonicalFileSha256(regimeCalibrationFile),
    },
  } : {}),
  rules: {
    immutable_player_baseline: true,
    current_week_safe_line_is_adjusted: true,
    only_pre_kickoff_snapshots_are_eligible: true,
    promotion_is_automatic: false,
  },
};
definition.definition_sha256 = crypto.createHash("sha256")
  .update(JSON.stringify(definition))
  .digest("hex");
fs.mkdirSync(challengerDirectory, { recursive: true });
fs.writeFileSync(definitionFile, JSON.stringify(definition, null, 2));
console.log(`Locked the current manual tuner candidate at ${document.locked_at}.`);
console.log(`Settings SHA-256: ${document.settings_sha256}`);
console.log(`Local lock: ${lockFile}`);
console.log(`Automatic shadow definition: ${definitionFile}`);
console.log(`Frozen player baselines: ${definition.manual_stat_trend.baseline_player_count}`);
console.log(regimeEnabled
  ? "Regime-aware combined passed its development gate and is locked as the fourth shadow arm."
  : "Regime-aware combined is not eligible; the original and dynamic-ROS challenger arms are locked without it.");
console.log("Arsenal Safe remains unchanged; this challenger is capture-only until explicit promotion.");
