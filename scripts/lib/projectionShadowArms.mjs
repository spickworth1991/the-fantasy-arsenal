import { applyRegimeAwareCombined } from "./regimeAwareCombined.mjs";

const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const round = (value, digits = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

const targetPositions = new Set(["RB", "WR", "TE"]);

function scaleProjections(projections, factor) {
  return Object.fromEntries(
    Object.entries(projections || {}).map(([format, value]) => [
      format,
      Number.isFinite(Number(value)) ? round(Number(value) * factor, 3) : value,
    ]),
  );
}

function combineProjectionDeltas(incumbent, left, right, maximumShift = 0.4) {
  return Object.fromEntries(["ppr", "half", "std"].map((format) => {
    const base = finite(incumbent?.[format]);
    const combined = base + (finite(left?.[format], base) - base) + (finite(right?.[format], base) - base);
    return [format, round(clamp(combined, Math.max(0, base * (1 - maximumShift)), base * (1 + maximumShift)), 3)];
  }));
}

function scoreStatLine(line, scoring) {
  const receptionPoints = scoring === "ppr" ? 1 : scoring === "half" ? 0.5 : 0;
  return (
    finite(line?.pass_yd) * 0.04 +
    finite(line?.pass_td) * 4 -
    finite(line?.pass_int) * 2 +
    finite(line?.rush_yd) * 0.1 +
    finite(line?.rush_td) * 6 +
    finite(line?.rec_yd) * 0.1 +
    finite(line?.rec_td) * 6 +
    finite(line?.fgm) * 3 +
    finite(line?.xpm) +
    finite(line?.rec) * receptionPoints -
    finite(line?.fum_lost) * 2
  );
}

const manualTrendFields = {
  QB: { volume: ["pass_att", "rush_att"], rates: [["pass_cmp", "pass_att"], ["pass_yd", "pass_att"], ["pass_td", "pass_att"], ["pass_int", "pass_att"], ["rush_yd", "rush_att"], ["rush_td", "rush_att"]] },
  RB: { volume: ["rush_att", "rec_tgt"], rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  WR: { volume: ["rush_att", "rec_tgt"], rates: [["rush_yd", "rush_att"], ["rush_td", "rush_att"], ["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  TE: { volume: ["rec_tgt"], rates: [["rec", "rec_tgt"], ["rec_yd", "rec_tgt"], ["rec_td", "rec_tgt"]] },
  K: { volume: ["fga", "xpa", "kick_pts"], rates: [["fgm", "fga"], ["xpm", "xpa"]] },
};

function manualStatTrendProjection(player, definition, teamFactor = 1) {
  const incumbent = { ...(player.forecast?.projections || {}) };
  const manual = definition.manual_stat_trend;
  const config = manual?.settings;
  const positionConfig = config?.positions?.[player.position];
  const fields = manualTrendFields[player.position];
  const baseline = manual?.baseline_by_player?.[String(player.player_id)]?.stat_line;
  const frozen = player.forecast?.stat_line || {};
  const games = finite(player.completed_games);
  if (!positionConfig?.enabled || !fields || !baseline || games < 1 || isUnavailableForPlay(player)) {
    return { projections: incumbent, context: { triggered: false, reason: !baseline ? "missing_frozen_baseline" : "ineligible" } };
  }
  const actualAverage = Object.fromEntries(
    Object.entries(player.actual_stat_line || {}).map(([field, value]) => [field, finite(value) / games]),
  );
  const starter = finite(player.depth_chart_order, 99) <= 1;
  const cohort = `established_${starter ? "starter" : "reserve"}`;
  const roleMultiplier = finite(positionConfig.role_multipliers?.[cohort], 1);
  const factors = {};
  const applyFactor = (entry, observed, prior, key) => {
    const minimumGames = finite(entry?.minimum_games ?? positionConfig.minimum_games ?? config.minimum_games, 3);
    if (entry?.enabled !== true || games < minimumGames || !(prior > 0)) return 1;
    const direction = observed >= prior ? "up" : "down";
    const weight = finite(direction === "up" ? entry.up_weight ?? entry.weight : entry.down_weight ?? entry.weight, 1) * roleMultiplier;
    const maximum = finite(direction === "up" ? entry.max_up_move_pct ?? entry.max_stat_move_pct : entry.max_down_move_pct ?? entry.max_stat_move_pct, 0.25);
    const reliability = games / (games + finite(entry.prior_games, 8));
    const factor = clamp(1 + (observed / prior - 1) * reliability * weight, 1 - maximum, 1 + maximum);
    factors[key] = round(factor, 5);
    return factor;
  };
  const next = { ...frozen };
  for (const field of fields.volume) {
    next[field] = finite(frozen[field]) * applyFactor(positionConfig.stats?.[field], finite(actualAverage[field]), finite(baseline[field]), field);
  }
  for (const [numerator, denominator] of fields.rates) {
    const priorRate = finite(baseline[numerator]) / Math.max(0.01, finite(baseline[denominator]));
    const observedRate = finite(actualAverage[numerator]) / Math.max(0.01, finite(actualAverage[denominator]));
    const frozenRate = finite(frozen[numerator]) / Math.max(0.01, finite(frozen[denominator]));
    next[numerator] = finite(next[denominator]) * frozenRate * applyFactor(positionConfig.stats?.[numerator], observedRate, priorRate, `${numerator}_per_${denominator}`);
  }
  next.pass_cmp = Math.min(finite(next.pass_cmp), finite(next.pass_att));
  next.rec = Math.min(finite(next.rec), finite(next.rec_tgt));
  const overallWeight = finite(positionConfig.overall_weight, 0);
  const maximumTotalMove = finite(positionConfig.max_total_move_pct, 0.2);
  const scoreLine = (line, format) => player.position === "K"
    ? finite(line?.kick_pts)
    : scoreStatLine(line, format);
  const projections = Object.fromEntries(["ppr", "half", "std"].map((format) => {
    const safe = finite(incumbent[format]);
    const adjusted = safe + (scoreLine(next, format) - scoreLine(frozen, format)) * overallWeight;
    const reconciled = adjusted * teamFactor;
    return [format, round(clamp(reconciled, Math.max(0, safe * (1 - maximumTotalMove)), safe * (1 + maximumTotalMove)), 3)];
  }));
  return {
    projections,
    context: {
      triggered: Object.values(factors).some((factor) => Math.abs(factor - 1) >= 0.005) || Math.abs(teamFactor - 1) >= 0.005,
      completed_games: games,
      baseline_week: manual.baseline_by_player[String(player.player_id)]?.week || null,
      team_volume_factor: round(teamFactor, 5),
      field_factors: factors,
    },
  };
}

const adaptationFields = {
  QB: {
    volume: ["pass_att", "rush_att"],
    rates: [
      ["pass_cmp", "pass_att"],
      ["pass_yd", "pass_att"],
      ["pass_td", "pass_att"],
      ["pass_int", "pass_att"],
      ["rush_yd", "rush_att"],
      ["rush_td", "rush_att"],
    ],
  },
  RB: {
    volume: ["rush_att", "rec_tgt"],
    rates: [
      ["rush_yd", "rush_att"],
      ["rush_td", "rush_att"],
      ["rec", "rec_tgt"],
      ["rec_yd", "rec_tgt"],
      ["rec_td", "rec_tgt"],
    ],
  },
  WR: {
    volume: ["rush_att", "rec_tgt"],
    rates: [
      ["rush_yd", "rush_att"],
      ["rush_td", "rush_att"],
      ["rec", "rec_tgt"],
      ["rec_yd", "rec_tgt"],
      ["rec_td", "rec_tgt"],
    ],
  },
  TE: {
    volume: ["rec_tgt"],
    rates: [
      ["rec", "rec_tgt"],
      ["rec_yd", "rec_tgt"],
      ["rec_td", "rec_tgt"],
    ],
  },
};

function dynamicRestOfSeasonAnchor(player, definition) {
  const incumbent = { ...(player.forecast?.projections || {}) };
  const settings = definition.dynamic_rest_of_season;
  const positionSettings = settings?.settings_by_position?.[player.position];
  const fields = adaptationFields[player.position];
  const baseline = definition.manual_stat_trend?.baseline_by_player?.[String(player.player_id)]?.stat_line;
  const frozen = player.forecast?.stat_line || {};
  const actual = player.actual_stat_line || {};
  const games = finite(player.completed_games);
  if (!positionSettings?.enabled || !fields || !baseline || games < finite(settings.minimum_games, 2) || isUnavailableForPlay(player))
    return { projections: incumbent, stat_line: frozen, context: { triggered: false, reason: !baseline ? "missing_frozen_baseline" : "ineligible" } };

  const next = { ...baseline };
  const fieldFactors = {};
  const volumeReliability = games / (games + finite(positionSettings.volume_prior_games, 4));
  for (const field of fields.volume) {
    const prior = finite(baseline[field]);
    const observed = finite(actual[field]) / Math.max(1, games);
    if (!(prior > 0) || observed < 0) continue;
    const factor = clamp(
      1 + (observed / prior - 1) * volumeReliability * finite(positionSettings.volume_strength, 0.7),
      1 - finite(positionSettings.maximum_volume_shift, 0.35),
      1 + finite(positionSettings.maximum_volume_shift, 0.35),
    );
    next[field] = prior * factor;
    fieldFactors[field] = round(factor, 5);
  }
  for (const [numerator, denominator] of fields.rates) {
    const priorDenominator = finite(baseline[denominator]);
    const observedDenominator = finite(actual[denominator]);
    const priorRate = finite(baseline[numerator]) / Math.max(0.01, priorDenominator);
    const observedRate = finite(actual[numerator]) / Math.max(0.01, observedDenominator);
    if (!(priorRate > 0) || !(observedDenominator > 0)) continue;
    const isTouchdown = numerator.endsWith("_td");
    const priorGames = isTouchdown
      ? finite(positionSettings.touchdown_prior_games, 24)
      : finite(positionSettings.efficiency_prior_games, 12);
    const strength = isTouchdown
      ? finite(positionSettings.touchdown_strength, 0.15)
      : finite(positionSettings.efficiency_strength, 0.35);
    const reliability = games / (games + priorGames);
    const maximum = isTouchdown
      ? finite(positionSettings.maximum_touchdown_rate_shift, 0.15)
      : finite(positionSettings.maximum_efficiency_rate_shift, 0.16);
    const factor = clamp(1 + (observedRate / priorRate - 1) * reliability * strength, 1 - maximum, 1 + maximum);
    next[numerator] = finite(next[denominator]) * priorRate * factor;
    fieldFactors[`${numerator}_per_${denominator}`] = round(factor, 5);
  }
  next.pass_cmp = Math.min(finite(next.pass_cmp), finite(next.pass_att));
  next.rec = Math.min(finite(next.rec), finite(next.rec_tgt));
  const applicationStrength = finite(positionSettings.application_strength, 0.8);
  const correctedLine = Object.fromEntries(
    [...new Set([...Object.keys(frozen), ...Object.keys(next)])].map((field) => [
      field,
      finite(frozen[field]) + (finite(next[field]) - finite(frozen[field])) * applicationStrength,
    ]),
  );
  const maximumTotalShift = finite(positionSettings.maximum_total_shift, 0.6);
  const projections = Object.fromEntries(["ppr", "half", "std"].map((format) => {
    const safe = finite(incumbent[format]);
    const frozenPoints = scoreStatLine(frozen, format);
    const matchupScale = frozenPoints > 0 ? clamp(safe / frozenPoints, 0.85, 1.15) : 1;
    const candidate = scoreStatLine(correctedLine, format) * matchupScale;
    return [format, round(clamp(candidate, Math.max(0, safe * (1 - maximumTotalShift)), safe * (1 + maximumTotalShift)), 3)];
  }));
  return {
    projections,
    stat_line: correctedLine,
    context: {
      triggered: Math.abs(finite(projections.ppr) - finite(incumbent.ppr)) >= 0.05,
      completed_games: games,
      application_strength: applicationStrength,
      factor: round(finite(projections.ppr) / Math.max(0.001, finite(incumbent.ppr)), 5),
      field_factors: fieldFactors,
    },
  };
}

function adaptCurrentSeasonRole(player, settings = {}) {
  const incumbent = { ...(player.forecast?.projections || {}) };
  const fields = adaptationFields[player.position];
  const games = finite(player.completed_games);
  const minimumGames = finite(settings.minimum_games, 3);
  const source = player.forecast?.stat_line || {};
  const actual = player.actual_stat_line || {};
  if (
    settings.enabled === false ||
    !fields ||
    games < minimumGames ||
    isUnavailableForPlay(player)
  ) {
    return {
      projections: incumbent,
      context: {
        triggered: false,
        completed_games: games,
        reason: settings.enabled === false
          ? "position_disabled_by_validation"
          : !fields
          ? "unsupported_position"
          : games < minimumGames
            ? "insufficient_current_season_games"
            : "unavailable",
      },
    };
  }

  const next = { ...source };
  const volumeReliability = games / (games + finite(settings.volume_prior_games, 4));
  const efficiencyReliability = games / (games + finite(settings.efficiency_prior_games, 16));
  const volumeStrength = finite(
    settings.volume_strength ?? settings.application_strength,
    1,
  );
  const efficiencyStrength = finite(
    settings.efficiency_strength ?? settings.application_strength,
    1,
  );
  const maximumShift = finite(settings.maximum_field_shift, 0.3);
  const fieldFactors = {};

  for (const field of fields.volume) {
    const baseline = finite(source[field]);
    const observed = finite(actual[field]) / Math.max(1, games);
    if (baseline <= 0 || observed < 0) continue;
    const rawRatio = observed / Math.max(0.01, baseline);
    const factor = clamp(
      1 + (rawRatio - 1) * volumeReliability * volumeStrength,
      1 - maximumShift,
      1 + maximumShift,
    );
    next[field] = baseline * factor;
    fieldFactors[field] = round(factor, 5);
  }

  for (const [numerator, denominator] of fields.rates) {
    const baselineDenominator = finite(source[denominator]);
    const actualDenominator = finite(actual[denominator]);
    const baselineRate = finite(source[numerator]) / Math.max(0.01, baselineDenominator);
    const actualRate = finite(actual[numerator]) / Math.max(0.01, actualDenominator);
    if (baselineDenominator <= 0 || actualDenominator <= 0 || baselineRate <= 0) continue;
    const maximumRateShift = Math.min(maximumShift, finite(settings.maximum_rate_shift, 0.16));
    const rateFactor = clamp(
      1 +
        (actualRate / baselineRate - 1) *
          efficiencyReliability *
          efficiencyStrength,
      1 - maximumRateShift,
      1 + maximumRateShift,
    );
    next[numerator] = finite(next[denominator]) * baselineRate * rateFactor;
    fieldFactors[`${numerator}_per_${denominator}`] = round(rateFactor, 5);
  }

  next.pass_cmp = Math.min(finite(next.pass_cmp), finite(next.pass_att));
  next.rec = Math.min(finite(next.rec), finite(next.rec_tgt));
  const projections = Object.fromEntries(
    ["ppr", "half", "std"].map((format) => [
      format,
      round(Math.max(0, scoreStatLine(next, format)), 3),
    ]),
  );
  const factor = finite(incumbent.ppr)
    ? finite(projections.ppr) / finite(incumbent.ppr)
    : 1;
  return {
    projections,
    context: {
      triggered: Object.values(fieldFactors).some((value) => Math.abs(value - 1) >= 0.005),
      completed_games: games,
      factor: round(factor, 5),
      volume_reliability: round(volumeReliability, 5),
      efficiency_reliability: round(efficiencyReliability, 5),
      field_factors: fieldFactors,
    },
  };
}

function targetAffinity(absentPosition, recipientPosition) {
  const affinity = {
    WR: { WR: 1, TE: 0.65, RB: 0.4 },
    TE: { TE: 1, WR: 0.75, RB: 0.35 },
    RB: { RB: 1, WR: 0.35, TE: 0.35 },
  };
  return affinity[absentPosition]?.[recipientPosition] || 0;
}

function carryAffinity(absentPosition, recipientPosition) {
  if (absentPosition === "RB") return recipientPosition === "RB" ? 1 : 0;
  if (absentPosition === "WR")
    return recipientPosition === "WR" ? 1 : recipientPosition === "RB" ? 0.35 : 0;
  return 0;
}

function isUnavailable(player, settings = {}) {
  const availability = player.forecast?.availability || {};
  const status = String(availability.status || "").toLowerCase();
  const unavailableStatuses = new Set(
    settings.confirmed_unavailable_statuses || ["out"],
  );
  return (
    availability.applies_to_this_week === true &&
    finite(availability.player_factor, 1) === 0 &&
    unavailableStatuses.has(status)
  );
}

function isUnavailableForPlay(player) {
  const availability = player.forecast?.availability || {};
  const status = String(availability.status || "").toLowerCase();
  return (
    availability.applies_to_this_week === true &&
    (finite(availability.player_factor, 1) === 0 ||
      new Set(["out", "ir", "pup", "suspended"]).has(status))
  );
}

function opportunity(player, field) {
  return Math.max(
    0,
    finite(player.forecast?.opportunity_projection?.[field]),
  );
}

function allocationWeight(player, opportunityField, affinity) {
  const volume = Math.max(0.25, opportunity(player, opportunityField));
  const depth = Math.max(1, finite(player.depth_chart_order, 3));
  const depthFactor = 1 / (1 + 0.15 * (depth - 1));
  return volume ** 0.75 * affinity * depthFactor;
}

function allocateVacatedOpportunity(players, settings) {
  const allocation = new Map(
    players.map((player) => [
      player.player_id || `${player.name}|${player.position}`,
      {
        added_targets: 0,
        added_carries: 0,
        absent_players: new Set(),
      },
    ]),
  );
  const absences = players.filter((player) => isUnavailable(player, settings));
  const active = players.filter((player) => !isUnavailableForPlay(player));
  const minimum = finite(settings.minimum_vacated_opportunities, 2);

  for (const absent of absences) {
    const absentTargets = opportunity(absent, "projected_targets");
    const absentCarries = opportunity(absent, "projected_carries");
    if (absentTargets + absentCarries < minimum) continue;
    const absentIdentity = absent.player_id || absent.name;

    if (absentTargets > 0 && targetPositions.has(absent.position)) {
      const recipients = active
        .filter(
          (player) =>
            targetPositions.has(player.position) &&
            opportunity(player, "projected_targets") >=
              finite(settings.minimum_recipient_targets, 1),
        )
        .map((player) => ({
          player,
          weight: allocationWeight(
            player,
            "projected_targets",
            targetAffinity(absent.position, player.position),
          ),
        }))
        .filter((row) => row.weight > 0);
      const totalWeight = recipients.reduce((sum, row) => sum + row.weight, 0);
      const pool = absentTargets * finite(settings.target_redistribution_rate, 0.65);
      for (const recipient of recipients) {
        const key = recipient.player.player_id || `${recipient.player.name}|${recipient.player.position}`;
        const row = allocation.get(key);
        row.added_targets += pool * recipient.weight / Math.max(0.001, totalWeight);
        row.absent_players.add(absentIdentity);
      }
    }

    if (absentCarries > 0) {
      const recipients = active
        .filter(
          (player) =>
            opportunity(player, "projected_carries") >=
            finite(settings.minimum_recipient_carries, 2),
        )
        .map((player) => ({
          player,
          weight: allocationWeight(
            player,
            "projected_carries",
            carryAffinity(absent.position, player.position),
          ),
        }))
        .filter((row) => row.weight > 0);
      const totalWeight = recipients.reduce((sum, row) => sum + row.weight, 0);
      const pool = absentCarries * finite(settings.carry_redistribution_rate, 0.8);
      for (const recipient of recipients) {
        const key = recipient.player.player_id || `${recipient.player.name}|${recipient.player.position}`;
        const row = allocation.get(key);
        row.added_carries += pool * recipient.weight / Math.max(0.001, totalWeight);
        row.absent_players.add(absentIdentity);
      }
    }
  }
  return { allocation, absences };
}

function pointsPerOpportunity(player, scoring) {
  const line = player.forecast?.stat_line || {};
  const targets = Math.max(0.1, finite(line.rec_tgt));
  const carries = Math.max(0.1, finite(line.rush_att));
  const receptionPoints = scoring === "ppr" ? 1 : scoring === "half" ? 0.5 : 0;
  return {
    target:
      finite(line.rec) / targets * receptionPoints +
      finite(line.rec_yd) / targets * 0.1 +
      finite(line.rec_td) / targets * 6,
    carry:
      finite(line.rush_yd) / carries * 0.1 +
      finite(line.rush_td) / carries * 6,
  };
}

function roleProjection(player, row, settings) {
  const projections = player.forecast?.projections || {};
  if (
    isUnavailableForPlay(player) ||
    (!row.added_targets && !row.added_carries)
  ) {
    return {
      projections: { ...projections },
      context: {
        triggered: false,
        factor: 1,
        added_targets: 0,
        added_carries: 0,
        absent_players: [],
      },
    };
  }
  const oldSimpleFactor = Math.max(
    1,
    finite(player.forecast?.availability?.teammate_opportunity_factor, 1),
  );
  const maximum = finite(settings.maximum_recipient_increase_factor, 1.35);
  const next = {};
  for (const format of ["ppr", "half", "std"]) {
    const current = finite(projections[format]);
    const baseWithoutSimpleBoost = current / oldSimpleFactor;
    const value = pointsPerOpportunity(player, format);
    const added = row.added_targets * value.target + row.added_carries * value.carry;
    next[format] = round(
      clamp(
        baseWithoutSimpleBoost + added,
        0,
        baseWithoutSimpleBoost * maximum,
      ),
      3,
    );
  }
  return {
    projections: next,
    context: {
      triggered: true,
      factor: round(next.ppr / Math.max(0.001, finite(projections.ppr)), 5),
      replaced_simple_factor: round(oldSimpleFactor, 5),
      added_targets: round(row.added_targets, 3),
      added_carries: round(row.added_carries, 3),
      absent_players: [...row.absent_players].sort(),
    },
  };
}

function teamVolumeFactors(players, definition) {
  const groupMinimum = finite(definition.group_minimum_ppr, 1);
  const totals = new Map();
  for (const player of players) {
    if (finite(player.forecast?.projections?.ppr) < groupMinimum) continue;
    const row = totals.get(player.team) || { targets: 0, carries: 0 };
    row.targets += opportunity(player, "target_share");
    row.carries += opportunity(player, "carry_share");
    totals.set(player.team, row);
  }
  return new Map(
    players.map((player) => {
      const settings = definition.settings_by_position?.[player.position] || {};
      const identity = player.player_id || `${player.name}|${player.position}`;
      if (player.position === "K") return [identity, 1];
      const group = totals.get(player.team) || { targets: 0, carries: 0 };
      const targetShare = opportunity(player, "target_share");
      const carryShare = opportunity(player, "carry_share");
      const targetScale = group.targets > 1 ? 1 / group.targets : 1;
      const carryScale = group.carries > 1 ? 1 / group.carries : 1;
      const shareWeight = targetShare + carryShare;
      const reconciled = shareWeight
        ? (targetShare * targetScale + carryShare * carryScale) / shareWeight
        : 1;
      const shareFactor = 1 +
        (reconciled - 1) * finite(settings.share_strength);
      const teamPlays = opportunity(player, "team_plays");
      const paceDelta = teamPlays > 0
        ? clamp(teamPlays / 64 - 1, -0.15, 0.15)
        : 0;
      const paceFactor = 1 + paceDelta * finite(settings.pace_strength);
      return [
        identity,
        clamp(shareFactor * paceFactor, 0.8, 1.2),
      ];
    }),
  );
}

export function buildProjectionShadowArms(players, definition) {
  const teamVolume = teamVolumeFactors(players, definition);
  const byTeam = new Map();
  for (const player of players) {
    const rows = byTeam.get(player.team) || [];
    rows.push(player);
    byTeam.set(player.team, rows);
  }
  const roleByPlayer = new Map();
  for (const teamPlayers of byTeam.values()) {
    const { allocation } = allocateVacatedOpportunity(
      teamPlayers,
      definition.role_redistribution || {},
    );
    for (const player of teamPlayers) {
      const key = player.player_id || `${player.name}|${player.position}`;
      roleByPlayer.set(
        key,
        roleProjection(
          player,
          allocation.get(key) || {
            added_targets: 0,
            added_carries: 0,
            absent_players: new Set(),
          },
          definition.role_redistribution || {},
        ),
      );
    }
  }

  return players.map((player) => {
    const key = player.player_id || `${player.name}|${player.position}`;
    const incumbent = { ...(player.forecast?.projections || {}) };
    const teamFactor = teamVolume.get(key) || 1;
    const role = roleByPlayer.get(key) || {
      projections: incumbent,
      context: { triggered: false, factor: 1, absent_players: [] },
    };
    const adaptationArms = Object.fromEntries(
      Object.entries(definition.in_season_adaptation?.arms || {}).map(
        ([arm, settings]) => {
          const positionSettings =
            settings.settings_by_position?.[player.position] || {};
          const adaptation = adaptCurrentSeasonRole(player, {
            ...(definition.in_season_adaptation || {}),
            ...settings,
            ...positionSettings,
          });
          return [arm, adaptation];
        },
      ),
    );
    const manualTrend = definition.manual_stat_trend
      ? manualStatTrendProjection(player, definition, teamFactor)
      : null;
    const adaptationForCombination = adaptationArms.in_season_adaptation;
    const combinePositions = new Set(definition.manual_stat_trend?.combined_positions || []);
    const combinedAdaptationManual = manualTrend && adaptationForCombination
      ? combinePositions.has(player.position)
        ? combineProjectionDeltas(
            incumbent,
            adaptationForCombination.projections,
            manualTrend.projections,
            finite(definition.manual_stat_trend?.settings?.positions?.[player.position]?.max_total_move_pct, 0.4),
          )
        : manualTrend.projections
      : null;
    const dynamicRos = dynamicRestOfSeasonAnchor(player, definition);
    const correctedPlayer = {
      ...player,
      forecast: {
        ...player.forecast,
        projections: dynamicRos.projections,
        stat_line: dynamicRos.stat_line,
      },
    };
    const correctedAdaptation = adaptationForCombination
      ? adaptCurrentSeasonRole(correctedPlayer, {
          ...(definition.in_season_adaptation || {}),
          ...(definition.in_season_adaptation?.arms?.in_season_adaptation || {}),
          ...(definition.in_season_adaptation?.arms?.in_season_adaptation?.settings_by_position?.[player.position] || {}),
        })
      : null;
    const correctedManual = definition.manual_stat_trend
      ? manualStatTrendProjection(correctedPlayer, definition, teamFactor)
      : null;
    const correctedCombined = correctedManual && correctedAdaptation
      ? combinePositions.has(player.position)
        ? combineProjectionDeltas(
            dynamicRos.projections,
            correctedAdaptation.projections,
            correctedManual.projections,
            finite(definition.manual_stat_trend?.settings?.positions?.[player.position]?.max_total_move_pct, 0.4),
          )
        : correctedManual.projections
      : null;
    const regimeAwareCombined = combinedAdaptationManual && manualTrend && adaptationForCombination && definition.regime_aware_combined
      ? applyRegimeAwareCombined({
          player,
          incumbent,
          manual: manualTrend.projections,
          adaptation: adaptationForCombination.projections,
          combined: combinedAdaptationManual,
          calibration: definition.regime_aware_combined,
        })
      : null;
    return {
      ...player,
      forecast_arms: {
        incumbent,
        team_volume: scaleProjections(incumbent, teamFactor),
        role_redistribution: role.projections,
        combined: scaleProjections(role.projections, teamFactor),
        ...Object.fromEntries(
          Object.entries(adaptationArms).map(([arm, row]) => [
            arm,
            row.projections,
          ]),
        ),
        ...(manualTrend ? { manual_stat_trend: manualTrend.projections } : {}),
        ...(combinedAdaptationManual ? { combined_adaptation_manual: combinedAdaptationManual } : {}),
        ...(definition.dynamic_rest_of_season ? { dynamic_rest_of_season: dynamicRos.projections } : {}),
        ...(correctedAdaptation ? { dynamic_ros_in_season_adaptation: correctedAdaptation.projections } : {}),
        ...(correctedManual ? { dynamic_ros_manual_stat_trend: correctedManual.projections } : {}),
        ...(correctedCombined ? { dynamic_ros_combined: correctedCombined } : {}),
        ...(regimeAwareCombined ? { regime_aware_combined: regimeAwareCombined.projections } : {}),
      },
      shadow_context: {
        team_volume_factor: round(teamFactor, 5),
        role_redistribution: role.context,
        in_season_adaptation: Object.fromEntries(
          Object.entries(adaptationArms).map(([arm, row]) => [
            arm,
            row.context,
          ]),
        ),
        ...(manualTrend ? { manual_stat_trend: manualTrend.context } : {}),
        ...(combinedAdaptationManual ? {
          combined_adaptation_manual: {
            triggered: manualTrend.context.triggered || adaptationForCombination.context.triggered,
            method: combinePositions.has(player.position)
              ? "bounded additive deltas versus the same frozen incumbent"
              : "manual-only passthrough where stacking did not improve retrospective accuracy",
          },
        } : {}),
        ...(definition.dynamic_rest_of_season ? { dynamic_rest_of_season: dynamicRos.context } : {}),
        ...(correctedAdaptation ? { dynamic_ros_in_season_adaptation: correctedAdaptation.context } : {}),
        ...(correctedManual ? { dynamic_ros_manual_stat_trend: correctedManual.context } : {}),
        ...(correctedCombined ? { dynamic_ros_combined: { triggered: dynamicRos.context.triggered || correctedManual.context.triggered || correctedAdaptation.context.triggered } } : {}),
        ...(regimeAwareCombined ? { regime_aware_combined: regimeAwareCombined.context } : {}),
      },
    };
  });
}
