import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const historyRoot = path.join(root, "public", "stats", "history");
const outputDirectory = path.join(root, "public", "stats", "derived");
const outputFile = path.join(outputDirectory, "opponent-splits.json");
const positions = new Set(["QB", "RB", "WR", "TE"]);
const scoringKeys = ["ppr", "half", "std"];
const additiveStats = new Set([
  "gp",
  "gs",
  "gms_active",
  "off_snp",
  "tm_off_snp",
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_sack",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rush_rz_att",
  "rec_tgt",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_rz_tgt",
  "rec_air_yd",
  "rec_drop",
  "fum_lost",
]);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round = (value, places = 3) => Number(number(value).toFixed(places));
const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const normalizeTeam = (team) =>
  ({ OAK: "LV", SD: "LAC", STL: "LAR", JAX: "JAC", WSH: "WAS" })[
    String(team || "").toUpperCase()
  ] || String(team || "").toUpperCase();
const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

function addStats(target, stats) {
  Object.entries(stats || {}).forEach(([key, value]) => {
    if (!additiveStats.has(key) || !Number.isFinite(Number(value))) return;
    target[key] = number(target[key]) + number(value);
  });
}

function emptyAggregate(identity = {}) {
  return {
    ...identity,
    games: 0,
    raw_games: 0,
    seasons: new Set(),
    points: { ppr: 0, half: 0, std: 0 },
    stats: {},
    best: Object.fromEntries(
      scoringKeys.map((key) => [
        key,
        { points: -Infinity, season: null, week: null },
      ]),
    ),
  };
}

function compact(row) {
  const games = Math.max(1, row.games);
  const stats = Object.fromEntries(
    Object.entries(row.stats)
      .filter(([, value]) => number(value) !== 0)
      .map(([key, value]) => [key, round(value)]),
  );
  return {
    ...Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          !["points", "stats", "best", "seasons", "identity_key"].includes(key),
      ),
    ),
    seasons: [...row.seasons].sort((a, b) => a - b),
    points: Object.fromEntries(
      scoringKeys.map((key) => [key, round(row.points[key])]),
    ),
    averages: Object.fromEntries(
      scoringKeys.map((key) => [key, round(row.points[key] / games)]),
    ),
    stats,
    best: Object.fromEntries(
      scoringKeys.map((key) => [
        key,
        row.best[key]?.points > -Infinity ? row.best[key] : null,
      ]),
    ),
  };
}

const manifest = readJson(path.join(historyRoot, "manifest.json"), {
  seasons: [],
});
const seasons = (manifest.seasons || [])
  .filter(
    (row) =>
      row.weekly_box_scores &&
      fs.existsSync(
        path.join(historyRoot, String(row.season), "schedule.json"),
      ),
  )
  .map((row) => Number(row.season))
  .filter((year) => year >= 2018)
  .sort((a, b) => a - b);

const playerTotals = new Map();
const opponentSplits = new Map();
const defenseTotals = new Map();
const playerGameSamples = new Map();
const stablePlayerKeyByName = new Map();
let gameRows = 0;
let statMatchedRows = 0;

for (const season of seasons) {
  const folder = path.join(historyRoot, String(season));
  const fantasyPros = readJson(path.join(folder, "fantasypros.json"), {
    players: [],
  });
  const sleeper = readJson(path.join(folder, "sleeper.json"), { players: [] });
  const schedule = readJson(path.join(folder, "schedule.json"), { weeks: [] });
  const rawByName = new Map(
    (sleeper.players || [])
      .filter((row) => row.name)
      .map((row) => [
        `${normalizeName(row.name)}|${String(row.position || "").toUpperCase()}`,
        row,
      ]),
  );
  const rawByPositionSurname = new Map();
  (sleeper.players || [])
    .filter((row) => row.name)
    .forEach((row) => {
      const surname = normalizeName(row.name).split(" ").at(-1);
      const key = `${String(row.position || "").toUpperCase()}|${surname}`;
      const candidates = rawByPositionSurname.get(key) || [];
      candidates.push(row);
      rawByPositionSurname.set(key, candidates);
    });
  const rawAliases = new Map([
    ["hollywood brown|WR", "marquise brown|WR"],
    ["kenneth gainwell|RB", "kenny gainwell|RB"],
    ["chigoziem okonkwo|TE", "chig okonkwo|TE"],
    ["andres borregales|K", "andy borregales|K"],
  ]);
  const findRawPlayer = (player) => {
    const nameKey = `${normalizeName(player.name)}|${String(player.position || "").toUpperCase()}`;
    const exact = rawByName.get(nameKey);
    if (exact) return exact;
    const alias = rawByName.get(rawAliases.get(nameKey));
    if (alias) return alias;
    const surname = normalizeName(player.name).split(" ").at(-1);
    const candidates = rawByPositionSurname.get(
      `${String(player.position || "").toUpperCase()}|${surname}`,
    );
    return candidates?.length === 1 ? candidates[0] : null;
  };
  const opponentByWeek = new Map();
  (schedule.weeks || []).forEach(({ week, games }) =>
    (games || []).forEach((game) => {
      const home = normalizeTeam(game.home);
      const away = normalizeTeam(game.away);
      if (!home || !away) return;
      opponentByWeek.set(`${week}:${home}`, away);
      opponentByWeek.set(`${week}:${away}`, home);
    }),
  );

  const scoringPlayers = (fantasyPros.players || []).length
    ? fantasyPros.players
    : (sleeper.players || []).map((player) => ({
        player_id: player.player_id,
        name: player.name,
        position: player.position,
        team: player.team,
        scoring: Object.fromEntries(
          scoringKeys.map((key) => [
            key,
            {
              weeks: Object.fromEntries(
                Object.entries(player.weeks || {}).map(([week, points]) => [
                  week,
                  number(points?.[key]),
                ]),
              ),
            },
          ]),
        ),
      }));

  for (const player of scoringPlayers) {
    const position = String(player.position || "").toUpperCase();
    const team = normalizeTeam(player.team);
    if (!positions.has(position) || !team || !player.name) continue;
    const raw = findRawPlayer(player);
    const weekNumbers = new Set(
      scoringKeys.flatMap((key) =>
        Object.keys(player.scoring?.[key]?.weeks || {}).map(Number),
      ),
    );
    for (const week of weekNumbers) {
      const opponent = opponentByWeek.get(`${week}:${team}`);
      if (!opponent) continue;
      const points = Object.fromEntries(
        scoringKeys.map((key) => [
          key,
          number(player.scoring?.[key]?.weeks?.[String(week)]),
        ]),
      );
      const stats = raw?.weekly_stats?.[String(week)] || {};
      const hasRawStats = Object.keys(stats).length > 0;
      const namePositionKey = `${normalizeName(player.name)}|${position}`;
      const playerKey = player.player_id
        ? `fp:${player.player_id}|${position}`
        : stablePlayerKeyByName.get(namePositionKey) || namePositionKey;
      if (player.player_id)
        stablePlayerKeyByName.set(namePositionKey, playerKey);
      const splitKey = `${playerKey}|${opponent}`;
      const defenseKey = `${opponent}|${position}`;
      const identity = {
        name: player.name,
        position,
        team,
        identity_key: playerKey,
      };
      const samples = playerGameSamples.get(playerKey) || [];
      samples.push({ season, week, opponent, points });
      playerGameSamples.set(playerKey, samples);
      const total = playerTotals.get(playerKey) || emptyAggregate(identity);
      const split =
        opponentSplits.get(splitKey) ||
        emptyAggregate({ ...identity, opponent });
      const defense =
        defenseTotals.get(defenseKey) ||
        emptyAggregate({ defense: opponent, position });

      for (const row of [total, split, defense]) {
        row.games += 1;
        row.seasons.add(season);
        scoringKeys.forEach((key) => {
          row.points[key] += points[key];
          if (points[key] > row.best[key].points)
            row.best[key] = { points: round(points[key]), season, week };
        });
        if (hasRawStats) {
          row.raw_games += 1;
          addStats(row.stats, stats);
        }
      }
      total.team = team;
      split.team = team;
      playerTotals.set(playerKey, total);
      opponentSplits.set(splitKey, split);
      defenseTotals.set(defenseKey, defense);
      gameRows += 1;
      if (hasRawStats) statMatchedRows += 1;
    }
  }
}

function opponentAdjustment(row) {
  const playerKey =
    row.identity_key || `${normalizeName(row.name)}|${row.position}`;
  const games = playerGameSamples.get(playerKey) || [];
  const matches = games.filter((game) => game.opponent === row.opponent);
  const newestSeason = Math.max(...games.map((game) => game.season), 0);
  return Object.fromEntries(
    scoringKeys.map((scoring) => {
      const comparisons = matches
        .map((game) => {
          const sameSeasonOthers = games.filter(
            (candidate) =>
              candidate.season === game.season &&
              candidate.opponent !== row.opponent,
          );
          if (!sameSeasonOthers.length) return null;
          const baseline =
            sameSeasonOthers.reduce(
              (sum, candidate) => sum + number(candidate.points?.[scoring]),
              0,
            ) / sameSeasonOthers.length;
          return {
            baseline,
            residual: number(game.points?.[scoring]) - baseline,
            weight: 1 / (1 + (newestSeason - game.season) * 0.4),
            comparison_games: sameSeasonOthers.length,
          };
        })
        .filter(Boolean);
      if (!comparisons.length)
        return [
          scoring,
          {
            adjusted_edge: null,
            raw_residual: null,
            same_season_baseline: null,
            confidence: 0,
            confidence_label: "unavailable",
            meetings: 0,
            comparison_games: 0,
          },
        ];
      const weight = comparisons.reduce((sum, item) => sum + item.weight, 0);
      const rawResidual =
        comparisons.reduce(
          (sum, item) => sum + item.residual * item.weight,
          0,
        ) / weight;
      const baseline =
        comparisons.reduce(
          (sum, item) => sum + item.baseline * item.weight,
          0,
        ) / weight;
      const comparisonGames = comparisons.reduce(
        (sum, item) => sum + item.comparison_games,
        0,
      );
      const weightSquared = comparisons.reduce(
        (sum, item) => sum + item.weight * item.weight,
        0,
      );
      const effectiveMeetings = weightSquared > 0 ? (weight * weight) / weightSquared : 0;
      const residualVariance = comparisons.reduce(
        (sum, item) => sum + item.weight * Math.pow(item.residual - rawResidual, 2),
        0,
      ) / Math.max(weight, 1);
      const standardError = Math.sqrt(residualVariance / Math.max(1, effectiveMeetings));
      const contextualGames = Math.min(18, comparisonGames) / 6;
      const evidenceStrength = 1 - Math.exp(-(effectiveMeetings + contextualGames) / 4.5);
      const directionStrength = 1 - Math.exp(-Math.abs(rawResidual) / Math.max(2, standardError));
      const stabilityStrength = 1 / (1 + standardError / 8);
      const reliability = Math.min(
        0.9,
        evidenceStrength * (0.45 + 0.35 * directionStrength + 0.2 * stabilityStrength),
      );
      const baselineCoverage = Math.min(
        1,
        comparisonGames / Math.max(1, comparisons.length * 6),
      );
      const confidence = Math.round(
        Math.min(0.95, reliability * (0.7 + 0.3 * baselineCoverage)) * 100,
      );
      return [
        scoring,
        {
          adjusted_edge: round(rawResidual * reliability),
          raw_residual: round(rawResidual),
          same_season_baseline: round(baseline),
          reliability: round(reliability, 4),
          effective_meetings: round(effectiveMeetings, 2),
          residual_standard_error: round(standardError, 2),
          confidence,
          confidence_label:
            confidence >= 60
              ? "strong"
              : confidence >= 35
                ? "moderate"
                : "limited",
          meetings: comparisons.length,
          comparison_games: comparisonGames,
        },
      ];
    }),
  );
}

const shared = {
  source: "The Fantasy Arsenal saved historical datasets",
  generated_at: new Date().toISOString(),
  seasons,
  coverage: {
    player_game_rows: gameRows,
    raw_stat_matched_rows: statMatchedRows,
    raw_stat_match_rate: gameRows ? round(statMatchedRows / gameRows, 4) : 0,
  },
  methodology: {
    scoring:
      "Saved FantasyPros historical fantasy points, with saved Sleeper scoring used for current-season weeks before a final FantasyPros archive exists",
    production:
      "Saved Sleeper weekly passing, rushing, receiving, and participation statistics",
    opponent:
      "Saved ESPN regular-season schedule joined by season, week, and team",
    opponent_adjustment:
      "Each meeting is compared with that player's same-season average against every other opponent, recency weighted, then shrunk toward zero by sample size. Raw split averages remain visible beside the adjusted edge.",
    limitation:
      "A season-final team identifier is used when a player changed teams during that season; those rare split-team rows should be treated as estimated opponent attribution.",
  },
};

fs.mkdirSync(outputDirectory, { recursive: true });
const files = {};
for (const position of positions) {
  const positionOutput = {
    ...shared,
    position,
    players: [...playerTotals.values()]
      .filter((row) => row.position === position && row.games >= 2)
      .map(compact),
    splits: [...opponentSplits.values()]
      .filter((row) => row.position === position && row.games >= 2)
      .map((row) => ({
        ...compact(row),
        opponent_adjustment: opponentAdjustment(row),
      })),
    defenses: [...defenseTotals.values()]
      .filter((row) => row.position === position)
      .map(compact),
  };
  const filename = `opponent-splits-${position.toLowerCase()}.json`;
  fs.writeFileSync(
    path.join(outputDirectory, filename),
    JSON.stringify(positionOutput),
  );
  files[position] = {
    file: filename,
    players: positionOutput.players.length,
    splits: positionOutput.splits.length,
  };
}
fs.writeFileSync(
  outputFile,
  JSON.stringify({
    ...shared,
    minimum_split_games: 2,
    files,
  }),
);
console.log(
  `Saved ${[...opponentSplits.values()].filter((row) => row.games >= 2).length} qualified player-opponent splits across ${seasons.join(", ")} (${(shared.coverage.raw_stat_match_rate * 100).toFixed(1)}% raw-stat coverage).`,
);
