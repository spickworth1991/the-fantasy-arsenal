import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season =
  Number(
    process.argv
      .find((argument) => argument.startsWith("--season="))
      ?.split("=")[1],
  ) || new Date().getUTCFullYear();
const projectionRoot = path.join(
  root,
  "public",
  "stats",
  "projections",
  String(season),
);
const archiveRoot = path.join(
  root,
  "public",
  "archive",
  "stat-projections",
  String(season),
);
const currentFile = path.join(projectionRoot, "current.json");
const identityFile = path.join(projectionRoot, "identities.json");
const auditFile = path.join(projectionRoot, "audit.json");
const archiveIndexFile = path.join(archiveRoot, "index.json");
const calibrationFile = path.join(
  root,
  "public",
  "stats",
  "projections",
  "model-calibration.json",
);
const positions = new Set(["QB", "RB", "WR", "TE", "K"]);
const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const normalizeTeam = (value) => {
  const team = String(value || "").toUpperCase();
  return (
    { JAX: "JAC", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" }[team] ||
    team
  );
};
const namePositionKey = (row) =>
  `${normalizeName(row?.name)}|${String(row?.position || "").toUpperCase()}`;
const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const fingerprint = (file) => {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  return crypto.createHash("sha256").update(raw).digest("hex");
};
const relative = (file) => path.relative(root, file).replace(/\\/g, "/");
const current = readJson(currentFile);
if (
  current &&
  !current.players?.length &&
  Array.isArray(current.player_shards)
) {
  current.players = current.player_shards.flatMap((shard) => {
    const shardPath = String(shard?.path || "").replace(/^\/+/, "");
    const payload = readJson(path.join(root, "public", shardPath), {
      players: [],
    });
    return Array.isArray(payload?.players) ? payload.players : [];
  });
}
if (!current?.players?.length)
  throw new Error(
    `Missing ${relative(currentFile)}. Build the stat model before auditing it.`,
  );
const calibration = readJson(calibrationFile, { by_position: {} });

  const sourceSpecs = [
    {
      key: "projection_anchor",
      name: "Projection Source Average Anchor",
      file: `stats/projections/${season}/consensus-anchor.json`,
    },
  {
    key: "fantasypros",
    name: "FantasyPros",
    file: `projections_fantasypros_${season}.json`,
    statInput: true,
  },
  {
    key: "draftsharks",
    name: "DraftSharks",
    file: `projections_draftsharks_${season}.json`,
    statInput: true,
  },
  {
    key: "fantasysharks",
    name: "FantasySharks",
    file: `projections_fantasysharks_${season}.json`,
    statInput: true,
  },
  {
    key: "sleeper",
    name: "Sleeper",
    file: `projections_sleeper_${season}.json`,
  },
  { key: "espn", name: "ESPN", file: `projections_espn_${season}.json` },
  { key: "cbs", name: "CBS", file: `projections_cbs_${season}.json` },
  {
    key: "ffa",
    name: "Fantasy Football Analytics",
    file: `projections_${season}.json`,
  },
];

const canonical = current.players.map((player) => {
  const sleeperId = String(player.player_id || "").trim();
  const fallback = namePositionKey(player);
  return {
    canonical_id: sleeperId ? `sleeper:${sleeperId}` : `name:${fallback}`,
    sleeper_id: sleeperId || null,
    name: player.name,
    normalized_name: normalizeName(player.name),
    position: String(player.position || "").toUpperCase(),
    team: normalizeTeam(player.team),
    aliases: [],
  };
});
const scheduledTeams = new Set(canonical.map((player) => player.team).filter(Boolean));
const byCanonicalId = new Map(
  canonical.map((player) => [player.canonical_id, player]),
);
const bySleeperId = new Map(
  canonical
    .filter((player) => player.sleeper_id)
    .map((player) => [player.sleeper_id, player]),
);
const byNamePosition = new Map();
for (const player of canonical) {
  const nameKey = `${player.normalized_name}|${player.position}`;
  const nameCandidates = byNamePosition.get(nameKey) || [];
  nameCandidates.push(player);
  byNamePosition.set(nameKey, nameCandidates);
}
const reviewedAliases = new Map();
const aliasConfig = readJson(
  path.join(root, "data", "player-identity-aliases.json"),
  { aliases: [] },
);
for (const group of aliasConfig.aliases || []) {
  const position = String(group.position || "").toUpperCase();
  const keys = (group.names || []).map(
    (name) => `${normalizeName(name)}|${position}`,
  );
  const canonicalKey = keys.find((key) => byNamePosition.has(key));
  if (!canonicalKey) continue;
  keys.forEach((key) => reviewedAliases.set(key, canonicalKey));
}

const sourceReports = [];
const canonicalSets = new Map();
const unmatchedAliases = [];
const ambiguousAliases = [];
for (const source of sourceSpecs) {
  const file = path.join(root, "public", source.file);
  const payload = readJson(file, { rows: [] });
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const matchedCanonicalIds = new Set();
  const methodCounts = { sleeper_id: 0, name_position: 0, reviewed_alias: 0 };
  const sourceCanonicalCounts = new Map();
  for (const row of rows) {
    const position = String(row?.position || "").toUpperCase();
    if (!positions.has(position) || !normalizeName(row?.name)) continue;
    const sleeperId = String(row?.player_id || "").trim();
    let candidates = sleeperId && bySleeperId.has(sleeperId)
      ? [bySleeperId.get(sleeperId)]
      : byNamePosition.get(namePositionKey(row)) || [];
    let method = sleeperId && bySleeperId.has(sleeperId)
      ? "sleeper_id"
      : "name_position";
    if (!candidates.length) {
      const reviewed = reviewedAliases.get(namePositionKey(row));
      candidates = reviewed ? byNamePosition.get(reviewed) || [] : [];
      method = "reviewed_alias";
    }
    if (candidates.length !== 1) {
      const record = {
        source: source.key,
        name: row.name,
        team: normalizeTeam(row.team),
        position,
        source_player_id: row.source_player_id || row.player_id || null,
        projected_points: Number(
          row.points_ppr ??
            row.points ??
            row.projections?.ppr ??
            row.projections?.points_ppr ??
            0,
        ),
        candidates: candidates.map((candidate) => candidate.canonical_id),
      };
      (candidates.length ? ambiguousAliases : unmatchedAliases).push(record);
      continue;
    }
    const player = candidates[0];
    matchedCanonicalIds.add(player.canonical_id);
    methodCounts[method] += 1;
    sourceCanonicalCounts.set(
      player.canonical_id,
      (sourceCanonicalCounts.get(player.canonical_id) || 0) + 1,
    );
    player.aliases.push({
      source: source.key,
      name: row.name,
      team: normalizeTeam(row.team),
      position,
      source_player_id: row.source_player_id || null,
      match_method: method,
    });
  }
  const duplicateCanonicalRows = [...sourceCanonicalCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([canonicalId, count]) => ({ canonical_id: canonicalId, count }));
  canonicalSets.set(source.key, matchedCanonicalIds);
  sourceReports.push({
    key: source.key,
    name: source.name,
    file: relative(file),
    exists: fs.existsSync(file),
    updated: payload?.updated || payload?.generated_at || null,
    rows: rows.length,
    matched_players: matchedCanonicalIds.size,
    model_player_coverage: Number(
      (matchedCanonicalIds.size / Math.max(1, canonical.length)).toFixed(4),
    ),
    match_methods: methodCounts,
    duplicate_canonical_rows: duplicateCanonicalRows,
    stat_model_input: Boolean(source.statInput),
  });
}

const intersection = (keys) => {
  const sets = keys.map((key) => canonicalSets.get(key) || new Set());
  if (!sets.length) return [];
  return [...sets[0]].filter((id) => sets.every((set) => set.has(id))).sort();
};
const commonPopulations = {
  stat_line_sources: {
    sources: ["fantasypros", "draftsharks", "fantasysharks"],
    canonical_ids: intersection([
      "fantasypros",
      "draftsharks",
      "fantasysharks",
    ]),
  },
  major_projection_sources: {
    sources: ["fantasypros", "sleeper", "espn", "cbs"],
    canonical_ids: intersection(["fantasypros", "sleeper", "espn", "cbs"]),
  },
  all_available_sources: {
    sources: sourceSpecs.map((source) => source.key),
    canonical_ids: intersection(sourceSpecs.map((source) => source.key)),
  },
};
for (const population of Object.values(commonPopulations))
  population.players = population.canonical_ids.length;

const sleeperIdDuplicates = [...bySleeperId.entries()]
  .filter(([, player]) => !player)
  .map(([id]) => id);
const canonicalIdCounts = new Map();
for (const player of canonical)
  canonicalIdCounts.set(
    player.canonical_id,
    (canonicalIdCounts.get(player.canonical_id) || 0) + 1,
  );
const duplicateCanonicalIds = [...canonicalIdCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([canonical_id, count]) => ({ canonical_id, count }));
const actionableUnmatchedAliases = unmatchedAliases.filter(
  (row) =>
    scheduledTeams.has(row.team) &&
    Number.isFinite(row.projected_points) &&
    row.projected_points >= 50,
);
const duplicateSourceMappings = sourceReports.flatMap((source) =>
  source.duplicate_canonical_rows.map((row) => ({
    source: source.key,
    ...row,
  })),
);

const archiveFiles = fs.existsSync(archiveRoot)
  ? fs
      .readdirSync(archiveRoot)
      .filter((file) => file.endsWith(".json") && file !== "index.json")
      .sort()
  : [];
const snapshots = archiveFiles
  .map((file) => ({ file, snapshot: readJson(path.join(archiveRoot, file)) }))
  .filter(({ snapshot }) => snapshot?.generated_at && snapshot?.week);
const snapshotIdCounts = new Map();
const snapshotRows = snapshots.map(({ file, snapshot }) => {
  const generated = Date.parse(snapshot.generated_at);
  const postKickoffPlayers = (snapshot.players || []).filter((player) => {
    const kickoff = Date.parse(player?.forecast?.kickoff);
    return !Number.isFinite(kickoff) || !Number.isFinite(generated) || generated >= kickoff;
  });
  if (snapshot.snapshot_id)
    snapshotIdCounts.set(
      snapshot.snapshot_id,
      (snapshotIdCounts.get(snapshot.snapshot_id) || 0) + 1,
    );
  return {
    file,
    snapshot_id: snapshot.snapshot_id || null,
    generated_at: snapshot.generated_at,
    season: Number(snapshot.season),
    week: Number(snapshot.week),
    snapshot_class: snapshot.snapshot_class || "legacy_unclassified",
    model_version: snapshot.model_version || null,
    model_build_id: snapshot.model_build_id || null,
    feature_version: snapshot.feature_version || null,
    input_bundle_sha256: snapshot.input_manifest?.bundle_sha256 || null,
    players: snapshot.players?.length || 0,
    post_kickoff_or_missing_kickoff_players: postKickoffPlayers.length,
    legacy: !snapshot.snapshot_id || !snapshot.input_manifest,
    sha256: fingerprint(path.join(archiveRoot, file)),
  };
});
const newestSnapshotEntry = snapshots
  .slice()
  .sort(
    (left, right) =>
      Date.parse(right.snapshot.generated_at) -
      Date.parse(left.snapshot.generated_at),
  )[0];
const newestSnapshot = newestSnapshotEntry?.snapshot || null;
const previousReleaseSnapshot = snapshots
  .filter(
    ({ snapshot }) =>
      snapshot?.model_version &&
      snapshot.model_version !== newestSnapshot?.model_version &&
      Date.parse(snapshot.generated_at) < Date.parse(newestSnapshot?.generated_at),
  )
  .sort(
    (left, right) =>
      Date.parse(right.snapshot.generated_at) -
      Date.parse(left.snapshot.generated_at),
  )[0]?.snapshot;
const newestInputChecks = (newestSnapshot?.input_manifest?.files || []).map(
  (entry) => {
    const file = path.join(root, entry.path);
    const actualSha = fingerprint(file);
    return {
      path: entry.path,
      expected_sha256: entry.sha256,
      actual_sha256: actualSha,
      exists: Boolean(actualSha),
      matches_current_workspace: actualSha === entry.sha256,
    };
  },
);
const duplicateSnapshotIds = [...snapshotIdCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([snapshot_id, count]) => ({ snapshot_id, count }));

const checks = [];
const addCheck = (key, status, message, evidence = null) =>
  checks.push({ key, status, message, evidence });
addCheck(
  "current_model",
  current?.players?.length ? "pass" : "fail",
  `${current?.players?.length || 0} modeled players loaded.`,
);
addCheck(
  "canonical_identity_uniqueness",
  duplicateCanonicalIds.length || sleeperIdDuplicates.length ? "fail" : "pass",
  duplicateCanonicalIds.length
    ? `${duplicateCanonicalIds.length} duplicate canonical identities found.`
    : "Canonical identities are unique.",
  { duplicate_canonical_ids: duplicateCanonicalIds },
);
addCheck(
  "source_alias_ambiguity",
  ambiguousAliases.length ? "warn" : "pass",
  ambiguousAliases.length
    ? `${ambiguousAliases.length} source aliases matched multiple model players.`
    : "No ambiguous source aliases found.",
  { ambiguous: ambiguousAliases.slice(0, 100) },
);
addCheck(
  "source_alias_coverage",
  actionableUnmatchedAliases.length ? "warn" : "pass",
  actionableUnmatchedAliases.length
    ? `${actionableUnmatchedAliases.length} rostered source rows projected for at least 50 points could not be attached to a modeled player.`
    : `${unmatchedAliases.length} unmatched depth/free-agent rows were retained for review; none crossed the actionable threshold.`,
  {
    actionable_unmatched: actionableUnmatchedAliases.slice(0, 100),
    total_unmatched: unmatchedAliases.length,
  },
);
addCheck(
  "source_duplicate_mappings",
  duplicateSourceMappings.length ? "warn" : "pass",
  duplicateSourceMappings.length
    ? `${duplicateSourceMappings.length} source-to-canonical mappings contain duplicate rows.`
    : "No source contains duplicate rows for the same canonical player.",
  { duplicates: duplicateSourceMappings },
);
addCheck(
  "snapshot_identity_uniqueness",
  duplicateSnapshotIds.length ? "fail" : "pass",
  duplicateSnapshotIds.length
    ? `${duplicateSnapshotIds.length} duplicate immutable snapshot IDs found.`
    : "Snapshot IDs are unique.",
  { duplicates: duplicateSnapshotIds },
);
const newestGenerated = Date.parse(newestSnapshot?.generated_at);
const newestPostKickoff = (newestSnapshot?.players || []).filter((player) => {
  const kickoff = Date.parse(player?.forecast?.kickoff);
  return !Number.isFinite(kickoff) || !Number.isFinite(newestGenerated) || newestGenerated >= kickoff;
});
addCheck(
  "latest_snapshot_pre_kickoff",
  !newestSnapshot ? "fail" : newestPostKickoff.length ? "fail" : "pass",
  !newestSnapshot
    ? "No stat-model snapshot exists."
    : newestPostKickoff.length
      ? `${newestPostKickoff.length} latest-snapshot players were captured at or after kickoff.`
      : `All ${newestSnapshot.players?.length || 0} latest-snapshot forecasts were captured before kickoff.`,
);
addCheck(
  "latest_snapshot_input_reproducibility",
  !newestSnapshot?.input_manifest
    ? "warn"
    : newestInputChecks.every((entry) => entry.matches_current_workspace)
      ? "pass"
      : "fail",
  !newestSnapshot?.input_manifest
    ? "Latest snapshot predates input fingerprinting."
    : newestInputChecks.every((entry) => entry.matches_current_workspace)
      ? `All ${newestInputChecks.length} fingerprinted inputs match the latest snapshot.`
      : `${newestInputChecks.filter((entry) => !entry.matches_current_workspace).length} fingerprinted inputs differ from the latest snapshot.`,
  { inputs: newestInputChecks },
);
const futureDatedSources = sourceReports.filter(
  (source) =>
    Number.isFinite(Date.parse(source.updated)) &&
    Number.isFinite(Date.parse(current.generated_at)) &&
    Date.parse(source.updated) > Date.parse(current.generated_at),
);
addCheck(
  "source_cutoff",
  futureDatedSources.length ? "fail" : "pass",
  futureDatedSources.length
    ? `${futureDatedSources.length} source timestamps are later than the model build.`
    : "No source timestamp is later than the model build cutoff.",
  { sources: futureDatedSources.map((source) => source.key) },
);
const missingStatInputs = sourceReports.filter(
  (source) => source.stat_model_input && !source.exists,
);
addCheck(
  "stat_input_availability",
  missingStatInputs.length ? "warn" : "pass",
  missingStatInputs.length
    ? `Missing stat inputs: ${missingStatInputs.map((source) => source.name).join(", ")}.`
    : "All configured field-level stat inputs are present.",
);
const calibrationPositions = ["QB", "RB", "WR", "TE", "K"];
const invalidCalibrations = calibrationPositions.filter((position) => {
  const row = calibration?.by_position?.[position];
  return (
    !row ||
    Number(row.validation_sample) < 100 ||
    Number(row.holdout_mae_improvement) <= 0 ||
    !Object.keys(row.features || {}).length
  );
});
addCheck(
  "trained_adjustment_holdout",
  invalidCalibrations.length ? "fail" : "pass",
  invalidCalibrations.length
    ? `Missing or non-improving holdout calibration: ${invalidCalibrations.join(", ")}.`
    : "Every position-specific adjustment improved MAE on the untouched 2025 holdout.",
  {
    calibration_version: calibration?.version || null,
    positions: Object.fromEntries(
      calibrationPositions.map((position) => [
        position,
        calibration?.by_position?.[position]
          ? {
              validation_sample:
                calibration.by_position[position].validation_sample,
              baseline_mae:
                calibration.by_position[position].holdout_baseline?.mae,
              trained_mae:
                calibration.by_position[position].holdout_trained?.mae,
              improvement:
                calibration.by_position[position].holdout_mae_improvement,
            }
          : null,
      ]),
    ),
  },
);

const quantile = (values, probability) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * probability)];
};
const adjustmentDistribution = (snapshot, position) => {
  const values = (snapshot?.players || [])
    .filter((player) => player.position === position)
    // Compare the published, season-neutral matchup factor. Raw trained
    // factors are normalized back to the player's season workload and can
    // legitimately move as a model's role calibration changes.
    .map((player) =>
      Number(
        player?.forecast?.matchup_factor ??
          player?.forecast?.learned_adjustment?.factor,
      ),
    )
    .filter(Number.isFinite);
  return {
    sample: values.length,
    p05: quantile(values, 0.05),
    median: quantile(values, 0.5),
    p95: quantile(values, 0.95),
  };
};
const releaseDistribution = Object.fromEntries(
  calibrationPositions.map((position) => {
    const currentDistribution = adjustmentDistribution(newestSnapshot, position);
    const previousDistribution = adjustmentDistribution(
      previousReleaseSnapshot,
      position,
    );
    return [
      position,
      {
        current: currentDistribution,
        previous: previousDistribution,
        median_shift:
          currentDistribution.median != null && previousDistribution.median != null
            ? Number(
                (currentDistribution.median - previousDistribution.median).toFixed(4),
              )
            : null,
        lower_tail_shift:
          currentDistribution.p05 != null && previousDistribution.p05 != null
            ? Number((currentDistribution.p05 - previousDistribution.p05).toFixed(4))
            : null,
        upper_tail_shift:
          currentDistribution.p95 != null && previousDistribution.p95 != null
            ? Number((currentDistribution.p95 - previousDistribution.p95).toFixed(4))
            : null,
      },
    ];
  }),
);
const unstablePositions = Object.entries(releaseDistribution)
  .filter(([, row]) =>
    [row.median_shift, row.lower_tail_shift, row.upper_tail_shift].some(
      (value) => Number.isFinite(value) && Math.abs(value) > 0.12,
    ),
  )
  .map(([position]) => position);
addCheck(
  "live_adjustment_distribution",
  unstablePositions.length ? "fail" : "pass",
  !previousReleaseSnapshot
    ? "No prior release snapshot exists; live adjustment stability will be checked after the next release."
    : unstablePositions.length
      ? `Unsafe published matchup-factor shift versus ${previousReleaseSnapshot.model_version}: ${unstablePositions.join(", ")}.`
      : `Published matchup-factor distributions remain stable versus ${previousReleaseSnapshot.model_version}.`,
  {
    previous_model_version: previousReleaseSnapshot?.model_version || null,
    threshold: 0.12,
    by_position: releaseDistribution,
  },
);

const overallStatus = checks.some((check) => check.status === "fail")
  ? "fail"
  : checks.some((check) => check.status === "warn")
    ? "warn"
    : "pass";
const generatedAt = new Date().toISOString();
const identityOutput = {
  source: "The Fantasy Arsenal canonical projection identity ledger",
  season,
  generated_at: generatedAt,
  model_generated_at: current.generated_at,
  model_version: current.model_version,
  model_build_id: current.model_build_id,
  feature_version: current.feature_version || null,
  canonical_players: canonical.length,
  sleeper_id_players: canonical.filter((player) => player.sleeper_id).length,
  fallback_identity_players: canonical.filter((player) => !player.sleeper_id).length,
  sources: sourceReports,
  common_populations: commonPopulations,
  unmatched_alias_count: unmatchedAliases.length,
  actionable_unmatched_alias_count: actionableUnmatchedAliases.length,
  ambiguous_alias_count: ambiguousAliases.length,
  unmatched_aliases: unmatchedAliases,
  ambiguous_aliases: ambiguousAliases,
  players: canonical,
};
const archiveIndex = {
  source: "The Fantasy Arsenal immutable stat projection snapshot index",
  season,
  generated_at: generatedAt,
  snapshots: snapshotRows.sort((left, right) =>
    String(left.generated_at).localeCompare(String(right.generated_at)),
  ),
};
const auditOutput = {
  source: "The Fantasy Arsenal projection pipeline audit",
  season,
  generated_at: generatedAt,
  status: overallStatus,
  model: {
    generated_at: current.generated_at,
    model_version: current.model_version,
    model_build_id: current.model_build_id,
    schema_version: current.schema_version,
    feature_version: current.feature_version || null,
    input_bundle_sha256: current.input_manifest?.bundle_sha256 || null,
    players: current.players.length,
  },
  latest_snapshot: newestSnapshotEntry
    ? snapshotRows.find((row) => row.file === newestSnapshotEntry.file)
    : null,
  source_summary: sourceReports,
  identity_summary: {
    canonical_players: canonical.length,
    sleeper_id_players: identityOutput.sleeper_id_players,
    fallback_identity_players: identityOutput.fallback_identity_players,
    unmatched_aliases: unmatchedAliases.length,
    actionable_unmatched_aliases: actionableUnmatchedAliases.length,
    ambiguous_aliases: ambiguousAliases.length,
  },
  common_populations: Object.fromEntries(
    Object.entries(commonPopulations).map(([key, population]) => [
      key,
      { sources: population.sources, players: population.players },
    ]),
  ),
  checks,
  artifacts: {
    identity_ledger: relative(identityFile),
    archive_index: relative(archiveIndexFile),
  },
};

writeJson(identityFile, identityOutput);
writeJson(archiveIndexFile, archiveIndex);
writeJson(auditFile, auditOutput);
console.log(
  `Projection pipeline audit: ${overallStatus.toUpperCase()} (${checks.filter((check) => check.status === "pass").length} pass, ${checks.filter((check) => check.status === "warn").length} warn, ${checks.filter((check) => check.status === "fail").length} fail).`,
);
console.log(
  `Canonical players: ${canonical.length}; Sleeper IDs: ${identityOutput.sleeper_id_players}; unmatched aliases: ${unmatchedAliases.length}; ambiguous aliases: ${ambiguousAliases.length}.`,
);
if (overallStatus === "fail") process.exitCode = 1;
