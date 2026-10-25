import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildProjectionShadowArms } from "./lib/projectionShadowArms.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1]) || new Date().getUTCFullYear();
const requestedPlayers = String(process.argv.find((value) => value.startsWith("--players="))?.slice(10) || "Bo Nix,Deshaun Watson")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const resultsDirectory = path.join(root, "public", "stats", "projections", String(season), "accuracy-results");
const resultFiles = fs.existsSync(resultsDirectory)
  ? fs.readdirSync(resultsDirectory).filter((file) => /^week-\d+\.json$/.test(file))
  : [];
const payloads = resultFiles.map((file) => read(path.join(resultsDirectory, file)));
const forecasts = payloads
  .flatMap((payload) => payload.player_results || [])
  .filter((row) => row.scoring === "ppr" && row.lens === "safe_expected" && row.stat_line);
const comparisons = payloads.flatMap((payload) => payload.source_comparison_results || []);
const history = read(path.join(root, "public", "stats", "history", String(season), "sleeper.json"));
const historyById = new Map((history.players || []).filter((row) => row.player_id).map((row) => [String(row.player_id), row]));
const historyByName = new Map((history.players || []).map((row) => [`${norm(row.name)}|${row.position}`, row]));
const fields = ["pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"];
const settingsByPosition = {
  QB: { enabled: true, volume_prior_games: 4, efficiency_prior_games: 12, volume_strength: 0.5, efficiency_strength: 0, maximum_field_shift: 0.25, maximum_rate_shift: 0.16 },
  RB: { enabled: true, volume_prior_games: 2, efficiency_prior_games: 12, volume_strength: 0.5, efficiency_strength: 1, maximum_field_shift: 0.25, maximum_rate_shift: 0.16 },
  WR: { enabled: true, volume_prior_games: 4, efficiency_prior_games: 24, volume_strength: 0.75, efficiency_strength: 0.5, maximum_field_shift: 0.35, maximum_rate_shift: 0.16 },
  TE: { enabled: false },
  K: { enabled: false },
};
const definition = {
  settings_by_position: {},
  role_redistribution: { minimum_vacated_opportunities: 999 },
  in_season_adaptation: {
    minimum_games: 3,
    arms: { adaptation: { settings_by_position: settingsByPosition } },
  },
};

const replayRows = forecasts.map((forecast) => {
  const saved = historyById.get(String(forecast.player_id)) || historyByName.get(`${norm(forecast.name)}|${forecast.position}`);
  const actualLine = {};
  let completedGames = 0;
  for (const [week, line] of Object.entries(saved?.weekly_stats || {})) {
    if (Number(week) >= Number(forecast.week)) continue;
    if (Number(line?.gp || line?.gms_active || 0) > 0) completedGames += 1;
    for (const field of fields) actualLine[field] = (actualLine[field] || 0) + Number(line?.[field] || 0);
  }
  const player = {
    player_id: forecast.player_id,
    name: forecast.name,
    team: forecast.team,
    position: forecast.position,
    completed_games: completedGames,
    actual_stat_line: actualLine,
    forecast: {
      stat_line: forecast.stat_line,
      projections: { ppr: Number(forecast.projection), half: Number(forecast.projection), std: Number(forecast.projection) },
      availability: { applies_to_this_week: true, player_factor: 1 },
    },
  };
  const replay = buildProjectionShadowArms([player], definition)[0];
  return {
    week: Number(forecast.week),
    name: forecast.name,
    position: forecast.position,
    actual: Number(forecast.actual),
    incumbent: Number(forecast.projection),
    adaptation: Number(replay.forecast_arms.adaptation.ppr),
    completed_games: completedGames,
    context: replay.shadow_context.in_season_adaptation.adaptation,
  };
});
const metrics = (rows, field) => ({
  sample: rows.length,
  mae: rows.length ? rows.reduce((sum, row) => sum + Math.abs(row[field] - row.actual), 0) / rows.length : null,
  rmse: rows.length ? Math.sqrt(rows.reduce((sum, row) => sum + (row[field] - row.actual) ** 2, 0) / rows.length) : null,
  bias: rows.length ? rows.reduce((sum, row) => sum + row[field] - row.actual, 0) / rows.length : null,
});
for (const position of ["ALL", "QB", "RB", "WR", "TE", "K"]) {
  const rows = replayRows.filter((row) => row.completed_games >= 3 && (position === "ALL" || row.position === position));
  const incumbent = metrics(rows, "incumbent");
  const adaptation = metrics(rows, "adaptation");
  const improvement = incumbent.mae && adaptation.mae != null
    ? (incumbent.mae - adaptation.mae) / incumbent.mae * 100
    : null;
  console.log(`  balance: MAE ${improvement == null ? "—" : `${improvement >= 0 ? "+" : ""}${improvement.toFixed(2)}%`} | RMSE ${incumbent.rmse?.toFixed(3) || "—"} -> ${adaptation.rmse?.toFixed(3) || "—"} | bias ${incumbent.bias?.toFixed(3) || "—"} -> ${adaptation.bias?.toFixed(3) || "—"}`);
  console.log(`${position}: ${rows.length} completed frozen player-games | incumbent ${incumbent.mae?.toFixed(3) || "—"} | adaptation ${adaptation.mae?.toFixed(3) || "—"}`);
}

const sourceGroups = new Map();
for (const row of comparisons.filter((entry) => entry.scoring === "ppr" && entry.position === "QB")) {
  const key = `${row.week}|${row.player_id || norm(row.name)}`;
  const current = sourceGroups.get(key) || { actual: Number(row.actual), sources: {} };
  current.sources[row.source] = Number(row.projection);
  sourceGroups.set(key, current);
}
const qbAnchors = [...sourceGroups.values()].filter((row) => Number.isFinite(row.sources["The Fantasy Arsenal"]) && (Number.isFinite(row.sources.Sleeper) || Number.isFinite(row.sources.CBS)));
const qbAnchorMae = qbAnchors.reduce((sum, row) => {
  const values = [row.sources.Sleeper, row.sources.CBS].filter(Number.isFinite);
  const projection = values.reduce((total, value) => total + value, 0) / values.length;
  return sum + Math.abs(projection - row.actual);
}, 0) / Math.max(1, qbAnchors.length);
console.log(`QB weekly CBS/Sleeper anchor: ${qbAnchors.length} paired games | MAE ${qbAnchorMae.toFixed(3)}`);

for (const playerName of requestedPlayers) {
  const rows = replayRows.filter((row) => row.name.toLowerCase() === playerName).sort((left, right) => left.week - right.week);
  if (!rows.length) continue;
  console.log(`\n${rows[0].name}`);
  for (const row of rows)
    console.log(`  Week ${row.week}: ${row.incumbent.toFixed(2)} -> ${row.adaptation.toFixed(2)} | actual ${row.actual.toFixed(2)} | prior games ${row.completed_games}`);
}
