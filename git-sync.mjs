import { spawnSync } from "node:child_process";

const message = process.argv.slice(2).join(" ").trim() || "Local updates";

function git(args, { allowFailure = false, quiet = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
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
    console.error("\nSync stopped because Git found a real conflict.");
    console.error("Resolve the marked files, then run: git rebase --continue");
    console.error("To safely cancel the rebase, run: git rebase --abort");
    process.exit(rebase.status || 1);
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
