import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const scriptFile = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(scriptFile), "..");
const season =
  Number(
    process.argv
      .find((argument) => argument.startsWith("--season="))
      ?.split("=")[1],
  ) || new Date().getUTCFullYear();
const archive = process.argv.includes("--archive");
const consensusAnchorFile = path.join(
  root,
  "public",
  "stats",
  "projections",
  String(season),
  "consensus-anchor.json",
);
const compactProjectionFile = path.join(
  root,
  "public",
  `projections_thefantasyarsenal_model_${season}.json`,
);
const MODEL_VERSION = "arsenal-stat-v3.3";
const MODEL_SCHEMA = 13;
const FEATURE_VERSION = "arsenal-features-v3.1";
const MODEL_BUILD_HASH = crypto
  .createHash("sha256")
  .update(fs.readFileSync(scriptFile))
  .digest("hex")
  .slice(0, 12);
const MODEL_BUILD_ID = `${MODEL_VERSION}.${MODEL_BUILD_HASH}`;
const scoringKeys = ["ppr", "half", "std"];
const positions = new Set(["QB", "RB", "WR", "TE", "K"]);
const statFields = [
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rec_tgt",
  "rec",
  "rec_yd",
  "rec_td",
  "fum_lost",
  "fgm",
  "fga",
  "xpm",
  "xpa",
  "kick_pts",
];
const usageFields = [
  "off_snp",
  "tm_off_snp",
  "pass_rz_att",
  "rush_rz_att",
  "rec_rz_tgt",
  "rec_air_yd",
];
const opportunityFeatureNames = [
  "target_share",
  "target_share_trend",
  "carry_share",
  "carry_share_trend",
  "weighted_opportunity_share",
  "weighted_opportunity_trend",
  "high_value_touch_rate",
  "two_minute_opportunity_rate",
  "third_down_opportunity_rate",
  "opportunity_volatility",
  "receiving_epa_per_target",
  "rushing_epa_per_carry",
  "ngs_cpoe",
  "ngs_separation",
  "ngs_yac_over_expected",
  "ngs_ryoe_per_carry",
  "ngs_box_eight_rate",
];
const advancedFeatureNames = [
  "protection_pressure_rate",
  "protection_sack_rate",
  "opponent_pressure_rate",
  "opponent_sack_rate",
  "pressure_mismatch",
  "opponent_blitz_rate",
  "ol_stability",
  "ol_continuity",
  "time_to_throw",
  "offense_motion_rate",
  "offense_play_action_rate",
  "offense_screen_rate",
  "offense_rpo_rate",
  "opponent_man_rate",
  "opponent_zone_rate",
  "offense_epa_per_play",
  "offense_success_rate",
  "offense_pass_rate",
  "offense_red_zone_play_rate",
  "opponent_epa_per_play_allowed",
  "opponent_success_rate_allowed",
  "opponent_pass_rate_faced",
  "opponent_red_zone_play_rate_allowed",
  "epa_matchup",
  "success_matchup",
  "offense_neutral_pass_rate",
  "offense_two_minute_rate",
  "offense_third_down_success_rate",
  "offense_play_volume_delta",
  "market_implied_points_delta",
  "market_spread_scaled",
  "advanced_reliability",
];
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round = (value, places = 3) => Number(num(value).toFixed(places));
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const normalizeTeam = (team) =>
  ({ OAK: "LV", SD: "LAC", STL: "LAR", JAX: "JAC", WSH: "WAS" })[
    String(team || "").toUpperCase()
  ] || String(team || "").toUpperCase();
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
const playerKey = (player) =>
  `${normalizeName(player?.name)}|${String(player?.position || "").toUpperCase()}`;
function buildCanonicalKeyResolver(players) {
  const exact = new Map(
    (players || []).map((player) => [playerKey(player), playerKey(player)]),
  );
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
    const canonical = keys.find((key) => exact.has(key));
    if (!canonical) continue;
    keys.forEach((key) => reviewedAliases.set(key, canonical));
  }
  return (row) => {
    const direct = exact.get(playerKey(row));
    if (direct) return direct;
    const alias = reviewedAliases.get(playerKey(row));
    return (alias && exact.get(alias)) || playerKey(row);
  };
}
const cleanLine = (line = {}) =>
  Object.fromEntries(
    statFields.map((field) => [field, round(Math.max(0, num(line[field])))]),
  );
const sparseLine = (line = {}) =>
  Object.fromEntries(
    Object.entries(cleanLine(line)).filter(([, value]) => value !== 0),
  );
const coherentLine = (line = {}) => {
  const next = cleanLine(line);
  next.pass_cmp = Math.min(next.pass_cmp, next.pass_att);
  next.pass_td = Math.min(next.pass_td, next.pass_att);
  next.pass_int = Math.min(next.pass_int, next.pass_att);
  next.rush_td = Math.min(next.rush_td, next.rush_att);
  next.rec = Math.min(next.rec, next.rec_tgt);
  next.rec_td = Math.min(next.rec_td, next.rec);
  next.fgm = Math.min(next.fgm, next.fga);
  next.xpm = Math.min(next.xpm, next.xpa);
  return next;
};
const fingerprintFile = (file) => {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  let updated = null;
  if (path.extname(file).toLowerCase() === ".json") {
    try {
      const payload = JSON.parse(raw.toString("utf8"));
      updated =
        payload?.updated || payload?.updated_at || payload?.generated_at || null;
    } catch {}
  }
  return {
    path: path.relative(root, file).replace(/\\/g, "/"),
    bytes: raw.length,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    updated,
  };
};

async function enrichScheduleWeather(schedule, savedFile) {
  const stadiumData = readJson(
    path.join(root, "src", "data", "nfl-stadiums.json"),
    { stadiums: [] },
  );
  const stadiumByTeam = new Map(
    (stadiumData.stadiums || []).flatMap((stadium) =>
      [...(stadium.teams || []), ...(stadium.aliases || [])].map((team) => [
        normalizeTeam(team),
        stadium,
      ]),
    ),
  );
  const candidates = [];
  const weeks = (schedule.weeks || []).map((entry) => ({
    ...entry,
    games: (entry.games || []).map((game) => {
      const stadium = stadiumByTeam.get(normalizeTeam(game.home));
      const enriched = {
        ...game,
        venue: stadium
          ? { name: stadium.name, roofType: stadium.roofType }
          : game.venue || null,
      };
      const daysAway = (Date.parse(game.date) - Date.now()) / 86400000;
      if (
        stadium &&
        stadium.roofType !== "fixed" &&
        Number.isFinite(daysAway) &&
        daysAway >= -1 &&
        daysAway <= 16
      )
        candidates.push({ entry, game: enriched, stadium });
      return enriched;
    }),
  }));
  if (!candidates.length) return { ...schedule, weeks };
  try {
    const parameters = new URLSearchParams({
      latitude: candidates.map(({ stadium }) => stadium.latitude).join(","),
      longitude: candidates.map(({ stadium }) => stadium.longitude).join(","),
      hourly:
        "temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      timezone: "GMT",
      forecast_days: "16",
    });
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${parameters}`,
    );
    if (!response.ok) return { ...schedule, weeks };
    const payload = await response.json();
    const forecasts = Array.isArray(payload) ? payload : [payload];
    const weatherByGame = new Map();
    candidates.forEach(({ entry, game, stadium }, index) => {
      const hourly = forecasts[index]?.hourly;
      const kickoff = Date.parse(game.date);
      let nearest = -1;
      let distance = Infinity;
      (hourly?.time || []).forEach((time, cursor) => {
        const delta = Math.abs(Date.parse(`${time}Z`) - kickoff);
        if (delta < distance) {
          nearest = cursor;
          distance = delta;
        }
      });
      if (nearest < 0 || distance > 90 * 60 * 1000) return;
      weatherByGame.set(`${entry.week}:${game.home}`, {
        source: "Open-Meteo",
        temperature: num(hourly.temperature_2m?.[nearest]),
        precipitationProbability: num(
          hourly.precipitation_probability?.[nearest],
        ),
        windSpeed: num(hourly.wind_speed_10m?.[nearest]),
        windGusts: num(hourly.wind_gusts_10m?.[nearest]),
        forecastTime: hourly.time[nearest],
        indoor: stadium.roofType === "fixed",
      });
    });
    const result = {
      ...schedule,
      weather_updated: new Date().toISOString(),
      weeks: weeks.map((entry) => ({
        ...entry,
        games: entry.games.map((game) => ({
          ...game,
          weather: weatherByGame.get(`${entry.week}:${game.home}`) || null,
        })),
      })),
    };
    writeJson(savedFile, result);
    return result;
  } catch {
    return { ...schedule, weeks };
  }
}

async function loadSchedule() {
  const saved = path.join(
    root,
    "public",
    "stats",
    "projections",
    String(season),
    "schedule.json",
  );
  const existing = readJson(saved);
  const existingUpdatedAt = Date.parse(existing?.updated);
  if (
    existing?.weeks?.some((week) => week.games?.length) &&
    Number.isFinite(existingUpdatedAt) &&
    Date.now() - existingUpdatedAt < 12 * 60 * 60 * 1000
  )
    return enrichScheduleWeather(existing, saved);
  const existingByWeek = new Map(
    (existing?.weeks || []).map((week) => [Number(week.week), week]),
  );
  const weeks = await Promise.all(
    Array.from({ length: 18 }, async (_, index) => {
      const week = index + 1;
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`,
        );
        if (!response.ok)
          return existingByWeek.get(week) || { week, games: [] };
        const payload = await response.json();
        const refreshed = {
          week,
          games: (payload?.events || [])
            .map((event) => {
              const competition = event?.competitions?.[0] || {};
              const competitors = competition.competitors || [];
              const home = competitors.find((team) => team.homeAway === "home")
                ?.team?.abbreviation;
              const away = competitors.find((team) => team.homeAway === "away")
                ?.team?.abbreviation;
              const odds = competition.odds?.[0];
              const rawSpread = Number(odds?.spread);
              const total = Number(odds?.overUnder);
              const homeFavorite = Boolean(odds?.homeTeamOdds?.favorite);
              const market = Number.isFinite(rawSpread) && Number.isFinite(total)
                ? {
                    source: odds?.provider?.name || "ESPN odds feed",
                    total,
                    home_spread: (homeFavorite ? 1 : -1) * Math.abs(rawSpread),
                    details: odds?.details || null,
                  }
                : null;
              return home && away
                ? {
                    home: normalizeTeam(home),
                    away: normalizeTeam(away),
                    date: event.date || null,
                    market,
                  }
                : null;
            })
            .filter(Boolean),
        };
        return refreshed.games.length
          ? refreshed
          : existingByWeek.get(week) || refreshed;
      } catch {
        return existingByWeek.get(week) || { week, games: [] };
      }
    }),
  );
  const result = {
    source: "ESPN public NFL scoreboard",
    season,
    updated: new Date().toISOString(),
    weeks,
  };
  writeJson(saved, result);
  return enrichScheduleWeather(result, saved);
}

function projectionLine(source, row) {
  const stats = row?.stats || {};
  const projected = row?.projections || {};
  const position = String(row?.position || "").toUpperCase();
  const line = {};
  if (source === "FantasyPros") {
    Object.assign(line, {
      games: stats.games || row.games || 17,
      pass_att: stats.pass_att,
      pass_cmp: stats.pass_cmp,
      pass_yd: stats.pass_yds,
      pass_td: stats.pass_tds,
      pass_int: stats.pass_ints,
      rush_att: stats.rush_att,
      rush_yd: stats.rush_yds,
      rush_td: stats.rush_tds,
      rec_tgt: stats.rec_tgt || stats.targets,
      rec: stats.rec_rec || stats.receptions,
      rec_yd: stats.rec_yds,
      rec_td: stats.rec_tds,
      fum_lost: num(stats.fumbles_lost) || num(stats.fumbles) * 0.5,
      fgm: stats.fgm ?? stats.fg,
      fga: stats.fga,
      xpm: stats.xpm ?? stats.xpt,
      xpa: stats.xpa ?? stats.xpt,
      kick_pts: position === "K" ? stats.points : 0,
    });
  } else if (source === "DraftSharks") {
    Object.assign(line, {
      games: projected.games_played || 17,
      pass_att: projected.pass_att,
      pass_cmp: projected.pass_cmp,
      pass_yd: projected.pass_yds,
      pass_td: projected.pass_tds,
      pass_int: projected.pass_int,
      rush_att: projected.rush_att,
      rush_yd: projected.rush_yds,
      rush_td: projected.rush_tds,
      rec_tgt: projected.rec_tgt || projected.targets,
      rec: projected.rec_catch,
      rec_yd: projected.rec_yds,
      rec_td: projected.rec_tds,
      fum_lost: projected.fum_lost,
      fgm: [
        projected.k_fg_0_29,
        projected.k_fg_30_39,
        projected.k_fg_40_49,
        projected.k_fg_50_59,
        projected.k_fg_60,
      ].reduce((sum, value) => sum + num(value), 0),
      xpm: projected.k_xp,
      kick_pts: position === "K" ? projected.kickingTotal : 0,
    });
  } else if (source === "FantasySharks") {
    Object.assign(line, {
      games: stats.games || 17,
      pass_att: stats.pass_att,
      pass_cmp: stats.pass_cmp,
      pass_yd: stats.pass_yds,
      pass_td: stats.pass_tds,
      pass_int: stats.pass_ints,
      rush_att: stats.rush_att,
      rush_yd: stats.rush_yds,
      rush_td: stats.rush_tds,
      rec_tgt: stats.targets,
      rec: stats.receptions,
      rec_yd: stats.rec_yds,
      rec_td: stats.rec_tds,
      fum_lost: stats.fumbles_lost,
      fgm: stats.fgm,
      fga: stats.fga,
      xpm: stats.xpm,
      xpa: stats.xpa,
      kick_pts: position === "K" ? row?.points : 0,
    });
  }
  const allowedFields = {
    QB: new Set([
      "games",
      "pass_att",
      "pass_cmp",
      "pass_yd",
      "pass_td",
      "pass_int",
      "rush_att",
      "rush_yd",
      "rush_td",
      "fum_lost",
    ]),
    RB: new Set([
      "games",
      "rush_att",
      "rush_yd",
      "rush_td",
      "rec_tgt",
      "rec",
      "rec_yd",
      "rec_td",
      "fum_lost",
    ]),
    WR: new Set([
      "games",
      "rush_att",
      "rush_yd",
      "rush_td",
      "rec_tgt",
      "rec",
      "rec_yd",
      "rec_td",
      "fum_lost",
    ]),
    TE: new Set([
      "games",
      "rush_att",
      "rush_yd",
      "rush_td",
      "rec_tgt",
      "rec",
      "rec_yd",
      "rec_td",
      "fum_lost",
    ]),
    K: new Set(["games", "fgm", "fga", "xpm", "xpa", "kick_pts"]),
  }[position];
  return Object.fromEntries(
    Object.entries(line).filter(
      ([field, value]) =>
        (!allowedFields || allowedFields.has(field)) &&
        value !== null &&
        value !== undefined &&
        value !== "" &&
        Number.isFinite(Number(value)),
    ),
  );
}

function projectionStatIndexes(resolveCanonicalKey) {
  const sources = [
    {
      name: "FantasyPros",
      weight: 1,
      file: `projections_fantasypros_${season}.json`,
    },
    {
      name: "DraftSharks",
      weight: 1,
      file: `projections_draftsharks_${season}.json`,
    },
    {
      name: "FantasySharks",
      weight: 0.75,
      file: `projections_fantasysharks_${season}.json`,
    },
  ];
  return sources
    .map((source) => {
      const payload = readJson(path.join(root, "public", source.file), {
        rows: [],
      });
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      return {
        ...source,
        updated: payload?.updated || null,
        index: new Map(
          rows
            .filter((row) => playerKey(row).split("|")[0])
            .map((row) => [resolveCanonicalKey(row), row]),
        ),
      };
    })
    .filter((source) => source.index.size);
}

function weightedConsensus(values) {
  return weightedConsensusDetails(values).value;
}

function weightedConsensusDetails(values) {
  const usable = values
    .filter((row) => row.present && Number.isFinite(Number(row.value)))
    .map((row) => ({ ...row, value: num(row.value) }))
    .sort((a, b) => a.value - b.value);
  if (!usable.length) return { value: 0, weights: {} };
  const middleIndex = Math.floor(usable.length / 2);
  const middle =
    usable.length % 2
      ? usable[middleIndex].value
      : (usable[middleIndex - 1].value + usable[middleIndex].value) / 2;
  if (middle === 0)
    {
      const weight = usable.reduce((sum, row) => sum + row.weight, 0);
      return {
        value:
          usable.reduce((sum, row) => sum + row.value * row.weight, 0) /
          Math.max(0.01, weight),
        weights: Object.fromEntries(
          usable.map((row) => [row.source || "unknown", round(row.weight / Math.max(0.01, weight), 4)]),
        ),
      };
    }
  const bounded = usable.map((row) => ({
    ...row,
    value: row.value === 0 ? 0 : clamp(row.value, middle * 0.65, middle * 1.35),
  }));
  const adaptive = bounded.map((row) => {
    const distance = Math.abs(row.value - middle) / Math.max(1, Math.abs(middle));
    const agreement = clamp(1 - distance * 1.5, 0.45, 1);
    return { ...row, effectiveWeight: row.weight * agreement };
  });
  const weight = adaptive.reduce((sum, row) => sum + row.effectiveWeight, 0);
  return {
    value:
      adaptive.reduce((sum, row) => sum + row.value * row.effectiveWeight, 0) /
      Math.max(0.01, weight),
    weights: Object.fromEntries(
      adaptive.map((row) => [
        row.source || "unknown",
        round(row.effectiveWeight / Math.max(0.01, weight), 4),
      ]),
    ),
  };
}

function externalStatPrior(player, sourceIndexes, history) {
  const position = String(player?.position || "").toUpperCase();
  const rows = sourceIndexes
    .map((source) => {
      const row = source.index.get(playerKey(player));
      if (!row) return null;
      const rawLine = projectionLine(source.name, row);
      const completedLine = inferMissingVolume(rawLine, history, position);
      return {
        source: source.name,
        weight: source.weight,
        rawLine,
        presentFields: new Set(
          Object.entries(completedLine)
            .filter(([, value]) => Number.isFinite(Number(value)))
            .map(([field]) => field),
        ),
        line: guardStatRates(completedLine, position),
      };
    })
    .filter(Boolean);
  const line = {};
  const weights = {};
  ["games", ...statFields].forEach((field) => {
    const consensus = weightedConsensusDetails(
      rows.map((row) => ({
        source: row.source,
        value: row.line[field],
        weight: row.weight,
        present: row.presentFields.has(field),
      })),
    );
    line[field] = consensus.value;
    weights[field] = consensus.weights;
  });
  line.games = clamp(line.games || 17, 1, 17);
  return {
    line,
    sources: rows.map((row) => row.source),
    coverage: Object.fromEntries(
      statFields.map((field) => [
        field,
        rows.filter((row) =>
          Object.prototype.hasOwnProperty.call(row.rawLine, field),
        ).length,
      ]),
    ),
    adaptive_weights: weights,
    source_lines: Object.fromEntries(
      rows.map((row) => [row.source, row.rawLine]),
    ),
  };
}

function seasonEvidence(year) {
  const fantasyPros = readJson(
    path.join(
      root,
      "public",
      "stats",
      "history",
      String(year),
      "fantasypros.json",
    ),
    { players: [] },
  );
  const schedule = readJson(
    path.join(
      root,
      "public",
      "stats",
      "history",
      String(year),
      "schedule.json",
    ),
    { weeks: [] },
  );
  const sleeper = readJson(
    path.join(root, "public", "stats", "history", String(year), "sleeper.json"),
    { players: [] },
  );
  const advanced = readJson(
    path.join(root, "public", "stats", "advanced", String(year), "context.json"),
    { team_weeks: [], player_weeks: [], coverage: {} },
  );
  const advancedTeamWeeks = new Map(
    (advanced.team_weeks || []).map((row) => [
      `${Number(row.week)}:${normalizeTeam(row.team)}`,
      row,
    ]),
  );
  const advancedTeamHistory = new Map();
  for (const row of advanced.team_weeks || []) {
    const team = normalizeTeam(row.team);
    const current = advancedTeamHistory.get(team) || [];
    current.push(row);
    advancedTeamHistory.set(team, current);
  }
  const advancedPlayerWeeks = new Map(
    (advanced.player_weeks || []).map((row) => [
      `${Number(row.week)}:${normalizeTeam(row.team)}:${normalizeName(row.name)}:${String(row.position || "").toUpperCase()}`,
      row,
    ]),
  );
  const fantasyProsByName = new Map(
    (fantasyPros.players || []).map((row) => [playerKey(row), row]),
  );
  const historicalAliases = new Map();
  const aliasConfig = readJson(
    path.join(root, "data", "player-identity-aliases.json"),
    { aliases: [] },
  );
  for (const group of aliasConfig.aliases || []) {
    const position = String(group.position || "").toUpperCase();
    const keys = (group.names || []).map(
      (name) => `${normalizeName(name)}|${position}`,
    );
    const canonical = keys.find((key) => fantasyProsByName.has(key));
    if (!canonical) continue;
    keys.forEach((key) => historicalAliases.set(key, canonical));
  }
  const findFantasyProsPlayer = (player) => {
    const exactKey = playerKey(player);
    const exact = fantasyProsByName.get(exactKey);
    if (exact) return exact;
    const aliased = fantasyProsByName.get(historicalAliases.get(exactKey));
    if (aliased) return aliased;
    return null;
  };
  const opponent = new Map();
  (schedule.weeks || []).forEach(({ week, games }) =>
    (games || []).forEach((game) => {
      const home = normalizeTeam(game.home);
      const away = normalizeTeam(game.away);
      opponent.set(`${week}:${home}`, away);
      opponent.set(`${week}:${away}`, home);
    }),
  );
  const defense = new Map();
  const playerHistory = new Map();
  (sleeper.players || [])
    .filter(
      (player) =>
        player?.name && positions.has(String(player.position).toUpperCase()),
    )
    .forEach((player) => {
      const key = playerKey(player);
      const fantasyProsPlayer = findFantasyProsPlayer(player);
      // FantasyPros' season team is preferred to current Sleeper metadata. It
      // is still a season-level team and therefore marked as directional for
      // players traded during the season.
      // Completed-season matchup attribution requires the saved season team.
      // Current Sleeper metadata may reflect a later trade/free-agent move, so
      // an unresolved historical identity is excluded from opponent features
      // instead of being assigned to today's team.
      const team = normalizeTeam(
        fantasyProsPlayer?.team || (year === season ? player.team : ""),
      );
      const weekly = Object.entries(player.weekly_stats || {})
        .map(([week, stats]) => {
          const position = String(player.position).toUpperCase();
          const advancedSnap = advancedPlayerWeeks.get(
            `${Number(week)}:${team}:${normalizeName(player.name)}:${position}`,
          );
          const advancedTeam = advancedTeamWeeks.get(`${Number(week)}:${team}`);
          const points = {
            ppr: num(player.weeks?.[String(week)]?.ppr),
            half: num(player.weeks?.[String(week)]?.half),
            std: num(player.weeks?.[String(week)]?.std),
          };
          const positionFields =
            position === "K"
              ? ["fga", "fgm", "xpa", "xpm", "kick_pts"]
              : position === "QB"
                ? [
                    "pass_att",
                    "pass_cmp",
                    "pass_yd",
                    "pass_td",
                    "pass_int",
                    "rush_att",
                    "rush_yd",
                    "rush_td",
                    "rec_tgt",
                    "rec",
                    "rec_yd",
                    "rec_td",
                    "fum_lost",
                  ]
                : [
                    "rush_att",
                    "rush_yd",
                    "rush_td",
                    "rec_tgt",
                    "rec",
                    "rec_yd",
                    "rec_td",
                    "pass_att",
                    "pass_yd",
                    "pass_td",
                    "fum_lost",
                  ];
          const modelActive =
            (position !== "K" && num(stats?.off_snp) > 0) ||
            positionFields.some((field) => num(stats?.[field]) > 0) ||
            Object.values(points).some((value) => Math.abs(value) > 0);
          return {
            week: num(week),
            active: modelActive,
            game_day_active: num(stats?.gp) > 0 || num(stats?.gms_active) > 0,
            stats: {
              ...cleanLine(stats),
              ...Object.fromEntries(
                usageFields.map((field) => [field, round(num(stats?.[field]))]),
              ),
              off_snp: round(
                Math.max(num(stats?.off_snp), num(advancedSnap?.offense_snaps)),
              ),
              tm_off_snp: round(
                Math.max(
                  num(stats?.tm_off_snp),
                  num(advancedTeam?.snaps?.team_offense_snaps),
                ),
              ),
            },
            advanced: advancedSnap || null,
            advanced_team: advancedTeam || null,
            points,
            opponent: opponent.get(`${week}:${team}`) || null,
          };
        })
        .filter((row) => row.active)
        .sort((a, b) => a.week - b.week);
      const games = weekly.length;
      if (!games) return;
      const totals = cleanLine(player.stats || {});
      playerHistory.set(key, { year, team, games, totals, weekly });
      weekly.forEach(({ week, stats, points }) => {
        const defenseTeam = opponent.get(`${week}:${team}`);
        if (!team || !defenseTeam) return;
        const defenseKey = `${defenseTeam}|${String(player.position).toUpperCase()}`;
        const row = defense.get(defenseKey) || {
          team: defenseTeam,
          position: String(player.position).toUpperCase(),
          weeks: new Set(),
          playerGames: 0,
          pointsPpr: 0,
          stats: cleanLine(),
        };
        row.weeks.add(week);
        row.playerGames += 1;
        row.pointsPpr += num(points?.ppr);
        statFields.forEach((field) => {
          row.stats[field] += num(stats[field]);
        });
        defense.set(defenseKey, row);
      });
    });
  const defenseRows = [...defense.values()].map((row) => ({
    ...row,
    games: row.weeks.size,
    perGame: Object.fromEntries(
      [
        ...statFields.map((field) => [
          field,
          num(row.stats[field]) / Math.max(1, row.weeks.size),
        ]),
        ["points_ppr", num(row.pointsPpr) / Math.max(1, row.weeks.size)],
      ],
    ),
  }));
  const baselines = {};
  positions.forEach((position) => {
    const rows = defenseRows.filter((row) => row.position === position);
    baselines[position] = Object.fromEntries(
      [...statFields, "points_ppr"].map((field) => [
        field,
        rows.reduce((sum, row) => sum + num(row.perGame[field]), 0) /
          Math.max(1, rows.length),
      ]),
    );
  });
  return {
    year,
    completedWeeks: num(sleeper.completed_weeks),
    defense: defenseRows,
    baselines,
    playerHistory,
    advancedTeamWeeks,
    advancedTeamHistory,
    advancedCoverage: advanced.coverage || {},
  };
}

function evidenceWeights(items) {
  const completed = items.filter((item) => item.year < season);
  const historicalWeights = [0.15, 0.3, 0.55].slice(-completed.length);
  return items.map((item) => {
    if (item.year === season)
      return clamp((num(item.completedWeeks) / 17) * 0.7, 0.04, 0.7);
    const index = completed.findIndex(
      (candidate) => candidate.year === item.year,
    );
    return historicalWeights[index] || 0.55;
  });
}

function aggregatePlayerHistory(key, evidence) {
  const recency = evidenceWeights(evidence);
  const samples = evidence
    .map((item, index) => {
      const history = item.playerHistory.get(key);
      return history ? { ...history, weight: recency[index] || 0.55 } : null;
    })
    .filter(Boolean);
  const totalWeight = samples.reduce((sum, row) => sum + row.weight, 0);
  const perGame = Object.fromEntries(
    statFields.map((field) => [
      field,
      samples.reduce(
        (sum, row) =>
          sum + (num(row.totals[field]) / Math.max(1, row.games)) * row.weight,
        0,
      ) / Math.max(0.01, totalWeight),
    ]),
  );
  return {
    seasons: samples.map((row) => row.year),
    games: round(
      samples.reduce((sum, row) => sum + row.games, 0),
      0,
    ),
    effectiveGames: samples.reduce(
      (sum, row) => sum + row.games * row.weight,
      0,
    ),
    perGame,
  };
}

function inferMissingVolume(line, history, position) {
  const result = { ...line };
  const catchRateFallback = { RB: 0.78, WR: 0.65, TE: 0.72 }[position] || 0;
  const yardsPerCatchFallback = { RB: 7.5, WR: 12.5, TE: 10.5 }[position] || 0;
  if (!result.rec && result.rec_yd) {
    const historicalYardsPerCatch =
      history?.perGame?.rec > 0
        ? history.perGame.rec_yd / history.perGame.rec
        : yardsPerCatchFallback;
    result.rec = result.rec_yd / clamp(historicalYardsPerCatch || 10, 4, 24);
  }
  if (!result.rec_tgt && result.rec) {
    const historicalCatchRate =
      history?.perGame?.rec_tgt > 0
        ? history.perGame.rec / history.perGame.rec_tgt
        : catchRateFallback;
    result.rec_tgt = result.rec / clamp(historicalCatchRate || 0.68, 0.48, 0.9);
  }
  if (!result.pass_att && result.pass_yd)
    result.pass_att = result.pass_yd / 7.1;
  if (!result.pass_att && result.pass_td)
    result.pass_att = result.pass_td / 0.045;
  if (!result.pass_cmp && result.pass_att)
    result.pass_cmp = result.pass_att * 0.65;
  if (!result.rush_att && result.rush_yd)
    result.rush_att = result.rush_yd / 4.35;
  if (!result.rush_att && result.rush_td)
    result.rush_att = result.rush_td / 0.045;
  if (!result.fga && result.fgm) result.fga = result.fgm / 0.86;
  if (!result.xpa && result.xpm) result.xpa = result.xpm / 0.94;
  return result;
}

function guardStatRates(line, position) {
  const result = { ...line };
  const limitRate = (numerator, denominator, minimum, maximum) => {
    const volume = num(result[denominator]);
    const production = num(result[numerator]);
    if (volume <= 0) {
      if (production > 0) result[numerator] = 0;
      return;
    }
    result[numerator] =
      production > 0
        ? clamp(production, volume * minimum, volume * maximum)
        : 0;
  };
  if (position === "QB") {
    limitRate("pass_cmp", "pass_att", 0.45, 0.82);
    limitRate("pass_yd", "pass_att", 4, 10.5);
    limitRate("pass_td", "pass_att", 0.005, 0.12);
    limitRate("pass_int", "pass_att", 0.002, 0.1);
  }
  if (["QB", "RB", "WR", "TE"].includes(position)) {
    limitRate("rush_yd", "rush_att", 1.5, position === "QB" ? 10 : 9);
    limitRate("rush_td", "rush_att", 0.002, position === "QB" ? 0.25 : 0.18);
  }
  if (["RB", "WR", "TE"].includes(position)) {
    const catchRange = {
      RB: [0.45, 0.95],
      WR: [0.4, 0.9],
      TE: [0.45, 0.93],
    }[position];
    const targetYardsRange = {
      RB: [2.5, 11],
      WR: [4, 14],
      TE: [3.5, 12.5],
    }[position];
    const catchYardsRange = {
      RB: [3, 16],
      WR: [6, 24],
      TE: [5, 20],
    }[position];
    limitRate("rec", "rec_tgt", catchRange[0], catchRange[1]);
    if (
      num(result.rec_yd) > 0 &&
      num(result.rec_tgt) > 0 &&
      num(result.rec) > 0
    ) {
      result.rec_yd = clamp(
        num(result.rec_yd),
        Math.max(
          num(result.rec_tgt) * targetYardsRange[0],
          num(result.rec) * catchYardsRange[0],
        ),
        Math.min(
          num(result.rec_tgt) * targetYardsRange[1],
          num(result.rec) * catchYardsRange[1],
        ),
      );
    }
    limitRate("rec_td", "rec_tgt", 0.001, 0.2);
  }
  if (position === "K") {
    limitRate("fgm", "fga", 0.5, 0.99);
    limitRate("xpm", "xpa", 0.7, 1);
  }
  return {
    games: clamp(num(result.games) || 17, 1, 17),
    ...coherentLine(result),
  };
}

function syntheticLine(player, history) {
  const position = String(player.position).toUpperCase();
  const games = 17;
  const ppr = num(player.points_ppr ?? player.points);
  const historicalLine = Object.fromEntries(
    statFields.map((field) => [field, num(history?.perGame?.[field]) * games]),
  );
  const guardedHistory = guardStatRates({ games, ...historicalLine }, position);
  const historicalPoints = scoreLine(guardedHistory, 1, position);
  if (historicalPoints > 0) {
    const scale = ppr > 0 ? ppr / historicalPoints : 1;
    return guardStatRates(
      {
        games,
        ...Object.fromEntries(
          statFields.map((field) => [
            field,
            num(guardedHistory[field]) * scale,
          ]),
        ),
      },
      position,
    );
  }
  const line = { games };
  if (position === "QB") {
    line.pass_yd = ppr * 12;
    line.pass_td = ppr * 0.08;
    line.rush_yd = ppr * 0.8;
    line.rush_td = ppr * 0.02;
  } else if (position === "RB") {
    line.rush_yd = ppr * 3.2;
    line.rush_td = ppr * 0.035;
    line.rec = ppr * 0.18;
    line.rec_yd = ppr * 1.6;
    line.rec_td = ppr * 0.02;
  } else if (position === "WR" || position === "TE") {
    line.rec = ppr * (position === "TE" ? 0.28 : 0.25);
    line.rec_yd = ppr * (position === "TE" ? 5 : 5.5);
    line.rec_td = ppr * (position === "TE" ? 0.0367 : 0.033);
  } else if (position === "K") {
    line.kick_pts = ppr;
  }
  return guardStatRates(inferMissingVolume(line, history, position), position);
}

function regressVolumeAndEfficiency(line, history, position) {
  const result = inferMissingVolume(line, history, position);
  const effectiveGames = num(history?.effectiveGames);
  const blend = clamp((effectiveGames / (effectiveGames + 20)) * 0.22, 0, 0.22);
  const volumeFactors = {};
  const efficiencyFactors = {};
  const adjustVolume = (field) => {
    const sourcePerGame = num(result[field]) / Math.max(1, num(result.games));
    const historicalPerGame = num(history?.perGame?.[field]);
    if (!sourcePerGame || !historicalPerGame || !blend) return;
    const factor = clamp(
      1 + (historicalPerGame / sourcePerGame - 1) * blend,
      0.94,
      1.06,
    );
    result[field] *= factor;
    volumeFactors[field] = round(factor, 4);
  };
  const adjustRate = (numerator, denominator, pseudoAttempts) => {
    const sourceRate =
      num(result[numerator]) / Math.max(0.01, num(result[denominator]));
    const historicalDenominator = num(history?.perGame?.[denominator]);
    const historicalRate =
      num(history?.perGame?.[numerator]) /
      Math.max(0.01, historicalDenominator);
    if (!sourceRate || !historicalRate || !blend) return;
    const observations = historicalDenominator * Math.max(1, effectiveGames);
    const regressed =
      (historicalRate * observations + sourceRate * pseudoAttempts) /
      Math.max(0.01, observations + pseudoAttempts);
    const factor = clamp(1 + (regressed / sourceRate - 1) * blend, 0.95, 1.05);
    result[numerator] = result[denominator] * sourceRate * factor;
    efficiencyFactors[`${numerator}_per_${denominator}`] = round(factor, 4);
  };
  if (position === "QB") {
    adjustVolume("pass_att");
    adjustVolume("rush_att");
    adjustRate("pass_cmp", "pass_att", 120);
    adjustRate("pass_yd", "pass_att", 120);
    adjustRate("pass_td", "pass_att", 160);
    adjustRate("pass_int", "pass_att", 160);
    adjustRate("rush_yd", "rush_att", 35);
    adjustRate("rush_td", "rush_att", 50);
  } else if (["RB", "WR", "TE"].includes(position)) {
    adjustVolume("rush_att");
    adjustVolume("rec_tgt");
    adjustRate("rush_yd", "rush_att", 45);
    adjustRate("rush_td", "rush_att", 65);
    adjustRate("rec", "rec_tgt", 55);
    adjustRate("rec_yd", "rec_tgt", 55);
    adjustRate("rec_td", "rec_tgt", 80);
  } else if (position === "K") {
    adjustVolume("fga");
    adjustVolume("xpa");
    adjustRate("fgm", "fga", 30);
    adjustRate("xpm", "xpa", 30);
  }
  result.pass_cmp = Math.min(num(result.pass_cmp), num(result.pass_att));
  result.rec = Math.min(num(result.rec), num(result.rec_tgt));
  result.fgm = Math.min(num(result.fgm), num(result.fga));
  result.xpm = Math.min(num(result.xpm), num(result.xpa));
  return {
    line: guardStatRates(result, position),
    regression: {
      history_games: num(history?.games),
      history_seasons: history?.seasons || [],
      blend: round(blend, 4),
      volume_factors: volumeFactors,
      efficiency_factors: efficiencyFactors,
    },
  };
}

function playerVolatilityProfile(key, evidence) {
  const recency = evidenceWeights(evidence);
  const outcomes = [];
  let weightedMean = 0;
  let weightedTotal = 0;
  evidence.forEach((item, index) => {
    const history = item.playerHistory.get(key);
    if (!history?.weekly?.length) return;
    const playable = history.weekly.filter(
      (row) => num(row.points?.ppr) > 0 || Object.values(row.stats || {}).some(num),
    );
    if (playable.length < 3) return;
    const seasonMean =
      playable.reduce((sum, row) => sum + num(row.points?.ppr), 0) /
      playable.length;
    if (!seasonMean) return;
    const seasonWeight = recency[index] || 0.55;
    playable.forEach((row) => {
      const weight = seasonWeight / playable.length;
      const ratio = clamp(num(row.points?.ppr) / seasonMean, 0, 3);
      outcomes.push({ ratio, weight, season: item.year, week: row.week });
      weightedMean += ratio * weight;
      weightedTotal += weight;
    });
  });
  if (!outcomes.length || !weightedTotal)
    return {
      games: 0,
      cv: 0.35,
      boom_rate: null,
      bust_rate: null,
      reliability: 0,
      matchup_sensitivity: 1,
      outcomes: [],
    };
  const mean = weightedMean / weightedTotal;
  const variance =
    outcomes.reduce(
      (sum, row) => sum + row.weight * (row.ratio - mean) ** 2,
      0,
    ) / weightedTotal;
  const cv = clamp(Math.sqrt(variance) / Math.max(0.1, mean), 0.12, 1.15);
  const boomWeight = outcomes.reduce(
    (sum, row) => sum + (row.ratio >= 1.3 ? row.weight : 0),
    0,
  );
  const bustWeight = outcomes.reduce(
    (sum, row) => sum + (row.ratio <= 0.7 ? row.weight : 0),
    0,
  );
  const reliability = outcomes.length / (outcomes.length + 8);
  return {
    games: outcomes.length,
    cv: round(cv, 4),
    boom_rate: round(boomWeight / weightedTotal, 4),
    bust_rate: round(bustWeight / weightedTotal, 4),
    reliability: round(reliability, 4),
    // High-variance roles should react more to a matchup than stable volume
    // earners, but the multiplier remains bounded and sample-regressed.
    matchup_sensitivity: round(
      clamp(0.88 + cv * 0.72 * reliability, 0.88, 1.48),
      4,
    ),
    outcomes: outcomes.map(({ ratio, weight }) => ({ ratio, weight })),
  };
}

function defenseAdjustment(evidence, opponent, position, volatility) {
  const recency = evidenceWeights(evidence);
  const factors = {};
  const indices = {};
  const rawIndices = {};
  const sample = evidence.reduce((sum, item) => {
    const row = item.defense.find(
      (candidate) =>
        candidate.team === opponent && candidate.position === position,
    );
    return sum + num(row?.games);
  }, 0);
  [...statFields, "points_ppr"].forEach((field) => {
    let weightedIndex = 0;
    let weightedRawIndex = 0;
    let weightTotal = 0;
    evidence.forEach((item, index) => {
      const row = item.defense.find(
        (candidate) =>
          candidate.team === opponent && candidate.position === position,
      );
      const baseline = num(item.baselines?.[position]?.[field]);
      const observed = num(row?.perGame?.[field]);
      if (!row?.games || !baseline) return;
      const reliability = row.games / (row.games + 8);
      const weight = recency[index] || 0.55;
      const rawIndex = observed / baseline;
      const regressedIndex = 1 + (rawIndex - 1) * reliability;
      weightedIndex += regressedIndex * weight;
      weightedRawIndex += rawIndex * weight;
      weightTotal += weight;
    });
    const index = weightTotal ? weightedIndex / weightTotal : 1;
    rawIndices[field] = weightTotal ? weightedRawIndex / weightTotal : 1;
    const volume = ["pass_att", "rush_att", "rec_tgt", "fga", "xpa"].includes(
      field,
    );
    const sensitivity = num(volatility?.matchup_sensitivity) || 1;
    const strength = (volume ? 0.28 : 0.48) * sensitivity;
    if (field !== "points_ppr")
      factors[field] = clamp(
        1 + (index - 1) * strength,
        volume ? 0.88 : 0.76,
        volume ? 1.12 : 1.24,
      );
    indices[field] = index;
  });
  return {
    factors,
    indices,
    raw_indices: rawIndices,
    sample: Math.round(sample),
    reliability: sample / (sample + 8),
  };
}

function playerOpponentAdjustment(key, opponent, evidence, volatility) {
  const recency = evidenceWeights(evidence);
  let splitTotal = 0;
  let splitWeight = 0;
  let baselineTotal = 0;
  let baselineWeight = 0;
  let games = 0;
  const seasons = [];
  evidence.forEach((item, index) => {
    const history = item.playerHistory.get(key);
    if (!history?.weekly?.length) return;
    const matches = history.weekly.filter(
      (row) => normalizeTeam(row.opponent) === opponent,
    );
    const comparisonGames = history.weekly.filter(
      (row) => normalizeTeam(row.opponent) !== opponent,
    );
    const seasonAverage =
      comparisonGames.reduce((sum, row) => sum + num(row.points?.ppr), 0) /
      Math.max(1, comparisonGames.length);
    if (!matches.length || !comparisonGames.length || !seasonAverage) return;
    const weight = recency[index] || 0.55;
    matches.forEach((row) => {
      splitTotal += num(row.points?.ppr) * weight;
      splitWeight += weight;
      baselineTotal += seasonAverage * weight;
      baselineWeight += weight;
      games += 1;
    });
    seasons.push(item.year);
  });
  if (games < 2 || !splitWeight || !baselineWeight)
    return {
      games,
      seasons,
      factor: 1,
      split_average: null,
      player_baseline: null,
    };
  const splitAverage = splitTotal / splitWeight;
  const playerBaseline = baselineTotal / baselineWeight;
  const ratio = clamp(splitAverage / Math.max(0.1, playerBaseline), 0.6, 1.4);
  const reliability = games / (games + 6);
  const sensitivity = num(volatility?.matchup_sensitivity) || 1;
  return {
    games,
    seasons,
    factor: clamp(
      1 + (ratio - 1) * reliability * 0.3 * sensitivity,
      0.94,
      1.06,
    ),
    split_average: round(splitAverage),
    player_baseline: round(playerBaseline),
  };
}

function matchupOutcomeProfile(volatility, matchupFactor, neutralPoints) {
  const outcomes = volatility?.outcomes || [];
  const totalWeight = outcomes.reduce((sum, row) => sum + num(row.weight), 0);
  const reliability = num(volatility?.reliability);
  const adjusted = outcomes.map((row) => ({
    ratio: num(row.ratio) * matchupFactor,
    weight: num(row.weight),
  }));
  const empiricalBoom = totalWeight
    ? adjusted.reduce(
        (sum, row) => sum + (row.ratio >= 1.3 ? row.weight : 0),
        0,
      ) / totalWeight
    : 0.2;
  const empiricalBust = totalWeight
    ? adjusted.reduce(
        (sum, row) => sum + (row.ratio <= 0.7 ? row.weight : 0),
        0,
      ) / totalWeight
    : 0.2;
  const directionalBoom = clamp(0.2 + (matchupFactor - 1) * 1.35, 0.05, 0.58);
  const directionalBust = clamp(0.2 - (matchupFactor - 1) * 1.35, 0.05, 0.58);
  const historyWeight = clamp(reliability * 0.72, 0, 0.62);
  const boomProbability =
    empiricalBoom * historyWeight + directionalBoom * (1 - historyWeight);
  const bustProbability =
    empiricalBust * historyWeight + directionalBust * (1 - historyWeight);
  const spread = Math.max(1.5, neutralPoints * (num(volatility?.cv) || 0.35));
  let label = "Balanced range";
  if (matchupFactor >= 1.1 || boomProbability >= 0.34) label = "Boom spot";
  else if (matchupFactor <= 0.9 || bustProbability >= 0.34) label = "Bust risk";
  else if (boomProbability >= 0.27) label = "Ceiling lean";
  else if (bustProbability >= 0.27) label = "Floor concern";
  return {
    label,
    boom_probability: round(clamp(boomProbability, 0.03, 0.72), 4),
    bust_probability: round(clamp(bustProbability, 0.03, 0.72), 4),
    boom_threshold: round(neutralPoints * 1.3),
    bust_threshold: round(neutralPoints * 0.7),
    floor: round(Math.max(0, neutralPoints * matchupFactor - spread)),
    ceiling: round(neutralPoints * matchupFactor + spread * 1.35),
    historical_cv: round(num(volatility?.cv), 4),
    sample: num(volatility?.games),
  };
}

function weatherRiskSignal(weather, position) {
  if (!weather || weather.indoor) return 0;
  const wind = Math.max(num(weather.windSpeed), num(weather.windGusts) * 0.75);
  const precipitation = num(weather.precipitationProbability);
  const temperature = num(weather.temperature);
  let signal = 0;
  if (wind >= 20) signal -= position === "RB" ? 0.025 : 0.09;
  else if (wind >= 15) signal -= position === "RB" ? 0.01 : 0.05;
  if (precipitation >= 70) signal -= position === "RB" ? 0.01 : 0.045;
  else if (precipitation >= 45) signal -= position === "RB" ? 0 : 0.02;
  if (temperature && temperature <= 15) signal -= position === "K" ? 0.05 : 0.02;
  return clamp(signal, -0.16, 0.04);
}

function seededGenerator(seedText) {
  let seed = 2166136261;
  for (const character of String(seedText || "")) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(random) {
  const first = Math.max(1e-9, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function correlatedOutcomeSimulation({
  playerKeyValue,
  team,
  week,
  mean,
  volatility,
  position,
  market,
}) {
  const samples = 500;
  const teamRandom = seededGenerator(`${season}|${week}|${team}|team`);
  const playerRandom = seededGenerator(
    `${season}|${week}|${team}|${playerKeyValue}|player`,
  );
  const correlation = position === "QB" ? 0.5 : position === "K" ? 0.42 : 0.34;
  const cv = clamp(num(volatility?.cv) || 0.35, 0.16, 0.95);
  const marketScale = market
    ? clamp(num(market.implied_points) / 22.5, 0.72, 1.35)
    : 1;
  const sigma = clamp(cv * 0.68, 0.13, 0.72);
  const values = [];
  let booms = 0;
  let busts = 0;
  for (let index = 0; index < samples; index += 1) {
    const teamZ = standardNormal(teamRandom);
    const playerZ = standardNormal(playerRandom);
    const combined = correlation * teamZ + Math.sqrt(1 - correlation ** 2) * playerZ;
    const marketTilt = 1 + (marketScale - 1) * 0.35;
    const value = Math.max(
      0,
      num(mean) * marketTilt * Math.exp(sigma * combined - (sigma ** 2) / 2),
    );
    values.push(value);
    if (value >= num(mean) * 1.3) booms += 1;
    if (value <= num(mean) * 0.7) busts += 1;
  }
  values.sort((left, right) => left - right);
  const percentile = (value) =>
    values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * value)))];
  return {
    simulations: samples,
    team_correlation: correlation,
    p10: round(percentile(0.1)),
    p25: round(percentile(0.25)),
    median: round(percentile(0.5)),
    p75: round(percentile(0.75)),
    p90: round(percentile(0.9)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    boom_probability: round(booms / samples, 4),
    bust_probability: round(busts / samples, 4),
    market_informed: Boolean(market),
  };
}

function buildTeamUsageEvidence(evidence) {
  const rows = new Map();
  const paceSamples = [];
  evidence.forEach((seasonRow) => {
    seasonRow.playerHistory.forEach((history, key) => {
      const position = key.split("|").at(-1);
      history.weekly.forEach((game) => {
        const mapKey = `${history.year}|${game.week}|${history.team}`;
        const row = rows.get(mapKey) || {
          plays: 0,
          pass_att: 0,
          rush_att: 0,
          targets: 0,
          red_zone: 0,
          air_yards: 0,
          two_minute_plays: 0,
          third_down_plays: 0,
        };
        row.plays = Math.max(row.plays, num(game.stats?.tm_off_snp));
        if (position === "QB") row.pass_att += num(game.stats?.pass_att);
        row.rush_att += num(game.stats?.rush_att);
        row.targets += num(game.stats?.rec_tgt);
        row.red_zone +=
          num(game.stats?.pass_rz_att) +
          num(game.stats?.rush_rz_att) +
          num(game.stats?.rec_rz_tgt);
        row.air_yards += num(game.stats?.rec_air_yd);
        row.two_minute_plays = Math.max(
          row.two_minute_plays,
          num(game.advanced_team?.offense?.samples?.two_minute),
        );
        row.third_down_plays = Math.max(
          row.third_down_plays,
          num(game.advanced_team?.offense?.samples?.third_down),
        );
        rows.set(mapKey, row);
      });
    });
  });
  rows.forEach((row) => {
    if (row.plays > 0) paceSamples.push(row.plays);
  });
  return {
    rows,
    leaguePace:
      paceSamples.reduce((sum, value) => sum + value, 0) /
        Math.max(1, paceSamples.length) || 64,
  };
}

function productionRoleFeatures(key, position, evidence, teamUsage) {
  const games = evidence
    .flatMap((seasonRow) => {
      const history = seasonRow.playerHistory.get(key);
      return (history?.weekly || []).map((game) => ({
        ...game,
        year: seasonRow.year,
        team: history.team,
      }));
    })
    .sort((left, right) => left.year - right.year || left.week - right.week);
  const recent = games.slice(-3);
  const earlier = games.slice(0, -3);
  const average = (rows, accessor) => {
    const values = rows.map(accessor).filter(Number.isFinite);
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  };
  const teamRow = (game) =>
    teamUsage.rows.get(`${game.year}|${game.week}|${game.team}`);
  const snapShare = (game) => {
    const snaps = num(game.stats?.tm_off_snp);
    return snaps > 0 ? num(game.stats?.off_snp) / snaps : null;
  };
  const opportunityShare = (game) => {
    const team = teamRow(game);
    const playerOpportunity =
      position === "QB"
        ? num(game.stats?.pass_att) + num(game.stats?.rush_att)
        : position === "K"
          ? num(game.stats?.fga) + num(game.stats?.xpa)
          : num(game.stats?.rush_att) + num(game.stats?.rec_tgt);
    const teamOpportunity =
      position === "QB"
        ? num(team?.pass_att) + num(team?.rush_att)
        : position === "K"
          ? 0
          : num(team?.rush_att) + num(team?.targets);
    return teamOpportunity > 0 ? playerOpportunity / teamOpportunity : null;
  };
  const redZoneShare = (game) => {
    const team = teamRow(game);
    const value =
      num(game.stats?.pass_rz_att) +
      num(game.stats?.rush_rz_att) +
      num(game.stats?.rec_rz_tgt);
    return num(team?.red_zone) > 0 ? value / num(team.red_zone) : null;
  };
  const airYardShare = (game) => {
    const team = teamRow(game);
    return num(team?.air_yards) > 0
      ? num(game.stats?.rec_air_yd) / num(team.air_yards)
      : null;
  };
  const advancedValue = (field, nested) => (game) => {
    const advanced = game.advanced;
    const value = nested ? advanced?.[field]?.[nested] : advanced?.[field];
    return value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const highValueTouchRate = (game) => {
    const opportunities = num(game.advanced?.targets) + num(game.advanced?.carries);
    return opportunities > 0
      ? num(game.advanced?.high_value_touches) / opportunities
      : null;
  };
  const situationalRate = (game, playerField, teamField) => {
    const team = teamRow(game);
    return num(team?.[teamField]) > 0
      ? num(game.advanced?.[playerField]) / num(team[teamField])
      : null;
  };
  const recentPoints = average(recent, (game) => num(game.points?.ppr));
  const historicalPoints = average(games, (game) => num(game.points?.ppr));
  const recentSnap = average(recent, snapShare);
  const earlierSnap = average(earlier, snapShare);
  const recentOpportunity = average(recent, opportunityShare);
  const earlierOpportunity = average(earlier, opportunityShare);
  const recentTargetShare = average(recent, advancedValue("target_share"));
  const earlierTargetShare = average(earlier, advancedValue("target_share"));
  const recentCarryShare = average(recent, advancedValue("carry_share"));
  const earlierCarryShare = average(earlier, advancedValue("carry_share"));
  const opportunityShares = games
    .map(advancedValue("opportunity_share"))
    .filter(Number.isFinite);
  const opportunityMean = opportunityShares.length
    ? opportunityShares.reduce((sum, value) => sum + value, 0) / opportunityShares.length
    : null;
  const opportunityVolatility = opportunityShares.length > 1
    ? Math.sqrt(
        opportunityShares.reduce(
          (sum, value) => sum + (value - opportunityMean) ** 2,
          0,
        ) / opportunityShares.length,
      )
    : null;
  const features = {
    recent_form_delta:
      Number.isFinite(recentPoints) && historicalPoints > 0
        ? clamp(recentPoints / historicalPoints - 1, -0.75, 1)
        : null,
    snap_share: average(games, snapShare),
    snap_trend:
      Number.isFinite(recentSnap) && Number.isFinite(earlierSnap)
        ? clamp(recentSnap - earlierSnap, -0.5, 0.5)
        : null,
    opportunity_share: average(games, opportunityShare),
    opportunity_trend:
      Number.isFinite(recentOpportunity) && Number.isFinite(earlierOpportunity)
        ? clamp(recentOpportunity - earlierOpportunity, -0.5, 0.5)
        : null,
    red_zone_share: average(games, redZoneShare),
    air_yard_share: average(games, airYardShare),
    target_share: average(games, advancedValue("target_share")),
    target_share_trend:
      Number.isFinite(recentTargetShare) && Number.isFinite(earlierTargetShare)
        ? clamp(recentTargetShare - earlierTargetShare, -0.5, 0.5)
        : null,
    carry_share: average(games, advancedValue("carry_share")),
    carry_share_trend:
      Number.isFinite(recentCarryShare) && Number.isFinite(earlierCarryShare)
        ? clamp(recentCarryShare - earlierCarryShare, -0.5, 0.5)
        : null,
    weighted_opportunity_share: opportunityMean,
    weighted_opportunity_trend:
      Number.isFinite(recentOpportunity) && Number.isFinite(earlierOpportunity)
        ? clamp(recentOpportunity - earlierOpportunity, -0.5, 0.5)
        : null,
    high_value_touch_rate: average(games, highValueTouchRate),
    two_minute_opportunity_rate: average(
      games,
      (game) => situationalRate(game, "two_minute_opportunities", "two_minute_plays"),
    ),
    third_down_opportunity_rate: average(
      games,
      (game) => situationalRate(game, "third_down_opportunities", "third_down_plays"),
    ),
    opportunity_volatility: opportunityVolatility,
    receiving_epa_per_target: average(games, advancedValue("receiving_epa_per_target")),
    rushing_epa_per_carry: average(games, advancedValue("rushing_epa_per_carry")),
    ngs_cpoe: average(games, advancedValue("ngs", "cpoe")),
    ngs_separation: average(games, advancedValue("ngs", "separation")),
    ngs_yac_over_expected: average(games, advancedValue("ngs", "yac_over_expected")),
    ngs_ryoe_per_carry: average(games, advancedValue("ngs", "ryoe_per_carry")),
    ngs_box_eight_rate: average(games, advancedValue("ngs", "box_eight_rate")),
    team_pace_delta: average(games, (game) => {
      const plays = num(teamRow(game)?.plays);
      return plays > 0 ? plays / teamUsage.leaguePace - 1 : null;
    }),
    history_reliability: games.length / (games.length + 6),
    games: games.length,
  };
  features.available_features = Object.entries(features).filter(
    ([key, value]) => key !== "games" && value !== null && Number.isFinite(Number(value)),
  ).length;
  return features;
}

function advancedMatchupFeatures(evidence, offenseTeam, defenseTeam) {
  const recency = evidenceWeights(evidence);
  const averageSide = (team, side, field) => {
    let weighted = 0;
    let weightTotal = 0;
    let samples = 0;
    evidence.forEach((seasonRow, index) => {
      const rows = seasonRow.advancedTeamHistory?.get(team) || [];
      const values = rows
        .map((row) => Number(row?.[side]?.[field]))
        .filter(Number.isFinite);
      if (!values.length) return;
      const seasonAverage =
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const weight = recency[index] || 0.55;
      weighted += seasonAverage * weight;
      weightTotal += weight;
      samples += values.length;
    });
    return {
      value: weightTotal ? weighted / weightTotal : null,
      samples,
    };
  };
  const offense = (field) => averageSide(offenseTeam, "offense", field);
  const defense = (field) => averageSide(defenseTeam, "defense", field);
  const snap = (field) => averageSide(offenseTeam, "snaps", field);
  const protectionPressure = offense("pressure_rate");
  const protectionSack = offense("sack_rate");
  const opponentPressure = defense("pressure_rate");
  const opponentSack = defense("sack_rate");
  const offenseEpa = offense("epa_per_play");
  const offenseSuccess = offense("success_rate");
  const opponentEpa = defense("epa_per_play_allowed");
  const opponentSuccess = defense("success_rate_allowed");
  const offensePlayVolume = offense("play_volume");
  const sample = Math.min(
    protectionPressure.samples || 0,
    opponentPressure.samples || 0,
  );
  const result = {
    protection_pressure_rate: protectionPressure.value,
    protection_sack_rate: protectionSack.value,
    opponent_pressure_rate: opponentPressure.value,
    opponent_sack_rate: opponentSack.value,
    pressure_mismatch:
      Number.isFinite(opponentPressure.value) &&
      Number.isFinite(protectionPressure.value)
        ? opponentPressure.value - protectionPressure.value
        : null,
    opponent_blitz_rate: defense("blitz_rate").value,
    ol_stability: snap("ol_stability").value,
    ol_continuity: snap("ol_continuity").value,
    time_to_throw: offense("average_time_to_throw").value,
    offense_motion_rate: offense("motion_rate").value,
    offense_play_action_rate: offense("play_action_rate").value,
    offense_screen_rate: offense("screen_rate").value,
    offense_rpo_rate: offense("rpo_rate").value,
    opponent_man_rate: defense("man_rate").value,
    opponent_zone_rate: defense("zone_rate").value,
    offense_epa_per_play: offenseEpa.value,
    offense_success_rate: offenseSuccess.value,
    offense_pass_rate: offense("pass_rate").value,
    offense_red_zone_play_rate: offense("red_zone_play_rate").value,
    opponent_epa_per_play_allowed: opponentEpa.value,
    opponent_success_rate_allowed: opponentSuccess.value,
    opponent_pass_rate_faced: defense("pass_rate_faced").value,
    opponent_red_zone_play_rate_allowed: defense("red_zone_play_rate_allowed").value,
    epa_matchup:
      Number.isFinite(offenseEpa.value) && Number.isFinite(opponentEpa.value)
        ? offenseEpa.value + opponentEpa.value
        : null,
    success_matchup:
      Number.isFinite(offenseSuccess.value) && Number.isFinite(opponentSuccess.value)
        ? offenseSuccess.value + opponentSuccess.value - 1
        : null,
    offense_neutral_pass_rate: offense("neutral_pass_rate").value,
    offense_two_minute_rate: offense("two_minute_rate").value,
    offense_third_down_success_rate: offense("third_down_success_rate").value,
    offense_play_volume_delta: Number.isFinite(offensePlayVolume.value)
      ? offensePlayVolume.value / 64 - 1
      : null,
    advanced_reliability: sample / (sample + 8),
  };
  result.available_features = advancedFeatureNames.filter(
    (feature) =>
      result[feature] !== null && Number.isFinite(Number(result[feature])),
  ).length;
  return result;
}

function trainedAdjustment(position, calibration, features) {
  const positionModel = calibration?.by_position?.[position];
  if (!positionModel || positionModel.holdout_mae_improvement <= 0)
    return { factor: 1, raw_delta: 0, available: 0, model: null };
  let available = 0;
  const observedFeatures = new Set();
  Object.entries(positionModel.features || {}).forEach(([feature]) => {
    const raw = features?.[feature];
    const observed = raw !== null && Number.isFinite(Number(raw));
    if (observed) observedFeatures.add(feature);
  });
  available = observedFeatures.size;
  let delta = num(positionModel.intercept);
  if (positionModel.model_type === "boosted_stumps") {
    (positionModel.trees || []).forEach((tree) => {
      const settings = positionModel.features?.[tree.feature] || {};
      const raw = features?.[tree.feature];
      const observed = raw !== null && Number.isFinite(Number(raw));
      const value = observed ? Number(raw) : num(settings.mean);
      delta += value <= num(tree.threshold) ? num(tree.left) : num(tree.right);
    });
  } else {
    Object.entries(positionModel.features || {}).forEach(([feature, settings]) => {
      const raw = features?.[feature];
      const observed = raw !== null && Number.isFinite(Number(raw));
      const value = observed ? Number(raw) : num(settings.mean);
      const normalized =
        (value - num(settings.mean)) /
        Math.max(0.000001, num(settings.scale) || 1);
      delta += normalized * num(settings.coefficient);
    });
  }
  const strength = num(positionModel.application_strength);
  return {
    factor: clamp(1 + clamp(delta, -0.35, 0.45) * strength, 0.65, 1.45),
    raw_delta: round(delta, 5),
    available,
    model: positionModel,
  };
}

function projectOpportunityLayer(position, baseline, role, environment, market) {
  const historicalPlays = 64 * (1 + num(environment.offense_play_volume_delta));
  const marketVolume = market
    ? clamp(num(market.implied_points) / 22.5, 0.78, 1.28)
    : 1;
  const teamPlays = clamp(historicalPlays * (1 + (marketVolume - 1) * 0.28), 50, 78);
  const passRate = clamp(
    Number.isFinite(Number(environment.offense_neutral_pass_rate))
      ? Number(environment.offense_neutral_pass_rate)
      : 0.58,
    0.42,
    0.72,
  );
  const targetShare = clamp(
    num(role.target_share) + num(role.target_share_trend) * 0.55,
    0,
    0.42,
  );
  const carryShare = clamp(
    num(role.carry_share) + num(role.carry_share_trend) * 0.55,
    0,
    0.72,
  );
  const opportunityReliability = clamp(
    num(role.games) / (num(role.games) + 6),
    0,
    0.82,
  );
  const modelTargets = teamPlays * passRate * targetShare;
  const modelCarries = teamPlays * (1 - passRate) * carryShare;
  const priorTargets = num(baseline.rec_tgt);
  const priorCarries = num(baseline.rush_att);
  const targets = ["RB", "WR", "TE"].includes(position)
    ? priorTargets * (1 - opportunityReliability) + modelTargets * opportunityReliability
    : 0;
  const carries = ["QB", "RB", "WR", "TE"].includes(position)
    ? priorCarries * (1 - opportunityReliability) + modelCarries * opportunityReliability
    : 0;
  const passAttempts = position === "QB"
    ? num(baseline.pass_att) * (1 - opportunityReliability) +
      teamPlays * passRate * opportunityReliability
    : 0;
  return {
    team_plays: round(teamPlays, 2),
    team_neutral_pass_rate: round(passRate, 4),
    projected_pass_attempts: round(passAttempts, 2),
    projected_targets: round(targets, 2),
    projected_carries: round(carries, 2),
    target_share: round(targetShare, 4),
    carry_share: round(carryShare, 4),
    reliability: round(opportunityReliability, 4),
    market_informed: Boolean(market),
  };
}

function publicOpportunityProjection(position, projection) {
  if (!projection || position === "K") return null;
  const common = {
    team_plays: projection.team_plays,
    team_neutral_pass_rate: projection.team_neutral_pass_rate,
    reliability: projection.reliability,
    market_informed: projection.market_informed,
  };
  if (position === "QB") {
    return {
      ...common,
      projected_pass_attempts: projection.projected_pass_attempts,
      projected_carries: projection.projected_carries,
    };
  }
  if (["RB", "WR", "TE"].includes(position)) {
    return {
      ...common,
      projected_targets: projection.projected_targets,
      projected_carries: projection.projected_carries || undefined,
      target_share: projection.target_share,
      carry_share: projection.carry_share || undefined,
    };
  }
  return common;
}

function publicAvailability(availability) {
  if (!availability) return null;
  const meaningful =
    availability.applies_to_this_week ||
    availability.status ||
    num(availability.vacated_group_share) > 0;
  return meaningful ? availability : null;
}

function calibratedOutcomeProfile(
  baseProfile,
  positionModel,
  trainedFactor,
  expectedPoints,
) {
  if (!positionModel) return baseProfile;
  const tier = (positionModel.baseline_tiers || []).find(
    (row) =>
      expectedPoints >= num(row.minimum_baseline) &&
      (row.maximum_baseline == null ||
        expectedPoints <= num(row.maximum_baseline)),
  );
  const probabilityBins = tier?.probability_bins || positionModel.probability_bins || [];
  const bin = probabilityBins.find(
    (row) =>
      trainedFactor >= num(row.minimum_factor) &&
      trainedFactor <= num(row.maximum_factor),
  );
  const uncertainty = tier?.uncertainty || positionModel.uncertainty || {};
  const floor = Math.max(0, expectedPoints * num(uncertainty.p10 || 0.45));
  const ceiling = expectedPoints * num(uncertainty.p90 || 1.65);
  return {
    ...baseProfile,
    boom_probability: round(num(bin?.boom_probability || baseProfile?.boom_probability), 4),
    bust_probability: round(num(bin?.bust_probability || baseProfile?.bust_probability), 4),
    floor: round(floor),
    ceiling: round(ceiling),
    median: round(expectedPoints * num(uncertainty.p50 || 1)),
    p25: round(expectedPoints * num(uncertainty.p25 || 0.72)),
    p75: round(expectedPoints * num(uncertainty.p75 || 1.3)),
    calibration_sample: num(positionModel.final_sample),
    calibration_tier: tier?.key || "all",
    calibration_tier_sample: num(tier?.sample || positionModel.final_sample),
    calibration_source: `${(positionModel.final_fit_seasons || [2023, 2024, 2025]).join("-")} leakage-safe player-games`,
  };
}

function applyRiskyProjectionPath(weeks, baselineWeekly, volatility, position) {
  const active = weeks.filter((week) => !week.bye && !week.completed);
  if (!active.length) return weeks;
  const sensitivity = num(volatility?.matchup_sensitivity) || 1;
  const lensesByWeek = new Map(active.map((week) => [week.week, {}]));

  scoringKeys.forEach((scoring) => {
    const receptionPoints = scoring === "ppr" ? 1 : scoring === "half" ? 0.5 : 0;
    const neutral = scoreLine(baselineWeekly, receptionPoints, position);
    const expectedTotal = active.reduce(
      (sum, week) => sum + num(week.projections?.[scoring]),
      0,
    );
    const weightedMeanFactor = expectedTotal
      ? active.reduce((sum, week) => {
          const expected = num(week.projections?.[scoring]);
          return sum + (neutral ? expected / neutral : 1) * expected;
        }, 0) / expectedTotal
      : 1;
    const raw = active.map((week) => {
      const expected = num(week.projections?.[scoring]);
      const matchupFactor = neutral ? expected / neutral : 1;
      const centeredMatchup = matchupFactor - weightedMeanFactor;
      const homeSignal = week.home ? 0.012 : -0.012;
      const weatherSignal = weatherRiskSignal(week.weather, position);
      const directionSignal = centeredMatchup + homeSignal + weatherSignal;
      const strongTail = Math.abs(directionSignal) >= 0.08;
      const upper = num(
        strongTail
          ? week.outcome_profile?.ceiling
          : week.outcome_profile?.p75,
      );
      const lower = num(
        strongTail
          ? week.outcome_profile?.floor
          : week.outcome_profile?.p25,
      );
      const tailRatio =
        directionSignal >= 0
          ? upper > 0 && expected > 0
            ? upper / expected
            : 1
          : lower >= 0 && expected > 0
            ? lower / expected
            : 1;
      const scenarioWeight = clamp(
        0.18 + Math.abs(directionSignal) * 4.5 * sensitivity,
        0.18,
        0.68,
      );
      const riskyFactor = clamp(
        1 + (tailRatio - 1) * scenarioWeight,
        0.52,
        1.7,
      );
      return { week, expected, value: expected * riskyFactor };
    });
    const rawTotal = raw.reduce((sum, row) => sum + row.value, 0);
    const normalization = rawTotal ? expectedTotal / rawTotal : 1;
    raw.forEach(({ week, expected, value }) => {
      lensesByWeek.get(week.week)[scoring] = {
        safe_expected: round(expected),
        risky: round(Math.max(0, value * normalization)),
      };
    });
  });

  return weeks.map((week) => {
    if (week.bye || week.completed) return week;
    const projectionLenses = lensesByWeek.get(week.week);
    const expected = num(projectionLenses?.ppr?.safe_expected);
    const risky = num(projectionLenses?.ppr?.risky);
    const riskFactor = expected ? risky / expected : 1;
    let label = week.outcome_profile?.label || "Balanced range";
    if (riskFactor >= 1.22) label = "Boom spot";
    else if (riskFactor <= 0.78) label = "Bust risk";
    else if (riskFactor >= 1.1) label = "Ceiling lean";
    else if (riskFactor <= 0.9) label = "Floor concern";
    return {
      ...week,
      projection_lenses: projectionLenses,
      risky_factor: round(riskFactor, 4),
      outcome_profile: {
        ...week.outcome_profile,
        label,
        safe_expected_projection: round(expected),
        risky_projection: round(risky),
      },
    };
  });
}

function applyDefense(line, adjustment, position) {
  const next = cleanLine(line);
  statFields.forEach((field) => {
    next[field] *= num(adjustment?.factors?.[field]) || 1;
  });
  return guardStatRates(next, position);
}

function scoreLine(line, receptionPoints, position) {
  if (String(position || "").toUpperCase() === "K")
    return num(line.kick_pts) || num(line.fgm) * 3 + num(line.xpm);
  return (
    num(line.pass_yd) * 0.04 +
    num(line.pass_td) * 4 -
    num(line.pass_int) * 2 +
    num(line.rush_yd) * 0.1 +
    num(line.rush_td) * 6 +
    num(line.rec_yd) * 0.1 +
    num(line.rec_td) * 6 +
    num(line.rec) * receptionPoints -
    num(line.fum_lost) * 2
  );
}

function calibrateExpectedRole(line, player, statSourceCount, fallback) {
  const coherent = coherentLine(line);
  const rawPpr = scoreLine(coherent, 1, player?.position);
  const consensusPpr = num(player.points_ppr ?? player.points);
  const targetFactor =
    rawPpr > 0 && consensusPpr > 0
      ? clamp(consensusPpr / rawPpr, 0.35, 1.65)
      : 1;
  // The existing Arsenal consensus is a useful workload prior, not the answer
  // this model is required to reproduce. Strong multi-source stat coverage is
  // allowed to disagree substantially; sparse/fallback lines lean more on the
  // portfolio-wide consensus to avoid inventing a starter-sized workload.
  const sourceWeight =
    statSourceCount >= 3 ? 0.18 : statSourceCount === 2 ? 0.28 : 0.42;
  const anchorWeight = fallback ? 0.72 : sourceWeight;
  const factor = clamp(1 + (targetFactor - 1) * anchorWeight, 0.55, 1.35);
  const calibrated = coherentLine(
    Object.fromEntries(
      statFields.map((field) => [field, num(coherent[field]) * factor]),
    ),
  );
  return {
    line: {
      games: clamp(num(line.games) || 17, 1, 17),
      ...calibrated,
    },
    calibration: {
      raw_stat_model_ppr: round(rawPpr),
      arsenal_consensus_ppr: round(consensusPpr),
      consensus_target_factor: round(targetFactor, 4),
      consensus_anchor_weight: round(anchorWeight, 4),
      playing_time_factor: round(factor, 4),
      consensus_scale_factor: round(factor, 4),
      independent_stat_signal_weight: round(1 - anchorWeight, 4),
      bounded: factor === 0.55 || factor === 1.35,
    },
  };
}

function rebalanceNumerator(
  weeks,
  seasonLine,
  numerator,
  denominator,
  minimumRate,
  maximumRate,
) {
  const active = weeks.filter((week) => !week.bye && !week.completed);
  const target = num(seasonLine[numerator]);
  if (!active.length) return;
  active.forEach((week) => {
    const volume = num(week.stat_line?.[denominator]);
    const minimum = target > 0 ? volume * minimumRate : 0;
    const maximum = volume * maximumRate;
    week.stat_line[numerator] = clamp(
      num(week.stat_line?.[numerator]),
      minimum,
      maximum,
    );
  });
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const current = active.reduce(
      (sum, week) => sum + num(week.stat_line?.[numerator]),
      0,
    );
    const difference = target - current;
    if (Math.abs(difference) < 0.0001) break;
    const capacities = active.map((week) => {
      const volume = num(week.stat_line?.[denominator]);
      const value = num(week.stat_line?.[numerator]);
      return difference > 0
        ? Math.max(0, volume * maximumRate - value)
        : Math.max(0, value - (target > 0 ? volume * minimumRate : 0));
    });
    const totalCapacity = capacities.reduce((sum, value) => sum + value, 0);
    if (!totalCapacity) break;
    active.forEach((week, index) => {
      const change =
        (Math.min(Math.abs(difference), totalCapacity) * capacities[index]) /
        totalCapacity;
      week.stat_line[numerator] =
        num(week.stat_line[numerator]) + (difference > 0 ? change : -change);
    });
  }
}

function normalizeWeeklyLines(weeks, seasonLine, position) {
  const totals = cleanLine();
  weeks.forEach((week) => {
    if (week.bye || week.completed) return;
    statFields.forEach((field) => {
      totals[field] += num(week.stat_line?.[field]);
    });
  });
  const normalized = weeks.map((week) => {
    if (week.bye || week.completed) return week;
    const normalizedLine = coherentLine(
      Object.fromEntries(
        statFields.map((field) => [
          field,
          round(
            totals[field]
              ? num(week.stat_line[field]) *
                  (num(seasonLine[field]) / totals[field])
              : 0,
          ),
        ]),
      ),
    );
    return { ...week, stat_line: normalizedLine };
  });
  const constraints =
    position === "QB"
      ? [
          ["pass_cmp", "pass_att", 0.45, 0.82],
          ["pass_yd", "pass_att", 4, 10.5],
          ["pass_td", "pass_att", 0.005, 0.12],
          ["pass_int", "pass_att", 0.002, 0.1],
          ["rush_yd", "rush_att", 1.5, 10],
          ["rush_td", "rush_att", 0.002, 0.25],
        ]
      : ["RB", "WR", "TE"].includes(position)
        ? [
            ["rush_yd", "rush_att", 1.5, 9],
            ["rush_td", "rush_att", 0.002, 0.18],
            [
              "rec",
              "rec_tgt",
              position === "WR" ? 0.4 : 0.45,
              position === "RB" ? 0.95 : position === "WR" ? 0.9 : 0.93,
            ],
            [
              "rec_yd",
              "rec_tgt",
              position === "RB" ? 2.5 : position === "WR" ? 4 : 3.5,
              position === "RB" ? 11 : position === "WR" ? 14 : 12.5,
            ],
            [
              "rec_yd",
              "rec",
              position === "RB" ? 3 : position === "WR" ? 6 : 5,
              position === "RB" ? 16 : position === "WR" ? 24 : 20,
            ],
            ["rec_td", "rec_tgt", 0.001, 0.2],
          ]
        : position === "K"
          ? [
              ["fgm", "fga", 0.5, 0.99],
              ["xpm", "xpa", 0.7, 1],
            ]
          : [];
  // A second pass is intentional because receiving yards are constrained by
  // both targets and catches. The bounded redistribution preserves the season
  // totals while keeping every weekly rate physically plausible.
  for (let pass = 0; pass < 2; pass += 1)
    constraints.forEach(([numerator, denominator, minimum, maximum]) =>
      rebalanceNumerator(
        normalized,
        seasonLine,
        numerator,
        denominator,
        minimum,
        maximum,
      ),
    );
  return normalized.map((week) =>
    week.bye
      ? week
      : {
          ...week,
          stat_line: coherentLine(week.stat_line),
        },
  );
}

const schedule = await loadSchedule();
const base = readJson(consensusAnchorFile);
if (!base?.rows?.length)
  throw new Error(
    `Missing stats/projections/${season}/consensus-anchor.json. Run the projection-anchor update before building the Arsenal model.`,
  );
const completedEvidenceYears = [season - 3, season - 2, season - 1].filter(
  (year) =>
    fs.existsSync(
      path.join(
        root,
        "public",
        "stats",
        "history",
        String(year),
        "sleeper.json",
      ),
    ),
);
const liveEvidence = readJson(
  path.join(root, "public", "stats", "history", String(season), "sleeper.json"),
);
const scheduleFinalWeeks = new Set(
  (schedule.weeks || [])
    .filter(
      ({ games }) =>
        (games || []).length > 0 &&
        games.every((game) => {
          const kickoff = Date.parse(game?.date);
          return (
            Number.isFinite(kickoff) &&
            kickoff + 6 * 60 * 60 * 1000 < Date.now()
          );
        }),
    )
    .map(({ week }) => Number(week)),
);
const archivedFinalWeeks = new Set(
  Array.isArray(liveEvidence?.final_weeks)
    ? liveEvidence.final_weeks.map(Number)
    : Array.from(
        { length: num(liveEvidence?.completed_weeks) },
        (_, index) => index + 1,
      ),
);
const finalWeeks = new Set(
  [...archivedFinalWeeks].filter((week) => scheduleFinalWeeks.has(week)),
);
const evidenceYears = [
  ...completedEvidenceYears,
  ...(finalWeeks.size > 0 ? [season] : []),
];
const evidence = evidenceYears.map(seasonEvidence);
const currentEvidence = evidence.find((item) => item.year === season) || null;
const trainedCalibration = readJson(
  path.join(
    root,
    "public",
    "stats",
    "projections",
    "model-calibration.json",
  ),
  { by_position: {} },
);
const teamUsageEvidence = buildTeamUsageEvidence(evidence);
const resolveCanonicalKey = buildCanonicalKeyResolver(base.rows);
const sourceIndexes = projectionStatIndexes(resolveCanonicalKey);
const sleeperIdIndex = new Map(
  (
    readJson(path.join(root, "public", `projections_sleeper_${season}.json`), {
      rows: [],
    })?.rows || []
  )
    .filter((row) => row?.player_id && row?.name)
    .map((row) => [resolveCanonicalKey(row), String(row.player_id)]),
);
const opponentByWeek = new Map();
(schedule.weeks || []).forEach(({ week, games }) =>
  (games || []).forEach((game) => {
    opponentByWeek.set(`${week}:${normalizeTeam(game.home)}`, {
      opponent: normalizeTeam(game.away),
      home: true,
      date: game.date,
      weather: game.weather || null,
      venue: game.venue || null,
      market: game.market
        ? {
            ...game.market,
            team_spread: num(game.market.home_spread),
            implied_points:
              num(game.market.total) / 2 + num(game.market.home_spread) / 2,
          }
        : null,
    });
    opponentByWeek.set(`${week}:${normalizeTeam(game.away)}`, {
      opponent: normalizeTeam(game.home),
      home: false,
      date: game.date,
      weather: game.weather || null,
      venue: game.venue || null,
      market: game.market
        ? {
            ...game.market,
            team_spread: -num(game.market.home_spread),
            implied_points:
              num(game.market.total) / 2 - num(game.market.home_spread) / 2,
          }
        : null,
    });
  }),
);
const scheduledTeams = new Set(
  [...opponentByWeek.keys()].map((key) => key.split(":")[1]),
);
const availabilityGroup = (position) =>
  position === "RB" ? "backfield" : ["WR", "TE"].includes(position) ? "targets" : position;
const unavailableStatuses = new Set(["out", "ir", "pup", "suspended"]);
const upcomingGame = [...opponentByWeek.entries()]
  .map(([mapKey, matchup]) => ({
    week: Number(mapKey.split(":")[0]),
    kickoff: Date.parse(matchup.date),
  }))
  .filter((row) => Number.isFinite(row.kickoff) && row.kickoff >= Date.now())
  .sort((left, right) => left.kickoff - right.kickoff)[0];
const availabilityByTeam = new Map();
for (const player of base.rows || []) {
  const playerTeam = normalizeTeam(player.team);
  const playerPosition = String(player.position || "").toUpperCase();
  if (!playerTeam || !positions.has(playerPosition)) continue;
  const group = availabilityGroup(playerPosition);
  const key = `${playerTeam}|${group}`;
  const row = availabilityByTeam.get(key) || { total: 0, unavailable: 0, players: [] };
  const workload = Math.max(0, num(player.points_ppr ?? player.points));
  const status = String(player.context?.injury_status || "").toLowerCase();
  row.total += workload;
  if (unavailableStatuses.has(status)) row.unavailable += workload;
  row.players.push({ name: player.name, status, workload });
  availabilityByTeam.set(key, row);
}

let statSourcePlayers = 0;
let historyPlayers = 0;
let fallbackPlayers = 0;
const modeledPlayers = base.rows
  .filter(
    (player) =>
      positions.has(String(player.position || "").toUpperCase()) &&
      scheduledTeams.has(normalizeTeam(player.team)),
  )
  .map((player) => {
    const position = String(player.position).toUpperCase();
    const team = normalizeTeam(player.team);
    const key = playerKey(player);
    const history = aggregatePlayerHistory(key, evidence);
    if (history.games) historyPlayers += 1;
    const prior = externalStatPrior(player, sourceIndexes, history);
    let priorLine = prior.line;
    let priorType = "multi-source projected stat consensus";
    const scoreablePrior = scoreLine(priorLine, 1, position) > 0;
    let usedStatSources = prior.sources;
    if (!prior.sources.length || !scoreablePrior) {
      priorLine = syntheticLine(player, history);
      usedStatSources = [];
      priorType = history.games
        ? "historical stat fallback shaped to the Arsenal point prior"
        : "position fallback shaped to the Arsenal point prior";
      fallbackPlayers += 1;
    } else {
      statSourcePlayers += 1;
    }
    const { line: regressedLine, regression } = regressVolumeAndEfficiency(
      priorLine,
      history,
      position,
    );
    const { line: seasonLine, calibration: role_calibration } =
      calibrateExpectedRole(
        regressedLine,
        player,
        usedStatSources.length,
        usedStatSources.length === 0,
      );
    const activeWeeks = Array.from({ length: 18 }, (_, index) => index + 1)
      .map((week) => opponentByWeek.get(`${week}:${team}`))
      .filter(Boolean).length;
    const baselineWeekly = Object.fromEntries(
      statFields.map((field) => [
        field,
        num(seasonLine[field]) / Math.max(1, activeWeeks),
      ]),
    );
    const currentPlayerHistory = currentEvidence?.playerHistory.get(key);
    const volatility = playerVolatilityProfile(key, evidence);
    const learnedRoleFeatures = productionRoleFeatures(
      key,
      position,
      evidence,
      teamUsageEvidence,
    );
    const availabilityStatus = String(
      player.context?.injury_status || "",
    ).toLowerCase();
    const teamAvailability = availabilityByTeam.get(
      `${team}|${availabilityGroup(position)}`,
    ) || { total: 0, unavailable: 0, players: [] };
    const playerUnavailable = unavailableStatuses.has(availabilityStatus);
    const vacatedShare = teamAvailability.total > 0
      ? teamAvailability.unavailable / teamAvailability.total
      : 0;
    const teammateOpportunityBoost = !playerUnavailable && !["QB", "K"].includes(position)
      ? clamp(1 + vacatedShare * 0.22, 1, 1.1)
      : 1;
    const actualByWeek = new Map(
      (currentPlayerHistory?.weekly || []).map((row) => [row.week, row]),
    );
    const remainingGames = Array.from(
      { length: 18 },
      (_, index) => index + 1,
    ).filter(
      (week) => opponentByWeek.has(`${week}:${team}`) && !finalWeeks.has(week),
    ).length;
    const remainingLine = guardStatRates(
      {
        games: Math.max(1, remainingGames),
        ...Object.fromEntries(
          statFields.map((field) => [
            field,
            num(baselineWeekly[field]) * remainingGames,
          ]),
        ),
      },
      position,
    );
    const unnormalizedWeeks = Array.from(
      { length: 18 },
      (_, index) => index + 1,
    ).map((week) => {
      const matchup = opponentByWeek.get(`${week}:${team}`);
      if (!matchup)
        return {
          week,
          bye: true,
          opponent: null,
          home: null,
          kickoff: null,
          stat_line: cleanLine(),
          defense: null,
        };
      if (finalWeeks.has(week)) {
        const actual = actualByWeek.get(week);
        return {
          week,
          bye: false,
          completed: true,
          opponent: matchup.opponent,
          home: matchup.home,
          kickoff: matchup.date,
          weather: matchup.weather,
          venue: matchup.venue,
          stat_line: actual?.stats || cleanLine(),
          projections: actual?.points || { ppr: 0, half: 0, std: 0 },
          defense: null,
        };
      }
      const defense = defenseAdjustment(
        evidence,
        matchup.opponent,
        position,
        volatility,
      );
      const personalHistory = playerOpponentAdjustment(
        key,
        matchup.opponent,
        evidence,
        volatility,
      );
      const defenseFields =
        position === "QB"
          ? ["pass_att", "pass_yd", "pass_td", "rush_yd", "rush_td"]
          : position === "RB"
            ? ["rush_att", "rush_yd", "rush_td", "rec_tgt", "rec_yd"]
            : position === "K"
              ? ["fga", "fgm", "xpa", "xpm", "kick_pts"]
              : ["rec_tgt", "rec_yd", "rec_td"];
      const defenseValues = defenseFields
        .map((field) => Number(defense.raw_indices?.[field]))
        .filter(Number.isFinite);
      const defensePointsIndex = Number(defense.raw_indices?.points_ppr);
      const baselinePoints = scoreLine(baselineWeekly, 1, position);
      const advancedFeatures = advancedMatchupFeatures(
        evidence,
        team,
        matchup.opponent,
      );
      const weekFeatures = {
        baseline_points: baselinePoints,
        log_baseline: Math.log1p(Math.max(0, baselinePoints)),
        week_fraction: week / 18,
        early_season: week <= 4 ? 1 : 0,
        ...learnedRoleFeatures,
        ...advancedFeatures,
        home: matchup.home ? 1 : 0,
        defense_points_delta: Number.isFinite(defensePointsIndex)
          ? defensePointsIndex - 1
          : null,
        defense_volume_delta: defenseValues.length
          ? defenseValues.reduce((sum, value) => sum + value, 0) /
              defenseValues.length -
            1
          : null,
        personal_delta: num(personalHistory.factor) - 1,
        defense_reliability: num(defense.reliability),
        personal_reliability:
          num(personalHistory.games) / (num(personalHistory.games) + 4),
        market_implied_points_delta: matchup.market
          ? num(matchup.market.implied_points) / 22.5 - 1
          : null,
        market_spread_scaled: matchup.market
          ? clamp(num(matchup.market.team_spread) / 10, -1.5, 1.5)
          : null,
      };
      const learned = trainedAdjustment(
        position,
        trainedCalibration,
        weekFeatures,
      );
      const opportunityProjection = projectOpportunityLayer(
        position,
        baselineWeekly,
        learnedRoleFeatures,
        advancedFeatures,
        matchup.market,
      );
      const kickoffDistance = Date.parse(matchup.date) - Date.now();
      const availabilityApplies =
        upcomingGame?.week === week &&
        Number.isFinite(kickoffDistance) &&
        kickoffDistance >= -60 * 60 * 1000 &&
        kickoffDistance <= 8 * 86400000;
      const ownAvailabilityFactor = availabilityApplies
        ? playerUnavailable
          ? 0
          : availabilityStatus === "doubtful"
            ? 0.35
            : 1
        : 1;
      const availabilityFactor = ownAvailabilityFactor *
        (availabilityApplies ? teammateOpportunityBoost : 1);
      const defenseLine = learned.model
        ? Object.fromEntries(
            statFields.map((field) => [
              field,
              num(baselineWeekly[field]) * learned.factor,
            ]),
          )
        : applyDefense(baselineWeekly, defense, position);
      return {
        week,
        bye: false,
        opponent: matchup.opponent,
        home: matchup.home,
        kickoff: matchup.date,
        weather: matchup.weather,
        venue: matchup.venue,
        market: matchup.market || null,
        completed: false,
        stat_line: guardStatRates(
          {
            games: 1,
            ...Object.fromEntries(
              statFields.map((field) => [
                field,
                num(defenseLine[field]) *
                  (learned.model ? 1 : personalHistory.factor) *
                  availabilityFactor,
              ]),
            ),
          },
          position,
        ),
        defense,
        personal_history: personalHistory,
        opportunity_projection: opportunityProjection,
        availability: {
          status: availabilityStatus || null,
          applies_to_this_week: availabilityApplies,
          player_factor: round(ownAvailabilityFactor, 4),
          teammate_opportunity_factor: round(
            availabilityApplies ? teammateOpportunityBoost : 1,
            4,
          ),
          vacated_group_share: round(vacatedShare, 4),
        },
        learned_adjustment: {
          factor: round(learned.factor, 4),
          available_features: learned.available,
          signals: {
            home: weekFeatures.home,
            defense_points_delta: round(
              weekFeatures.defense_points_delta,
              5,
            ),
            defense_volume_delta: round(
              weekFeatures.defense_volume_delta,
              5,
            ),
            personal_delta: round(weekFeatures.personal_delta, 5),
            pressure_mismatch: round(weekFeatures.pressure_mismatch, 5),
            protection_pressure_rate: round(
              weekFeatures.protection_pressure_rate,
              5,
            ),
            opponent_pressure_rate: round(
              weekFeatures.opponent_pressure_rate,
              5,
            ),
            opponent_blitz_rate: round(
              weekFeatures.opponent_blitz_rate,
              5,
            ),
            ol_continuity: round(weekFeatures.ol_continuity, 5),
            opponent_man_rate: round(weekFeatures.opponent_man_rate, 5),
            opponent_zone_rate: round(weekFeatures.opponent_zone_rate, 5),
            offense_epa_per_play: round(weekFeatures.offense_epa_per_play, 5),
            offense_success_rate: round(weekFeatures.offense_success_rate, 5),
            offense_pass_rate: round(weekFeatures.offense_pass_rate, 5),
            offense_red_zone_play_rate: round(
              weekFeatures.offense_red_zone_play_rate,
              5,
            ),
            opponent_epa_per_play_allowed: round(
              weekFeatures.opponent_epa_per_play_allowed,
              5,
            ),
            opponent_success_rate_allowed: round(
              weekFeatures.opponent_success_rate_allowed,
              5,
            ),
            opponent_pass_rate_faced: round(
              weekFeatures.opponent_pass_rate_faced,
              5,
            ),
            opponent_red_zone_play_rate_allowed: round(
              weekFeatures.opponent_red_zone_play_rate_allowed,
              5,
            ),
            epa_matchup: round(weekFeatures.epa_matchup, 5),
            success_matchup: round(weekFeatures.success_matchup, 5),
            offense_neutral_pass_rate: round(
              weekFeatures.offense_neutral_pass_rate,
              5,
            ),
            offense_two_minute_rate: round(
              weekFeatures.offense_two_minute_rate,
              5,
            ),
            offense_third_down_success_rate: round(
              weekFeatures.offense_third_down_success_rate,
              5,
            ),
            offense_play_volume_delta: round(
              weekFeatures.offense_play_volume_delta,
              5,
            ),
            market_implied_points_delta: round(
              weekFeatures.market_implied_points_delta,
              5,
            ),
            market_spread_scaled: round(
              weekFeatures.market_spread_scaled,
              5,
            ),
            advanced_reliability: round(
              weekFeatures.advanced_reliability,
              5,
            ),
          },
        },
      };
    });
    const expectedWeeks = normalizeWeeklyLines(
      unnormalizedWeeks,
      remainingLine,
      position,
    ).map((week) => {
      if (week.bye)
        return {
          ...week,
          projections: { ppr: null, half: null, std: null },
          matchup_factor: null,
        };
      if (week.completed)
        return {
          ...week,
          matchup_factor: null,
          defense_index: null,
          defense_sample: null,
        };
      const projections = {
        ppr: round(scoreLine(week.stat_line, 1, position)),
        half: round(scoreLine(week.stat_line, 0.5, position)),
        std: round(scoreLine(week.stat_line, 0, position)),
      };
      const baselinePoints = scoreLine(baselineWeekly, 1, position);
      const defenseIndex = baselinePoints
        ? projections.ppr / baselinePoints
        : 1;
      const matchupFactor = baselinePoints ? projections.ppr / baselinePoints : 1;
      const baseOutcome = matchupOutcomeProfile(
        volatility,
        matchupFactor,
        baselinePoints,
      );
      const calibratedOutcome = calibratedOutcomeProfile(
        baseOutcome,
        trainedCalibration?.by_position?.[position],
        matchupFactor,
        projections.ppr,
      );
      const simulation = correlatedOutcomeSimulation({
        playerKeyValue: key,
        team,
        week: week.week,
        mean: projections.ppr,
        volatility,
        position,
        market: week.market,
      });
      return {
        ...week,
        projections,
        matchup_factor: round(matchupFactor, 4),
        defense_index: round(defenseIndex, 4),
        defense_sample: num(week.defense?.sample),
        outcome_profile: {
          ...calibratedOutcome,
          simulation,
        },
      };
    });
    const normalizedWeeks = applyRiskyProjectionPath(
      expectedWeeks,
      baselineWeekly,
      volatility,
      position,
    );
    const actualLine = cleanLine();
    const restOfSeasonLine = cleanLine();
    normalizedWeeks.forEach((week) => {
      if (week.bye) return;
      statFields.forEach((field) => {
        if (week.completed) actualLine[field] += num(week.stat_line?.[field]);
        else restOfSeasonLine[field] += num(week.stat_line?.[field]);
      });
    });
    const seasonOutlookLine = coherentLine(
      Object.fromEntries(
        statFields.map((field) => [
          field,
          num(actualLine[field]) + num(restOfSeasonLine[field]),
        ]),
      ),
    );
    const scoring = Object.fromEntries(
      scoringKeys.map((scoringKey) => {
        const actualPoints = normalizedWeeks.reduce(
          (sum, week) =>
            sum + (week.completed ? num(week.projections?.[scoringKey]) : 0),
          0,
        );
        const remainingPoints = normalizedWeeks.reduce(
          (sum, week) =>
            sum + (!week.completed ? num(week.projections?.[scoringKey]) : 0),
          0,
        );
        const seasonPoints = actualPoints + remainingPoints;
        const rawConsensusAnchor =
          player[
            scoringKey === "half"
              ? "points_half"
              : scoringKey === "std"
                ? "points_std"
                : "points_ppr"
          ] ?? player.points;
        const anchorAvailable =
          num(player.format_source_count?.[scoringKey]) > 0 &&
          Number.isFinite(Number(rawConsensusAnchor)) &&
          Number(rawConsensusAnchor) > 0;
        const consensusAnchor = anchorAvailable
          ? num(rawConsensusAnchor)
          : null;
        return [
          scoringKey,
          {
            season_points: round(seasonPoints),
            actual_points: round(actualPoints),
            remaining_points: round(remainingPoints),
            consensus_anchor: anchorAvailable ? round(consensusAnchor) : null,
            variance_from_anchor: anchorAvailable
              ? round(seasonPoints - consensusAnchor)
              : null,
            consensus_anchor_sources: num(
              player.format_source_count?.[scoringKey],
            ),
          },
        ];
      }),
    );
    const learnedPositionModel = trainedCalibration?.by_position?.[position];
    const learnedWeeks = unnormalizedWeeks.filter(
      (week) => !week.bye && !week.completed && week.learned_adjustment,
    );
    const trainedFeatureCount = Math.max(
      1,
      Object.keys(learnedPositionModel?.features || {}).length,
    );
    const trainedFeatureCoverage = learnedWeeks.length
      ? learnedWeeks.reduce(
          (sum, week) =>
            sum + num(week.learned_adjustment?.available_features),
          0,
        ) /
        (learnedWeeks.length * trainedFeatureCount)
      : num(learnedRoleFeatures.available_features) / trainedFeatureCount;
    const holdoutValidated =
      num(learnedPositionModel?.holdout_mae_improvement) > 0;
    const sourceCoverageScore = usedStatSources.length * 7;
    const historyCoverageScore = Math.min(12, history.effectiveGames * 0.55);
    const trainedCoverageScore = trainedFeatureCoverage * 8;
    const validationScore = holdoutValidated ? 4 : -8;
    const fallbackPenalty = usedStatSources.length ? 0 : 18;
    const confidence = Math.round(
      clamp(
        num(player.confidence) * 0.62 +
          sourceCoverageScore +
          historyCoverageScore +
          trainedCoverageScore +
          validationScore +
          (evidenceYears.length / 3) * 6 -
          fallbackPenalty,
        20,
        98,
      ),
    );
    return {
      player_id: player.player_id || sleeperIdIndex.get(key) || "",
      name: player.name,
      team,
      position,
      confidence,
      confidence_components: {
        source_projection_confidence: round(num(player.confidence), 1),
        projected_stat_sources: usedStatSources.length,
        historical_effective_games: round(history.effectiveGames, 1),
        trained_feature_coverage: round(trainedFeatureCoverage, 4),
        holdout_validated: holdoutValidated,
        bounded_fallback: usedStatSources.length === 0,
      },
      source_count: num(player.source_count),
      disagreement: num(player.disagreement),
      model_version: MODEL_VERSION,
      model_build_id: MODEL_BUILD_ID,
      stat_prior: {
        type: priorType,
        sources: usedStatSources,
        ignored_sources:
          prior.sources.length && !scoreablePrior ? prior.sources : [],
        field_coverage: prior.coverage,
        weighting: "adaptive field-level agreement weighting",
      },
      regression,
      volatility: {
        games: volatility.games,
        cv: volatility.cv,
        boom_rate: volatility.boom_rate,
        bust_rate: volatility.bust_rate,
        reliability: volatility.reliability,
        matchup_sensitivity: volatility.matchup_sensitivity,
      },
      role_calibration,
      learned_role: {
        calibration_version: trainedCalibration?.version || null,
        features: learnedRoleFeatures,
        advanced_feature_names: advancedFeatureNames,
        advanced_features_enabled: advancedFeatureNames.filter((feature) =>
          Object.prototype.hasOwnProperty.call(
            trainedCalibration?.by_position?.[position]?.features || {},
            feature,
          ),
        ),
        opportunity_feature_names: opportunityFeatureNames,
        opportunity_features_enabled: opportunityFeatureNames.filter((feature) =>
          Object.prototype.hasOwnProperty.call(
            trainedCalibration?.by_position?.[position]?.features || {},
            feature,
          ),
        ),
        available_features: round(
          trainedFeatureCoverage * trainedFeatureCount,
          2,
        ),
        feature_coverage: round(trainedFeatureCoverage, 4),
        feature_count: Object.keys(
          trainedCalibration?.by_position?.[position]?.features || {},
        ).length,
        holdout: trainedCalibration?.by_position?.[position]
          ? {
              sample:
                trainedCalibration.by_position[position].validation_sample,
              baseline_mae:
                trainedCalibration.by_position[position].holdout_baseline?.mae,
              trained_mae:
                trainedCalibration.by_position[position].holdout_trained?.mae,
              improvement:
                trainedCalibration.by_position[position]
                  .holdout_mae_improvement,
            }
          : null,
      },
      projected_stat_line: sparseLine(seasonLine),
      projected_games: round(seasonLine.games, 1),
      completed_games: activeWeeks - remainingGames,
      remaining_games: remainingGames,
      actual_stat_line: sparseLine(actualLine),
      rest_of_season_stat_line: sparseLine(restOfSeasonLine),
      season_outlook_stat_line: sparseLine(seasonOutlookLine),
      weeks: normalizedWeeks.map((week) => ({
        week: week.week,
        bye: week.bye,
        completed: Boolean(week.completed),
        opponent: week.opponent,
        home: week.home,
        kickoff: week.kickoff,
        stat_line: sparseLine(week.stat_line),
        projections: week.projections,
        matchup_factor: week.matchup_factor,
        defense_index: week.defense_index,
        defense_sample: week.defense_sample,
        personal_history: week.personal_history || null,
        learned_adjustment: week.learned_adjustment || null,
        opportunity_projection: publicOpportunityProjection(
          player.position,
          week.opportunity_projection,
        ),
        availability: publicAvailability(week.availability),
        market: week.market || null,
        weather: week.weather || null,
        venue: week.venue || null,
        outcome_profile: week.outcome_profile
          ? {
              ...week.outcome_profile,
              simulation: week.outcome_profile.simulation
                ? {
                    p10: week.outcome_profile.simulation.p10,
                    median: week.outcome_profile.simulation.median,
                    p90: week.outcome_profile.simulation.p90,
                    boom_probability:
                      week.outcome_profile.simulation.boom_probability,
                    bust_probability:
                      week.outcome_profile.simulation.bust_probability,
                  }
                : null,
            }
          : null,
        projection_lenses: week.projection_lenses || null,
        risky_factor: week.risky_factor ?? null,
      })),
      scoring,
    };
  });

const modelPlayerIds = new Map();
modeledPlayers.forEach((player) => {
  if (!player.player_id) return;
  const existing = modelPlayerIds.get(player.player_id);
  if (existing)
    throw new Error(
      `Duplicate Sleeper identity ${player.player_id}: ${existing} and ${player.name}. Canonicalize the source aliases before publishing this model.`,
    );
  modelPlayerIds.set(player.player_id, player.name);
});

const generatedAt = new Date().toISOString();
const modelInputFiles = [
  consensusAnchorFile,
  path.join(root, "public", `projections_sleeper_${season}.json`),
  path.join(root, "public", `projections_fantasypros_${season}.json`),
  path.join(root, "public", `projections_draftsharks_${season}.json`),
  path.join(root, "public", `projections_fantasysharks_${season}.json`),
  path.join(
    root,
    "public",
    "stats",
    "projections",
    String(season),
    "schedule.json",
  ),
  path.join(root, "src", "data", "nfl-stadiums.json"),
  path.join(root, "data", "player-identity-aliases.json"),
  path.join(
    root,
    "public",
    "stats",
    "projections",
    "model-calibration.json",
  ),
  ...evidenceYears.flatMap((year) =>
    ["sleeper.json", "schedule.json", "fantasypros.json"].map((file) =>
      path.join(root, "public", "stats", "history", String(year), file),
    ),
  ),
  ...evidenceYears.map((year) =>
    path.join(root, "public", "stats", "advanced", String(year), "context.json"),
  ),
];
const inputManifest = {
  captured_at: generatedAt,
  feature_version: FEATURE_VERSION,
  files: [...new Set(modelInputFiles)]
    .map(fingerprintFile)
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path)),
};
inputManifest.bundle_sha256 = crypto
  .createHash("sha256")
  .update(
    inputManifest.files
      .map((file) => `${file.path}:${file.sha256}`)
      .join("\n"),
  )
  .digest("hex");

const output = {
  source: "The Fantasy Arsenal Stat Projection Model",
  season,
  generated_at: generatedAt,
  model_version: MODEL_VERSION,
  model_build_id: MODEL_BUILD_ID,
  schema_version: MODEL_SCHEMA,
  feature_version: FEATURE_VERSION,
  input_manifest: inputManifest,
  status: "experimental",
  trained_calibration: {
    version: trainedCalibration?.version || null,
    generated_at: trainedCalibration?.generated_at || null,
    validation: trainedCalibration?.validation || null,
    positions: Object.fromEntries(
      Object.entries(trainedCalibration?.by_position || {}).map(
        ([position, row]) => [
          position,
          {
            training_sample: row.training_sample,
            validation_sample: row.validation_sample,
            application_strength: row.application_strength,
            holdout_baseline_mae: row.holdout_baseline?.mae,
            holdout_trained_mae: row.holdout_trained?.mae,
            holdout_mae_improvement: row.holdout_mae_improvement,
          },
        ],
      ),
    ),
  },
  evidence_seasons: evidenceYears,
  scoring_variants: scoringKeys,
  count: modeledPlayers.length,
  feature_coverage: {
    projected_stat_source_players: statSourcePlayers,
    historical_raw_stat_players: historyPlayers,
    bounded_fallback_players: fallbackPlayers,
    trained_adjustment_players: modeledPlayers.filter(
      (player) => player.learned_role?.holdout?.improvement > 0,
    ).length,
    trained_adjustment_version: trainedCalibration?.version || null,
    average_role_features: round(
      modeledPlayers.reduce(
        (sum, player) =>
          sum + num(player.learned_role?.available_features),
        0,
      ) / Math.max(1, modeledPlayers.length),
      2,
    ),
    projected_stat_sources: sourceIndexes.map((source) => ({
      source: source.name,
      players: source.index.size,
      updated: source.updated,
    })),
    advanced_context_seasons: evidence.filter(
      (row) => num(row.advancedCoverage?.team_weeks) > 0,
    ).map((row) => ({ year: row.year, ...row.advancedCoverage })),
  },
  scoring_rules: {
    pass_yard: 0.04,
    pass_touchdown: 4,
    interception: -2,
    rush_yard: 0.1,
    rush_touchdown: 6,
    receiving_yard: 0.1,
    receiving_touchdown: 6,
    reception: { ppr: 1, half: 0.5, std: 0 },
    fumble_lost: -2,
    kicker_note:
      "Published kick points are preferred; otherwise field goals are approximated at three points plus extra points.",
  },
  methodology: {
    baseline:
      "The model independently scores a coherent stat line. The existing Fantasy Arsenal consensus is retained as a bounded workload prior and comparison point, not a forced final answer.",
    projected_stats:
      "Canonical projected stat lines combine FantasyPros, DraftSharks, and FantasySharks field-level projections with a 35% outlier guard and adaptive per-field agreement weights. Raw source contributions are retained for later accuracy learning.",
    regression: `Projected volume and efficiency are blended toward the player's recency-weighted ${completedEvidenceYears.join("–")} raw Sleeper production. Historical influence is sample-sized, capped at 22%, with volume bounded to +/-6% and efficiency to +/-5%.`,
    live_learning:
      finalWeeks.size > 0
        ? `${season} finalized results through Week ${Math.max(...finalWeeks)} are blended progressively; early-season samples are heavily shrunk and gain influence as evidence grows. Past weeks remain actual and only unplayed games are reforecast.`
        : `${season} results have not started. The daily workflow will begin adding progressively weighted current-season evidence after completed box scores exist.`,
    role_calibration:
      "The Arsenal consensus supplies 18% of role calibration when three projected-stat sources agree, 28% with two sources, 42% with one, and 72% only for synthetic fallbacks. The remaining weight belongs to the independent stat model, and the transparent final scale factor is bounded between 55% and 135%.",
    matchup:
      "Weekly redistribution uses position-specific leakage-safe adjustments trained on role, snap, opportunity, red-zone, air-yard, pace, opponent, home, personal history, pass protection, defensive pressure, blitz, coverage, offensive-line continuity, motion, play action, screen, and RPO context. Every position must beat its untrained and incumbent 2025 holdout before a challenger is enabled.",
    advanced_context:
      "Compact nflverse archives add weekly PFR pressure and snaps, play-level team environment and player opportunities, FTN charting, and NFL Next Gen Stats. Features are calculated only from games available before the forecast target, are sample-weighted, and remain neutral unless their position-specific challenger clears the untouched holdout.",
    opportunity_model:
      "The two-stage layer first estimates team plays and pass rate, then allocates targets, carries, high-value touches, two-minute work, and third-down work by a player's recency-weighted role. Volume and per-opportunity efficiency are exposed separately; only holdout-validated position layers influence the expected projection.",
    availability:
      "Inside the final eight days before the next kickoff, OUT/IR/PUP/suspended players are removed from that week, doubtful players receive a conservative availability factor, and a capped teammate-vacancy factor can redistribute opportunity. Season totals are rebalanced across later active weeks rather than silently erased.",
    simulation:
      "Each active player-week includes 500 deterministic Monte Carlo outcomes with a shared team component and player-specific volatility. This produces correlated P10/P25/median/P75/P90 ranges without changing the validated expected mean.",
    trained_features:
      "The compact published calibration contains coefficients, feature means, missing-value fallbacks, sample sizes, regularization, shrinkage, and 2025 holdout results. Detailed player-game training rows remain local.",
    player_matchup_history:
      "When at least two recent meetings exist, each result is compared with that player's same-season average against every other opponent. The recency-weighted residual is sample-regressed, volatility-aware, and capped at +/-6%, so opponent history can create direction without overpowering role or projected stats.",
    outcomes:
      "Safe / Expected is the calibrated mean path. Floor, median, ceiling, and boom/bust probabilities use empirical residual distributions from 2023-2025 leakage-safe player-games. Risky follows the appropriate calibrated tail only when matchup, venue, personal-history, or weather evidence supplies direction, then remains season-total neutral.",
    schedule:
      "The saved ESPN NFL schedule supplies opponent, home/away, bye, and kickoff context.",
    normalization:
      "Before the season, matchups redistribute the projected stat line across all active weeks. In season, finalized weeks remain actual while projected per-game pace is distributed only across unplayed games.",
    scoring:
      "STD, Half-PPR, and PPR points are derived from one coherent weekly stat line rather than independently scaling fantasy-point totals.",
    accuracy:
      "Dated snapshots are immutable evidence; the final pre-kickoff snapshot must be used for evaluation.",
    known_limit:
      "Historical source files carry a season-level team. Opponent splits for players traded in-season are directional until weekly team identity is archived.",
  },
  players: modeledPlayers,
};
const outputDirectory = path.join(
  root,
  "public",
  "stats",
  "projections",
  String(season),
);
// Cloudflare Pages rejects individual static assets larger than 25 MiB. Keep
// the stable current.json URL as a lightweight model manifest and publish the
// detailed player research rows in position shards. Consumers can reconstruct
// the exact former payload without any loss of model detail.
const playerShardDescriptors = [...new Set(modeledPlayers.map((player) =>
  String(player.position || "OTHER").toUpperCase(),
))]
  .sort()
  .map((position) => {
    const players = modeledPlayers.filter(
      (player) => String(player.position || "OTHER").toUpperCase() === position,
    );
    const fileName = `current-${position.toLowerCase()}.json`;
    writeJson(path.join(outputDirectory, fileName), {
      season,
      generated_at: output.generated_at,
      model_version: MODEL_VERSION,
      model_build_id: MODEL_BUILD_ID,
      position,
      count: players.length,
      players,
    });
    return {
      position,
      count: players.length,
      path: `/stats/projections/${season}/${fileName}`,
    };
  });
const currentIndex = {
  ...output,
  players: [],
  player_count: modeledPlayers.length,
  player_shards: playerShardDescriptors,
};
writeJson(path.join(outputDirectory, "current.json"), currentIndex);
const modeledIdentities = new Set(
  modeledPlayers.flatMap((player) => [
    player.player_id ? `id:${player.player_id}` : "",
    `name:${normalizeName(player.name)}|${player.position}`,
  ]).filter(Boolean),
);
const compactModelRows = modeledPlayers.map((player) => ({
  player_id: String(player.player_id || ""),
  name: player.name,
  team: player.team,
  position: player.position,
  points: round(player.scoring?.ppr?.season_points),
  points_ppr: round(player.scoring?.ppr?.season_points),
  points_half: round(player.scoring?.half?.season_points),
  points_std: round(player.scoring?.std?.season_points),
  remaining_points_ppr: round(player.scoring?.ppr?.remaining_points),
  remaining_points_half: round(player.scoring?.half?.remaining_points),
  remaining_points_std: round(player.scoring?.std?.remaining_points),
  actual_points_ppr: round(player.scoring?.ppr?.actual_points),
  actual_points_half: round(player.scoring?.half?.actual_points),
  actual_points_std: round(player.scoring?.std?.actual_points),
  confidence: player.confidence,
  projection_basis: "arsenal_safe_expected",
  model_version: MODEL_VERSION,
  model_build_id: MODEL_BUILD_ID,
  weeks: (player.weeks || []).map((week) => ({
    week: week.week,
    opponent: week.opponent || null,
    home: Boolean(week.home),
    bye: Boolean(week.bye),
    completed: Boolean(week.completed),
    kickoff: week.kickoff || null,
    points_ppr: round(week.projections?.ppr),
    points_half: round(week.projections?.half),
    points_std: round(week.projections?.std),
    confidence: player.confidence,
  })),
}));
const fallbackRows = (base.rows || [])
  .filter((row) => {
    const idKey = row.player_id ? `id:${row.player_id}` : "";
    const nameKey = `name:${normalizeName(row.name)}|${String(row.position || "").toUpperCase()}`;
    return !(idKey && modeledIdentities.has(idKey)) && !modeledIdentities.has(nameKey);
  })
  .map((row) => ({
    player_id: String(row.player_id || ""),
    name: row.name,
    team: row.team || "",
    position: String(row.position || "").toUpperCase(),
    points: round(row.points_ppr ?? row.points),
    points_ppr: round(row.points_ppr ?? row.points),
    points_half: round(row.points_half ?? row.points),
    points_std: round(row.points_std ?? row.points),
    remaining_points_ppr: round(row.points_ppr ?? row.points),
    remaining_points_half: round(row.points_half ?? row.points),
    remaining_points_std: round(row.points_std ?? row.points),
    actual_points_ppr: 0,
    actual_points_half: 0,
    actual_points_std: 0,
    confidence: Math.min(70, Number(row.confidence) || 55),
    projection_basis: "consensus_fallback",
    fallback_reason: "Position is not yet modeled by the Arsenal stat engine.",
    weeks: [],
  }));
const compactRows = [...compactModelRows, ...fallbackRows].sort(
  (left, right) => Number(right.points) - Number(left.points),
);
const compactById = {};
const compactByName = {};
compactRows.forEach((row) => {
  if (row.player_id) compactById[row.player_id] = row.points;
  compactByName[normalizeName(row.name)] = row.points;
});
const compactOutput = {
  updated: output.generated_at,
  season,
  source: "The Fantasy Arsenal Projections",
  scoring: "STD/HALF/PPR",
  scoring_variants: scoringKeys,
  default_scoring: "ppr",
  projection_lens: "safe_expected",
  model_version: MODEL_VERSION,
  model_build_id: MODEL_BUILD_ID,
  status: output.status,
  supported_model_positions: [...positions],
  fallback_positions: [...new Set(fallbackRows.map((row) => row.position))].sort(),
  count: compactRows.length,
  modeled_count: compactModelRows.length,
  fallback_count: fallbackRows.length,
  rows: compactRows,
  by_id: compactById,
  by_name: compactByName,
};
writeJson(compactProjectionFile, compactOutput);

const freshnessFile = path.join(root, "public", "source-freshness.json");
const freshness = readJson(freshnessFile, { updated_at: null, sources: {} });
freshness.updated_at = output.generated_at;
freshness.sources = {
  ...(freshness.sources || {}),
  arsenal_model_proj: {
    key: "arsenal_model_proj",
    name: "The Fantasy Arsenal Projections",
    status: "success",
    last_attempt_at: output.generated_at,
    last_success_at: output.generated_at,
    last_error: "",
  },
};
writeJson(freshnessFile, freshness);
writeJson(path.join(root, "public", "stats", "projections", "manifest.json"), {
  current_season: season,
  model_path: `/stats/projections/${season}/current.json`,
  source_path: `/projections_thefantasyarsenal_model_${season}.json`,
  consensus_anchor_path: `/stats/projections/${season}/consensus-anchor.json`,
  accuracy_path: `/stats/projections/${season}/accuracy.json`,
  audit_path: `/stats/projections/${season}/audit.json`,
  identity_path: `/stats/projections/${season}/identities.json`,
  calibration_path: "/stats/projections/model-calibration.json",
  generated_at: output.generated_at,
  model_version: MODEL_VERSION,
  model_build_id: MODEL_BUILD_ID,
  feature_version: FEATURE_VERSION,
  input_bundle_sha256: inputManifest.bundle_sha256,
  status: output.status,
});
if (archive) {
  const now = Date.now();
  const activeWeekSchedule = (schedule.weeks || []).find(({ games }) =>
      (games || []).some((game) => Date.parse(game.date) >= now),
    );
  const activeWeek = activeWeekSchedule?.week || 18;
  const generatedAtMs = Date.parse(output.generated_at);
  const candidatePlayers = modeledPlayers
    .map((player) => ({
      player_id: player.player_id,
      name: player.name,
      team: player.team,
      position: player.position,
      confidence: player.confidence,
      disagreement: player.disagreement,
      stat_sources: player.stat_prior.sources,
      historical_games: player.regression.history_games,
      role_calibration: player.role_calibration,
      learned_role: player.learned_role,
      consensus_anchors: Object.fromEntries(
        scoringKeys.map((key) => [key, player.scoring[key].consensus_anchor]),
      ),
      forecast: player.weeks.find((row) => row.week === activeWeek) || null,
    }))
    .filter(
      (player) =>
        player.forecast && !player.forecast.bye && !player.forecast.completed,
    );
  const preKickoffPlayers = candidatePlayers.filter((player) => {
    const kickoff = Date.parse(player.forecast?.kickoff);
    return Number.isFinite(kickoff) && generatedAtMs < kickoff;
  });
  const upcomingKickoffs = preKickoffPlayers
    .map((player) => Date.parse(player.forecast?.kickoff))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const hoursUntilNextKickoff = upcomingKickoffs.length
    ? (upcomingKickoffs[0] - generatedAtMs) / 3600000
    : null;
  const snapshotClass =
    hoursUntilNextKickoff === null
      ? "no_upcoming_games"
      : hoursUntilNextKickoff <= 3
        ? "final_window"
        : hoursUntilNextKickoff <= 24
          ? "late_week"
          : hoursUntilNextKickoff <= 72
            ? "midweek"
            : "early_week";
  const snapshotId = crypto
    .createHash("sha256")
    .update(
      [
        season,
        activeWeek,
        output.generated_at,
        MODEL_BUILD_ID,
        inputManifest.bundle_sha256,
      ].join("|"),
    )
    .digest("hex");
  const snapshot = {
    snapshot_id: snapshotId,
    source: output.source,
    season,
    week: activeWeek,
    generated_at: output.generated_at,
    data_cutoff_at: output.generated_at,
    snapshot_class: snapshotClass,
    model_version: MODEL_VERSION,
    model_build_id: MODEL_BUILD_ID,
    schema_version: MODEL_SCHEMA,
    feature_version: FEATURE_VERSION,
    status: output.status,
    input_manifest: inputManifest,
    capture: {
      candidate_players: candidatePlayers.length,
      pre_kickoff_players: preKickoffPlayers.length,
      excluded_after_kickoff: candidatePlayers.length - preKickoffPlayers.length,
      hours_until_next_kickoff: round(hoursUntilNextKickoff, 2),
      earliest_kickoff: upcomingKickoffs.length
        ? new Date(upcomingKickoffs[0]).toISOString()
        : null,
      latest_kickoff: upcomingKickoffs.length
        ? new Date(upcomingKickoffs.at(-1)).toISOString()
        : null,
    },
    scoring_rules: output.scoring_rules,
    methodology: output.methodology,
    feature_coverage: output.feature_coverage,
    players: preKickoffPlayers,
  };
  const timestamp = output.generated_at.replace(/:/g, "-");
  writeJson(
    path.join(
      root,
      "public",
      "archive",
      "stat-projections",
      String(season),
      `${timestamp}_${MODEL_VERSION}.json`,
    ),
    snapshot,
  );
}
console.log(
  `Saved ${modeledPlayers.length} ${season} weekly stat-model projections (${MODEL_VERSION}) using ${evidenceYears.join(", ")} evidence.`,
);
console.log(
  `Stat sources: ${statSourcePlayers}; raw history: ${historyPlayers}; bounded fallbacks: ${fallbackPlayers}.`,
);
