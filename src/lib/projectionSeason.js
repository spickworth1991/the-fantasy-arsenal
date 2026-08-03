export const PROJECTION_DATA_SEASON = new Date().getUTCFullYear();
export const PROJ_JSON_URL = `/projections_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_ESPN_JSON_URL = `/projections_espn_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_CBS_JSON_URL = `/projections_cbs_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_SLEEPER_JSON_URL = `/projections_sleeper_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_FANTASYSHARKS_JSON_URL = `/projections_fantasysharks_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_DRAFTSHARKS_JSON_URL = `/projections_draftsharks_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_FANTASYPROS_JSON_URL = `/projections_fantasypros_${PROJECTION_DATA_SEASON}.json`;
// Keep PROJ_ARSENAL_JSON_URL as the legacy identity for saved source choices.
// It is the published average, while the model URL is Arsenal's own Safe/Expected projection.
export const PROJ_AVERAGE_JSON_URL = `/projections_thefantasyarsenal_${PROJECTION_DATA_SEASON}.json`;
export const PROJ_ARSENAL_JSON_URL = PROJ_AVERAGE_JSON_URL;
export const PROJ_ARSENAL_MODEL_JSON_URL = `/projections_thefantasyarsenal_model_${PROJECTION_DATA_SEASON}.json`;
