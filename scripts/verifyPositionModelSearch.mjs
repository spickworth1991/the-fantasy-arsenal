import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "data", "model-challengers", "position-model-lab-v1");
const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const report = read("evaluation.json"), definition = read("definition.json"), models = read("models.json");
const ledger = read("search-ledger.json");
const failures = [];
if (!report.position_search?.enabled) failures.push("the saved evaluation did not run the position search");
if (!(report.position_search?.candidates_tested > 0)) failures.push("no search candidates were tested");
const ledgerCount = Object.values(ledger.by_position || {}).reduce((sum, rows) => sum + rows.length, 0);
if (ledgerCount !== report.position_search.candidates_tested) failures.push(`search ledger contains ${ledgerCount} candidates but the report contains ${report.position_search.candidates_tested}`);
if (definition.site_exposed !== false || definition.capture_enabled !== false) failures.push("the lab is not private");
if (definition.model_bundle_sha256 !== models.sha256) failures.push("the definition and model bundle hashes disagree");
for (const position of ["QB", "RB", "WR", "TE", "K"]) {
  const positionReport = report.position_search?.by_position?.[position];
  if (!positionReport || !(positionReport.tested > 0)) failures.push(`${position} has no tested candidates`);
  for (const finalist of positionReport?.finalists || []) for (const scope of ["discovery", "selection", "exact"])
    if (!["maeImprovement", "rmseImprovement", "biasImprovement"].every((key) => Number.isFinite(finalist[scope]?.[key]))) failures.push(`${position}/${finalist.id} has incomplete ${scope} metrics`);
}
if (failures.length) throw new Error(`Position Model Search verification failed:\n- ${failures.join("\n- ")}`);
console.log("Position Model Search verification: PASS");
