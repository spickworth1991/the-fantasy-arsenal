import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const horizon = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(root, "src/lib/projectionHorizon.js"), "utf8")).toString("base64")}`);
const { projectionPoints, projectionWeeks, resolveWeeklyProjection, isWeeklyProjectionFeed } = horizon;
const sleeperScoring = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(root, "src/lib/sleeperScoring.js"), "utf8")).toString("base64")}`);

// Exercise the actual context index and getters without mounting React or
// running any updater. Only these pure functions are evaluated, not the app.
const source = fs.readFileSync(path.join(root, "src/context/SleeperContext.jsx"), "utf8");
const ast = require("espree").parse(source, { ecmaVersion: "latest", sourceType: "module", range: true, ecmaFeatures: { jsx: true } });
const declarations = ast.body.flatMap((node) => node.type === "ExportNamedDeclaration" ? [node.declaration] : [node]);
const provider = declarations.find((node) => node?.declarations?.some((decl) => decl.id.name === "SleeperProvider")).declarations[0].init.body.body;
const slice = (node) => source.slice(...node.range);
const findVariable = (nodes, name) => nodes.flatMap((node) => node.declarations || []).find((decl) => decl.id.name === name);
const helperNames = ["normalizeName", "normPos", "keyName", "safeNum"];
const functionNames = ["getPrimaryPos", "normalizeTeamAbbr", "normalizePos", "getSleeperTeamForProj", "getSleeperPosForProj", "createProjectionIndex", "buildProjectionIndexFromJSON"];
const helperCode = helperNames.map((name) => `const ${slice(findVariable(declarations, name))};`).join("\n") + "\n" + functionNames.map((name) => slice(declarations.find((node) => node.type === "FunctionDeclaration" && node.id.name === name))).join("\n");
function context() {
  const ctx = vm.createContext({ ...horizon, ...sleeperScoring, projectionIndexes: {}, weeklyProjectionData: {}, projectionScoring: "ppr", qbType: "sf", PROJECTION_DATA_SEASON: 2026 });
  vm.runInContext(helperCode, ctx);
  for (const name of ["projectionSourceFromKey", "getProjection", "getWeeklyProjectionDetails"]) {
    const init = findVariable(provider, name).init;
    vm.runInContext(`var ${name} = ${slice(init.type === "CallExpression" ? init.arguments[0] : init)};`, ctx);
  }
  return ctx;
}
const player = { full_name: "Example Player", team: "BUF", position: "WR" };
const seasonFeed = { rows: [{ name: player.full_name, position: "WR", team: "BUF", points: 170, points_ppr: 170, points_half_ppr: 136, points_standard: 102, weekly: { 1: { ppr: 8, half_ppr: 6, standard: 4 }, 2: { ppr: 24, half_ppr: 20, standard: 16 }, 3: { ppr: 0, half_ppr: 0, standard: 0 } } }] };

test("Sleeper keeps season totals and different weekly forecasts in the same index", () => {
  const ctx = context();
  ctx.projectionIndexes.SLEEPER = ctx.buildProjectionIndexFromJSON(seasonFeed);
  assert.equal(ctx.getProjection(player, "SLEEPER"), 170);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 1).points, 8);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 2).points, 24);
  assert.equal(ctx.getProjection(player, "SLEEPER"), 170);
});
test("Sleeper's standard and half-PPR aliases survive index parsing", () => {
  const ctx = context();
  ctx.projectionIndexes.SLEEPER = ctx.buildProjectionIndexFromJSON(seasonFeed);
  ctx.projectionScoring = "half";
  assert.equal(ctx.getProjection(player, "SLEEPER"), 136);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 2).points, 20);
  ctx.projectionScoring = "std";
  assert.equal(ctx.getProjection(player, "SLEEPER"), 102);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 2).points, 16);
});
test("a published weekly zero is not replaced with a season average", () => {
  const ctx = context();
  ctx.projectionIndexes.SLEEPER = ctx.buildProjectionIndexFromJSON(seasonFeed);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 3).points, 0);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 3).basis, "weekly");
});
test("weekly CBS feed cannot be loaded as a season feed", () => {
  const ctx = context();
  const weekly = { projection_contract: "explicit_week", season: 2026, week: 2, rows: [{ ...seasonFeed.rows[0], weekly: undefined, points: 12, points_ppr: 12 }] };
  assert.equal(ctx.buildProjectionIndexFromJSON(weekly), null);
  ctx.projectionIndexes.CBS = ctx.buildProjectionIndexFromJSON(seasonFeed);
  ctx.weeklyProjectionData["2026:CBS"] = { weeklyIndex: ctx.buildProjectionIndexFromJSON(weekly, "week") };
  assert.equal(ctx.getProjection(player, "CBS"), 170);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "CBS", 2).points, 12);
  assert.notEqual(ctx.getWeeklyProjectionDetails(player, "CBS", 1).points, 12);
});
test("season-only sources return a labeled estimate, never the full season total", () => {
  const result = resolveWeeklyProjection({ row: {}, week: 2, seasonPoints: 170, byeWeeks: [7] });
  assert.deepEqual(result, { points: 10, basis: "season_estimate" });
});
test("known byes are zero for season estimates and weekly rows", () => {
  assert.equal(resolveWeeklyProjection({ week: 7, seasonPoints: 170, byeWeeks: [7] }).points, 0);
  assert.equal(resolveWeeklyProjection({ row: { weeks: [{ week: 7, bye: true }] }, week: 7, seasonPoints: 170 }).basis, "bye");
});
test("invalid weeks and wrong seasons do not leak season totals", () => {
  for (const week of [null, undefined, 0, -1, 19, 1.5, "bad"]) {
    assert.equal(resolveWeeklyProjection({ week, seasonPoints: 170 }).points, null);
  }
  assert.equal(resolveWeeklyProjection({ week: 1, seasonPoints: 170, season: 2027, dataSeason: 2026 }).points, null);
});
test("unmatched players stay missing, not zero projections", () => {
  const ctx = context();
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 1).points, null);
});
test("missing CBS scoring variants are not mislabeled PPR points", () => {
  assert.equal(resolveWeeklyProjection({ row: { weeks: [{ week: 1, points_ppr: 20 }] }, week: 1, scoring: "std", seasonPoints: 300 }).points, null);
});
test("negative forecasts are preserved", () => {
  assert.equal(resolveWeeklyProjection({ row: { weeks: [{ week: 1, points_ppr: -1 }] }, week: 1 }).points, -1);
});
test("TE premium derives its weekly reception bonus when possible", () => {
  assert.equal(projectionPoints({ points_ppr: 14, points_half: 11 }, "tep", "TE"), 17);
  assert.equal(projectionPoints({ points_ppr: 14, points_half: 11 }, "tep", "WR"), 14);
});
test("explicit Arsenal weeks stay intact", () => {
  const row = { weeks: [{ week: 1, points_ppr: 22, points_half: 20, points_std: 18 }, { week: 2, bye: true }] };
  assert.equal(projectionWeeks(row), row.weeks);
  assert.equal(resolveWeeklyProjection({ row, week: 1, seasonPoints: 340 }).points, 22);
});
test("weekly stat lines use the selected league's exact scoring rules", () => {
  const ctx = context();
  ctx.projectionIndexes.ARSENAL_MODEL = ctx.buildProjectionIndexFromJSON({
    rows: [{
      name: player.full_name,
      position: "WR",
      team: "BUF",
      points_ppr: 170,
      weeks: [{ week: 1, points_ppr: 14, stat_line: { rec: 6, rec_yd: 80, rec_td: 1 } }],
    }],
  });
  const result = ctx.getWeeklyProjectionDetails(player, "ARSENAL_MODEL", 1, {
    scoringSettings: { rec: 0.5, rec_yd: 0.1, rec_td: 6 },
  });
  assert.equal(result.points, 17);
  assert.equal(result.basis, "weekly_league_scoring");
});
test("FantasyPros raw season stats can be rescored for six-point passing touchdowns", () => {
  const ctx = context();
  const quarterback = { ...player, position: "QB" };
  ctx.projectionIndexes.FANTASYPROS = ctx.buildProjectionIndexFromJSON({
    rows: [{
      name: player.full_name,
      position: "QB",
      team: "BUF",
      points_ppr: 340,
      stats: { pass_yds: 4250, pass_tds: 34, pass_ints: 12, rush_yds: 510, rush_tds: 7 },
    }],
  });
  const result = ctx.getWeeklyProjectionDetails(quarterback, "FANTASYPROS", 1, {
    scoringSettings: { pass_yd: 0.04, pass_td: 6, pass_int: -2, rush_yd: 0.1, rush_td: 6 },
  });
  assert.equal(result.points, 443 / 17);
  assert.equal(result.basis, "fantasypros_league_scoring_estimate");
});
test("DraftSharks raw season stats can be rescored for six-point passing touchdowns", () => {
  const ctx = context();
  const quarterback = { ...player, position: "QB" };
  ctx.projectionIndexes.DRAFTSHARKS = ctx.buildProjectionIndexFromJSON({
    rows: [{
      name: player.full_name,
      position: "QB",
      team: "BUF",
      points_ppr: 340,
      projections: { pass_yds: 4250, pass_tds: 34, pass_int: 12, rush_yds: 510, rush_tds: 7 },
    }],
  });
  const result = ctx.getWeeklyProjectionDetails(quarterback, "DRAFTSHARKS", 1, {
    scoringSettings: { pass_yd: 0.04, pass_td: 6, pass_int: -2, rush_yd: 0.1, rush_td: 6 },
  });
  assert.equal(result.points, 443 / 17);
  assert.equal(result.basis, "draftsharks_league_scoring_estimate");
});
test("a tool can use freshly loaded data before the provider has rerendered", () => {
  const ctx = context();
  const data = { index: ctx.buildProjectionIndexFromJSON(seasonFeed) };
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 2, { data }).points, 24);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "SLEEPER", 4, { data }).points, 10);
});
test("DraftSharks season estimates preserve the chosen QB-format variant", () => {
  const ctx = context();
  ctx.projectionIndexes.DRAFTSHARKS = ctx.buildProjectionIndexFromJSON({ rows: [{ name: player.full_name, position: "WR", team: "BUF", points: 170, points_ppr: 170, points_ppr_sf: 204 }] });
  assert.equal(ctx.getProjection(player, "DRAFTSHARKS"), 204);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "DRAFTSHARKS", 1).points, 12);
  assert.equal(ctx.getWeeklyProjectionDetails(player, "DRAFTSHARKS", 1, { qbType: "1qb" }).points, 10);
});
test("cached parsed indexes retain weekly rows and scoring variants", () => {
  const ctx = context();
  const parsed = ctx.buildProjectionIndexFromJSON(seasonFeed);
  ctx.projectionIndexes.SLEEPER = ctx.createProjectionIndex(JSON.parse(JSON.stringify(parsed.raw)));
  assert.equal(ctx.getWeeklyProjectionDetails(player, "proj:sleeper", 2, { scoring: "half" }).points, 20);
});
test("published Arsenal, Sleeper and CBS files satisfy both horizon contracts", () => {
  const season = JSON.parse(fs.readFileSync(path.join(root, "public/stats/projections/manifest.json"), "utf8")).current_season;
  for (const [code, filename] of [["ARSENAL_MODEL", "thefantasyarsenal_model"], ["SLEEPER", "sleeper"], ["CBS", "cbs"]]) {
    const feed = JSON.parse(fs.readFileSync(path.join(root, `public/projections_${filename}_${season}.json`), "utf8"));
    const ctx = context();
    ctx.PROJECTION_DATA_SEASON = Number(season);
    ctx.projectionIndexes[code] = ctx.buildProjectionIndexFromJSON(feed);
    assert.ok(ctx.projectionIndexes[code]);
    const row = feed.rows.find((row) => row.points > 50 && (code === "CBS" || projectionWeeks(row).some((w) => !w.bye && projectionPoints(w) > 0)));
    const p = { full_name: row.name, position: row.position || row.pos, team: row.team };
    assert.equal(ctx.getProjection(p, code), row.points_ppr ?? row.points);
    if (code !== "CBS") {
      const weekly = projectionWeeks(row).find((w) => !w.bye && projectionPoints(w) > 0);
      assert.equal(ctx.getWeeklyProjectionDetails(p, code, weekly.week).points, projectionPoints(weekly));
    }
  }
  const cbsWeekly = JSON.parse(fs.readFileSync(path.join(root, `public/projections_cbs_weekly_${season}.json`), "utf8"));
  assert.equal(isWeeklyProjectionFeed(cbsWeekly), true);
  assert.equal(context().buildProjectionIndexFromJSON(cbsWeekly), null);
});
