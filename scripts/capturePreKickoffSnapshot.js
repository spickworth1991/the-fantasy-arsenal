import fs from "fs";
import path from "path";
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
for (const [script, args] of [
  ["buildStatProjectionModel.js", ["--archive", `--season=${season}`]],
  ["auditProjectionPipeline.js", [`--season=${season}`]],
  ["evaluateStatProjectionModel.js", [`--season=${season}`]],
]) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", script), ...args],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
