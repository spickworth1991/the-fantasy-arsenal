import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const challengerRoot = path.join(root, "data", "model-challengers");
const seasonArgument = process.argv.find((value) => value.startsWith("--season="));
const challengers = fs.existsSync(challengerRoot)
  ? fs.readdirSync(challengerRoot, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const definitionFile = path.join(challengerRoot, entry.name, "definition.json");
      if (!fs.existsSync(definitionFile)) return [];
      try {
        const definition = JSON.parse(fs.readFileSync(definitionFile, "utf8"));
        return definition.local_only === true ? [] : [entry.name];
      } catch {
        console.warn(`Skipping '${entry.name}': definition.json is unreadable.`);
        return [];
      }
    })
  : [];

if (!challengers.length) {
  console.log("No active projection challengers require evaluation.");
  process.exit(0);
}

let failed = false;
for (const challenger of challengers) {
  const args = ["--no-warnings", path.join(root, "scripts", "evaluateProjectionChallenger.js"), `--challenger=${challenger}`];
  if (seasonArgument) args.push(seasonArgument);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);

