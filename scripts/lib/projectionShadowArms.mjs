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
    return {
      ...player,
      forecast_arms: {
        incumbent,
        team_volume: scaleProjections(incumbent, teamFactor),
        role_redistribution: role.projections,
        combined: scaleProjections(role.projections, teamFactor),
      },
      shadow_context: {
        team_volume_factor: round(teamFactor, 5),
        role_redistribution: role.context,
      },
    };
  });
}
