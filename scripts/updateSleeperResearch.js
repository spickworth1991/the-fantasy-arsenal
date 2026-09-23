import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(
  __dirname,
  "..",
  "public",
  "data",
  "sleeper-roster-percentages.json",
);

const getJson = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "the-fantasy-arsenal-daily-update" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
};

const state = await getJson("https://api.sleeper.app/v1/state/nfl");
const season = String(state?.season || new Date().getUTCFullYear());
const rawSeasonType = String(state?.season_type || "regular").toLowerCase();
const seasonType = ["pre", "regular", "post", "off"].includes(rawSeasonType)
  ? rawSeasonType
  : "regular";
const week = Math.max(1, Number(state?.week || state?.leg || 1));
const weekSuffix = seasonType === "off" ? "" : `/${week}`;
const sourceUrl = `https://api.sleeper.com/players/nfl/research/${seasonType}/${season}${weekSuffix}`;
const research = await getJson(sourceUrl);

const players = {};
for (const [playerId, row] of Object.entries(research || {})) {
  const rostered = Number(row?.owned);
  const started = Number(row?.started);
  if (!Number.isFinite(rostered)) continue;
  players[String(playerId)] = {
    rostered,
    ...(Number.isFinite(started) ? { started } : {}),
  };
}

if (Object.keys(players).length < 100) {
  throw new Error(
    `Sleeper research returned only ${Object.keys(players).length} usable players; refusing to replace the published snapshot.`,
  );
}

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "Sleeper player research",
  season,
  seasonType,
  week: seasonType === "off" ? null : week,
  players,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
await fs.rename(temporaryPath, outputPath);

console.log(
  `Saved Sleeper roster percentages for ${Object.keys(players).length} players (${seasonType} ${season}${seasonType === "off" ? "" : ` Week ${week}`}).`,
);
