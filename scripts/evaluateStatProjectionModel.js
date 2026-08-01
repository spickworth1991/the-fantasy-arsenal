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
const archiveDirectory = path.join(
  root,
  "public",
  "archive",
  "stat-projections",
  String(season),
);
const actualFile = path.join(
  root,
  "public",
  "stats",
  "history",
  String(season),
  "sleeper.json",
);
const scheduleFile = path.join(
  root,
  "public",
  "stats",
  "projections",
  String(season),
  "schedule.json",
);
const outputFile = path.join(
  root,
  "public",
  "stats",
  "projections",
  String(season),
  "accuracy.json",
);
const scoringKeys = ["ppr", "half", "std"];
const projectionLenses = ["safe", "expected", "upside"];
const positions = ["QB", "RB", "WR", "TE", "K"];
const finalWindowMs = 6 * 60 * 60 * 1000;
const evaluationTime = Date.now();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const finiteNumber = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
const round = (value, places = 4) => Number(number(value).toFixed(places));
const roundNullable = (value, places = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(places)) : null;
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
    { JAX: "JAC", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" }[team] || team
  );
};
const namePositionKeyOf = (row) =>
  `${normalizeName(row?.name)}|${String(row?.position || "").toUpperCase()}`;
const keyOf = (row) => {
  const playerId = String(row?.player_id || "").trim();
  return playerId ? `id:${playerId}` : namePositionKeyOf(row);
};
const identityKeysOf = (row) =>
  [...new Set([keyOf(row), namePositionKeyOf(row)])].filter(Boolean);
const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (file, payload) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
};

function correlation(left, right) {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  left.forEach((value, index) => {
    const leftDelta = value - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  });
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator ? covariance / denominator : null;
}

function ranks(values) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);
  const result = Array(values.length).fill(0);
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (
      end + 1 < sorted.length &&
      sorted[end + 1].value === sorted[index].value
    )
      end += 1;
    const rank = (index + end) / 2 + 1;
    for (let cursor = index; cursor <= end; cursor += 1)
      result[sorted[cursor].index] = rank;
    index = end + 1;
  }
  return result;
}

function metrics(rows) {
  if (!rows.length) return null;
  const errors = rows.map((row) => row.projection - row.actual);
  const rankCorrelation = correlation(
    ranks(rows.map((row) => row.projection)),
    ranks(rows.map((row) => row.actual)),
  );
  return {
    sample: rows.length,
    mae: round(
      errors.reduce((sum, value) => sum + Math.abs(value), 0) / rows.length,
    ),
    rmse: round(
      Math.sqrt(
        errors.reduce((sum, value) => sum + value ** 2, 0) / rows.length,
      ),
    ),
    bias: round(errors.reduce((sum, value) => sum + value, 0) / rows.length),
    rank_correlation: roundNullable(rankCorrelation),
  };
}

function coverageSummary(records) {
  const matched = records.filter((record) => record.result === "active_match");
  const withoutResult = records.filter(
    (record) => record.result !== "active_match",
  );
  const knownDnp = records.filter(
    (record) => record.result === "known_dnp_or_inactive",
  );
  const unmatched = records.filter(
    (record) => record.result === "identity_unmatched_or_not_in_archive",
  );
  const projectedFive = records.filter((record) => record.projection >= 5);
  const projectedTen = records.filter((record) => record.projection >= 10);
  const topHundred = records.filter((record) => record.top_100);
  return {
    projected_completed_games: records.length,
    matched_active_games: matched.length,
    active_game_match_rate: records.length
      ? round(matched.length / records.length)
      : null,
    projected_without_active_result: withoutResult.length,
    known_projected_dnp_or_inactive: knownDnp.length,
    identity_unmatched_or_not_in_archive: unmatched.length,
    sleeper_id_matches: records.filter(
      (record) => record.identity_match_method === "sleeper_id",
    ).length,
    normalized_name_position_matches: records.filter(
      (record) => record.identity_match_method === "normalized_name_position",
    ).length,
    projected_5_plus: projectedFive.length,
    projected_5_plus_without_active_result: projectedFive.filter(
      (record) => record.result !== "active_match",
    ).length,
    projected_10_plus: projectedTen.length,
    projected_10_plus_without_active_result: projectedTen.filter(
      (record) => record.result !== "active_match",
    ).length,
    top_100_projected_completed_games: topHundred.length,
    top_100_matched_active_games: topHundred.filter(
      (record) => record.result === "active_match",
    ).length,
  };
}

function scoringSummary(rows, coverage, includePositions = true) {
  const summary = {
    ...(metrics(rows) || {}),
    population: "active_game_conditional",
    cohorts: {
      all_matched: metrics(rows),
      projected_5_plus: metrics(rows.filter((row) => row.projection >= 5)),
      projected_10_plus: metrics(rows.filter((row) => row.projection >= 10)),
      top_100_projected: metrics(rows.filter((row) => row.top_100)),
    },
    coverage: coverageSummary(coverage),
  };
  if (includePositions) {
    summary.by_position = Object.fromEntries(
      positions.map((position) => [
        position,
        metrics(rows.filter((row) => row.position === position)),
      ]),
    );
  }
  return summary;
}

function scheduledWeeks(schedule) {
  if (!Array.isArray(schedule?.weeks)) return new Map();
  return new Map(
    schedule.weeks.map((entry) => {
      const games = (entry.games || [])
        .map((game) => {
          const kickoff = Date.parse(game.date);
          if (!Number.isFinite(kickoff)) return null;
          return {
            home: normalizeTeam(game.home),
            away: normalizeTeam(game.away),
            kickoff,
            finalAt: kickoff + finalWindowMs,
          };
        })
        .filter(Boolean);
      return [Number(entry.week), games];
    }),
  );
}

const actual = readJson(actualFile);
const schedule = readJson(scheduleFile);
const scheduleByWeek = scheduledWeeks(schedule);
const actualFinalWeeks = new Set(
  Array.isArray(actual?.final_weeks)
    ? actual.final_weeks.map(Number)
    : Array.from(
        { length: number(actual?.completed_weeks) },
        (_, index) => index + 1,
      ),
);
const actualUpdatedAt = Date.parse(actual?.updated);
const snapshots = fs.existsSync(archiveDirectory)
  ? fs
      .readdirSync(archiveDirectory)
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJson(path.join(archiveDirectory, file)))
      .filter(
        (snapshot) =>
          snapshot?.week &&
          snapshot?.generated_at &&
          Array.isArray(snapshot?.players),
      )
  : [];

const actualByPlayer = new Map(
  (actual?.players || []).flatMap((player) =>
    identityKeysOf(player).map((key) => [key, player]),
  ),
);
const weekResults = [];
const ledger = [];
const lensLedger = [];
const coverageLedger = [];
const snapshotWeeks = [
  ...new Set(snapshots.map((snapshot) => Number(snapshot.week))),
].sort((a, b) => a - b);

if (
  scheduleByWeek.size &&
  actual?.players &&
  Number.isFinite(actualUpdatedAt)
) {
  for (const week of snapshotWeeks) {
    if (!actualFinalWeeks.has(week)) continue;
    const games = scheduleByWeek.get(week) || [];
    if (!games.length) continue;
    const weekSnapshots = snapshots
      .filter((snapshot) => Number(snapshot.week) === week)
      .sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at));

    const gamesByTeam = new Map();
    for (const game of games) {
      gamesByTeam.set(game.home, game);
      gamesByTeam.set(game.away, game);
    }
    const completedGames = games.filter(
      (game) => evaluationTime >= game.finalAt,
    );
    const resultsReadyGames = completedGames.filter(
      (game) => actualUpdatedAt >= game.finalAt,
    );
    if (!resultsReadyGames.length) continue;
    const resultsReadySet = new Set(resultsReadyGames);

    // A Thursday player must retain the final snapshot frozen before Thursday,
    // while Sunday and Monday players may use newer immutable builds. Iterating
    // newest-first and filling each identity once gives every player the latest
    // forecast that existed before their own scheduled kickoff.
    const selectedForecasts = new Map();
    const claimedForecastIdentities = new Set();
    for (const snapshot of weekSnapshots) {
      const generatedAt = Date.parse(snapshot.generated_at);
      if (!Number.isFinite(generatedAt)) continue;
      for (const forecast of snapshot.players) {
        const identityKeys = identityKeysOf(forecast);
        const playerKey = keyOf(forecast);
        if (
          !playerKey ||
          identityKeys.some((key) => claimedForecastIdentities.has(key))
        )
          continue;
        const game = gamesByTeam.get(normalizeTeam(forecast.team));
        if (!game || generatedAt >= game.kickoff) continue;
        selectedForecasts.set(playerKey, { forecast, game, snapshot });
        identityKeys.forEach((key) => claimedForecastIdentities.add(key));
      }
    }
    if (!selectedForecasts.size) continue;

    const topHundredByScoring = Object.fromEntries(
      scoringKeys.map((scoring) => {
        const ranked = [...selectedForecasts.entries()]
          .map(([key, selection]) => ({
            key,
            projection: finiteNumber(
              selection.forecast.forecast?.projections?.[scoring],
            ),
          }))
          .filter((entry) => Number.isFinite(entry.projection))
          .sort((a, b) => b.projection - a.projection)
          .slice(0, 100);
        return [scoring, new Set(ranked.map((entry) => entry.key))];
      }),
    );
    const rowsByScoring = Object.fromEntries(
      scoringKeys.map((key) => [key, []]),
    );
    const coverageByScoring = Object.fromEntries(
      scoringKeys.map((key) => [key, []]),
    );
    const usedSnapshots = new Map();

    for (const [playerKey, selection] of selectedForecasts) {
      const { forecast, game, snapshot } = selection;
      if (!resultsReadySet.has(game)) continue;
      const modelBuildId =
        snapshot.model_build_id || snapshot.model_version || "unknown";
      const modelReleaseVersion = snapshot.model_version || "unknown";
      usedSnapshots.set(snapshot.generated_at, {
        generated_at: snapshot.generated_at,
        model_build_id: modelBuildId,
        model_version: modelReleaseVersion,
      });
      const idKey = forecast?.player_id
        ? `id:${String(forecast.player_id).trim()}`
        : null;
      const nameKey = namePositionKeyOf(forecast);
      const observedById = idKey ? actualByPlayer.get(idKey) : null;
      const observed = observedById || actualByPlayer.get(nameKey);
      const identityMatchMethod = observedById
        ? "sleeper_id"
        : observed
          ? "normalized_name_position"
          : "unmatched";
      const observedWeek = observed?.weeks?.[String(week)];
      for (const scoring of scoringKeys) {
        const projection = finiteNumber(
          forecast.forecast?.projections?.[scoring],
        );
        if (!Number.isFinite(projection)) continue;
        const top100 = topHundredByScoring[scoring].has(playerKey);
        const result = finiteNumber(observedWeek?.[scoring]);
        const coverageRecord = {
          week,
          scoring,
          model_version: modelBuildId,
          model_build_id: modelBuildId,
          model_release_version: modelReleaseVersion,
          snapshot_generated_at: snapshot.generated_at,
          projection,
          top_100: top100,
          identity_match_method: identityMatchMethod,
          result: Number.isFinite(result)
            ? "active_match"
            : observed
              ? "known_dnp_or_inactive"
              : "identity_unmatched_or_not_in_archive",
        };
        coverageByScoring[scoring].push(coverageRecord);
        coverageLedger.push(coverageRecord);
        if (!Number.isFinite(result)) continue;
        const row = {
          week,
          scoring,
          model_version: modelBuildId,
          model_build_id: modelBuildId,
          model_release_version: modelReleaseVersion,
          snapshot_generated_at: snapshot.generated_at,
          name: forecast.name,
          team: forecast.team,
          position: forecast.position,
          projection: round(projection, 3),
          actual: round(result, 3),
          error: round(projection - result, 3),
          confidence: number(forecast.confidence),
          top_100: top100,
        };
        rowsByScoring[scoring].push(row);
        ledger.push(row);
        for (const lens of projectionLenses) {
          const lensProjection = finiteNumber(
            forecast.forecast?.projection_lenses?.[scoring]?.[lens] ??
              (lens === "expected" ? projection : null),
          );
          if (!Number.isFinite(lensProjection)) continue;
          lensLedger.push({
            ...row,
            lens,
            projection: round(lensProjection, 3),
            error: round(lensProjection - result, 3),
          });
        }
      }
    }
    const snapshotMetadata = [...usedSnapshots.values()].sort(
      (left, right) =>
        Date.parse(left.generated_at) - Date.parse(right.generated_at),
    );
    const snapshotTimes = snapshotMetadata.map(
      (snapshot) => snapshot.generated_at,
    );
    const modelBuildIds = [
      ...new Set(snapshotMetadata.map((snapshot) => snapshot.model_build_id)),
    ];
    const modelReleaseVersions = [
      ...new Set(snapshotMetadata.map((snapshot) => snapshot.model_version)),
    ];
    weekResults.push({
      week,
      snapshot_generated_at:
        snapshotTimes.length === 1 ? snapshotTimes[0] : null,
      snapshot_range: {
        earliest_generated_at: snapshotTimes[0] || null,
        latest_generated_at: snapshotTimes.at(-1) || null,
        snapshots_used: snapshotTimes.length,
      },
      model_version: modelBuildIds.length === 1 ? modelBuildIds[0] : null,
      model_build_ids: modelBuildIds,
      model_versions: modelReleaseVersions,
      schedule: {
        games: games.length,
        games_past_final_window: completedGames.length,
        games_in_saved_results_window: resultsReadyGames.length,
        week_complete: completedGames.length === games.length,
        saved_results_complete: resultsReadyGames.length === games.length,
      },
      scoring: Object.fromEntries(
        scoringKeys.map((key) => [
          key,
          scoringSummary(rowsByScoring[key], coverageByScoring[key]),
        ]),
      ),
      projection_lenses: Object.fromEntries(
        scoringKeys.map((scoring) => [
          scoring,
          Object.fromEntries(
            projectionLenses.map((lens) => [
              lens,
              metrics(
                lensLedger.filter(
                  (row) =>
                    row.week === week &&
                    row.scoring === scoring &&
                    row.lens === lens,
                ),
              ),
            ]),
          ),
        ]),
      ),
    });
  }
}

const cumulative = Object.fromEntries(
  scoringKeys.map((scoring) => [
    scoring,
    scoringSummary(
      ledger.filter((row) => row.scoring === scoring),
      coverageLedger.filter((record) => record.scoring === scoring),
    ),
  ]),
);

const modelVersions = [
  ...new Set(coverageLedger.map((record) => record.model_version)),
].sort();
const cumulativeByModelVersion = Object.fromEntries(
  modelVersions.map((modelVersion) => {
    const versionRows = ledger.filter(
      (row) => row.model_version === modelVersion,
    );
    const versionCoverage = coverageLedger.filter(
      (record) => record.model_version === modelVersion,
    );
    return [
      modelVersion,
      {
        model_build_id: modelVersion,
        model_release_versions: [
          ...new Set(
            versionCoverage.map((record) => record.model_release_version),
          ),
        ].filter(Boolean),
        weeks: [...new Set(versionCoverage.map((record) => record.week))].sort(
          (a, b) => a - b,
        ),
        scoring: Object.fromEntries(
          scoringKeys.map((scoring) => [
            scoring,
            scoringSummary(
              versionRows.filter((row) => row.scoring === scoring),
              versionCoverage.filter((record) => record.scoring === scoring),
              false,
            ),
          ]),
        ),
        projection_lenses: Object.fromEntries(
          scoringKeys.map((scoring) => [
            scoring,
            Object.fromEntries(
              projectionLenses.map((lens) => [
                lens,
                metrics(
                  lensLedger.filter(
                    (row) =>
                      row.model_version === modelVersion &&
                      row.scoring === scoring &&
                      row.lens === lens,
                  ),
                ),
              ]),
            ),
          ]),
        ),
      },
    ];
  }),
);

const scheduleAvailable = scheduleByWeek.size > 0;
const scoredWeeks = weekResults.filter((result) =>
  scoringKeys.some((scoring) => result.scoring?.[scoring]?.sample > 0),
);
const output = {
  source: "The Fantasy Arsenal frozen forecast evaluator",
  season,
  generated_at: new Date().toISOString(),
  status: !scheduleAvailable
    ? "awaiting_schedule"
    : ledger.length
      ? "ready"
      : "awaiting_results",
  metric_population: "active_game_conditional",
  last_scored_week: scoredWeeks.at(-1)?.week || null,
  snapshot_count: snapshots.length,
  actual_source: actual?.source || null,
  schedule_source: schedule?.source || null,
  methodology: {
    snapshot:
      "Each player uses the latest immutable model snapshot created before that player's own scheduled NFL kickoff. Weekly results expose every build used and the snapshot-time range instead of treating a mixed Thursday-to-Monday slate as one freeze point.",
    finality:
      "A player is eligible only after their scheduled NFL game has been past kickoff by at least six hours and the saved results archive was refreshed after that finality window. Missing schedule data is never graded.",
    sample:
      "Accuracy metrics are active-game conditional: only players with both a pre-kickoff projection and a saved active-game result are graded. Forecasts without an active result remain visible in coverage and DNP/inactive-miss counts.",
    cohorts:
      "Reports all matched active games, projections of at least 5 points, projections of at least 10 points, and the top 100 projections selected independently for each week and scoring format.",
    model_versions:
      "Cumulative accuracy is separated by the exact model build ID stored in each immutable forecast snapshot; release-version labels remain attached separately.",
    mae: "Mean absolute error; lower is better.",
    rmse: "Root mean squared error; lower is better and penalizes large misses.",
    bias: "Average projection minus actual result; positive means the model projected too high.",
    rank_correlation:
      "Spearman-style rank correlation between projected and actual player order; higher is better. It remains null when fewer than three observations or no rank variance makes it undefined.",
  },
  cumulative,
  projection_lens_accuracy: Object.fromEntries(
    scoringKeys.map((scoring) => [
      scoring,
      Object.fromEntries(
        projectionLenses.map((lens) => [
          lens,
          metrics(
            lensLedger.filter(
              (row) => row.scoring === scoring && row.lens === lens,
            ),
          ),
        ]),
      ),
    ]),
  ),
  cumulative_by_model_version: cumulativeByModelVersion,
  weeks: weekResults,
};

writeJson(outputFile, output);
console.log(
  !scheduleAvailable
    ? `No saved ${season} projection schedule is available; no forecasts were graded.`
    : scoredWeeks.length
      ? `Scored ${scoredWeeks.length} ${season} forecast week${scoredWeeks.length === 1 ? "" : "s"}; latest Week ${output.last_scored_week}.`
      : `No final, results-ready ${season} player games are available yet; wrote an awaiting-results accuracy record.`,
);
