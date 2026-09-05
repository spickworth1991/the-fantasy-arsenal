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

for (const player of Array.isArray(source?.players) ? source.players : []) {
  const managers = new Map();
  for (const rows of Object.values(player?.draftersByMode || {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = String(row?.key || row?.username || row?.name || "").trim();
      if (!key) continue;
      const current = managers.get(key) || { name:String(row?.name || row?.username || "Unknown manager").trim(), count:0 };
      current.count += Number(row?.count || 0);
      managers.set(key, current);
    }
  }
  const top = [...managers.values()].filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5);
  if (!top.length) continue;
  const id = String(player?.playerId || "").trim();
  if (id) players[id] = top;
}

const output = { schemaVersion:1, season, generatedAt:source?.generatedAt || new Date().toISOString(), players };
fs.writeFileSync(outputFile, JSON.stringify(output));
console.log(`Wrote ${path.relative(root, outputFile)} (${Object.keys(players).length} players, ${fs.statSync(outputFile).size.toLocaleString()} bytes).`);
