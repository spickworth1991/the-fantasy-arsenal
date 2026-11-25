import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { finalScheduleWeeks } from "./lib/projectionFinality.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1]) || new Date().getUTCFullYear();
const labDir = path.join(root, "data", "model-challengers", "position-model-lab-v1");
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const round = (value, places = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(places)) : null;
const identity = (row) => String(row?.player_id || `${String(row?.name || "").toLowerCase()}|${row?.position || ""}`);
const definition = read(path.join(labDir, "definition.json"));
if (!definition) {
  console.log("Position Model Lab has no frozen definition; forward evaluation skipped.");
  process.exit(0);
}
const accuracyIndex = read(path.join(root, "public", "stats", "projections", String(season), "accuracy-results.json"), {});
const accuracy = accuracyIndex?.format === "week_shards"
  ? (accuracyIndex.weeks || []).flatMap((shard) => read(path.join(root, "public", String(shard.path || "").replace(/^\/+/, "")), {})?.player_results || [])
  : accuracyIndex.player_results || [];
const actuals = new Map(accuracy.filter((row) => row.scoring === "ppr" && row.lens === "safe_expected").map((row) => [`${row.week}:${identity(row)}`, row]));
const schedule = read(path.join(root, "public", "stats", "projections", String(season), "schedule.json"), { weeks: [] });
const finalWeeks = finalScheduleWeeks(schedule);
const snapshotRoot = path.join(labDir, "snapshots", String(season));
const files = fs.existsSync(snapshotRoot)
  ? fs.readdirSync(snapshotRoot, { recursive: true }).filter((file) => String(file).endsWith(".json")).map((file) => path.join(snapshotRoot, file))
  : [];
const latest = new Map();
let rejected = 0;
for (const file of files) {
  const snapshot = read(file);
  if (!snapshot || snapshot.definition_sha256 !== definition.definition_sha256 || snapshot.model_bundle_sha256 !== definition.model_bundle_sha256) { rejected += 1; continue; }
  for (const player of snapshot.players || []) {
    const generated = Date.parse(snapshot.generated_at), kickoff = Date.parse(player.kickoff);
    if (!Number.isFinite(generated) || !Number.isFinite(kickoff) || generated >= kickoff) continue;
    const key = `${snapshot.week}:${identity(player)}`, prior = latest.get(key);
    if (!prior || Date.parse(prior.snapshot.generated_at) < generated) latest.set(key, { snapshot, player });
  }
}
const pairs = [...latest.entries()].flatMap(([key, entry]) => {
  const actual = actuals.get(key), safe = Number(entry.player.forecast_arms?.safe);
  if (!actual || !finalWeeks.has(Number(actual.week)) || !Number.isFinite(safe) || safe < 5) return [];
  const allowed = new Set(["safe", "manual_stat_trend", "original_combined", ...(definition.eligible_positions?.[entry.player.position] || [])]);
  const forecasts = Object.fromEntries(Object.entries(entry.player.forecast_arms || {}).filter(([arm, value]) => allowed.has(arm) && Number.isFinite(Number(value))).map(([arm, value]) => [arm, Number(value)]));
  return [{ week: Number(actual.week), player_id: actual.player_id, name: actual.name, position: actual.position, actual: Number(actual.actual), forecasts, snapshot_generated_at: entry.snapshot.generated_at }];
});
const summarize = (rows, arm) => {
  const sample = rows.filter((row) => Number.isFinite(row.forecasts[arm]) && Number.isFinite(row.forecasts.safe));
  if (!sample.length) return null;
  const errors = sample.map((row) => row.forecasts[arm] - row.actual), safeErrors = sample.map((row) => row.forecasts.safe - row.actual);
  const mae = errors.reduce((sum, value) => sum + Math.abs(value), 0) / sample.length;
  const safeMae = safeErrors.reduce((sum, value) => sum + Math.abs(value), 0) / sample.length;
  const rmse = Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / sample.length);
  const safeRmse = Math.sqrt(safeErrors.reduce((sum, value) => sum + value ** 2, 0) / sample.length);
  return { sample: sample.length, mae: round(mae), rmse: round(rmse), bias: round(errors.reduce((sum, value) => sum + value, 0) / sample.length), mae_improvement_rate: round((safeMae - mae) / safeMae), rmse_improvement_rate: round((safeRmse - rmse) / safeRmse) };
};
const byPosition = Object.fromEntries(["QB", "RB", "WR", "TE", "K"].map((position) => {
  const rows = pairs.filter((row) => row.position === position);
  const arms = [...new Set(rows.flatMap((row) => Object.keys(row.forecasts)))];
  return [position, Object.fromEntries(arms.map((arm) => [arm, summarize(rows, arm)]))];
}));
const report = { generated_at: new Date().toISOString(), season, definition_sha256: definition.definition_sha256, model_bundle_sha256: definition.model_bundle_sha256, fully_final_weeks: [...finalWeeks].sort((a, b) => a - b), evaluated_weeks: [...new Set(pairs.map((row) => row.week))].sort((a, b) => a - b), paired_player_games: pairs.length, rejected_stale_definition_snapshots: rejected, by_position: byPosition };
fs.writeFileSync(path.join(labDir, "forward-report.json"), JSON.stringify(report, null, 2));
console.log(`Position Model Lab: ${pairs.length} paired player-games across ${report.evaluated_weeks.length} completed weeks; private forward report refreshed.`);
