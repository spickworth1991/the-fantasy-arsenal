const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export function evaluateSerializedPositionModel(model, features = {}) {
  if (!model)
    return { raw_delta: 0, bounded_delta: 0, available_features: 0 };
  let rawDelta = number(model.intercept);
  let availableFeatures = 0;
  const observed = new Set();
  Object.keys(model.features || {}).forEach((feature) => {
    const value = features?.[feature];
    if (value !== null && Number.isFinite(Number(value))) observed.add(feature);
  });
  availableFeatures = observed.size;
  if (model.model_type === "boosted_stumps") {
    for (const tree of model.trees || []) {
      const settings = model.features?.[tree.feature] || {};
      const value = observed.has(tree.feature)
        ? Number(features[tree.feature])
        : number(settings.mean);
      rawDelta +=
        value <= number(tree.threshold) ? number(tree.left) : number(tree.right);
    }
  } else {
    for (const [feature, settings] of Object.entries(model.features || {})) {
      const value = observed.has(feature)
        ? Number(features[feature])
        : number(settings.mean);
      const normalized =
        (value - number(settings.mean)) /
        Math.max(0.000001, number(settings.scale) || 1);
      rawDelta += normalized * number(settings.coefficient);
    }
  }
  return {
    raw_delta: rawDelta,
    bounded_delta: clamp(rawDelta, -0.35, 0.45),
    available_features: availableFeatures,
  };
}

export function trainedAdjustmentFromCalibration(
  position,
  calibration,
  features = {},
) {
  const model = calibration?.by_position?.[position];
  if (!model || number(model.holdout_mae_improvement) <= 0)
    return {
      factor: 1,
      raw_delta: 0,
      bounded_delta: 0,
      available_features: 0,
      model: null,
    };
  const evaluated = evaluateSerializedPositionModel(model, features);
  return {
    ...evaluated,
    factor: clamp(
      1 + evaluated.bounded_delta * number(model.application_strength),
      0.65,
      1.45,
    ),
    model,
  };
}
