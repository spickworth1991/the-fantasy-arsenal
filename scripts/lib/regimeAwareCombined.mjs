const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const round = (value, places = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(places)) : null;

export const REGIME_FEATURE_GROUPS = {
  core: [
    "log_projection",
    "completed_games",
    "manual_delta_ratio",
    "adaptation_delta_ratio",
    "combined_delta_ratio",
    "arm_agreement",
    "arm_disagreement",
    "arm_delta_gap",
    "sample_reliability",
    "positive_combined_delta",
    "negative_combined_delta",
    "agreement_delta_ratio",
    "disagreement_delta_ratio",
    "role_confirmed_delta_ratio",
    "role_conflicted_delta_ratio",
    "recent_role_consensus",
    "history_reliability",
    "opportunity_volatility",
  ],
  role: [
    "recent_form_delta",
    "snap_share",
    "snap_trend",
    "opportunity_share",
    "opportunity_trend",
    "target_share_trend",
    "carry_share_trend",
    "weighted_opportunity_trend",
    "red_zone_share",
    "regime_expansion",
    "regime_contraction",
    "regime_uncertain",
    ...[1, 2, 3].flatMap((window) => [
      `regime_snap_trend_${window}g`,
      `regime_opportunity_trend_${window}g`,
      `regime_target_share_trend_${window}g`,
      `regime_carry_share_trend_${window}g`,
      `regime_red_zone_share_trend_${window}g`,
    ]),
  ],
  context: [
    "team_pace_delta",
    "offense_play_volume_delta",
    "offense_pass_rate",
    "offense_red_zone_play_rate",
    "defense_points_delta",
    "defense_volume_delta",
    "personal_delta",
    "advanced_reliability",
  ],
};

function regimeDirection(features = {}) {
  const signals = [1, 2, 3].flatMap((window) => [
    finite(features[`regime_snap_trend_${window}g`], NaN),
    finite(features[`regime_opportunity_trend_${window}g`], NaN),
    finite(features[`regime_target_share_trend_${window}g`], NaN),
    finite(features[`regime_carry_share_trend_${window}g`], NaN),
  ]).filter(Number.isFinite);
  const positive = signals.filter((value) => value >= 0.03);
  const negative = signals.filter((value) => value <= -0.03);
  const strongestPositive = positive.length ? Math.max(...positive) : 0;
  const strongestNegative = negative.length ? Math.min(...negative) : 0;
  const expansion = positive.length >= 2 && strongestPositive >= 0.06;
  const contraction = negative.length >= 2 && strongestNegative <= -0.06;
  const uncertain = !expansion && !contraction && signals.some((value) => Math.abs(value) >= 0.08);
  return { expansion, contraction, uncertain };
}

export function regimeFeatureVector({
  sourceFeatures = {},
  completedGames = 0,
  incumbent = 0,
  manual = 0,
  adaptation = 0,
  combined = 0,
}) {
  const denominator = Math.max(5, Math.abs(finite(incumbent)));
  const manualDelta = finite(manual, incumbent) - finite(incumbent);
  const adaptationDelta = finite(adaptation, incumbent) - finite(incumbent);
  const combinedDelta = finite(combined, incumbent) - finite(incumbent);
  const manualActive = Math.abs(manualDelta) > 0.01;
  const adaptationActive = Math.abs(adaptationDelta) > 0.01;
  const agreement = manualActive && adaptationActive && Math.sign(manualDelta) === Math.sign(adaptationDelta);
  const disagreement = manualActive && adaptationActive && Math.sign(manualDelta) !== Math.sign(adaptationDelta);
  const regime = regimeDirection(sourceFeatures);
  const recentSignals = [
    sourceFeatures.regime_snap_trend_1g,
    sourceFeatures.regime_opportunity_trend_1g,
    sourceFeatures.regime_target_share_trend_1g,
    sourceFeatures.regime_carry_share_trend_1g,
    sourceFeatures.regime_snap_trend_2g,
    sourceFeatures.regime_opportunity_trend_2g,
    sourceFeatures.regime_target_share_trend_2g,
    sourceFeatures.regime_carry_share_trend_2g,
  ].map(Number).filter(Number.isFinite);
  const recentRoleConsensus = recentSignals.length
    ? recentSignals.reduce((sum, value) => sum + value, 0) / recentSignals.length
    : 0;
  const combinedRatio = combinedDelta / denominator;
  const roleDirection = regime.expansion ? 1 : regime.contraction ? -1 : 0;
  const combinedDirection = Math.sign(combinedDelta);
  const roleConfirmed = roleDirection !== 0 && roleDirection === combinedDirection;
  const roleConflicted = roleDirection !== 0 && combinedDirection !== 0 && roleDirection !== combinedDirection;
  return {
    ...sourceFeatures,
    log_projection: Math.log1p(Math.max(0, finite(incumbent))),
    completed_games: finite(completedGames),
    manual_delta_ratio: manualDelta / denominator,
    adaptation_delta_ratio: adaptationDelta / denominator,
    combined_delta_ratio: combinedRatio,
    arm_agreement: agreement ? 1 : 0,
    arm_disagreement: disagreement ? 1 : 0,
    arm_delta_gap: Math.abs(manualDelta - adaptationDelta) / denominator,
    sample_reliability: finite(completedGames) / (finite(completedGames) + 4),
    positive_combined_delta: Math.max(0, combinedRatio),
    negative_combined_delta: Math.min(0, combinedRatio),
    agreement_delta_ratio: agreement ? combinedRatio : 0,
    disagreement_delta_ratio: disagreement ? combinedRatio : 0,
    role_confirmed_delta_ratio: roleConfirmed ? combinedRatio : 0,
    role_conflicted_delta_ratio: roleConflicted ? combinedRatio : 0,
    recent_role_consensus: clamp(recentRoleConsensus, -0.5, 0.5),
    regime_expansion: regime.expansion ? 1 : 0,
    regime_contraction: regime.contraction ? 1 : 0,
    regime_uncertain: regime.uncertain ? 1 : 0,
  };
}

export function predictRegimeResidual(model, features) {
  if (!model) return 0;
  if (model.model_type === "boosted_stumps") {
    let prediction = finite(model.intercept);
    for (const tree of model.trees || []) {
      const raw = Number(features?.[tree.feature]);
      const value = Number.isFinite(raw) ? raw : finite(tree.missing_value);
      prediction += value <= finite(tree.threshold)
        ? finite(tree.left_value)
        : finite(tree.right_value);
    }
    return clamp(
      prediction * finite(model.strength, 1),
      -finite(model.maximum_residual_shift, 0.12),
      finite(model.maximum_residual_shift, 0.12),
    );
  }
  if (!Array.isArray(model.features)) return 0;
  let prediction = finite(model.intercept);
  model.features.forEach((name, index) => {
    const mean = finite(model.means?.[name]);
    const scale = Math.max(1e-6, finite(model.scales?.[name], 1));
    const raw = Number(features?.[name]);
    const value = Number.isFinite(raw) ? raw : mean;
    prediction += ((value - mean) / scale) * finite(model.coefficients?.[index]);
  });
  return clamp(
    prediction * finite(model.strength, 1),
    -finite(model.maximum_residual_shift, 0.12),
    finite(model.maximum_residual_shift, 0.12),
  );
}

export function applyRegimeAwareCombined({
  player,
  incumbent,
  manual,
  adaptation,
  combined,
  calibration,
}) {
  const model = calibration?.by_position?.[player.position];
  if (!model?.enabled || player.position === "K") {
    return {
      projections: { ...combined },
      context: { triggered: false, reason: model ? "position_passthrough" : "missing_calibration" },
    };
  }
  const sourceFeatures = player.learned_role?.features || {};
  const pprFeatures = regimeFeatureVector({
    sourceFeatures,
    completedGames: player.completed_games,
    incumbent: incumbent.ppr,
    manual: manual.ppr,
    adaptation: adaptation.ppr,
    combined: combined.ppr,
  });
  const disagreement = pprFeatures.arm_disagreement === 1;
  const shrink = disagreement ? finite(model.disagreement_shrink, 0.25) : 1;
  const guarded = Object.fromEntries(["ppr", "half", "std"].map((format) => {
    const base = finite(incumbent?.[format]);
    const value = finite(combined?.[format], base);
    return [format, base + (value - base) * shrink];
  }));
  const residual = predictRegimeResidual(model, pprFeatures);
  const maximumTotalShift = finite(model.maximum_total_shift, 0.4);
  const projections = Object.fromEntries(["ppr", "half", "std"].map((format) => {
    const base = finite(incumbent?.[format]);
    const adjusted = finite(guarded[format], base) * (1 + residual);
    return [format, round(clamp(
      adjusted,
      Math.max(0, base * (1 - maximumTotalShift)),
      base * (1 + maximumTotalShift),
    ), 3)];
  }));
  return {
    projections,
    context: {
      triggered: Math.abs(projections.ppr - finite(combined?.ppr)) >= 0.01,
      method: "pregame role-regime residual correction on the locked combined arm",
      completed_games: finite(player.completed_games),
      arm_agreement: pprFeatures.arm_agreement === 1,
      arm_disagreement: disagreement,
      disagreement_shrink: shrink,
      regime: pprFeatures.regime_expansion
        ? "expansion"
        : pprFeatures.regime_contraction
          ? "contraction"
          : pprFeatures.regime_uncertain
            ? "uncertain"
            : "stable",
      residual_ratio: round(residual, 5),
      feature_version: calibration.feature_version || null,
      missing_feature_count: model.features.filter(
        (name) => !Number.isFinite(Number(pprFeatures[name])),
      ).length,
    },
  };
}
