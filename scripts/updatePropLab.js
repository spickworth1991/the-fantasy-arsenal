import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const fetchResult = spawnSync(process.execPath, ["--no-warnings", "./scripts/fetchSportsGameOddsSnapshot.js", ...args], { cwd: process.cwd(), stdio: "inherit" });
if (fetchResult.status === 3) process.exit(0);
if (fetchResult.status !== 0 || args.includes("--dry-run")) process.exit(fetchResult.status || 0);
const buildResult = spawnSync(process.execPath, ["--no-warnings", "./scripts/buildPropBoard.js"], { cwd: process.cwd(), stdio: "inherit" });
if (buildResult.status !== 0) process.exit(buildResult.status || 1);
console.log("Prop Lab data is updated locally. Commit and deploy the generated odds files to update the live site.");
