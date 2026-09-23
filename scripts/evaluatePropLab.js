import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const root = process.cwd();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const readArchive = (file) => { try { const data = fs.readFileSync(file); return JSON.parse(file.endsWith(".gz") ? gunzipSync(data).toString("utf8") : data.toString("utf8")); } catch { return null; } };
const round = (value, places = 4) => Number(Number(value || 0).toFixed(places));
const archiveRoot = path.join(root, "public", "archive", "prop-lab");
const latestByOffer = new Map();

if (fs.existsSync(archiveRoot)) for (const seasonName of fs.readdirSync(archiveRoot)) {
  const directory = path.join(archiveRoot, seasonName);
  if (!fs.statSync(directory).isDirectory()) continue;
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json") || name.endsWith(".json.gz"))) {
    const board = readArchive(path.join(directory, file));
    for (const prediction of board?.predictions || []) {
      if (Date.parse(prediction.capturedAt) >= Date.parse(prediction.kickoff)) continue;
      const key = `${prediction.season}:${prediction.week}:${prediction.playerId}:${prediction.statKey}:${prediction.direction}:${prediction.line}`;
      const prior = latestByOffer.get(key);
      if (!prior || Date.parse(prediction.capturedAt) > Date.parse(prior.capturedAt)) latestByOffer.set(key, prediction);
    }
  }
}

const historyBySeason = new Map();
const resultRows = [];
for (const prediction of latestByOffer.values()) {
  if (!historyBySeason.has(prediction.season)) {
    const data = readJson(path.join(root, "public", "stats", "history", String(prediction.season), "sleeper.json"));
    historyBySeason.set(prediction.season, new Map((data?.players || []).map((player) => [String(player.player_id), player])));
  }
  const player = historyBySeason.get(prediction.season).get(String(prediction.playerId));
  const stats = player?.weekly_stats?.[String(prediction.week)];
  const actual = number(stats?.[prediction.statKey]);
  let result = "pending";
  if (stats && Number(stats.gp ?? stats.gms_active ?? 0) <= 0) result = "void";
  else if (actual != null) result = actual === Number(prediction.line) ? "push" :
    prediction.direction === "over" ? (actual > Number(prediction.line) ? "won" : "lost") :
      (actual < Number(prediction.line) ? "won" : "lost");
  resultRows.push({ ...prediction, actual, result });
}

function summarize(rows) {
  const settled = rows.filter((row) => ["won", "lost"].includes(row.result));
  const weighted = new Map();
  settled.forEach((row) => {
    const key = row.evaluationGroup;
    if (!weighted.has(key)) weighted.set(key, []);
    weighted.get(key).push(row);
  });
  let wins = 0, weight = 0, predicted = 0, market = 0;
  for (const group of weighted.values()) for (const row of group) {
    const rowWeight = 1 / group.length;
    weight += rowWeight;
    wins += rowWeight * (row.result === "won" ? 1 : 0);
    predicted += rowWeight * Number(row.probability || 0);
    const odds = Number(row.sportsbookOdds || 0);
    market += rowWeight * (odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100));
  }
  return {
    observations: rows.length, settled: settled.length, groups: weighted.size,
    hitRate: weight ? round(wins / weight) : null,
    averagePredicted: weight ? round(predicted / weight) : null,
    averageMarketImplied: weight ? round(market / weight) : null,
    calibrationError: weight ? round(Math.abs(wins / weight - predicted / weight)) : null,
  };
}

const settled = resultRows.filter((row) => ["won", "lost"].includes(row.result));
const bandKey = (probability) => {
  const low = Math.floor(Number(probability || 0) * 20) * 5;
  return `${low}-${Math.min(100, low + 5)}%`;
};
const grouped = (keyOf) => Object.fromEntries([...new Set(settled.map(keyOf))].sort().map((key) => [key, summarize(settled.filter((row) => keyOf(row) === key))]));
const output = {
  generatedAt: new Date().toISOString(), methodology: "Latest frozen pre-kickoff prediction per exact offer. Alternate lines share one player-game-market evaluation group and receive equal group weight.",
  overall: summarize(resultRows),
  probabilityBands: grouped((row) => bandKey(row.probability)),
  markets: grouped((row) => row.market),
  evidence: grouped((row) => row.evidenceLabel),
  highEstimatedChance: summarize(resultRows.filter((row) => row.highEstimatedChance)),
  pending: resultRows.filter((row) => row.result === "pending").length,
  pushes: resultRows.filter((row) => row.result === "push").length,
  voids: resultRows.filter((row) => row.result === "void").length,
};
const destination = path.join(root, "public", "data", "odds", "prop-lab-accuracy.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Evaluated ${resultRows.length} frozen Prop Lab offers: ${output.overall.settled} settled across ${output.overall.groups} independent player-market groups.`);
