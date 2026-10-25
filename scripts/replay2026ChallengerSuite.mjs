import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildProjectionShadowArms } from "./lib/projectionShadowArms.mjs";
import { finalScheduleWeeks } from "./lib/projectionFinality.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1]) || new Date().getUTCFullYear();
const challenger = "manual-stat-trend-v1";
const directory = path.join(root, "data", "model-challengers", challenger);
const definition = JSON.parse(fs.readFileSync(path.join(directory, "definition.json"), "utf8"));
const resultsDirectory = path.join(root, "public", "stats", "projections", String(season), "accuracy-results");
const history = JSON.parse(fs.readFileSync(path.join(root, "public", "stats", "history", String(season), "sleeper.json"), "utf8"));
const schedule = JSON.parse(fs.readFileSync(path.join(root, "public", "stats", "projections", String(season), "schedule.json"), "utf8"));
const fullyFinalWeeks = finalScheduleWeeks(schedule);
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const identity = (row) => String(row.player_id || `${normalize(row.name)}|${row.position}`);
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const fields = ["pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"];
const historyById = new Map((history.players || []).filter((row) => row.player_id).map((row) => [String(row.player_id), row]));
const historyByName = new Map((history.players || []).map((row) => [`${normalize(row.name)}|${row.position}`, row]));

const latest = new Map();
const latestRisky = new Map();
for (const file of fs.readdirSync(resultsDirectory).filter((name) => /^week-\d+\.json$/.test(name))) {
  const payload = JSON.parse(fs.readFileSync(path.join(resultsDirectory, file), "utf8"));
  for (const row of payload.player_results || []) {
    if (row.scoring !== "ppr") continue;
    const key = `${row.week}:${identity(row)}`;
    if (row.lens === "risky") {
      const prior = latestRisky.get(key);
      if (!prior || Date.parse(prior.snapshot_generated_at || 0) < Date.parse(row.snapshot_generated_at || 0)) latestRisky.set(key, row);
      continue;
    }
    if (row.lens !== "safe_expected" || !row.stat_line) continue;
    const prior = latest.get(key);
    if (!prior || Date.parse(prior.snapshot_generated_at || 0) < Date.parse(row.snapshot_generated_at || 0)) latest.set(key, row);
  }
}

const rowsByWeek = new Map();
for (const row of latest.values()) {
  const risky = latestRisky.get(`${row.week}:${identity(row)}`);
  const saved = historyById.get(String(row.player_id)) || historyByName.get(`${normalize(row.name)}|${row.position}`);
  const actualLine = {};
  let completedGames = 0;
  for (const [week, line] of Object.entries(saved?.weekly_stats || {})) {
    if (Number(week) >= Number(row.week)) continue;
    if (Number(line?.gp || line?.gms_active || 0) > 0) completedGames += 1;
    for (const field of fields) actualLine[field] = (actualLine[field] || 0) + Number(line?.[field] || 0);
  }
  const players = rowsByWeek.get(Number(row.week)) || [];
  players.push({
    player_id: row.player_id,
    name: row.name,
    team: row.team,
    position: row.position,
    depth_chart_order: row.depth_chart_order,
    completed_games: completedGames,
    actual_stat_line: actualLine,
    actual: Number(row.actual),
    risky: Number(risky?.projection),
    forecast: {
      stat_line: row.stat_line,
      projections: { ppr: Number(row.projection), half: Number(row.projection), std: Number(row.projection) },
      availability: { applies_to_this_week: true, player_factor: 1 },
    },
  });
  rowsByWeek.set(Number(row.week), players);
}

const arms = definition.arms;
const records = [...rowsByWeek.entries()].flatMap(([week, players]) =>
  buildProjectionShadowArms(players, definition).flatMap((player) => {
    if (!Number.isFinite(player.actual) || Number(player.forecast_arms?.incumbent?.ppr) < 5) return [];
    return [{
      week,
      player_id: player.player_id,
      name: player.name,
      position: player.position,
      actual: player.actual,
      manual_adjustment_eligible: !player.shadow_context?.manual_stat_trend?.reason,
      risky: Number(players.find((source) => String(source.player_id) === String(player.player_id))?.risky),
      ...Object.fromEntries(arms.map((arm) => [arm, Number(player.forecast_arms?.[arm]?.ppr)])),
    }];
  }),
);
const selectionRecords = records.filter((row) => fullyFinalWeeks.has(Number(row.week)));

const metrics = (sample, arm) => {
  if (!sample.length) return null;
  const errors = sample.map((row) => row[arm] - row.actual);
  return {
    sample: sample.length,
    mae: round(errors.reduce((sum, value) => sum + Math.abs(value), 0) / sample.length),
    rmse: round(Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / sample.length)),
    bias: round(errors.reduce((sum, value) => sum + value, 0) / sample.length),
  };
};
const comparison = (sample) => {
  const byArm = Object.fromEntries(arms.map((arm) => [arm, metrics(sample, arm)]));
  const incumbent = byArm.incumbent;
  return Object.fromEntries(arms.map((arm) => [arm, {
    ...byArm[arm],
    mae_improvement_rate: arm === "incumbent" ? 0 : round((incumbent.mae - byArm[arm].mae) / incumbent.mae, 6),
    rmse_change_rate: arm === "incumbent" ? 0 : round((byArm[arm].rmse - incumbent.rmse) / incumbent.rmse, 6),
    bias_absolute_change: arm === "incumbent" ? 0 : round(Math.abs(byArm[arm].bias) - Math.abs(incumbent.bias), 4),
  }]));
};
const riskyMetrics = metrics(selectionRecords.filter((row) => Number.isFinite(row.risky)), "risky");
const diagnosticRiskyMetrics = metrics(records.filter((row) => Number.isFinite(row.risky)), "risky");
const report = {
  source: "Leakage-safe 2026 retrospective replay using one latest frozen Safe forecast per player-game and only earlier game statistics",
  generated_at: new Date().toISOString(),
  season,
  challenger,
  evidence_class: "retrospective",
  promotion_eligible: false,
  cache_policy: "Recovered rows are persisted for repeatable analysis but never mixed into the prospective promotion gate.",
  limitation: "Team-volume opportunity fields are not present in the accuracy rows, so this replay isolates the two stat-adaptation methods and their bounded combination.",
  weeks: [...rowsByWeek.keys()].sort((a, b) => a - b),
  fully_final_weeks: [...fullyFinalWeeks].filter((week) => rowsByWeek.has(week)).sort((a, b) => a - b),
  partial_weeks: [...rowsByWeek.keys()].filter((week) => !fullyFinalWeeks.has(week)).sort((a, b) => a - b),
  paired_player_games: selectionRecords.length,
  diagnostic_player_games_including_partial_weeks: records.length,
  records: records.sort((left, right) => left.week - right.week || String(left.player_id).localeCompare(String(right.player_id))),
  overall: comparison(selectionRecords),
  risky: riskyMetrics ? {
    ...riskyMetrics,
    mae_improvement_rate: round((comparison(selectionRecords).incumbent.mae - riskyMetrics.mae) / comparison(selectionRecords).incumbent.mae, 6),
  } : null,
  diagnostic_risky_including_partial_weeks: diagnosticRiskyMetrics ? {
    ...diagnosticRiskyMetrics,
    mae_improvement_rate: round((comparison(records).incumbent.mae - diagnosticRiskyMetrics.mae) / comparison(records).incumbent.mae, 6),
  } : null,
  diagnostic_overall_including_partial_weeks: comparison(records),
  modeled_positions_only: comparison(selectionRecords.filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position))),
  adjustment_eligible_only: comparison(selectionRecords.filter((row) => row.manual_adjustment_eligible)),
  by_position: Object.fromEntries(["QB", "RB", "WR", "TE", "K"].map((position) => [position, comparison(selectionRecords.filter((row) => row.position === position))])),
  by_week: Object.fromEntries([...rowsByWeek.keys()].sort((a, b) => a - b).map((week) => [week, comparison(records.filter((row) => row.week === week))])),
};
fs.writeFileSync(path.join(directory, `retrospective-${season}.json`), JSON.stringify(report, null, 2));
console.log(`\n${season} RETROSPECTIVE PROJECTION EXPERIMENT SUITE`);
console.log("=".repeat(52));
console.log(`${selectionRecords.length} unique paired player-games across fully final Weeks ${report.fully_final_weeks.join(", ")}.`);
if (report.partial_weeks.length)
  console.log(`Partial Weeks ${report.partial_weeks.join(", ")} remain diagnostic only (${records.length - selectionRecords.length} finalized player-games excluded from headline selection).`);
for (const arm of arms) {
  const row = report.overall[arm];
  console.log(`${arm}: MAE ${row.mae} (${arm === "incumbent" ? "baseline" : `${(row.mae_improvement_rate * 100).toFixed(2)}% improvement`}) | RMSE ${row.rmse} | bias ${row.bias}`);
}
if (report.risky)
  console.log(`risky_boom_bust: MAE ${report.risky.mae} (${(report.risky.mae_improvement_rate * 100).toFixed(2)}% versus incumbent) | RMSE ${report.risky.rmse} | bias ${report.risky.bias}`);
if (report.partial_weeks.length) {
  console.log("Diagnostic including finalized games from partial weeks:");
  for (const arm of arms) {
    const row = report.diagnostic_overall_including_partial_weeks[arm];
    console.log(`  ${arm}: ${row.sample} games | MAE ${row.mae} | ${arm === "incumbent" ? "baseline" : `${(row.mae_improvement_rate * 100).toFixed(2)}% improvement`}`);
  }
  if (report.diagnostic_risky_including_partial_weeks)
    console.log(`  risky_boom_bust: ${report.diagnostic_risky_including_partial_weeks.sample} games | MAE ${report.diagnostic_risky_including_partial_weeks.mae} | ${(report.diagnostic_risky_including_partial_weeks.mae_improvement_rate * 100).toFixed(2)}% versus incumbent`);
}
console.log("Adjustment-eligible unique player-games:");
for (const arm of arms) {
  const row = report.adjustment_eligible_only[arm];
  console.log(`  ${arm}: ${row.sample} games | MAE ${row.mae} | ${arm === "incumbent" ? "baseline" : `${(row.mae_improvement_rate * 100).toFixed(2)}% improvement`}`);
}
console.log(`Report: ${path.join(directory, `retrospective-${season}.json`)}\n`);

