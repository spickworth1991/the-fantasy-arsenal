import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "model-challengers", "position-model-lab-v1", "evaluation.json");
if (!fs.existsSync(file)) throw new Error("No Position Model Search evaluation exists. Run npm run model:position-search first.");
const report = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`Position search generated ${report.generated_at}`);
console.log(`Tested ${report.position_search?.candidates_tested || 0} candidates in ${report.position_search?.elapsed_seconds || 0}s.`);
for (const position of ["QB", "RB", "WR", "TE", "K"]) {
  const selection = report.position_selections?.[position];
  const search = report.position_search?.by_position?.[position];
  console.log(`${position}: ${selection?.model || "no qualified all-around winner"} | searched ${search?.tested || 0}, search finalists ${search?.finalists?.length || 0}`);
}
console.log(`Readable report: ${path.join(path.dirname(file), "report.md")}`);
