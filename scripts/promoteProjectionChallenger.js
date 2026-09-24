import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const challenger = String(
  process.argv.find((value) => value.startsWith("--challenger="))?.slice(13) || "current",
).replace(/[^a-z0-9_-]/gi, "");
if (!process.argv.includes("--confirm"))
  throw new Error("Promotion is review-gated. Re-run with --confirm after reviewing forward-report.json.");
const directory = path.join(root, "data", "model-challengers", challenger);
const publicReport = path.join(root, "public", "stats", "projections", "challengers", `${challenger}.json`);
const report = JSON.parse(
  fs.readFileSync(
    fs.existsSync(publicReport) ? publicReport : path.join(directory, "forward-report.json"),
    "utf8",
  ),
);
if (!report.eligible_for_review || report.recommendation !== "review_for_promotion")
  throw new Error("This challenger has not passed the four-week paired promotion gate.");
const candidate = path.join(directory, "calibration.json");
const candidatePayload = JSON.parse(fs.readFileSync(candidate, "utf8"));
if (
  !candidatePayload.definition_sha256 ||
  report.definition_sha256 !== candidatePayload.definition_sha256
)
  throw new Error("The reviewed report does not match the current challenger definition.");
const published = path.join(root, "public", "stats", "projections", "model-calibration.json");
const rollbackDirectory = path.join(root, "data", "model-calibration-rollbacks");
fs.mkdirSync(rollbackDirectory, { recursive: true });
if (fs.existsSync(published)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(published, path.join(rollbackDirectory, `${stamp}.json`));
}
fs.copyFileSync(candidate, published);
console.log(`Promoted '${challenger}'. The prior calibration was retained in data/model-calibration-rollbacks/. Run npm run update:stat-model to publish projections.`);
