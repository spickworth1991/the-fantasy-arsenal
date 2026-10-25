import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "scripts", "_stat_backtests", "replays", "manual-stat-tune", "forward-verification.json");
if (!fs.existsSync(file)) throw new Error("Run npm run tune:verify before this test.");
const report = JSON.parse(fs.readFileSync(file, "utf8"));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.0006;
const rows = report.records || [];
check(report.local_only === true, "verification report must remain local-only");
check(rows.length === report.overall?.sample, "verification sample mismatch");
check(rows.every((row) => row.snapshot_id && row.snapshot_generated_at), "a verification row is not tied to an immutable snapshot");
check(rows.every((row) => ["prospective", "retrospective"].includes(row.evidence_class)), "invalid evidence class");
check(close(mean(rows.map((row) => Math.abs(row.safe - row.actual))), report.overall?.safe_mae), "Safe MAE mismatch");
check(close(mean(rows.map((row) => Math.abs(row.tuned - row.actual))), report.overall?.tuned_mae), "tuned MAE mismatch");
if (!report.locked_candidate)
  check(report.prospective?.sample === 0, "unlocked settings cannot claim prospective evidence");
if (failures.length) {
  console.error("Manual tuner verification tests: FAIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Manual tuner verification tests: PASS (${rows.length} exact frozen player-games).`);
