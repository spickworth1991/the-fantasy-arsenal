import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season =
  Number(
    process.argv
      .find((argument) => argument.startsWith("--season="))
      ?.split("=")[1],
  ) || new Date().getUTCFullYear();
const windowHours = Math.max(
  0.5,
  Number(
    process.argv
      .find((argument) => argument.startsWith("--window-hours="))
      ?.split("=")[1] || 3,
  ),
);
const refreshInputs = process.argv.includes("--refresh-inputs");
const challengerRoot = path.join(root, "data", "model-challengers");
const shadowCandidates = fs.existsSync(challengerRoot)
  ? fs
      .readdirSync(challengerRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name.replace(/[^a-z0-9_-]/gi, ""),
        definition: path.join(challengerRoot, entry.name, "definition.json"),
      }))
      .filter((entry) => entry.name && fs.existsSync(entry.definition))
  : [];
const scheduleFile = path.join(
  root,
  "public",
  "stats",
  "projections",
  String(season),
  "schedule.json",
);
const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const schedule = readJson(scheduleFile);
if (!schedule?.weeks?.length) {
  console.log(`No saved ${season} NFL schedule; pre-kickoff capture skipped.`);
  process.exit(0);
}
const now = Date.now();
const cutoff = now + windowHours * 3600000;
const upcoming = schedule.weeks
  .flatMap((entry) =>
    (entry.games || []).map((game) => ({
      week: Number(entry.week),
      kickoff: Date.parse(game.date),
      home: game.home,
      away: game.away,
    })),
  )
  .filter(
    (game) =>
      Number.isFinite(game.kickoff) &&
      game.kickoff > now &&
      game.kickoff <= cutoff,
  )
  .sort((left, right) => left.kickoff - right.kickoff);
if (!upcoming.length) {
  console.log(
    `No ${season} NFL kickoff occurs in the next ${windowHours} hours; snapshot skipped without changing files.`,
  );
  process.exit(0);
}
const earliest = upcoming[0].kickoff;
const batch = upcoming.filter(
  (game) => Math.abs(game.kickoff - earliest) <= 20 * 60 * 1000,
);
console.log(
  `Capturing Week ${upcoming[0].week} final-window projections for ${batch.length} game${batch.length === 1 ? "" : "s"} kicking off near ${new Date(earliest).toISOString()}.`,
);
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const calibrationFile = path.join(root, "public", "stats", "projections", "model-calibration.json");
const shadowImplementationFile = path.join(root, "scripts", "lib", "projectionShadowArms.mjs");
const eligibleShadowCandidates = shadowCandidates.filter((candidate) => {
  const definition = readJson(candidate.definition);
  if (!definition) {
    console.warn(`Skipping shadow '${candidate.name}': its frozen definition is unreadable. The incumbent capture will continue.`);
    return false;
  }
  if (definition.base_calibration_sha256 && (!fs.existsSync(calibrationFile) || sha256(calibrationFile) !== definition.base_calibration_sha256)) {
    console.warn(`Skipping shadow '${candidate.name}': its frozen base calibration no longer matches the published calibration. Freeze and audit a new challenger definition before resuming this arm.`);
    return false;
  }
  if (definition.implementation_sha256 && (!fs.existsSync(shadowImplementationFile) || sha256(shadowImplementationFile) !== definition.implementation_sha256)) {
    console.warn(`Skipping shadow '${candidate.name}': its implementation changed after the definition was frozen. Freeze and audit a new definition before resuming this arm.`);
    return false;
  }
  return true;
});
const incumbentSteps = [
  ...(refreshInputs
    ? [
        ["updateHistoricalStats.js", ["--sleeper-only", `--season=${season}`]],
        ["updateValues.js", ["--only=sleeper_proj,cbs_proj,projection_anchor", "--defer-archive"]],
      ]
    : []),
  ["buildStatProjectionModel.js", ["--archive", `--season=${season}`]],
  ["auditProjectionPipeline.js", [`--season=${season}`]],
  ["evaluateStatProjectionModel.js", [`--season=${season}`]],
];
const runStep = (script, args) => spawnSync(
  process.execPath,
  [path.join(root, "scripts", script), ...args],
  { cwd: root, stdio: "inherit" },
);
for (const [script, args] of incumbentSteps) {
  const result = runStep(script, args);
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const candidate of eligibleShadowCandidates) {
  const captureResult = runStep("buildStatProjectionModel.js", [
    `--challenger=${candidate.name}`,
    `--shadow-definition=${path.relative(root, candidate.definition)}`,
    `--season=${season}`,
  ]);
  if (captureResult.status !== 0) {
    console.warn(`Shadow '${candidate.name}' failed to capture and was omitted; the valid incumbent snapshot is preserved.`);
    continue;
  }
  const evaluationResult = runStep("evaluateProjectionChallenger.js", [`--challenger=${candidate.name}`, `--season=${season}`]);
  if (evaluationResult.status !== 0)
    console.warn(`Shadow '${candidate.name}' was captured, but its report failed to refresh. The frozen snapshot remains available for a later evaluation.`);
}
if (shadowCandidates.length && !eligibleShadowCandidates.length)
  console.warn("No frozen shadow definition matched the current model inputs. Incumbent pre-kickoff capture completed without shadow data.");
