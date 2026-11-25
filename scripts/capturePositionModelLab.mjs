import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildProjectionShadowArms } from "./lib/projectionShadowArms.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1]) || new Date().getUTCFullYear();
const labDir = path.join(root, "data", "model-challengers", "position-model-lab-v1");
const manifestFile = path.join(root, "public", "stats", "projections", String(season), "current.json");
const modelFile = path.join(labDir, "models.json");
const definitionFile = path.join(labDir, "definition.json");
const manualDefinitionFile = path.join(root, "data", "model-challengers", "manual-stat-trend-v1", "definition.json");
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, places = 4) => Number.isFinite(value) ? Number(value.toFixed(places)) : null;
if (![manifestFile, modelFile, definitionFile, manualDefinitionFile].every(fs.existsSync)) {
  console.log("Position Model Lab capture skipped because its private model bundle or current projections are unavailable.");
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const bundle = JSON.parse(fs.readFileSync(modelFile, "utf8"));
const definition = JSON.parse(fs.readFileSync(definitionFile, "utf8"));
const manualDefinition = JSON.parse(fs.readFileSync(manualDefinitionFile, "utf8"));
const expected = crypto.createHash("sha256").update(JSON.stringify({ ...bundle, sha256: undefined })).digest("hex");
if (definition.model_bundle_sha256 !== bundle.sha256 || expected !== bundle.sha256)
  throw new Error("Position Model Lab bundle hash mismatch; capture stopped.");
const players = (manifest.player_shards || []).flatMap((shard) => {
  const file = path.join(root, "public", String(shard.path || "").replace(/^\/+/, ""));
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).players || [] : [];
});
const week = Number(manifest.forecast_week);
if (!week) throw new Error("Current projection manifest has no forecast week.");
const now = Date.now();
const roleCohort = (player) => {
  const snapTrend = Number(player.learned_role?.features?.snap_trend);
  if (Number.isFinite(snapTrend) && snapTrend >= .12) return "role_expansion";
  if (finite(player.depth_chart_order, 99) <= 1) return "established_starter";
  return "established_reserve";
};
const sources = players.flatMap((player) => {
  const forecast = (player.weeks || []).find((row) => Number(row.week) === week);
  const kickoff = Date.parse(forecast?.kickoff);
  if (!forecast || forecast.bye || forecast.completed || !Number.isFinite(kickoff) || kickoff <= now) return [];
  return [{
    player_id: player.player_id, name: player.name, team: player.team, position: player.position,
    depth_chart_order: player.depth_chart_order, completed_games: player.completed_games,
    actual_stat_line: player.actual_stat_line,
    learned_role: player.learned_role,
    forecast: { ...forecast, projections: forecast.projections, stat_line: forecast.stat_line },
    lab_features: {
      ...(player.learned_role?.features || {}),
      ...(forecast.learned_adjustment?.signals || {}),
      offense_play_volume_delta: forecast.learned_adjustment?.signals?.offense_play_volume_delta,
      offense_neutral_pass_rate: forecast.opportunity_projection?.team_neutral_pass_rate,
      projection: forecast.projections?.ppr,
      log_projection: Math.log1p(Math.max(0, finite(forecast.projections?.ppr))),
    },
    role_cohort: roleCohort(player),
  }];
});
const shadow = buildProjectionShadowArms(sources, manualDefinition);
const fieldsByPosition = bundle.fields_by_position;
function scoreLine(position, line = {}) {
  if (position === "QB") return finite(line.pass_yd) * .04 + finite(line.pass_td) * 4 - finite(line.pass_int) * 2 + finite(line.rush_yd) * .1 + finite(line.rush_td) * 6 - finite(line.fum_lost) * 2;
  if (position === "K") return finite(line.kick_pts, finite(line.fgm) * 3 + finite(line.xpm));
  return finite(line.rush_yd) * .1 + finite(line.rush_td) * 6 + finite(line.rec) + finite(line.rec_yd) * .1 + finite(line.rec_td) * 6 - finite(line.fum_lost) * 2;
}
function coherent(position, input) {
  const line = Object.fromEntries(Object.entries(input || {}).map(([key, value]) => [key, Math.max(0, finite(value))]));
  if (position === "QB") line.pass_cmp = Math.min(finite(line.pass_cmp), finite(line.pass_att));
  if (["RB", "WR", "TE"].includes(position)) line.rec = Math.min(finite(line.rec), finite(line.rec_tgt));
  if (position === "K") { line.fgm = Math.min(finite(line.fgm), finite(line.fga)); line.xpm = Math.min(finite(line.xpm), finite(line.xpa)); }
  return line;
}
function vector(row, names, extra = {}) {
  return names.map((name) => {
    if (name === "projection") return row.safe;
    if (name === "log_projection") return Math.log1p(Math.max(0, row.safe));
    if (name.startsWith("baseline_")) return finite(extra[name.slice(9)]);
    return finite(row.features?.[name]);
  });
}
function predict(model, row, extra = {}) {
  if (model.kind === "cohort") return model.global;
  const values = vector(row, model.names, extra);
  if (model.kind === "ridge") return model.coefficients[0] + values.reduce((sum, value, index) => sum + ((value - model.means[index]) / model.scales[index]) * model.coefficients[index + 1], 0);
  return model.base + model.trees.reduce((sum, tree) => sum + (values[tree.feature] <= tree.threshold ? tree.left : tree.right), 0);
}
function searchedCohortKey(row, config) {
  const base = config.base === "safe" ? row.safe : config.base === "manual" ? row.manual : row.combined;
  const role = row.role_cohort || "unknown", band = Math.floor(base / config.bandSize) * config.bandSize;
  const trend = finite(row.features?.opportunity_trend) > config.trendThreshold ? "up" : finite(row.features?.opportunity_trend) < -config.trendThreshold ? "down" : "flat";
  if (config.grouping === "role_band") return `${role}|${band}`;
  if (config.grouping === "band_trend") return `${band}|${trend}`;
  return `${role}|${band}|${trend}`;
}
function component(row, models, kind) {
  const base = coherent(row.position, row.baseline_line), next = { ...base };
  for (const field of fieldsByPosition[row.position]) {
    const divisor = Math.max(.25, Math.abs(finite(base[field])));
    next[field] = Math.max(0, finite(base[field]) + clamp(predict(models[kind][field], row, base), -1.25, 2) * divisor);
  }
  return clamp(scoreLine(row.position, coherent(row.position, next)), Math.max(0, row.safe * .5), row.safe * 1.55);
}
function expandModelVariants(predictions, componentArms) {
  const next = { ...predictions };
  for (const strength of [.25, .5, .75]) {
    const suffix = String(Math.round(strength * 100));
    next[`manual_adjustment_${suffix}`] = predictions.safe + strength * (predictions.manual_stat_trend - predictions.safe);
    next[`combined_adjustment_${suffix}`] = predictions.safe + strength * (predictions.original_combined - predictions.safe);
  }
  for (const strength of [.25, .5, .75, 1.05, 1.1, 1.15, 1.2, 1.25, 1.5]) {
    const suffix = String(Math.round(strength * 100));
    next[`bias_corrected_manual_${suffix}`] = predictions.manual_stat_trend + strength * (predictions.bias_calibrated_manual - predictions.manual_stat_trend);
    next[`residual_corrected_combined_${suffix}`] = predictions.original_combined + strength * (predictions.residual_corrected_combined - predictions.original_combined);
  }
  for (const strength of [.1, .2, .25, .35, .4, .5, .6, .75]) {
    const suffix = String(Math.round(strength * 100));
    for (const arm of componentArms)
      next[`${arm}_over_manual_${suffix}`] = predictions.manual_stat_trend + strength * (predictions[arm] - predictions.manual_stat_trend);
  }
  return Object.fromEntries(Object.entries(next).map(([arm, value]) => [arm, round(value)]));
}
const outputPlayers = shadow.map((player) => {
  const positionBundle = bundle.positions[player.position];
  const source = sources.find((row) => String(row.player_id) === String(player.player_id));
  const safe = finite(player.forecast_arms?.incumbent?.ppr), manual = finite(player.forecast_arms?.manual_stat_trend?.ppr, safe), combined = finite(player.forecast_arms?.combined_adaptation_manual?.ppr, manual);
  const row = { position: player.position, safe, manual, combined, baseline_line: player.forecast.stat_line, features: source?.lab_features || {}, role_cohort: source?.role_cohort };
  const biasKey = `${Math.floor(manual / 5) * 5}|${row.role_cohort || "unknown"}`;
  const residualRow = { ...row, features: { ...row.features, manual_delta: manual - safe, combined_delta: combined - safe } };
  const prefix = { QB: "qb_component", RB: "rb_opportunity", WR: "wr_usage", TE: "te_role_mixture", K: "k_opportunity" }[player.position];
  const ridge = component(row, positionBundle.models, "ridge"), boosted = component(row, positionBundle.models, "boosted");
  const componentArms = [`${prefix}_ridge`, `${prefix}_boosted`];
  const forecastArms = {
    safe, manual_stat_trend: manual, original_combined: combined,
    bias_calibrated_manual: clamp(manual + finite(positionBundle.models.bias[biasKey]), Math.max(0, manual * .75), manual * 1.25),
    residual_corrected_combined: clamp(combined + predict(positionBundle.models.residual, residualRow, row.baseline_line), Math.max(0, combined * .75), combined * 1.25),
    [`${prefix}_ridge`]: ridge, [`${prefix}_ridge_calibrated`]: ridge + finite(positionBundle.point_corrections[`${prefix}_ridge`]),
    [`${prefix}_boosted`]: boosted, [`${prefix}_boosted_calibrated`]: boosted + finite(positionBundle.point_corrections[`${prefix}_boosted`]),
  };
  for (const [arm, searched] of Object.entries(bundle.search_models?.[player.position] || {})) {
    const base = searched.config.base === "safe" ? safe : searched.config.base === "manual" ? manual : combined;
    if (searched.model.kind === "rb_switch") {
      const advantage = predict(searched.model.predictor, row, row.baseline_line);
      const adjustment = advantage > searched.config.threshold ? searched.config.strength * (base - safe) : 0;
      forecastArms[arm] = clamp(safe + adjustment + finite(searched.model.biasCorrection), Math.max(0, safe * .55), safe * 1.5);
    } else if (searched.model.kind === "rb_volume") {
      const line = coherent("RB", row.baseline_line), next = { ...line };
      const rushDelta = clamp(predict(searched.model.rush_att, row, line), -searched.config.predictionCap, searched.config.predictionCap);
      const targetDelta = clamp(predict(searched.model.rec_tgt, row, line), -searched.config.predictionCap, searched.config.predictionCap);
      const rushAtt = Math.max(0, finite(line.rush_att)), recTgt = Math.max(0, finite(line.rec_tgt));
      next.rush_att = rushAtt * (1 + searched.config.strength * rushDelta);
      next.rec_tgt = recTgt * (1 + searched.config.strength * targetDelta);
      const rushScale = rushAtt > .25 ? next.rush_att / rushAtt : 1, targetScale = recTgt > .25 ? next.rec_tgt / recTgt : 1;
      for (const field of ["rush_yd", "rush_td"]) next[field] = finite(line[field]) * rushScale;
      for (const field of ["rec", "rec_yd", "rec_td"]) next[field] = finite(line[field]) * targetScale;
      forecastArms[arm] = clamp(base + (scoreLine("RB", coherent("RB", next)) - safe) + finite(searched.model.biasCorrection), Math.max(0, safe * .55), safe * 1.5);
    } else {
      const residual = searched.model.kind === "cohort" ? finite(searched.model.cells?.[searchedCohortKey(row, searched.config)]?.residual, searched.model.global) : predict(searched.model, row, row.baseline_line);
      const cap = Math.max(1.5, safe * searched.config.predictionCap);
      forecastArms[arm] = clamp(base + searched.config.strength * clamp(residual, -cap, cap) + finite(searched.model.biasCorrection), Math.max(0, safe * .55), safe * 1.5);
    }
  }
  return {
    player_id: player.player_id, name: player.name, team: player.team, position: player.position,
    kickoff: player.forecast.kickoff,
    forecast_arms: expandModelVariants(forecastArms, componentArms),
  };
});
if (!outputPlayers.length) {
  console.log("Position Model Lab capture found no eligible pre-kickoff players.");
  process.exit(0);
}
const directory = path.join(labDir, "snapshots", String(season), `week-${week}`);
fs.mkdirSync(directory, { recursive: true });
const generatedAt = new Date().toISOString(), file = path.join(directory, `${generatedAt.replace(/:/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify({ challenger: definition.version, definition_sha256: definition.definition_sha256, model_bundle_sha256: bundle.sha256, generated_at: generatedAt, season, week, site_exposed: false, players: outputPlayers }, null, 2));
console.log(`Saved private Position Model Lab Week ${week} snapshot for ${outputPlayers.length} pre-kickoff players.`);
