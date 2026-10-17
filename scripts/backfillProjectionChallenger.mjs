import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildProjectionShadowArms } from "./lib/projectionShadowArms.mjs";
import {
  canonicalFileSha256,
  frozenTextHashMatches,
} from "./lib/canonicalFileHash.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name, fallback = "") =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const season = Number(argument("season", new Date().getUTCFullYear()));
const challenger = String(argument("challenger", "team-volume-v1")).replace(/[^a-z0-9_-]/gi, "");
const weeks = [...new Set(
  argument("weeks")
    .split(",")
    .map(Number)
    .filter((week) => Number.isInteger(week) && week > 0 && week <= 18),
)].sort((left, right) => left - right);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, payload) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
};

if (!challenger || !weeks.length) {
  throw new Error("Provide a challenger and at least one week, for example --challenger=team-volume-v1 --weeks=4,5.");
}

const candidateDirectory = path.join(root, "data", "model-challengers", challenger);
const definitionFile = path.join(candidateDirectory, "definition.json");
const implementationFile = path.join(root, "scripts", "lib", "projectionShadowArms.mjs");
const calibrationFile = path.join(root, "public", "stats", "projections", "model-calibration.json");
const archiveDirectory = path.join(root, "public", "archive", "stat-projections", String(season));
const archiveIndexFile = path.join(archiveDirectory, "index.json");
const definition = readJson(definitionFile);
const archiveIndex = readJson(archiveIndexFile);

if (definition.model_type !== "projection_experiment_suite")
  throw new Error(`Unsupported challenger model type: ${definition.model_type || "missing"}.`);
if (!frozenTextHashMatches(calibrationFile, definition.base_calibration_sha256))
  throw new Error("The current calibration is not byte-equivalent to the challenger's frozen calibration.");
if (!frozenTextHashMatches(implementationFile, definition.implementation_sha256))
  throw new Error("The current shadow implementation is not byte-equivalent to the challenger's frozen implementation.");

const selected = (archiveIndex.snapshots || [])
  .filter((snapshot) => weeks.includes(Number(snapshot.week)))
  .sort((left, right) => Date.parse(left.generated_at) - Date.parse(right.generated_at));
if (!selected.length) throw new Error(`No immutable incumbent snapshots were found for Weeks ${weeks.join(", ")}.`);

let written = 0;
let skipped = 0;
for (const descriptor of selected) {
  const sourceName = descriptor.path || descriptor.file;
  const sourceFile = path.join(archiveDirectory, sourceName);
  const source = readJson(sourceFile);
  const generatedAt = Date.parse(source.generated_at);
  if (!Number.isFinite(generatedAt) || Number(source.week) !== Number(descriptor.week))
    throw new Error(`Invalid immutable snapshot metadata in ${sourceName}.`);

  const basePlayers = (source.players || [])
    .map((player) => ({
      player_id: player.player_id,
      name: player.name,
      team: player.team,
      position: player.position,
      depth_chart_order: player.depth_chart_order,
      forecast: player.forecast,
    }))
    .filter((player) => {
      const kickoff = Date.parse(player.forecast?.kickoff);
      return player.forecast && !player.forecast.bye && !player.forecast.completed &&
        Number.isFinite(kickoff) && generatedAt < kickoff;
    });
  const players = buildProjectionShadowArms(basePlayers, definition);
  const timestamp = source.generated_at.replace(/:/g, "-");
  const destination = path.join(
    candidateDirectory,
    "snapshots",
    String(season),
    `week-${source.week}`,
    `${timestamp}.json`,
  );
  if (fs.existsSync(destination)) {
    const existing = readJson(destination);
    if (
      existing.challenger_definition_sha256 !== definition.definition_sha256 ||
      existing.reconstruction?.source_snapshot_sha256 !== canonicalFileSha256(sourceFile)
    ) throw new Error(`Refusing to overwrite a different challenger snapshot: ${destination}`);
    skipped += 1;
    continue;
  }
  writeJson(destination, {
    challenger,
    challenger_definition_sha256: definition.definition_sha256,
    site_exposed: false,
    season,
    week: Number(source.week),
    generated_at: source.generated_at,
    data_cutoff_at: source.data_cutoff_at || source.generated_at,
    model_version: source.model_version,
    model_build_id: source.model_build_id,
    feature_version: source.feature_version,
    calibration_identity: source.calibration_identity,
    input_manifest: source.input_manifest,
    snapshot_origin: "reconstructed_from_immutable_incumbent_snapshot",
    reconstruction: {
      reconstructed_at: new Date().toISOString(),
      source_snapshot_id: source.snapshot_id || descriptor.snapshot_id || null,
      source_snapshot_path: `public/archive/stat-projections/${season}/${sourceName}`,
      source_snapshot_sha256: canonicalFileSha256(sourceFile),
      source_generated_at: source.generated_at,
      definition_sha256: definition.definition_sha256,
      implementation_sha256: canonicalFileSha256(implementationFile),
      future_information_used: false,
    },
    players,
  });
  written += 1;
  console.log(`Reconstructed ${challenger} Week ${source.week} at ${source.generated_at} (${players.length} eligible players).`);
}

console.log(`Backfill complete: ${written} written, ${skipped} already present, ${selected.length} immutable source snapshots checked.`);
