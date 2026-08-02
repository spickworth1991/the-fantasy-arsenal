import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Papa from "papaparse";
import zlib from "zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const currentSeason = new Date().getUTCFullYear();
const outputRoot = path.join(root, "public", "stats", "advanced");
const force = process.argv.includes("--force");
const currentOnly = process.argv.includes("--current");
const requested = process.argv
  .find((argument) => argument.startsWith("--seasons="))
  ?.split("=")[1];
const seasons = requested
  ? requested.split(",").map(Number).filter(Number.isFinite)
  : currentOnly
    ? [currentSeason]
    : Array.from(
        { length: Math.min(5, Math.max(1, currentSeason - 2021)) },
        (_, index) => currentSeason - Math.min(4, currentSeason - 2022) + index,
      ).filter((season) => season >= 2022 && season <= currentSeason);

const number = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : 0;
const finite = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const round = (value, places = 5) =>
  Number.isFinite(Number(value)) ? Number(Number(value).toFixed(places)) : null;
const normalizeTeam = (team) =>
  ({ OAK: "LV", SD: "LAC", STL: "LAR", JAX: "JAC", WSH: "WAS" })[
    String(team || "").toUpperCase()
  ] || String(team || "").toUpperCase();
const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const boolean = (value) =>
  value === true || value === 1 || /^(true|t|yes|1)$/i.test(String(value || ""));
const writeJson = (file, payload) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
};
const parseCsv = (text, label) => {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (header) => String(header || "").trim(),
  });
  const serious = (parsed.errors || []).filter(
    (error) => error.code !== "TooFewFields" && error.code !== "TooManyFields",
  );
  if (serious.length)
    throw new Error(`${label} CSV parse failed: ${serious[0].message}`);
  return parsed.data || [];
};

async function fetchRows(url, label) {
  const response = await fetch(url, {
    headers: { "User-Agent": "The-Fantasy-Arsenal/advanced-model" },
  });
  if (response.status === 404) {
    console.warn(`  - ${label}: not published for this season yet`);
    return { rows: [], status: "not_published", url };
  }
  if (!response.ok)
    throw new Error(`${label} returned HTTP ${response.status}`);
  const text = await response.text();
  const rows = parseCsv(text, label);
  console.log(`  - ${label}: ${rows.length.toLocaleString()} rows`);
  return { rows, status: "available", url };
}

async function processGzipRows(url, label, onRow) {
  const response = await fetch(url, {
    headers: { "User-Agent": "The-Fantasy-Arsenal/advanced-model" },
  });
  if (response.status === 404) {
    console.warn(`  - ${label}: not published for this season yet`);
    return { status: "not_published", url, rows: 0 };
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const text = zlib.gunzipSync(compressed).toString("utf8");
  let rows = 0;
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    step: ({ data }) => {
      rows += 1;
      onRow(data);
    },
  });
  const serious = (parsed.errors || []).filter(
    (error) => error.code !== "TooFewFields" && error.code !== "TooManyFields",
  );
  if (serious.length)
    throw new Error(`${label} CSV parse failed: ${serious[0].message}`);
  console.log(`  - ${label}: ${rows.toLocaleString()} rows`);
  return { status: "available", url, rows };
}

let playerDirectoryPromise;
async function loadPlayerDirectory() {
  if (!playerDirectoryPromise)
    playerDirectoryPromise = fetchRows(
      "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv",
      "nflverse player identity directory",
    );
  return playerDirectoryPromise;
}

function teamsFromGameId(gameId) {
  const parts = String(gameId || "").split("_");
  if (parts.length < 4) return [];
  return [normalizeTeam(parts.at(-2)), normalizeTeam(parts.at(-1))];
}

function opponentFromGame(gameId, team) {
  const normalized = normalizeTeam(team);
  return teamsFromGameId(gameId).find((candidate) => candidate !== normalized) || "";
}

function emptyTeamWeek(season, week, team, opponent = "") {
  return {
    season,
    week,
    team,
    opponent,
    offense: {
      pressure_opportunities: 0,
      sacks_allowed: 0,
      blitzes_faced: 0,
      hurries_allowed: 0,
      hits_allowed: 0,
      pressures_allowed: 0,
      bad_throws: 0,
      participation_pass_plays: 0,
      participation_plays: 0,
      participation_pressures: 0,
      time_to_throw_total: 0,
      time_to_throw_plays: 0,
      pass_rushers_total: 0,
      pass_rushers_plays: 0,
      shotgun_plays: 0,
      under_center_plays: 0,
      personnel_11_plays: 0,
      personnel_12_plays: 0,
      route_plays: 0,
      deep_route_plays: 0,
      short_route_plays: 0,
      ftn_plays: 0,
      ftn_pass_plays: 0,
      motion_plays: 0,
      play_action_plays: 0,
      screen_plays: 0,
      rpo_plays: 0,
      no_huddle_plays: 0,
      catchable_throws: 0,
      contested_throws: 0,
      charted_drops: 0,
      qb_fault_sacks: 0,
      pbp_plays: 0,
      pbp_pass_plays: 0,
      pbp_rush_plays: 0,
      pbp_epa: 0,
      pbp_successes: 0,
      pbp_red_zone_plays: 0,
      pbp_targets: 0,
      pbp_air_yards: 0,
      neutral_plays: 0,
      neutral_pass_plays: 0,
      two_minute_plays: 0,
      third_down_plays: 0,
      third_down_conversions: 0,
      implied_points_total: 0,
      spread_total: 0,
      market_samples: 0,
    },
    defense: {
      blitzes: 0,
      hurries: 0,
      hits: 0,
      sacks: 0,
      pressures: 0,
      targets: 0,
      completions_allowed: 0,
      yards_allowed: 0,
      touchdowns_allowed: 0,
      interceptions: 0,
      missed_tackles: 0,
      coverage_plays: 0,
      man_plays: 0,
      zone_plays: 0,
      ftn_pass_plays: 0,
      ftn_blitzers_total: 0,
      ftn_pass_rushers_total: 0,
      pbp_plays: 0,
      pbp_pass_plays: 0,
      pbp_rush_plays: 0,
      pbp_epa_allowed: 0,
      pbp_successes_allowed: 0,
      pbp_red_zone_plays: 0,
    },
    snaps: {
      team_offense_snaps: 0,
      team_defense_snaps: 0,
      ol_players: [],
    },
  };
}

function buildSeasonPayload(season) {
  const teamWeeks = new Map();
  const playerWeeks = new Map();
  const playOffense = new Map();
  const keyOf = (week, team) => `${Number(week)}|${normalizeTeam(team)}`;
  const getTeamWeek = (weekValue, teamValue, opponentValue = "") => {
    const week = Number(weekValue);
    const team = normalizeTeam(teamValue);
    if (!week || week > 18 || !team) return null;
    const key = keyOf(week, team);
    const current =
      teamWeeks.get(key) ||
      emptyTeamWeek(season, week, team, normalizeTeam(opponentValue));
    if (!current.opponent && opponentValue)
      current.opponent = normalizeTeam(opponentValue);
    teamWeeks.set(key, current);
    return current;
  };
  return { teamWeeks, playerWeeks, playOffense, getTeamWeek, keyOf };
}

function emptyPlayerWeek({ week, team, opponent, meta, fallbackName, fallbackPosition }) {
  return {
    week: Number(week),
    name: meta?.display_name || fallbackName || "",
    gsis_id: meta?.gsis_id || null,
    pfr_player_id: meta?.pfr_id || null,
    position: String(meta?.position || fallbackPosition || "").toUpperCase(),
    team: normalizeTeam(team),
    opponent: normalizeTeam(opponent),
    offense_snaps: 0,
    offense_pct: 0,
    pass_attempts: 0,
    dropbacks: 0,
    targets: 0,
    air_yards: 0,
    receiving_epa: 0,
    receptions: 0,
    receiving_yards: 0,
    carries: 0,
    rushing_epa: 0,
    rushing_yards: 0,
    red_zone_targets: 0,
    red_zone_carries: 0,
    inside_10_carries: 0,
    inside_5_carries: 0,
    third_down_opportunities: 0,
    two_minute_opportunities: 0,
    deep_targets: 0,
    ngs: {},
  };
}

function finalizePlayerWeeks(context) {
  return [...context.playerWeeks.values()]
    .map((row) => {
      const teamWeek = context.teamWeeks.get(context.keyOf(row.week, row.team));
      const offense = teamWeek?.offense || {};
      const opportunities = number(row.targets) + number(row.carries);
      const teamOpportunities = number(offense.pbp_targets) + number(offense.pbp_rush_plays);
      const teamRedZone = number(offense.pbp_red_zone_plays);
      return {
        ...row,
        offense_snaps: round(row.offense_snaps),
        offense_pct: round(row.offense_pct),
        opportunity_share: teamOpportunities
          ? round(opportunities / teamOpportunities)
          : null,
        target_share: offense.pbp_targets
          ? round(number(row.targets) / offense.pbp_targets)
          : null,
        carry_share: offense.pbp_rush_plays
          ? round(number(row.carries) / offense.pbp_rush_plays)
          : null,
        air_yard_share: offense.pbp_air_yards
          ? round(number(row.air_yards) / offense.pbp_air_yards)
          : null,
        red_zone_share: teamRedZone
          ? round(
              (number(row.red_zone_targets) + number(row.red_zone_carries)) /
                teamRedZone,
            )
          : null,
        high_value_touches:
          number(row.red_zone_targets) +
          number(row.inside_10_carries) +
          number(row.deep_targets),
        yards_per_target: row.targets
          ? round(number(row.receiving_yards) / row.targets)
          : null,
        yards_per_carry: row.carries
          ? round(number(row.rushing_yards) / row.carries)
          : null,
        receiving_epa_per_target: row.targets
          ? round(number(row.receiving_epa) / row.targets)
          : null,
        rushing_epa_per_carry: row.carries
          ? round(number(row.rushing_epa) / row.carries)
          : null,
      };
    })
    .sort((left, right) => left.week - right.week || left.name.localeCompare(right.name));
}

function finalizeTeamWeeks(context) {
  const rows = [...context.teamWeeks.values()].sort(
    (left, right) => left.week - right.week || left.team.localeCompare(right.team),
  );
  // Capture raw denominators before replacing each accumulator with its compact
  // public form; otherwise alphabetical iteration could make rates order-dependent.
  const pressureOpportunities = new Map(
    rows.map((row) => [
      context.keyOf(row.week, row.team),
      Math.max(
        row.offense.pressure_opportunities,
        row.offense.participation_pass_plays,
      ),
    ]),
  );
  const priorOl = new Map();
  for (const row of rows) {
    const offense = row.offense;
    const defense = row.defense;
    const snaps = row.snaps;
    const topOl = [...snaps.ol_players]
      .sort((left, right) => right.snaps - left.snaps)
      .slice(0, 5);
    const previous = priorOl.get(row.team) || [];
    const previousIds = new Set(previous.map((player) => player.id));
    const overlap = topOl.filter((player) => previousIds.has(player.id)).length;
    const offenseSnaps = Math.max(1, snaps.team_offense_snaps);
    const offensePressureOpportunities = Math.max(
      offense.pressure_opportunities,
      offense.participation_pass_plays,
    );
    const defensiveOpportunities = number(
      pressureOpportunities.get(context.keyOf(row.week, row.opponent)),
    );
    row.offense = {
      pressure_rate: round(
        offense.pressures_allowed / Math.max(1, offensePressureOpportunities),
      ),
      sack_rate: round(offense.sacks_allowed / Math.max(1, offensePressureOpportunities)),
      hurry_rate: round(offense.hurries_allowed / Math.max(1, offensePressureOpportunities)),
      hit_rate: round(offense.hits_allowed / Math.max(1, offensePressureOpportunities)),
      blitz_rate_faced: round(offense.blitzes_faced / Math.max(1, offensePressureOpportunities)),
      participation_pressure_rate: round(
        offense.participation_pressures /
          Math.max(1, offense.participation_pass_plays),
      ),
      average_time_to_throw: round(
        offense.time_to_throw_total / Math.max(1, offense.time_to_throw_plays),
      ),
      average_pass_rushers: round(
        offense.pass_rushers_total / Math.max(1, offense.pass_rushers_plays),
      ),
      shotgun_rate: round(
        offense.shotgun_plays /
          Math.max(1, offense.shotgun_plays + offense.under_center_plays),
      ),
      personnel_11_rate: round(
        offense.personnel_11_plays /
          Math.max(1, offense.participation_plays),
      ),
      personnel_12_rate: round(
        offense.personnel_12_plays /
          Math.max(1, offense.participation_plays),
      ),
      deep_route_rate: round(
        offense.deep_route_plays / Math.max(1, offense.route_plays),
      ),
      short_route_rate: round(
        offense.short_route_plays / Math.max(1, offense.route_plays),
      ),
      motion_rate: round(offense.motion_plays / Math.max(1, offense.ftn_plays)),
      play_action_rate: round(
        offense.play_action_plays / Math.max(1, offense.ftn_plays),
      ),
      screen_rate: round(offense.screen_plays / Math.max(1, offense.ftn_plays)),
      rpo_rate: round(offense.rpo_plays / Math.max(1, offense.ftn_plays)),
      no_huddle_rate: round(
        offense.no_huddle_plays / Math.max(1, offense.ftn_plays),
      ),
      catchable_rate: round(
        offense.catchable_throws / Math.max(1, offense.ftn_pass_plays),
      ),
      contested_rate: round(
        offense.contested_throws / Math.max(1, offense.ftn_pass_plays),
      ),
      drop_rate: round(offense.charted_drops / Math.max(1, offense.ftn_pass_plays)),
      qb_fault_sack_rate: round(
        offense.qb_fault_sacks / Math.max(1, offense.ftn_pass_plays),
      ),
      pass_rate: offense.pbp_plays
        ? round(offense.pbp_pass_plays / offense.pbp_plays)
        : null,
      play_volume: offense.pbp_plays || null,
      rush_rate: offense.pbp_plays
        ? round(offense.pbp_rush_plays / offense.pbp_plays)
        : null,
      epa_per_play: offense.pbp_plays
        ? round(offense.pbp_epa / offense.pbp_plays)
        : null,
      success_rate: offense.pbp_plays
        ? round(offense.pbp_successes / offense.pbp_plays)
        : null,
      red_zone_play_rate: offense.pbp_plays
        ? round(offense.pbp_red_zone_plays / offense.pbp_plays)
        : null,
      neutral_pass_rate: offense.neutral_plays
        ? round(offense.neutral_pass_plays / offense.neutral_plays)
        : null,
      two_minute_rate: offense.pbp_plays
        ? round(offense.two_minute_plays / offense.pbp_plays)
        : null,
      third_down_success_rate: offense.third_down_plays
        ? round(offense.third_down_conversions / offense.third_down_plays)
        : null,
      implied_points: offense.market_samples
        ? round(offense.implied_points_total / offense.market_samples)
        : null,
      team_spread: offense.market_samples
        ? round(offense.spread_total / offense.market_samples)
        : null,
      samples: {
        pressure: Math.round(offensePressureOpportunities),
        participation: offense.participation_pass_plays,
        charting: offense.ftn_pass_plays,
        play_by_play: offense.pbp_plays,
        two_minute: offense.two_minute_plays,
        third_down: offense.third_down_plays,
      },
    };
    row.defense = {
      pressure_rate: round(
        defense.pressures / Math.max(1, defensiveOpportunities),
      ),
      sack_rate: round(defense.sacks / Math.max(1, defensiveOpportunities)),
      hurry_rate: round(defense.hurries / Math.max(1, defensiveOpportunities)),
      hit_rate: round(defense.hits / Math.max(1, defensiveOpportunities)),
      blitz_rate: round(defense.blitzes / Math.max(1, defensiveOpportunities)),
      man_rate: round(defense.man_plays / Math.max(1, defense.coverage_plays)),
      zone_rate: round(defense.zone_plays / Math.max(1, defense.coverage_plays)),
      average_blitzers: round(
        defense.ftn_blitzers_total / Math.max(1, defense.ftn_pass_plays),
      ),
      average_pass_rushers: round(
        defense.ftn_pass_rushers_total / Math.max(1, defense.ftn_pass_plays),
      ),
      completion_rate_allowed: round(
        defense.completions_allowed / Math.max(1, defense.targets),
      ),
      yards_per_target_allowed: round(
        defense.yards_allowed / Math.max(1, defense.targets),
      ),
      pass_rate_faced: defense.pbp_plays
        ? round(defense.pbp_pass_plays / defense.pbp_plays)
        : null,
      rush_rate_faced: defense.pbp_plays
        ? round(defense.pbp_rush_plays / defense.pbp_plays)
        : null,
      epa_per_play_allowed: defense.pbp_plays
        ? round(defense.pbp_epa_allowed / defense.pbp_plays)
        : null,
      success_rate_allowed: defense.pbp_plays
        ? round(defense.pbp_successes_allowed / defense.pbp_plays)
        : null,
      red_zone_play_rate_allowed: defense.pbp_plays
        ? round(defense.pbp_red_zone_plays / defense.pbp_plays)
        : null,
      missed_tackles: round(defense.missed_tackles),
      samples: {
        pressure: Math.round(defensiveOpportunities),
        coverage: defense.coverage_plays,
        charting: defense.ftn_pass_plays,
        play_by_play: defense.pbp_plays,
      },
    };
    row.snaps = {
      team_offense_snaps: round(snaps.team_offense_snaps),
      team_defense_snaps: round(snaps.team_defense_snaps),
      ol_stability: round(
        topOl.reduce((sum, player) => sum + player.snaps, 0) /
          Math.max(1, offenseSnaps * 5),
      ),
      ol_continuity: previous.length ? round(overlap / 5) : null,
      ol_starters: topOl.map((player) => player.id),
    };
    priorOl.set(row.team, topOl);
  }
  return rows;
}

async function updateSeason(season) {
  const outputFile = path.join(outputRoot, String(season), "context.json");
  if (!force && season < currentSeason && fs.existsSync(outputFile)) {
    console.log(`Keeping saved ${season} advanced context (use --force to rebuild).`);
    return JSON.parse(fs.readFileSync(outputFile, "utf8"));
  }
  console.log(`Building ${season} advanced football context...`);
  const context = buildSeasonPayload(season);
  const base = "https://github.com/nflverse/nflverse-data/releases/download";
  const sourceStatus = {};
  const directory = await loadPlayerDirectory();
  sourceStatus.player_directory = directory;
  const playerByGsis = new Map(
    directory.rows.filter((row) => row.gsis_id).map((row) => [String(row.gsis_id), row]),
  );
  const playerByPfr = new Map(
    directory.rows.filter((row) => row.pfr_id).map((row) => [String(row.pfr_id), row]),
  );
  const playerWeekByGsis = new Map();
  const getPlayerWeek = ({ week, team, opponent, gsisId, pfrId, name, position }) => {
    const meta = (gsisId && playerByGsis.get(String(gsisId))) ||
      (pfrId && playerByPfr.get(String(pfrId))) || null;
    const resolvedPosition = String(meta?.position || position || "").toUpperCase();
    if (!["QB", "RB", "WR", "TE", "K"].includes(resolvedPosition)) return null;
    const resolvedName = meta?.display_name || name || "";
    if (!resolvedName) return null;
    const mapKey = `${Number(week)}|${normalizeTeam(team)}|${normalizeName(resolvedName)}|${resolvedPosition}`;
    const row = context.playerWeeks.get(mapKey) ||
      emptyPlayerWeek({
        week,
        team,
        opponent,
        meta,
        fallbackName: resolvedName,
        fallbackPosition: resolvedPosition,
      });
    if (!row.opponent && opponent) row.opponent = normalizeTeam(opponent);
    context.playerWeeks.set(mapKey, row);
    const resolvedGsis = meta?.gsis_id || gsisId;
    if (resolvedGsis)
      playerWeekByGsis.set(`${Number(week)}|${normalizeTeam(team)}|${resolvedGsis}`, row);
    return row;
  };

  const passing = await fetchRows(
    `${base}/pfr_advstats/advstats_week_pass_${season}.csv`,
    "PFR weekly passing pressure",
  );
  sourceStatus.passing_pressure = passing;
  for (const row of passing.rows) {
    if (String(row.game_type || "REG") !== "REG") continue;
    const item = context.getTeamWeek(row.week, row.team, row.opponent);
    if (!item) continue;
    const pressured = number(row.times_pressured);
    // nflverse stores this as a decimal fraction (0.182 = 18.2%), not 18.2.
    const pressurePct = number(row.times_pressured_pct);
    item.offense.pressure_opportunities +=
      pressurePct > 0 ? pressured / pressurePct : 0;
    item.offense.sacks_allowed += number(row.times_sacked);
    item.offense.blitzes_faced += number(row.times_blitzed);
    item.offense.hurries_allowed += number(row.times_hurried);
    item.offense.hits_allowed += number(row.times_hit);
    item.offense.pressures_allowed += pressured;
    item.offense.bad_throws += number(row.passing_bad_throws);
  }
  passing.rows = [];

  const defending = await fetchRows(
    `${base}/pfr_advstats/advstats_week_def_${season}.csv`,
    "PFR weekly defensive pressure",
  );
  sourceStatus.defensive_pressure = defending;
  for (const row of defending.rows) {
    if (String(row.game_type || "REG") !== "REG") continue;
    const item = context.getTeamWeek(row.week, row.team, row.opponent);
    if (!item) continue;
    item.defense.blitzes += number(row.def_times_blitzed);
    item.defense.hurries += number(row.def_times_hurried);
    item.defense.hits += number(row.def_times_hitqb);
    item.defense.sacks += number(row.def_sacks);
    item.defense.pressures += number(row.def_pressures);
    item.defense.targets += number(row.def_targets);
    item.defense.completions_allowed += number(row.def_completions_allowed);
    item.defense.yards_allowed += number(row.def_yards_allowed);
    item.defense.touchdowns_allowed += number(row.def_receiving_td_allowed);
    item.defense.interceptions += number(row.def_ints);
    item.defense.missed_tackles += number(row.def_missed_tackles);
  }
  defending.rows = [];

  const snaps = await fetchRows(
    `${base}/snap_counts/snap_counts_${season}.csv`,
    "PFR game-level snaps",
  );
  sourceStatus.snaps = snaps;
  for (const row of snaps.rows) {
    if (String(row.game_type || "REG") !== "REG") continue;
    const item = context.getTeamWeek(row.week, row.team, row.opponent);
    if (!item) continue;
    item.snaps.team_offense_snaps = Math.max(
      item.snaps.team_offense_snaps,
      number(row.offense_snaps),
    );
    item.snaps.team_defense_snaps = Math.max(
      item.snaps.team_defense_snaps,
      number(row.defense_snaps),
    );
    const position = String(row.position || "").toUpperCase();
    const id = String(row.pfr_player_id || normalizeName(row.player));
    if (/^(C|G|T|OL|OT|OG|LT|RT|LG|RG)$/.test(position))
      item.snaps.ol_players.push({ id, snaps: number(row.offense_snaps) });
    if (row.player && ["QB", "RB", "WR", "TE", "K"].includes(position)) {
      const playerWeek = getPlayerWeek({
        week: row.week,
        team: row.team,
        opponent: row.opponent,
        pfrId: row.pfr_player_id,
        name: row.player,
        position,
      });
      if (playerWeek) {
        playerWeek.offense_snaps = round(number(row.offense_snaps));
        playerWeek.offense_pct = round(number(row.offense_pct));
      }
    }
  }
  snaps.rows = [];

  const participation = await fetchRows(
    `${base}/pbp_participation/pbp_participation_${season}.csv`,
    "nflverse participation and coverage",
  );
  sourceStatus.participation = participation;
  for (const row of participation.rows) {
    const week = Number(String(row.nflverse_game_id || "").split("_")[1]);
    const team = normalizeTeam(row.possession_team);
    const opponent = opponentFromGame(row.nflverse_game_id, team);
    const item = context.getTeamWeek(week, team, opponent);
    if (!item) continue;
    const hasOffensivePersonnel = /\b1 QB\b/i.test(
      String(row.offense_personnel || ""),
    );
    if (hasOffensivePersonnel) {
      context.playOffense.set(`${row.nflverse_game_id}|${row.play_id}`, team);
      item.offense.participation_plays += 1;
    }
    const passRushers = finite(row.number_of_pass_rushers);
    const timeToThrow = finite(row.time_to_throw);
    const route = String(row.route || "").toUpperCase();
    const hasRoute = Boolean(route) && !["NA", "N/A", "NULL"].includes(route);
    const passPlay =
      number(passRushers) > 0 || number(timeToThrow) > 0 || hasRoute;
    if (passPlay) {
      item.offense.participation_pass_plays += 1;
      if (boolean(row.was_pressure)) item.offense.participation_pressures += 1;
      if (Number.isFinite(timeToThrow)) {
        item.offense.time_to_throw_total += timeToThrow;
        item.offense.time_to_throw_plays += 1;
      }
      if (number(passRushers) > 0) {
        item.offense.pass_rushers_total += passRushers;
        item.offense.pass_rushers_plays += 1;
      }
    }
    const formation = String(row.offense_formation || "").toUpperCase();
    if (hasOffensivePersonnel && formation.includes("SHOTGUN"))
      item.offense.shotgun_plays += 1;
    else if (hasOffensivePersonnel && formation)
      item.offense.under_center_plays += 1;
    const personnel = String(row.offense_personnel || "");
    if (hasOffensivePersonnel && /1 RB/i.test(personnel) && /1 TE/i.test(personnel) && /3 WR/i.test(personnel))
      item.offense.personnel_11_plays += 1;
    if (hasOffensivePersonnel && /1 RB/i.test(personnel) && /2 TE/i.test(personnel) && /2 WR/i.test(personnel))
      item.offense.personnel_12_plays += 1;
    if (hasRoute) {
      item.offense.route_plays += 1;
      if (/GO|POST|CORNER|WHEEL|DEEP/.test(route))
        item.offense.deep_route_plays += 1;
      if (/FLAT|SCREEN|SHORT|SWING/.test(route))
        item.offense.short_route_plays += 1;
    }
    const defense = context.getTeamWeek(week, opponent, team);
    if (defense && passPlay) {
      const manZone = String(row.defense_man_zone_type || "").toUpperCase();
      const coverage = String(row.defense_coverage_type || "").toUpperCase();
      if (manZone || coverage) defense.defense.coverage_plays += 1;
      if (manZone.includes("MAN") || coverage.includes("MAN"))
        defense.defense.man_plays += 1;
      else if (manZone.includes("ZONE") || coverage.includes("ZONE"))
        defense.defense.zone_plays += 1;
    }
  }
  participation.rows = [];

  const pbpUrl = `${base}/pbp/play_by_play_${season}.csv.gz`;
  const playByPlay = await processGzipRows(
    pbpUrl,
    "nflverse play-by-play team efficiency",
    (row) => {
      if (String(row.season_type || "REG") !== "REG") return;
      const week = Number(row.week);
      const team = normalizeTeam(row.posteam);
      const opponent = normalizeTeam(row.defteam);
      if (!week || week > 18 || !team || !opponent) return;
      context.playOffense.set(`${row.game_id}|${row.play_id}`, team);
      const pass = boolean(row.pass_attempt) || boolean(row.sack);
      const rush = boolean(row.rush_attempt) && !boolean(row.qb_kneel);
      if (!pass && !rush) return;
      const item = context.getTeamWeek(week, team, opponent);
      const defense = context.getTeamWeek(week, opponent, team);
      if (!item || !defense) return;
      const epa = finite(row.epa);
      const success = boolean(row.success);
      const redZone = number(row.yardline_100) > 0 && number(row.yardline_100) <= 20;
      const inside10 = number(row.yardline_100) > 0 && number(row.yardline_100) <= 10;
      const inside5 = number(row.yardline_100) > 0 && number(row.yardline_100) <= 5;
      const twoMinute = number(row.half_seconds_remaining) > 0 && number(row.half_seconds_remaining) <= 120;
      const thirdDown = number(row.down) === 3;
      const neutral = Math.abs(number(row.score_differential)) <= 8 && number(row.game_seconds_remaining) > 300;
      item.offense.pbp_plays += 1;
      item.offense.pbp_pass_plays += pass ? 1 : 0;
      item.offense.pbp_rush_plays += rush ? 1 : 0;
      item.offense.pbp_epa += Number.isFinite(epa) ? epa : 0;
      item.offense.pbp_successes += success ? 1 : 0;
      item.offense.pbp_red_zone_plays += redZone ? 1 : 0;
      item.offense.neutral_plays += neutral ? 1 : 0;
      item.offense.neutral_pass_plays += neutral && pass ? 1 : 0;
      item.offense.two_minute_plays += twoMinute ? 1 : 0;
      item.offense.third_down_plays += thirdDown ? 1 : 0;
      item.offense.third_down_conversions += thirdDown && boolean(row.third_down_converted) ? 1 : 0;
      const home = normalizeTeam(row.home_team);
      const spread = finite(row.spread_line);
      const total = finite(row.total_line);
      if (
        item.offense.market_samples === 0 &&
        Number.isFinite(spread) &&
        Number.isFinite(total)
      ) {
        const teamSpread = team === home ? spread : -spread;
        item.offense.spread_total = teamSpread;
        item.offense.implied_points_total = total / 2 + teamSpread / 2;
        item.offense.market_samples = 1;
      }
      const receiverId = String(row.receiver_player_id || row.receiver_id || "");
      if (receiverId && pass && !boolean(row.sack)) {
        item.offense.pbp_targets += 1;
        item.offense.pbp_air_yards += number(row.air_yards);
        const receiver =
          playerWeekByGsis.get(`${week}|${team}|${receiverId}`) ||
          getPlayerWeek({
            week,
            team,
            opponent,
            gsisId: receiverId,
            name: row.receiver_player_name,
          });
        if (receiver) {
          receiver.targets += 1;
          receiver.air_yards += number(row.air_yards);
          receiver.receiving_epa += Number.isFinite(epa) ? epa : 0;
          receiver.receptions += boolean(row.complete_pass) ? 1 : 0;
          receiver.receiving_yards += number(row.receiving_yards);
          receiver.red_zone_targets += redZone ? 1 : 0;
          receiver.deep_targets += number(row.air_yards) >= 15 ? 1 : 0;
          receiver.third_down_opportunities += thirdDown ? 1 : 0;
          receiver.two_minute_opportunities += twoMinute ? 1 : 0;
        }
      }
      const rusherId = String(row.rusher_player_id || row.rusher_id || "");
      if (rusherId && rush) {
        const rusher =
          playerWeekByGsis.get(`${week}|${team}|${rusherId}`) ||
          getPlayerWeek({
            week,
            team,
            opponent,
            gsisId: rusherId,
            name: row.rusher_player_name,
          });
        if (rusher) {
          rusher.carries += 1;
          rusher.rushing_epa += Number.isFinite(epa) ? epa : 0;
          rusher.rushing_yards += number(row.rushing_yards);
          rusher.red_zone_carries += redZone ? 1 : 0;
          rusher.inside_10_carries += inside10 ? 1 : 0;
          rusher.inside_5_carries += inside5 ? 1 : 0;
          rusher.third_down_opportunities += thirdDown ? 1 : 0;
          rusher.two_minute_opportunities += twoMinute ? 1 : 0;
        }
      }
      const passerId = String(row.passer_player_id || row.passer_id || "");
      if (passerId && pass) {
        const passer =
          playerWeekByGsis.get(`${week}|${team}|${passerId}`) ||
          getPlayerWeek({
            week,
            team,
            opponent,
            gsisId: passerId,
            name: row.passer_player_name,
            position: "QB",
          });
        if (passer) {
          passer.dropbacks += 1;
          passer.pass_attempts += boolean(row.pass_attempt) ? 1 : 0;
          passer.red_zone_targets += redZone ? 1 : 0;
          passer.two_minute_opportunities += twoMinute ? 1 : 0;
          passer.third_down_opportunities += thirdDown ? 1 : 0;
        }
      }
      defense.defense.pbp_plays += 1;
      defense.defense.pbp_pass_plays += pass ? 1 : 0;
      defense.defense.pbp_rush_plays += rush ? 1 : 0;
      defense.defense.pbp_epa_allowed += Number.isFinite(epa) ? epa : 0;
      defense.defense.pbp_successes_allowed += success ? 1 : 0;
      defense.defense.pbp_red_zone_plays += redZone ? 1 : 0;
    },
  );
  sourceStatus.play_by_play = {
    status: playByPlay.status,
    url: playByPlay.url,
  };

  const ngsSources = [
    {
      type: "passing",
      fields: {
        avg_time_to_throw: "time_to_throw",
        avg_intended_air_yards: "intended_air_yards",
        aggressiveness: "aggressiveness",
        completion_percentage_above_expectation: "cpoe",
      },
    },
    {
      type: "receiving",
      fields: {
        avg_cushion: "cushion",
        avg_separation: "separation",
        avg_intended_air_yards: "intended_air_yards",
        avg_yac_above_expectation: "yac_over_expected",
      },
    },
    {
      type: "rushing",
      fields: {
        efficiency: "rush_efficiency",
        percent_attempts_gte_eight_defenders: "box_eight_rate",
        avg_time_to_los: "time_to_line",
        rush_yards_over_expected_per_att: "ryoe_per_carry",
        rush_pct_over_expected: "rush_over_expected_rate",
      },
    },
  ];
  for (const source of ngsSources) {
    const url = `${base}/nextgen_stats/ngs_${source.type}.csv.gz`;
    const loaded = await processGzipRows(
      url,
      `NFL Next Gen Stats ${source.type}`,
      (row) => {
        if (Number(row.season) !== season || String(row.season_type || "REG") !== "REG")
          return;
        const week = Number(row.week);
        const team = normalizeTeam(row.team_abbr);
        const gsisId = String(row.player_gsis_id || "");
        if (!week || !team || !gsisId) return;
        const player =
          playerWeekByGsis.get(`${week}|${team}|${gsisId}`) ||
          getPlayerWeek({
            week,
            team,
            gsisId,
            name: row.player_display_name,
            position: row.player_position,
          });
        if (!player) return;
        for (const [input, output] of Object.entries(source.fields)) {
          const value = finite(row[input]);
          if (!Number.isFinite(value)) continue;
          player.ngs[output] = round(
            output === "box_eight_rate" || output === "aggressiveness" || output === "cpoe"
              ? value / 100
              : value,
          );
        }
      },
    );
    sourceStatus[`nextgen_${source.type}`] = {
      status: loaded.status,
      url: loaded.url,
    };
  }

  const charting = await fetchRows(
    `${base}/ftn_charting/ftn_charting_${season}.csv`,
    "FTN play charting",
  );
  sourceStatus.ftn_charting = charting;
  for (const row of charting.rows) {
    const week = Number(row.week);
    const playKey = `${row.nflverse_game_id}|${row.nflverse_play_id}`;
    const team = context.playOffense.get(playKey);
    if (!team) continue;
    const opponent = opponentFromGame(row.nflverse_game_id, team);
    const item = context.getTeamWeek(week, team, opponent);
    if (!item) continue;
    item.offense.ftn_plays += 1;
    const passPlay = number(row.n_pass_rushers) > 0;
    if (passPlay) item.offense.ftn_pass_plays += 1;
    if (boolean(row.is_motion)) item.offense.motion_plays += 1;
    if (boolean(row.is_play_action)) item.offense.play_action_plays += 1;
    if (boolean(row.is_screen_pass)) item.offense.screen_plays += 1;
    if (boolean(row.is_rpo)) item.offense.rpo_plays += 1;
    if (boolean(row.is_no_huddle)) item.offense.no_huddle_plays += 1;
    if (boolean(row.is_catchable_ball)) item.offense.catchable_throws += 1;
    if (boolean(row.is_contested_ball)) item.offense.contested_throws += 1;
    if (boolean(row.is_drop)) item.offense.charted_drops += 1;
    if (boolean(row.is_qb_fault_sack)) item.offense.qb_fault_sacks += 1;
    const defense = context.getTeamWeek(week, opponent, team);
    if (defense && passPlay) {
      defense.defense.ftn_pass_plays += 1;
      defense.defense.ftn_blitzers_total += number(row.n_blitzers);
      defense.defense.ftn_pass_rushers_total += number(row.n_pass_rushers);
    }
  }
  charting.rows = [];

  const playerWeeks = finalizePlayerWeeks(context);
  const teamWeeks = finalizeTeamWeeks(context);
  const available = Object.fromEntries(
    Object.entries(sourceStatus).map(([key, source]) => [
      key,
      { status: source.status, url: source.url },
    ]),
  );
  if (!teamWeeks.length) {
    console.warn(`No ${season} advanced data was available; saved data was not replaced.`);
    return fs.existsSync(outputFile)
      ? JSON.parse(fs.readFileSync(outputFile, "utf8"))
      : null;
  }
  const payload = {
    source: "nflverse normalized advanced context",
    season,
    updated: new Date().toISOString(),
    schema_version: 1,
    attribution: [
      "Pro Football Reference data via nflverse",
      "NFL play-by-play data via nflverse",
      "FTN Data via nflverse (CC BY-SA 4.0)",
      "NFL NextGenStats via nflverse for pre-2023 participation; FTN Data via nflverse from 2023 onward",
    ],
    sources: available,
    coverage: {
      team_weeks: teamWeeks.length,
      player_snap_weeks: context.playerWeeks.size,
      first_week: Math.min(...teamWeeks.map((row) => row.week)),
      last_week: Math.max(...teamWeeks.map((row) => row.week)),
    },
    team_weeks: teamWeeks,
    player_weeks: playerWeeks,
  };
  writeJson(outputFile, payload);
  console.log(
    `Saved ${season}: ${payload.coverage.team_weeks} team-weeks and ${payload.coverage.player_snap_weeks} player snap-weeks.`,
  );
  return payload;
}

const completed = [];
for (const season of [...new Set(seasons)].sort((a, b) => a - b)) {
  try {
    const payload = await updateSeason(season);
    if (payload) completed.push(payload);
  } catch (error) {
    console.error(`${season} advanced context failed: ${error.message}`);
  }
}

const manifestFile = path.join(outputRoot, "manifest.json");
const existing = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
  : { seasons: [] };
const bySeason = new Map((existing.seasons || []).map((row) => [row.season, row]));
for (const payload of completed)
  bySeason.set(payload.season, {
    season: payload.season,
    updated: payload.updated,
    schema_version: payload.schema_version,
    coverage: payload.coverage,
    path: `/stats/advanced/${payload.season}/context.json`,
  });
writeJson(manifestFile, {
  source: "The Fantasy Arsenal advanced context archive",
  updated: new Date().toISOString(),
  seasons: [...bySeason.values()].sort((left, right) => left.season - right.season),
});
console.log(`Advanced context ready for ${completed.map((row) => row.season).join(", ") || "no new seasons"}.`);
