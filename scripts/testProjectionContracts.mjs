import assert from "node:assert/strict";
import {
  normalizeProjectedStatLine,
  normalizeSeasonProjectionPoints,
} from "./lib/projectionContracts.mjs";

const fullSeason = normalizeProjectedStatLine({
  rawLine: { games: 17, pass_att: 510, pass_yd: 3400 },
  contract: "full_season",
  actualLine: { pass_att: 180, pass_yd: 1200 },
  remainingGames: 12,
  activeGames: 17,
  fields: ["pass_att", "pass_yd", "pass_td"],
});
assert.equal(fullSeason.games, 17);
assert.equal(fullSeason.pass_att, 467.5);
assert.ok(Math.abs(fullSeason.pass_yd - 3116.6666666666665) < 1e-9);
assert.equal(Object.hasOwn(fullSeason, "pass_td"), false);

const restOfSeason = normalizeProjectedStatLine({
  rawLine: { games: 12, pass_att: 360, pass_yd: 2700 },
  contract: "rest_of_season",
  actualLine: { pass_att: 180, pass_yd: 1200 },
  remainingGames: 12,
  activeGames: 17,
  fields: ["pass_att", "pass_yd"],
});
assert.equal(restOfSeason.pass_att, 510);
assert.equal(restOfSeason.pass_yd, 3825);

assert.equal(normalizeSeasonProjectionPoints(210, "rest_of_season", 75), 285);
assert.equal(normalizeSeasonProjectionPoints(300, "full_season", 75), 300);
assert.throws(
  () => normalizeSeasonProjectionPoints(20, "explicit_week", 75),
  /Unsupported season-point projection contract/,
);

console.log("Projection contract tests: PASS");
