import assert from "node:assert/strict";
import { buildProjectionShadowArms } from "./lib/projectionShadowArms.mjs";

const definition = {
  model_type: "projection_experiment_suite",
  group_minimum_ppr: 1,
  settings_by_position: {
    QB: { share_strength: 0.25, pace_strength: 1 },
    RB: { share_strength: 1, pace_strength: 0.5 },
    WR: { share_strength: 1, pace_strength: 1 },
    TE: { share_strength: 1, pace_strength: 1 },
    K: { share_strength: 0, pace_strength: 0 },
  },
  role_redistribution: {
    target_redistribution_rate: 0.65,
    carry_redistribution_rate: 0.8,
    minimum_vacated_opportunities: 2,
    minimum_recipient_targets: 1,
    minimum_recipient_carries: 2,
    maximum_recipient_increase_factor: 1.35,
    confirmed_unavailable_statuses: ["out"],
  },
  in_season_adaptation: {
    minimum_games: 3,
    volume_prior_games: 4,
    efficiency_prior_games: 16,
    maximum_field_shift: 0.3,
    maximum_rate_shift: 0.16,
    arms: {
      adaptive_balanced: { application_strength: 0.8 },
    },
  },
  dynamic_rest_of_season: {
    minimum_games: 2,
    settings_by_position: {
      QB: { enabled: true, application_strength: 0.8, volume_prior_games: 4, efficiency_prior_games: 12, touchdown_prior_games: 24, volume_strength: 0.6, efficiency_strength: 0.3, touchdown_strength: 0.12, maximum_volume_shift: 0.35, maximum_efficiency_rate_shift: 0.15, maximum_touchdown_rate_shift: 0.12, maximum_total_shift: 0.6 },
    },
  },
};

const forecast = ({
  ppr,
  targets,
  carries = 0,
  targetShare,
  carryShare = 0,
  status = null,
  playerFactor = 1,
  teammateFactor = 1,
}) => ({
  kickoff: "2026-09-25T00:15:00.000Z",
  projections: { ppr, half: ppr - 2, std: ppr - 4 },
  stat_line: {
    rec_tgt: targets,
    rec: targets * 0.65,
    rec_yd: targets * 8,
    rec_td: targets * 0.055,
    rush_att: carries,
    rush_yd: carries * 4.2,
    rush_td: carries * 0.035,
  },
  opportunity_projection: {
    team_plays: 65,
    projected_targets: targets,
    projected_carries: carries,
    target_share: targetShare,
    carry_share: carryShare,
  },
  availability: {
    status,
    applies_to_this_week: true,
    player_factor: playerFactor,
    teammate_opportunity_factor: teammateFactor,
  },
});

const players = [
  {
    player_id: "puka",
    name: "Unavailable WR1",
    team: "LAR",
    position: "WR",
    depth_chart_order: 1,
    forecast: forecast({
      ppr: 0,
      targets: 9,
      targetShare: 0.29,
      status: "out",
      playerFactor: 0,
    }),
  },
  {
    player_id: "adams",
    name: "Active WR2",
    team: "LAR",
    position: "WR",
    depth_chart_order: 2,
    forecast: forecast({
      ppr: 13.2,
      targets: 7,
      targetShare: 0.25,
      teammateFactor: 1.1,
    }),
  },
  {
    player_id: "te",
    name: "Active TE",
    team: "LAR",
    position: "TE",
    depth_chart_order: 1,
    forecast: forecast({ ppr: 8, targets: 4, targetShare: 0.14, teammateFactor: 1.1 }),
  },
  {
    player_id: "rb",
    name: "Active RB",
    team: "LAR",
    position: "RB",
    depth_chart_order: 1,
    forecast: forecast({
      ppr: 14,
      targets: 3,
      carries: 15,
      targetShare: 0.1,
      carryShare: 0.62,
      teammateFactor: 1.1,
    }),
  },
];

const result = buildProjectionShadowArms(players, definition);
const wr1 = result.find((player) => player.player_id === "puka");
const wr2 = result.find((player) => player.player_id === "adams");
const affected = result.filter(
  (player) => player.shadow_context.role_redistribution.triggered,
);

assert.equal(wr1.forecast_arms.role_redistribution.ppr, 0);
assert.ok(wr2.forecast_arms.role_redistribution.ppr > wr2.forecast_arms.incumbent.ppr);
assert.ok(
  wr2.forecast_arms.role_redistribution.ppr <=
    wr2.forecast_arms.incumbent.ppr / 1.1 * 1.35 + 0.001,
);
assert.ok(affected.length >= 2);
assert.ok(
  affected.reduce(
    (sum, player) =>
      sum + player.shadow_context.role_redistribution.added_targets,
    0,
  ) <= 9 * 0.65 + 0.01,
);
assert.deepEqual(
  wr2.forecast_arms.combined,
  Object.fromEntries(
    Object.entries(wr2.forecast_arms.role_redistribution).map(([key, value]) => [
      key,
      Number((value * wr2.shadow_context.team_volume_factor).toFixed(3)),
    ]),
  ),
);

const healthy = players.map((player) => ({
  ...player,
  forecast: {
    ...player.forecast,
    availability: {
      ...player.forecast.availability,
      status: null,
      player_factor: 1,
      teammate_opportunity_factor: 1,
    },
  },
}));
const healthyResult = buildProjectionShadowArms(healthy, definition);
for (const player of healthyResult) {
  assert.deepEqual(
    player.forecast_arms.role_redistribution,
    player.forecast_arms.incumbent,
  );
  assert.equal(player.shadow_context.role_redistribution.triggered, false);
}

const seasonLongAbsence = players.map((player) =>
  player.player_id === "puka"
    ? {
        ...player,
        forecast: {
          ...player.forecast,
          availability: {
            ...player.forecast.availability,
            status: "ir",
            player_factor: 0,
          },
        },
      }
    : player,
);
const seasonLongResult = buildProjectionShadowArms(seasonLongAbsence, definition);
for (const player of seasonLongResult) {
  assert.deepEqual(
    player.forecast_arms.role_redistribution,
    player.forecast_arms.incumbent,
  );
  assert.equal(player.shadow_context.role_redistribution.triggered, false);
}

const repeat = buildProjectionShadowArms(players, definition);
assert.deepEqual(result, repeat);

const quarterback = {
  player_id: "qb",
  name: "Changing QB",
  team: "CLE",
  position: "QB",
  completed_games: 5,
  actual_stat_line: {
    pass_att: 160,
    pass_cmp: 104,
    pass_yd: 1120,
    pass_td: 7,
    pass_int: 3,
    rush_att: 30,
    rush_yd: 170,
    rush_td: 2,
  },
  forecast: {
    ...forecast({ ppr: 10, targets: 0, targetShare: 0 }),
    projections: { ppr: 10, half: 10, std: 10 },
    stat_line: {
      pass_att: 22,
      pass_cmp: 14,
      pass_yd: 150,
      pass_td: 0.9,
      pass_int: 0.5,
      rush_att: 3,
      rush_yd: 15,
      rush_td: 0.08,
    },
  },
};
const adaptedQuarterback = buildProjectionShadowArms(
  [quarterback],
  definition,
)[0];
assert.ok(
  adaptedQuarterback.forecast_arms.adaptive_balanced.ppr >
    adaptedQuarterback.forecast_arms.incumbent.ppr,
);
assert.equal(
  adaptedQuarterback.shadow_context.in_season_adaptation.adaptive_balanced.triggered,
  true,
);

const positionControlled = buildProjectionShadowArms([quarterback], {
  ...definition,
  in_season_adaptation: {
    arms: {
      controlled: {
        settings_by_position: { QB: { enabled: false } },
      },
    },
  },
})[0];
assert.deepEqual(
  positionControlled.forecast_arms.controlled,
  positionControlled.forecast_arms.incumbent,
);
assert.equal(
  positionControlled.shadow_context.in_season_adaptation.controlled.reason,
  "position_disabled_by_validation",
);

const manualTrendQuarterback = buildProjectionShadowArms([quarterback], {
  model_type: "projection_experiment_suite",
  settings_by_position: { QB: { share_strength: 0, pace_strength: 0 } },
  dynamic_rest_of_season: {
    minimum_games: 2,
    settings_by_position: {
      QB: { enabled: true, application_strength: 0.8, volume_prior_games: 4, efficiency_prior_games: 12, touchdown_prior_games: 24, volume_strength: 0.6, efficiency_strength: 0.3, touchdown_strength: 0.12, maximum_volume_shift: 0.35, maximum_efficiency_rate_shift: 0.15, maximum_touchdown_rate_shift: 0.12, maximum_total_shift: 0.6 },
    },
  },
  in_season_adaptation: {
    minimum_games: 3,
    arms: {
      in_season_adaptation: {
        settings_by_position: {
          QB: { enabled: true, volume_prior_games: 4, efficiency_prior_games: 12, volume_strength: 0.5, efficiency_strength: 0, maximum_field_shift: 0.25, maximum_rate_shift: 0.16 },
        },
      },
    },
  },
  manual_stat_trend: {
    combined_positions: ["QB"],
    baseline_by_player: { qb: { week: 1, stat_line: quarterback.forecast.stat_line } },
    settings: {
      minimum_games: 1,
      positions: {
        QB: {
          enabled: true,
          minimum_games: 1,
          overall_weight: 1,
          max_total_move_pct: 0.4,
          role_multipliers: { established_starter: 1 },
          stats: {
            pass_att: { enabled: true, minimum_games: 1, up_weight: 1, down_weight: 1, prior_games: 1, max_stat_move_pct: 0.4 },
          },
        },
      },
    },
  },
  regime_aware_combined: {
    feature_version: "fixture-v1",
    by_position: {
      QB: {
        enabled: true,
        features: ["completed_games", "arm_agreement"],
        means: { completed_games: 3, arm_agreement: 0 },
        scales: { completed_games: 2, arm_agreement: 1 },
        intercept: -0.02,
        coefficients: [0, 0],
        strength: 1,
        maximum_residual_shift: 0.1,
        maximum_total_shift: 0.4,
        disagreement_shrink: 0.25,
      },
    },
  },
})[0];
assert.ok(manualTrendQuarterback.forecast_arms.manual_stat_trend.ppr > 10);
assert.equal(manualTrendQuarterback.shadow_context.manual_stat_trend.triggered, true);
assert.ok(Number.isFinite(manualTrendQuarterback.forecast_arms.combined_adaptation_manual.ppr));
assert.ok(Number.isFinite(manualTrendQuarterback.forecast_arms.dynamic_rest_of_season.ppr));
assert.ok(Number.isFinite(manualTrendQuarterback.forecast_arms.dynamic_ros_in_season_adaptation.ppr));
assert.ok(Number.isFinite(manualTrendQuarterback.forecast_arms.dynamic_ros_manual_stat_trend.ppr));
assert.ok(Number.isFinite(manualTrendQuarterback.forecast_arms.dynamic_ros_combined.ppr));
assert.equal(manualTrendQuarterback.shadow_context.combined_adaptation_manual.triggered, true);
assert.ok(
  manualTrendQuarterback.forecast_arms.regime_aware_combined.ppr <
    manualTrendQuarterback.forecast_arms.combined_adaptation_manual.ppr,
);
assert.equal(
  manualTrendQuarterback.shadow_context.regime_aware_combined.feature_version,
  "fixture-v1",
);

console.log(
  `Projection shadow-arm tests: PASS (${result.length} fixture players, ${affected.length} affected recipients, QB/manual/regime adaptation verified).`,
);
