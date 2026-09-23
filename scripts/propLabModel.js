import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";

export const PROP_MARKETS = {
  player_pass_yds: { stat: "pass_yd", label: "Passing yards", positions: ["QB"] },
  player_pass_tds: { stat: "pass_td", label: "Passing TDs", positions: ["QB"], count: true },
  player_pass_completions: { stat: "pass_cmp", label: "Completions", positions: ["QB"], count: true },
  player_rush_yds: { stat: "rush_yd", label: "Rushing yards", positions: ["QB", "RB", "WR"] },
  player_rush_attempts: { stat: "rush_att", label: "Rush attempts", positions: ["QB", "RB", "WR"], count: true },
  player_receptions: { stat: "rec", label: "Receptions", positions: ["RB", "WR", "TE"], count: true },
  player_reception_yds: { stat: "rec_yd", label: "Receiving yards", positions: ["RB", "WR", "TE"] },
};

const normalizeName = (value) => String(value || "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "").replace(/[^a-z0-9]/g, "");
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, places = 4) => Number(Number(value || 0).toFixed(places));
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const weight = index - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] * (1 - weight) + sorted[lower + 1] * weight;
};
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 20);

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function fullModel(root, season) {
  const positions = ["qb", "rb", "wr", "te", "k"];
  const shards = positions.map((position) => readJson(path.join(root, "public", "stats", "projections", String(season), `current-${position}.json`)))
    .filter(Boolean);
  return {
    generated_at: shards[0]?.generated_at || null,
    model_version: shards[0]?.model_version || null,
    model_build_id: shards[0]?.model_build_id || null,
    players: shards.flatMap((shard) => shard.players || []),
  };
}

function historicalSamples(root, seasons) {
  const playerSamples = new Map();
  const groupSamples = new Map();
  const gameObservations = new Map();
  for (const season of seasons) {
    const history = readJson(path.join(root, "public", "stats", "history", String(season), "sleeper.json"));
    const schedule = readJson(path.join(root, "public", "stats", "history", String(season), "schedule.json"));
    const gamesByTeamWeek = new Map();
    for (const weekRow of schedule?.weeks || []) for (const game of weekRow.games || []) {
      const gameId = `${season}:${weekRow.week}:${game.away}:${game.home}`;
      gamesByTeamWeek.set(`${weekRow.week}:${game.home}`, gameId);
      gamesByTeamWeek.set(`${weekRow.week}:${game.away}`, gameId);
    }
    for (const player of history?.players || []) {
      const position = String(player.position || "").toUpperCase();
      for (const [week, stats] of Object.entries(player.weekly_stats || {})) {
        if (Number(stats.gp ?? stats.gms_active ?? 0) <= 0) continue;
        for (const definition of Object.values(PROP_MARKETS)) {
          if (!definition.positions.includes(position)) continue;
          const actual = number(stats[definition.stat]);
          if (actual == null) continue;
          const playerKey = `${player.player_id}:${definition.stat}`;
          const groupKey = `${position}:${definition.stat}`;
          if (!playerSamples.has(playerKey)) playerSamples.set(playerKey, []);
          if (!groupSamples.has(groupKey)) groupSamples.set(groupKey, new Map());
          playerSamples.get(playerKey).push(actual);
          const byPlayer = groupSamples.get(groupKey);
          if (!byPlayer.has(`${season}:${player.player_id}`)) byPlayer.set(`${season}:${player.player_id}`, []);
          byPlayer.get(`${season}:${player.player_id}`).push({ actual, season, week: Number(week), team: player.team || "" });
          const gameId = gamesByTeamWeek.get(`${week}:${player.team}`);
          if (gameId) {
            if (!gameObservations.has(gameId)) gameObservations.set(gameId, []);
            gameObservations.get(gameId).push({ playerId: String(player.player_id), team: player.team, position, stat: definition.stat, actual });
          }
        }
      }
    }
  }
  const normalizedGroups = new Map();
  const groupMeans = new Map();
  for (const [key, players] of groupSamples) {
    const ratios = [];
    for (const rows of players.values()) {
      const mean = rows.reduce((sum, row) => sum + row.actual, 0) / rows.length;
      if (mean <= 0) continue;
      rows.forEach((row) => ratios.push(row.actual / mean));
    }
    normalizedGroups.set(key, ratios.sort((a, b) => a - b));
    const raw = [...players.values()].flat().map((row) => row.actual);
    groupMeans.set(key, raw.length ? raw.reduce((sum, value) => sum + value, 0) / raw.length : 0);
  }
  const accumulators = new Map();
  for (const observations of gameObservations.values()) {
    const normalized = observations.map((row) => ({ ...row, value: row.actual / Math.max(0.1, groupMeans.get(`${row.position}:${row.stat}`) || 1) }));
    for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex], right = normalized[rightIndex];
      if (left.playerId === right.playerId) continue;
      const relation = left.team === right.team ? "same_team" : "opponents";
      const signatures = [`${left.position}:${left.stat}`, `${right.position}:${right.stat}`].sort();
      const key = `${relation}|${signatures.join("|")}`;
      const row = accumulators.get(key) || { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
      row.n += 1; row.sx += left.value; row.sy += right.value; row.sxx += left.value ** 2; row.syy += right.value ** 2; row.sxy += left.value * right.value;
      accumulators.set(key, row);
    }
  }
  const dependencies = {};
  for (const [key, row] of accumulators) {
    const denominator = Math.sqrt((row.n * row.sxx - row.sx ** 2) * (row.n * row.syy - row.sy ** 2));
    if (row.n < 40 || !denominator) continue;
    dependencies[key] = { correlation: round(clamp((row.n * row.sxy - row.sx * row.sy) / denominator, -0.55, 0.55)), sample: row.n };
  }
  return { playerSamples, normalizedGroups, dependencies };
}

function availabilityConcern(availability) {
  if (!availability) return "";
  const status = String(availability.status || availability.injury_status || "").toLowerCase();
  if (/out|inactive|suspend|reserve|pup|ir/.test(status)) return "unavailable";
  if (/doubtful/.test(status)) return "doubtful";
  if (/questionable|limited/.test(status)) return "questionable";
  return "";
}

function empiricalProbability({ playerValues, groupRatios, projection, line, direction, count }) {
  const playerMean = playerValues.length ? playerValues.reduce((sum, value) => sum + value, 0) / playerValues.length : 0;
  const playerRatios = playerMean > 0 ? playerValues.map((value) => value / playerMean) : [];
  const playerWeight = Math.min(0.62, playerRatios.length / 28);
  const samples = [];
  const add = (ratios, weight, source) => ratios.forEach((ratio) => {
    const actual = count ? Math.max(0, Math.round(projection * ratio)) : Math.max(0, projection * ratio);
    samples.push({ actual, weight: weight / Math.max(1, ratios.length), source });
  });
  add(playerRatios, playerWeight, "player");
  add(groupRatios, 1 - playerWeight, "position");
  let win = 0, push = 0, total = 0;
  for (const sample of samples) {
    total += sample.weight;
    if (sample.actual === line) push += sample.weight;
    else if ((direction === "over" && sample.actual > line) || (direction === "under" && sample.actual < line)) win += sample.weight;
  }
  const probability = total ? win / total : 0;
  const pushProbability = total ? push / total : 0;
  const conservative = clamp(probability - (playerRatios.length < 8 ? 0.04 : 0.015), 0.01, 0.99);
  return { probability: conservative, rawProbability: probability, pushProbability, playerSample: playerRatios.length, groupSample: groupRatios.length };
}

function offerRows(snapshot) {
  const rows = [];
  for (const event of snapshot.events || []) for (const bookmaker of event.bookmakers || []) for (const market of bookmaker.markets || []) {
    const baseMarket = String(market.key || "").replace(/_alternate$/, "");
    if (!PROP_MARKETS[baseMarket]) continue;
    for (const outcome of market.outcomes || []) rows.push({
      eventId: event.id,
      kickoff: event.commence_time,
      home: event.home_team,
      away: event.away_team,
      market: baseMarket,
      alternate: market.key !== baseMarket,
      player: outcome.description,
      providerPlayerId: outcome.player_id || outcome.provider_player_id || null,
      side: String(outcome.name || "").toLowerCase(),
      line: number(outcome.point),
      price: number(outcome.price),
      sportsbook: bookmaker.title,
      sportsbookKey: bookmaker.key,
      updatedAt: outcome.updated_at || bookmaker.last_update || snapshot.fetched_at,
      available: outcome.available !== false,
      deeplink: outcome.deeplink || event.links?.bookmakers?.[bookmaker.key] || null,
    });
  }
  return rows;
}

export function buildPropBoard({ root = process.cwd(), season = new Date().getUTCFullYear(), archive = true } = {}) {
  const snapshotFile = path.join(root, "public", "data", "odds", "nfl-props-snapshot.json");
  const snapshot = readJson(snapshotFile);
  if (!snapshot) throw new Error("Saved sportsbook snapshot is unavailable.");
  const model = fullModel(root, season);
  if (!model.players.length) throw new Error(`Full ${season} stat-model shards are unavailable.`);
  const historicalSeasons = [season - 3, season - 2, season - 1, season].filter((year) => fs.existsSync(path.join(root, "public", "stats", "history", String(year), "sleeper.json")));
  const history = historicalSamples(root, historicalSeasons);
  const playersByName = new Map();
  model.players.forEach((player) => {
    const key = normalizeName(player.name);
    if (!playersByName.has(key)) playersByName.set(key, []);
    playersByName.get(key).push(player);
  });
  const aliasDirectory = readJson(path.join(root, "data", "player-identity-aliases.json"), { aliases: [] });
  for (const aliasGroup of aliasDirectory.aliases || []) {
    const candidates = [...new Set((aliasGroup.names || []).flatMap((name) => playersByName.get(normalizeName(name)) || []))];
    if (candidates.length !== 1) continue;
    for (const name of aliasGroup.names || []) playersByName.set(normalizeName(name), candidates);
  }
  const predictions = [];
  const rejected = [];
  for (const offer of offerRows(snapshot)) {
    if (!offer.available || offer.line == null || offer.price == null || !["over", "under"].includes(offer.side)) continue;
    const matches = playersByName.get(normalizeName(offer.player)) || [];
    if (matches.length !== 1) {
      rejected.push({ player: offer.player, market: offer.market, reason: matches.length ? "ambiguous_identity" : "unmatched_identity" });
      continue;
    }
    const player = matches[0];
    const definition = PROP_MARKETS[offer.market];
    if (!definition.positions.includes(String(player.position).toUpperCase())) continue;
    const forecast = (player.weeks || []).find((week) => !week.bye && !week.completed && Math.abs(Date.parse(week.kickoff) - Date.parse(offer.kickoff)) < 6 * 60 * 60 * 1000);
    if (!forecast?.stat_line) continue;
    const projection = number(forecast.stat_line[definition.stat]);
    if (projection == null || projection <= 0) continue;
    const concern = availabilityConcern(forecast.availability);
    if (["unavailable", "doubtful"].includes(concern)) {
      rejected.push({ player: player.name, market: offer.market, reason: concern });
      continue;
    }
    const playerValues = history.playerSamples.get(`${player.player_id}:${definition.stat}`) || [];
    const groupRatios = history.normalizedGroups.get(`${player.position}:${definition.stat}`) || [];
    const estimate = empiricalProbability({ playerValues, groupRatios, projection, line: offer.line, direction: offer.side, count: definition.count });
    const evidence = clamp(
      0.45 * Math.min(1, estimate.playerSample / 20) +
      0.2 * Math.min(1, estimate.groupSample / 400) +
      0.25 * Number(player.confidence || 0) / 100 +
      0.1 * Number(player.volatility?.reliability || 0), 0, 1,
    );
    const gameKey = `${offer.eventId || `${offer.away}-${offer.home}-${offer.kickoff}`}`;
    const id = hash([snapshot.fetched_at, gameKey, player.player_id, definition.stat, offer.side, offer.line, offer.sportsbookKey].join("|"));
    if (estimate.probability < 0.5) continue;
    predictions.push({
      id, evaluationGroup: `${season}:${forecast.week}:${player.player_id}:${definition.stat}`,
      season, week: Number(forecast.week), gameKey, eventId: offer.eventId,
      kickoff: forecast.kickoff, capturedAt: snapshot.fetched_at, offerUpdatedAt: offer.updatedAt,
      modelGeneratedAt: model.generated_at, modelVersion: model.model_version, modelBuildId: model.model_build_id,
      playerId: String(player.player_id), providerPlayerId: offer.providerPlayerId, playerName: player.name,
      team: player.team, opponent: forecast.opponent, position: player.position,
      statKey: definition.stat, market: offer.market, statLabel: definition.label,
      direction: offer.side, line: offer.line, projection: round(projection, 2),
      probability: round(estimate.probability), rawProbability: round(estimate.rawProbability), pushProbability: round(estimate.pushProbability),
      highEstimatedChance: estimate.probability >= 0.85,
      evidenceScore: round(evidence), evidenceLabel: evidence >= 0.78 ? "Strong" : evidence >= 0.58 ? "Moderate" : "Provisional",
      historicalSample: estimate.playerSample, groupSample: estimate.groupSample,
      roleConcern: concern || (Number(player.depth_chart_order || 1) > 1 ? `Depth chart ${player.depth_chart_order}` : ""),
      confidence: Number(player.confidence || 0), volatility: player.volatility || null,
      opportunity: forecast.opportunity_projection || null, availability: forecast.availability || null,
      sportsbook: offer.sportsbook, sportsbookKey: offer.sportsbookKey, sportsbookOdds: offer.price,
      alternate: offer.alternate, deeplink: offer.deeplink,
    });
  }
  const uniquePredictions = [...new Map(predictions.map((prediction) => [prediction.id, prediction])).values()];
  const uniqueRejected = [...new Map(rejected.map((row) => [`${row.player}:${row.market}:${row.reason}`, row])).values()];
  const board = {
    schemaVersion: 2, season, generatedAt: new Date().toISOString(), capturedAt: snapshot.fetched_at,
    modelGeneratedAt: model.generated_at, modelVersion: model.model_version, modelBuildId: model.model_build_id,
    source: snapshot.provider, quota: snapshot.quota, historicalSeasons,
    dependencyModel: { source: "historical same-game normalized player-stat outcomes", pairs: history.dependencies },
    predictionCount: uniquePredictions.length, rejectedCount: uniqueRejected.length, predictions: uniquePredictions, rejected: uniqueRejected.slice(0, 200),
  };
  const destination = path.join(root, "public", "data", "odds", "nfl-prop-board.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(board)}\n`);
  if (archive) {
    const archiveDir = path.join(root, "public", "archive", "prop-lab", String(season));
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = String(snapshot.fetched_at || board.generatedAt).replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(archiveDir, `${stamp}.json.gz`), gzipSync(`${JSON.stringify(board)}\n`));
  }
  return board;
}
