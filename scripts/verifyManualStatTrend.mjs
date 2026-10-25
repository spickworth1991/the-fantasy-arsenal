import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsFile = path.join(root, "data", "model-tuning", "stat-trend-settings.json");
const accuracyRoot = path.join(root, "public", "stats", "projections", "2026", "accuracy-results");
const outputFile = path.join(root, "scripts", "_stat_backtests", "replays", "manual-stat-tune", "forward-verification.json");
const lockFile = path.join(root, "scripts", "_stat_backtests", "replays", "manual-stat-tune", "locked-candidate.json");
const lockedCandidate = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, "utf8")) : null;
const useCurrentSettings = process.argv.includes("--current-settings");
const activeLock = useCurrentSettings ? null : lockedCandidate;
const config = activeLock?.settings || JSON.parse(fs.readFileSync(settingsFile, "utf8"));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const keyOf = (row) => `${row.player_id || row.name}|${row.position}`;
const fieldsByPosition = {
  QB: { volume: ["pass_att", "rush_att"], rates: [["pass_cmp", "pass_att"], ["pass_yd", "pass_att"], ["pass_td", "pass_att"], ["pass_int", "pass_att"], ["rush_yd", "rush_att"], ["rush_td", "rush_att"]] },
  RB: { volume: ["rush_att", "rec_tgt"], rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  WR: { volume: ["rush_att", "rec_tgt"], rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  TE: { volume: ["rec_tgt"], rates: [["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  K: { volume: ["fga", "xpa", "kick_pts"], rates: [["fgm", "fga"], ["xpm", "xpa"]] },
};

function score(position, line = {}) {
  return position === "QB"
    ? Number(line.pass_yd || 0) * 0.04 + Number(line.pass_td || 0) * 4 - Number(line.pass_int || 0) * 2 + Number(line.rush_yd || 0) * 0.1 + Number(line.rush_td || 0) * 6 - Number(line.fum_lost || 0) * 2
    : position === "K"
    ? Number(line.kick_pts || 0)
    : Number(line.rush_yd || 0) * 0.1 + Number(line.rush_td || 0) * 6 + Number(line.rec || 0) + Number(line.rec_yd || 0) * 0.1 + Number(line.rec_td || 0) * 6 - Number(line.fum_lost || 0) * 2;
}

const files = fs.existsSync(accuracyRoot)
  ? fs.readdirSync(accuracyRoot).filter((name) => /^week-\d+\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  : [];
const rows = files.flatMap((name) => {
  const document = JSON.parse(fs.readFileSync(path.join(accuracyRoot, name), "utf8"));
  return (document.player_results || []).filter((row) => row.scoring === "ppr" && row.stat_line && row.actual_stat_line);
});
if (!rows.length) throw new Error("No frozen 2026 accuracy rows are available.");

const earliestFrozenLine = new Map();
for (const row of [...rows].sort((a, b) => a.week - b.week))
  if (!earliestFrozenLine.has(keyOf(row))) earliestFrozenLine.set(keyOf(row), { week: row.week, line: row.stat_line });

function priorActualAverage(target) {
  const priorRows = rows.filter((row) => keyOf(row) === keyOf(target) && row.week < target.week);
  if (!priorRows.length) return null;
  const totals = {};
  for (const row of priorRows)
    for (const field of Object.keys(row.actual_stat_line || {}))
      if (Number.isFinite(Number(row.actual_stat_line[field]))) totals[field] = (totals[field] || 0) + Number(row.actual_stat_line[field]);
  return Object.fromEntries(Object.entries(totals).map(([field, total]) => [field, total / priorRows.length]));
}

function tunedLine(row, activeConfig = config) {
  const positionConfig = activeConfig.positions?.[row.position];
  const fields = fieldsByPosition[row.position];
  const frozen = row.stat_line;
  const baseline = earliestFrozenLine.get(keyOf(row));
  const current = priorActualAverage(row);
  const games = rows.filter((candidate) => keyOf(candidate) === keyOf(row) && candidate.week < row.week).length;
  if (!positionConfig?.enabled || !fields || !baseline || baseline.week >= row.week || !current) return { line: frozen, adjusted: false };
  const next = { ...frozen };
  const starter = Number(row.depth_chart_order || 99) <= 1;
  const cohort = `established_${starter ? "starter" : "reserve"}`;
  const roleMultiplier = Number(positionConfig.role_multipliers?.[cohort] ?? 1);
  const applyFactor = (entry, currentValue, priorValue) => {
    if (entry?.enabled !== true || games < Number(entry.minimum_games ?? positionConfig.minimum_games ?? activeConfig.minimum_games ?? 3) || !(priorValue > 0)) return 1;
    const direction = currentValue >= priorValue ? "up" : "down";
    const weight = Number(direction === "up" ? entry.up_weight ?? entry.weight ?? 1 : entry.down_weight ?? entry.weight ?? 1) * roleMultiplier;
    const cap = Number(direction === "up" ? entry.max_up_move_pct ?? entry.max_stat_move_pct ?? 0.25 : entry.max_down_move_pct ?? entry.max_stat_move_pct ?? 0.25);
    const reliability = games / (games + Number(entry.prior_games ?? 8));
    return clamp(1 + (currentValue / priorValue - 1) * reliability * weight, 1 - cap, 1 + cap);
  };
  for (const field of fields.volume) {
    const prior = Number(baseline.line[field] || 0);
    const observed = Number(current[field] || 0);
    next[field] = Number(frozen[field] || 0) * applyFactor(positionConfig.stats?.[field], observed, prior);
  }
  for (const [numerator, denominator] of fields.rates) {
    const priorRate = Number(baseline.line[numerator] || 0) / Math.max(0.01, Number(baseline.line[denominator] || 0));
    const currentRate = Number(current[numerator] || 0) / Math.max(0.01, Number(current[denominator] || 0));
    const rateFactor = applyFactor(positionConfig.stats?.[numerator], currentRate, priorRate);
    const frozenRate = Number(frozen[numerator] || 0) / Math.max(0.01, Number(frozen[denominator] || 0));
    next[numerator] = Number(next[denominator] || 0) * frozenRate * rateFactor;
  }
  next.pass_cmp = Math.min(Number(next.pass_cmp || 0), Number(next.pass_att || 0));
  next.rec = Math.min(Number(next.rec || 0), Number(next.rec_tgt || 0));
  const safe = Number(row.projection);
  const rawTuned = score(row.position, next);
  const rawSafe = score(row.position, frozen);
  const overallWeight = Number(positionConfig.overall_weight ?? 0);
  const cap = Number(positionConfig.max_total_move_pct ?? 0.2);
  const tuned = clamp(safe + (rawTuned - rawSafe) * overallWeight, Math.max(0, safe * (1 - cap)), safe * (1 + cap));
  return { line: next, adjusted: true, tuned };
}

function evaluateConfig(activeConfig) {
  return rows.flatMap((row) => {
    const result = tunedLine(row, activeConfig);
    if (!result.adjusted || !Number.isFinite(result.tuned) || Number(row.projection) < 5) return [];
    return [{
    week: row.week,
    player_id: row.player_id,
    name: row.name,
    position: row.position,
    team: row.team,
    snapshot_id: row.snapshot_id,
    snapshot_generated_at: row.snapshot_generated_at,
    evidence_class: activeLock && Date.parse(row.snapshot_generated_at) > Date.parse(activeLock.locked_at)
      ? "prospective"
      : "retrospective",
    safe: Number(row.projection),
    tuned: result.tuned,
    actual: Number(row.actual),
    }];
  });
}

const evaluated = evaluateConfig(config);

function metrics(sample) {
  const safeErrors = sample.map((row) => row.safe - row.actual);
  const tunedErrors = sample.map((row) => row.tuned - row.actual);
  const safeMae = mean(safeErrors.map(Math.abs));
  const tunedMae = mean(tunedErrors.map(Math.abs));
  return {
    sample: sample.length,
    safe_mae: round(safeMae),
    tuned_mae: round(tunedMae),
    mae_improvement_rate: round((safeMae - tunedMae) / Math.max(0.001, safeMae), 6),
    safe_rmse: round(Math.sqrt(mean(safeErrors.map((value) => value ** 2)))),
    tuned_rmse: round(Math.sqrt(mean(tunedErrors.map((value) => value ** 2)))),
    safe_bias: round(mean(safeErrors)),
    tuned_bias: round(mean(tunedErrors)),
  };
}

const enabledPositions = Object.entries(config.positions || {}).filter(([, value]) => value.enabled).map(([position]) => position);
const componentAblations = Object.fromEntries(enabledPositions.map((position) => {
  const fullRows = evaluated.filter((row) => row.position === position);
  const fullMetrics = metrics(fullRows);
  const components = Object.entries(config.positions?.[position]?.stats || {}).flatMap(([field, definition]) => {
    if (definition.enabled !== true) return [];
    const ablatedConfig = structuredClone(config);
    ablatedConfig.positions[position].stats[field].enabled = false;
    const ablatedMetrics = metrics(evaluateConfig(ablatedConfig).filter((row) => row.position === position));
    return [[field, {
      full_tuned_mae: fullMetrics.tuned_mae,
      without_component_mae: ablatedMetrics.tuned_mae,
      marginal_mae_points: round(ablatedMetrics.tuned_mae - fullMetrics.tuned_mae, 6),
      marginal_improvement_rate: round((ablatedMetrics.tuned_mae - fullMetrics.tuned_mae) / Math.max(0.001, fullMetrics.safe_mae), 6),
      result: ablatedMetrics.tuned_mae > fullMetrics.tuned_mae ? "HELPED" : ablatedMetrics.tuned_mae < fullMetrics.tuned_mae ? "HURT" : "TIED",
    }]];
  });
  return [position, Object.fromEntries(components)];
}));
const report = {
  generated_at: new Date().toISOString(),
  local_only: true,
  source: "Exact immutable pre-kickoff Arsenal Safe stat lines and finalized 2026 accuracy results",
  status: evaluated.length ? "ready" : "insufficient_evidence",
  warning: "These weeks are exact frozen evidence, but they are not untouched if their outcomes were inspected while choosing settings. Lock a settings hash before treating later weeks as prospective proof.",
  settings_file: path.relative(root, settingsFile),
  locked_candidate: activeLock ? {
    locked_at: activeLock.locked_at,
    settings_sha256: activeLock.settings_sha256,
  } : null,
  enabled_positions: enabledPositions,
  population: "Active player-games with an exact frozen PPR projection of at least 5 points, an earlier frozen player baseline, and prior current-season results.",
  limitations: [
    "The earliest available frozen stat line is the player baseline; no missing historical projection is reconstructed.",
    "Newcomer versus established status is unavailable in the accuracy artifact, so exact verification uses starter/reserve role multipliers only.",
    "Team-volume reconciliation requires the full team snapshot context and remains evaluated in the historical replay/challenger snapshot path.",
  ],
  overall: metrics(evaluated),
  retrospective: metrics(evaluated.filter((row) => row.evidence_class === "retrospective")),
  prospective: metrics(evaluated.filter((row) => row.evidence_class === "prospective")),
  completed_prospective_weeks: [...new Set(evaluated.filter((row) => row.evidence_class === "prospective").map((row) => row.week))].length,
  by_position: Object.fromEntries(enabledPositions.map((position) => [position, metrics(evaluated.filter((row) => row.position === position))])),
  by_week: Object.fromEntries([...new Set(evaluated.map((row) => row.week))].sort((a, b) => a - b).map((week) => [week, metrics(evaluated.filter((row) => row.week === week))])),
  component_ablations: componentAblations,
  records: evaluated,
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log("\nEXACT FROZEN 2026 MANUAL-TUNER VERIFICATION");
console.log("=".repeat(49));
console.log(`Rows: ${report.overall.sample} | Safe MAE ${report.overall.safe_mae} | tuned MAE ${report.overall.tuned_mae} | change ${(report.overall.mae_improvement_rate * 100).toFixed(2)}%`);
console.log(activeLock
  ? `Prospective evidence after lock: ${report.prospective.sample} rows across ${report.completed_prospective_weeks} completed weeks.`
  : "No candidate is locked; all results are retrospective diagnostics. Run npm run tune:lock when the settings are final.");
for (const [position, result] of Object.entries(report.by_position))
  console.log(`${position}: ${result.sample} rows | ${result.safe_mae} -> ${result.tuned_mae} | ${(result.mae_improvement_rate * 100).toFixed(2)}%`);
for (const position of enabledPositions) {
  console.log(`${position} exact component contributions:`);
  for (const [field, result] of Object.entries(componentAblations[position] || {}))
    console.log(`  ${field}: ${result.result} ${result.marginal_mae_points >= 0 ? "+" : ""}${result.marginal_mae_points} MAE points when included`);
}
console.log(`Report: ${outputFile}`);
console.log("No live or public model files were changed.\n");
