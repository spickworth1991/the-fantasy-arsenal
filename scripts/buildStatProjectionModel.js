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
const MODEL_VERSION = "arsenal-stat-v2.1";
const MODEL_SCHEMA = 6;
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
  const byTeamPositionSurname = new Map();
  (players || []).forEach((player) => {
    const normalized = normalizeName(player?.name);
    const surname = normalized.split(" ").at(-1);
    const position = String(player?.position || "").toUpperCase();
    const team = normalizeTeam(player?.team);
    if (!surname || !position || !team) return;
    const key = `${team}|${position}|${surname}`;
    const candidates = byTeamPositionSurname.get(key) || [];
    candidates.push(playerKey(player));
    byTeamPositionSurname.set(key, candidates);
  });
  return (row) => {
    const direct = exact.get(playerKey(row));
    if (direct) return direct;
    const surname = normalizeName(row?.name).split(" ").at(-1);
    const candidates = byTeamPositionSurname.get(
      `${normalizeTeam(row?.team)}|${String(row?.position || "").toUpperCase()}|${surname}`,
    );
    return candidates?.length === 1 ? candidates[0] : playerKey(row);
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
    return existing;
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
              const competitors = event?.competitions?.[0]?.competitors || [];
              const home = competitors.find((team) => team.homeAway === "home")
                ?.team?.abbreviation;
              const away = competitors.find((team) => team.homeAway === "away")
                ?.team?.abbreviation;
              return home && away
                ? {
                    home: normalizeTeam(home),
                    away: normalizeTeam(away),
                    date: event.date || null,
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
  return result;
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
  const usable = values
    .filter((row) => row.present && Number.isFinite(Number(row.value)))
    .map((row) => ({ ...row, value: num(row.value) }))
    .sort((a, b) => a.value - b.value);
  if (!usable.length) return 0;
  const middleIndex = Math.floor(usable.length / 2);
  const middle =
    usable.length % 2
      ? usable[middleIndex].value
      : (usable[middleIndex - 1].value + usable[middleIndex].value) / 2;
  if (middle === 0)
    return (
      usable.reduce((sum, row) => sum + row.value * row.weight, 0) /
      Math.max(
        0.01,
        usable.reduce((sum, row) => sum + row.weight, 0),
      )
    );
  const bounded = usable.map((row) => ({
    ...row,
    value: row.value === 0 ? 0 : clamp(row.value, middle * 0.65, middle * 1.35),
  }));
  const weight = bounded.reduce((sum, row) => sum + row.weight, 0);
  return (
    bounded.reduce((sum, row) => sum + row.value * row.weight, 0) /
    Math.max(0.01, weight)
  );
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
  ["games", ...statFields].forEach((field) => {
    line[field] = weightedConsensus(
      rows.map((row) => ({
        value: row.line[field],
        weight: row.weight,
        present: row.presentFields.has(field),
      })),
    );
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
  const fantasyProsByName = new Map(
    (fantasyPros.players || []).map((row) => [playerKey(row), row]),
  );
  const fantasyProsByPositionSurname = new Map();
  (fantasyPros.players || []).forEach((row) => {
    const surname = normalizeName(row.name).split(" ").at(-1);
    const position = String(row.position || "").toUpperCase();
    const key = `${position}|${surname}`;
    const candidates = fantasyProsByPositionSurname.get(key) || [];
    candidates.push(row);
    fantasyProsByPositionSurname.set(key, candidates);
  });
  const historicalAliases = new Map([
    ["marquise brown|WR", "hollywood brown|WR"],
    ["kenny gainwell|RB", "kenneth gainwell|RB"],
    ["chig okonkwo|TE", "chigoziem okonkwo|TE"],
    ["andy borregales|K", "andres borregales|K"],
  ]);
  const findFantasyProsPlayer = (player) => {
    const exactKey = playerKey(player);
    const exact = fantasyProsByName.get(exactKey);
    if (exact) return exact;
    const aliased = fantasyProsByName.get(historicalAliases.get(exactKey));
    if (aliased) return aliased;
    const surname = normalizeName(player.name).split(" ").at(-1);
    const candidates = fantasyProsByPositionSurname.get(
      `${String(player.position || "").toUpperCase()}|${surname}`,
    );
    return candidates?.length === 1 ? candidates[0] : null;
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
            stats: cleanLine(stats),
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
      weekly.forEach(({ week, stats }) => {
        const defenseTeam = opponent.get(`${week}:${team}`);
        if (!team || !defenseTeam) return;
        const defenseKey = `${defenseTeam}|${String(player.position).toUpperCase()}`;
        const row = defense.get(defenseKey) || {
          team: defenseTeam,
          position: String(player.position).toUpperCase(),
          weeks: new Set(),
          playerGames: 0,
          stats: cleanLine(),
        };
        row.weeks.add(week);
        row.playerGames += 1;
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
      statFields.map((field) => [
        field,
        num(row.stats[field]) / Math.max(1, row.weeks.size),
      ]),
    ),
  }));
  const baselines = {};
  positions.forEach((position) => {
    const rows = defenseRows.filter((row) => row.position === position);
    baselines[position] = Object.fromEntries(
      statFields.map((field) => [
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

function defenseAdjustment(evidence, opponent, position) {
  const recency = evidenceWeights(evidence);
  const factors = {};
  const indices = {};
  const sample = evidence.reduce((sum, item) => {
    const row = item.defense.find(
      (candidate) =>
        candidate.team === opponent && candidate.position === position,
    );
    return sum + num(row?.games);
  }, 0);
  statFields.forEach((field) => {
    let weightedIndex = 0;
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
      const regressedIndex = 1 + (observed / baseline - 1) * reliability;
      weightedIndex += regressedIndex * weight;
      weightTotal += weight;
    });
    const index = weightTotal ? weightedIndex / weightTotal : 1;
    const volume = ["pass_att", "rush_att", "rec_tgt", "fga", "xpa"].includes(
      field,
    );
    const strength = volume ? 0.18 : 0.32;
    factors[field] = clamp(
      1 + (index - 1) * strength,
      volume ? 0.94 : 0.88,
      volume ? 1.06 : 1.12,
    );
    indices[field] = index;
  });
  return {
    factors,
    indices,
    sample: Math.round(sample),
  };
}

function playerOpponentAdjustment(key, opponent, evidence) {
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
  return {
    games,
    seasons,
    factor: clamp(1 + (ratio - 1) * reliability * 0.15, 0.97, 1.03),
    split_average: round(splitAverage),
    player_baseline: round(playerBaseline),
  };
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
const base = readJson(
  path.join(root, "public", `projections_thefantasyarsenal_${season}.json`),
);
if (!base?.rows?.length)
  throw new Error(
    `Missing projections_thefantasyarsenal_${season}.json. Run npm run update first.`,
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
    });
    opponentByWeek.set(`${week}:${normalizeTeam(game.away)}`, {
      opponent: normalizeTeam(game.home),
      home: false,
      date: game.date,
    });
  }),
);
const scheduledTeams = new Set(
  [...opponentByWeek.keys()].map((key) => key.split(":")[1]),
);

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
          stat_line: actual?.stats || cleanLine(),
          projections: actual?.points || { ppr: 0, half: 0, std: 0 },
          defense: null,
        };
      }
      const defense = defenseAdjustment(evidence, matchup.opponent, position);
      const personalHistory = playerOpponentAdjustment(
        key,
        matchup.opponent,
        evidence,
      );
      const defenseLine = applyDefense(baselineWeekly, defense, position);
      return {
        week,
        bye: false,
        opponent: matchup.opponent,
        home: matchup.home,
        kickoff: matchup.date,
        completed: false,
        stat_line: guardStatRates(
          {
            games: 1,
            ...Object.fromEntries(
              statFields.map((field) => [
                field,
                num(defenseLine[field]) * personalHistory.factor,
              ]),
            ),
          },
          position,
        ),
        defense,
        personal_history: personalHistory,
      };
    });
    const normalizedWeeks = normalizeWeeklyLines(
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
      return {
        ...week,
        projections,
        matchup_factor: round(
          baselinePoints ? projections.ppr / baselinePoints : 1,
          4,
        ),
        defense_index: round(defenseIndex, 4),
        defense_sample: num(week.defense?.sample),
      };
    });
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
    const confidence = Math.round(
      clamp(
        num(player.confidence) * 0.62 +
          usedStatSources.length * 7 +
          Math.min(12, history.effectiveGames * 0.55) +
          (evidenceYears.length / 3) * 6 -
          (usedStatSources.length ? 0 : 18),
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
      },
      regression,
      role_calibration,
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

const output = {
  source: "The Fantasy Arsenal Stat Projection Model",
  season,
  generated_at: new Date().toISOString(),
  model_version: MODEL_VERSION,
  model_build_id: MODEL_BUILD_ID,
  schema_version: MODEL_SCHEMA,
  status: "experimental",
  evidence_seasons: evidenceYears,
  scoring_variants: scoringKeys,
  count: modeledPlayers.length,
  feature_coverage: {
    projected_stat_source_players: statSourcePlayers,
    historical_raw_stat_players: historyPlayers,
    bounded_fallback_players: fallbackPlayers,
    projected_stat_sources: sourceIndexes.map((source) => ({
      source: source.name,
      players: source.index.size,
      updated: source.updated,
    })),
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
      "Canonical projected stat lines combine FantasyPros, DraftSharks, and FantasySharks field-level projections with a 35% outlier guard.",
    regression: `Projected volume and efficiency are blended toward the player's recency-weighted ${completedEvidenceYears.join("–")} raw Sleeper production. Historical influence is sample-sized, capped at 22%, with volume bounded to +/-6% and efficiency to +/-5%.`,
    live_learning:
      finalWeeks.size > 0
        ? `${season} finalized results through Week ${Math.max(...finalWeeks)} are blended progressively; early-season samples are heavily shrunk and gain influence as evidence grows. Past weeks remain actual and only unplayed games are reforecast.`
        : `${season} results have not started. The daily workflow will begin adding progressively weighted current-season evidence after completed box scores exist.`,
    role_calibration:
      "The Arsenal consensus supplies 18% of role calibration when three projected-stat sources agree, 28% with two sources, 42% with one, and 72% only for synthetic fallbacks. The remaining weight belongs to the independent stat model, and the transparent final scale factor is bounded between 55% and 135%.",
    matchup:
      "Three years of defense-vs-position raw stats are weighted 15% / 30% / 55%, regressed by sample, then applied separately to volume and production fields. Volume moves at most 6%; other counting stats move at most 12% before season normalization.",
    player_matchup_history:
      "When at least two recent meetings exist, each result is compared with that player's same-season average against every other opponent. The recency-weighted residual is heavily regressed and capped at +/-3%, so opponent history can refine a matchup but never overpower role or projected stats.",
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
writeJson(path.join(outputDirectory, "current.json"), output);
writeJson(path.join(root, "public", "stats", "projections", "manifest.json"), {
  current_season: season,
  model_path: `/stats/projections/${season}/current.json`,
  accuracy_path: `/stats/projections/${season}/accuracy.json`,
  generated_at: output.generated_at,
  model_version: MODEL_VERSION,
  model_build_id: MODEL_BUILD_ID,
  status: output.status,
});
if (archive) {
  const now = Date.now();
  const activeWeek =
    (schedule.weeks || []).find(({ games }) =>
      (games || []).some((game) => Date.parse(game.date) >= now),
    )?.week || 18;
  const snapshot = {
    source: output.source,
    season,
    week: activeWeek,
    generated_at: output.generated_at,
    model_version: MODEL_VERSION,
    model_build_id: MODEL_BUILD_ID,
    schema_version: MODEL_SCHEMA,
    status: output.status,
    scoring_rules: output.scoring_rules,
    methodology: output.methodology,
    feature_coverage: output.feature_coverage,
    players: modeledPlayers
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
        consensus_anchors: Object.fromEntries(
          scoringKeys.map((key) => [key, player.scoring[key].consensus_anchor]),
        ),
        forecast: player.weeks.find((row) => row.week === activeWeek) || null,
      }))
      .filter(
        (player) =>
          player.forecast && !player.forecast.bye && !player.forecast.completed,
      ),
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
