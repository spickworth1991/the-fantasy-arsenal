import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season = Number(process.argv.find((arg) => /^--season=/.test(arg))?.split("=")[1] || new Date().getFullYear());
const inputFile = path.join(root, "public", "data", `ballsville-stats-${season}.json`);
const outputFile = path.join(root, "public", "data", `player-stock-drafters-${season}.json`);

if (!fs.existsSync(inputFile)) throw new Error(`Missing ${path.relative(root, inputFile)}. Run update:ballsville-stats first.`);

const source = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const players = {};
const adpPlayers = {};

// Ballsville draft feeds can contain a second, rookie-only draft for the same
// league. Manager exposure is current roster ownership across unique leagues,
// not the number of draft feeds in which a veteran happened to be selected.
const uniqueTeams = new Map();
for (const team of Array.isArray(source?.teams) ? source.teams : []) {
  const key = String(team?.key || `${team?.leagueId || ""}:${team?.rosterId || ""}`).trim();
  if (key && !uniqueTeams.has(key)) uniqueTeams.set(key, team);
}
const rosterManagersByPlayer = new Map();
for (const team of uniqueTeams.values()) {
  const managerKey = String(team?.owner?.key || team?.owner?.username || team?.owner?.name || "").trim();
  if (!managerKey) continue;
  for (const playerId of Array.isArray(team?.playerIds) ? team.playerIds : []) {
    const id = String(playerId || "").trim();
    if (!id) continue;
    if (!rosterManagersByPlayer.has(id)) rosterManagersByPlayer.set(id, new Map());
    const managers = rosterManagersByPlayer.get(id);
    const current = managers.get(managerKey) || {
      key:managerKey,
      name:String(team?.owner?.name || team?.owner?.username || "Unknown manager").trim(),
      count:0,
      leagueIds:new Set(),
    };
    const leagueId = String(team?.leagueId || "").trim();
    if (leagueId && !current.leagueIds.has(leagueId)) {
      current.leagueIds.add(leagueId);
      current.count += 1;
    }
    managers.set(managerKey, current);
  }
}

for (const player of Array.isArray(source?.players) ? source.players : []) {
  const id = String(player?.playerId || "").trim();
  if (!id) continue;
  const managers = rosterManagersByPlayer.get(id) || new Map();
  const totalLeagues = [...managers.values()].reduce((sum, manager) => sum + Number(manager.count || 0), 0);
  const exposure = [...managers.values()]
    .filter((row) => row.count > 0)
    .map((row) => ({ name:row.name, count:row.count, totalLeagues, percentage:Number(((row.count / Math.max(1, totalLeagues)) * 100).toFixed(1)) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (id) players[id] = exposure;
  adpPlayers[id] = {
    name:String(player?.name || "").trim(),
    position:String(player?.position || "").trim(),
    modes:Object.fromEntries(Object.entries(player?.modeDetails || {}).map(([slug, detail]) => [slug, {
      drafts:Number(detail?.drafts || 0),
      avgOverallPick:Number(detail?.adp || 0),
    }])),
  };
}

const output = {
  schemaVersion:3,
  season,
  generatedAt:source?.generatedAt || new Date().toISOString(),
  percentageBasis:"Manager roster ownership divided by unique Ballsville leagues rostering the player",
  totalBallsvilleLeagues:Number(source?.summary?.totalLeagues || 0),
  players,
  adpModes:Array.isArray(source?.modes) ? source.modes : [],
  adpPlayers,
};
fs.writeFileSync(outputFile, JSON.stringify(output));
console.log(`Wrote ${path.relative(root, outputFile)} (${Object.keys(players).length} players, ${fs.statSync(outputFile).size.toLocaleString()} bytes).`);
