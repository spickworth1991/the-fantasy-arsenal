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

console.log(
  `Projection shadow-arm tests: PASS (${result.length} fixture players, ${affected.length} affected recipients).`,
);
