import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const message = process.argv.slice(2).join(" ").trim() || "Local updates";

function git(args, { allowFailure = false, quiet = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
    env: { ...process.env, GIT_EDITOR: "true" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
}

function output(args) {
  return git(args, { allowFailure:true, quiet:true }).stdout?.trim() || "";
}

function rebaseInProgress() {
  const rebaseMerge = output(["rev-parse", "--git-path", "rebase-merge"]);
  const rebaseApply = output(["rev-parse", "--git-path", "rebase-apply"]);
  return Boolean((rebaseMerge && existsSync(rebaseMerge)) || (rebaseApply && existsSync(rebaseApply)));
}

function generatedDataFile(file) {
  const normalized = String(file || "").replaceAll("\\", "/");
  return (
    normalized.startsWith("public/archive/") ||
    /^public\/data\/ballsville-stats-\d{4}\.json$/i.test(normalized) ||
    /^public\/data\/player-stock-drafters-\d{4}\.json$/i.test(normalized) ||
    /^public\/(?:[^/]+_cache|source-freshness|value-cache-version)\.json$/i.test(normalized) ||
    /^public\/projections(?:_[^/]+)?\.json$/i.test(normalized) ||
    /^public\/stats\/(?:advanced|derived|history|projections)\//i.test(normalized)
  );
}

function readJsonStage(stage, file) {
  const staged = output(["show", `:${stage}:${file}`]);
  const fallbackRef = stage === 2 ? "HEAD" : "REBASE_HEAD";
  const raw = staged || output(["show", `${fallbackRef}:${file}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function freshnessTime(stage) {
  const freshness = readJsonStage(stage, "public/source-freshness.json");
  const version = readJsonStage(stage, "public/value-cache-version.json");
  const candidates = [
    freshness?.updated_at,
    freshness?.sources?.arsenal_proj?.last_success_at,
    version?.version,
  ]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : 0;
}

function resolveGeneratedConflicts() {
  let conflicts = output(["diff", "--name-only", "--diff-filter=U"])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  if (!conflicts.length) return true;

  const unsafe = conflicts.filter((file) => !generatedDataFile(file));
  if (unsafe.length) {
    console.error("\nAutomatic resolution stopped for source-code or configuration conflicts:");
    unsafe.forEach((file) => console.error(`  - ${file}`));
    return false;
  }

  const ballsvilleConflicts = conflicts.filter((file) =>
    /^public\/data\/ballsville-stats-\d{4}\.json$/i.test(file.replaceAll("\\", "/")),
  );
  for (const file of ballsvilleConflicts) {
    const upstream = readJsonStage(2, file);
    const local = readJsonStage(3, file);
    const upstreamTime = Date.parse(upstream?.generatedAt || "") || 0;
    const localTime = Date.parse(local?.generatedAt || "") || 0;
    const useLocal = localTime > upstreamTime;
    console.log(
      `Ballsville cache conflict: keeping ${useLocal ? "local" : "GitHub"} data ` +
        `(GitHub ${upstreamTime ? new Date(upstreamTime).toISOString() : "unknown"} · ` +
        `local ${localTime ? new Date(localTime).toISOString() : "unknown"}).`,
    );
    git(["checkout", useLocal ? "--theirs" : "--ours", "--", file]);
    git(["add", "--", file]);
  }
  conflicts = conflicts.filter((file) => !ballsvilleConflicts.includes(file));
  if (!conflicts.length) return true;

  const upstreamTime = freshnessTime(2);
  const localTime = freshnessTime(3);
  const useLocal = localTime > upstreamTime;
  const side = useLocal ? "--theirs" : "--ours";
  const chosen = useLocal ? "local generated data" : "GitHub workflow data";
  console.log(`All conflicts are generated data. Keeping ${chosen}.`);
  if (upstreamTime || localTime) {
    console.log(`Freshness: GitHub ${upstreamTime ? new Date(upstreamTime).toISOString() : "unknown"} · local ${localTime ? new Date(localTime).toISOString() : "unknown"}`);
  }
  git(["checkout", side, "--", ...conflicts]);
  git(["add", "--", ...conflicts]);
  return true;
}

function finishRebase() {
  for (let step = 0; step < 20; step += 1) {
    if (!resolveGeneratedConflicts()) return false;
    const unresolved = output(["diff", "--name-only", "--diff-filter=U"]);
    if (!unresolved) {
      const staged = git(["diff", "--cached", "--quiet"], {
        allowFailure: true,
        quiet: true,
      });
      if (staged.status === 0) {
        // Choosing the newer upstream generated file can make the rebased
        // local cache commit empty. In that case there is nothing to commit.
        const skipped = git(["rebase", "--skip"], { allowFailure: true });
        if (skipped.status === 0) return true;
        if (!rebaseInProgress()) return false;
        continue;
      }
    }
    const continued = git(["rebase", "--continue"], { allowFailure:true });
    if (continued.status === 0) return true;
    if (!rebaseInProgress()) return false;
  }
  console.error("Automatic rebase resolution stopped after 20 steps.");
  return false;
}

if (rebaseInProgress()) {
  console.log("A paused rebase was found. Checking whether it contains only generated-data conflicts...");
  if (!finishRebase()) {
    console.error("Resolve the remaining conflict manually, then run npm run sync again.");
    process.exit(1);
  }
}

const branch = git(["branch", "--show-current"], { quiet:true }).stdout.trim();
if (branch !== "main") {
  console.error(`npm run gil only syncs main. Current branch: ${branch || "detached HEAD"}`);
  process.exit(1);
}

console.log("Saving local work...");
git(["add", "-A"]);
const staged = git(["diff", "--cached", "--quiet"], { allowFailure:true, quiet:true });
if (staged.status === 1) {
  git(["commit", "-m", message]);
} else if (staged.status > 1) {
  process.exit(staged.status);
} else {
  console.log("No uncommitted local changes.");
}

for (let attempt = 1; attempt <= 3; attempt += 1) {
  console.log("Getting automated GitHub updates...");
  git(["fetch", "origin", "main"]);

  console.log("Replaying local commits on the latest main...");
  const rebase = git(["rebase", "origin/main"], { allowFailure:true });
  if (rebase.status !== 0) {
    if (!rebaseInProgress() || !finishRebase()) {
      console.error("\nSync stopped because Git found a conflict that is not safe to resolve automatically.");
      console.error("Resolve the marked source files, then run npm run sync again.");
      console.error("To safely cancel the rebase, run: git rebase --abort");
      process.exit(rebase.status || 1);
    }
  }

  console.log("Pushing the combined history...");
  const push = git(["push", "origin", "HEAD:main"], { allowFailure:true });
  if (push.status === 0) {
    console.log("Local and GitHub main are now synchronized.");
    process.exit(0);
  }
  if (attempt < 3) {
    console.warn(`Push changed while syncing; retrying (${attempt}/3)...`);
  }
}

console.error("GitHub changed repeatedly while syncing. Run npm run gil again.");
process.exit(1);
