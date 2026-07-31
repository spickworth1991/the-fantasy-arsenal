import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");

function loadLocalEnvironment() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
    );
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadLocalEnvironment();

const currentSeason = new Date().getUTCFullYear();
const all = process.argv.includes("--all");
const force = process.argv.includes("--force");
const sleeperOnly = process.argv.includes("--sleeper-only");
const requested = process.argv.find((arg) => arg.startsWith("--season="));
const requestedSeason = requested ? Number(requested.split("=")[1]) : 0;
const seasons =
  sleeperOnly && all
    ? Array.from(
        { length: Math.max(0, currentSeason - 2018) },
        (_, index) => 2018 + index,
      )
    : all
      ? Array.from(
          { length: Math.max(1, currentSeason - 2012) },
          (_, index) => 2012 + index,
        )
      : [
          requestedSeason >= 2012 && requestedSeason <= currentSeason
            ? requestedSeason
            : currentSeason - 1,
        ];
const apiKey =
  process.env.FANTASYPROS_API_KEY || process.env.FANTASYPROS_API_KEY2 || "";
if (!sleeperOnly && !apiKey)
  throw new Error(
    "FANTASYPROS_API_KEY is required in .env.local or the workflow environment.",
  );

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const FANTASYPROS_MIN_INTERVAL_MS = Math.max(
  1000,
  number(process.env.FANTASYPROS_MIN_INTERVAL_MS) || 7000,
);
const FANTASYPROS_RUN_BUDGET = Math.max(
  1,
  number(process.env.FANTASYPROS_RUN_BUDGET) || 100,
);
let fantasyProsRequests = 0;
let lastFantasyProsRequestAt = 0;
const writeJson = (file, payload) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
};
const usefulStat = (key) =>
  /^(pts_|pass_|rush_|rec($|_)|fum($|_)|fg($|_)|fga$|fgm$|fgmiss|xp($|_)|xpa$|xpm$|xpmiss|kick_|def_|idp_|tkl|tkl_|sack|sack_|int$|int_|ff$|fr$|fr_|pd$|blk_kick|safe$)/.test(
    String(key),
  );

async function fantasyPros(season, scoring) {
  const endpoint = `https://api.fantasypros.com/public/v2/json/nfl/${season}/player-points?position=ALL&scoring=${scoring}&min=false`;
  let response;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (fantasyProsRequests >= FANTASYPROS_RUN_BUDGET) {
      throw new Error(
        `FantasyPros run budget reached (${FANTASYPROS_RUN_BUDGET}). Re-run later to resume safely.`,
      );
    }
    const elapsed = Date.now() - lastFantasyProsRequestAt;
    if (elapsed < FANTASYPROS_MIN_INTERVAL_MS)
      await sleep(FANTASYPROS_MIN_INTERVAL_MS - elapsed);
    fantasyProsRequests += 1;
    lastFantasyProsRequestAt = Date.now();
    response = await fetch(endpoint, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (response.status !== 429) break;
    const retryHeader = response.headers.get("retry-after");
    const retrySeconds = Number(retryHeader);
    const retryDate =
      retryHeader && !Number.isFinite(retrySeconds)
        ? Date.parse(retryHeader)
        : 0;
    const waitMs =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? retrySeconds * 1000
        : retryDate > Date.now()
          ? retryDate - Date.now()
          : Math.min(300000, 65000 * attempt);
    console.warn(
      `  FantasyPros rate limit reached; waiting ${Math.ceil(waitMs / 1000)} seconds before retry ${attempt}/5.`,
    );
    await sleep(waitMs);
  }
  if (!response?.ok)
    throw new Error(
      `FantasyPros ${season} ${scoring} returned HTTP ${response?.status || 0} after paced retries.`,
    );
  const payload = await response.json();
  const players = (Array.isArray(payload?.players) ? payload.players : [])
    .map((player) => ({
      player_id: String(player?.player_id || ""),
      name: String(player?.player_name || ""),
      position: String(player?.position_id || ""),
      team: String(player?.team_id || ""),
      games: number(player?.games),
      points: number(player?.points),
      average: number(player?.average),
      weeks:
        player?.weeks && typeof player.weeks === "object" ? player.weeks : {},
    }))
    .filter((player) => player.name && player.games > 0);
  return {
    source: "FantasyPros official API",
    season,
    scoring,
    updated: new Date().toISOString(),
    publisher_updated: payload?.last_updated || null,
    count: players.length,
    players,
  };
}

async function sleeperWeek(season, week) {
  const response = await fetch(
    `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`,
  );
  if (!response.ok) return { week, rows: {} };
  const rows = await response.json();
  return { week, rows: rows && typeof rows === "object" ? rows : {} };
}

async function sleeper(season) {
  const weeks = [];
  for (let start = 1; start <= 18; start += 6) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(6, 19 - start) }, (_, index) =>
        sleeperWeek(season, start + index),
      ),
    );
    weeks.push(...batch);
  }
  const byPlayer = new Map();
  weeks.forEach(({ week, rows }) =>
    Object.entries(rows).forEach(([playerId, payload]) => {
      const stats =
        payload?.stats && typeof payload.stats === "object"
          ? payload.stats
          : payload;
      const current = byPlayer.get(String(playerId)) || {
        player_id: String(playerId),
        weeks: {},
        weekly_stats: {},
        stats: {},
      };
      const points = {
        std: number(stats?.pts_std),
        half: number(stats?.pts_half_ppr),
        ppr: number(stats?.pts_ppr),
      };
      if (points.std || points.half || points.ppr)
        current.weeks[String(week)] = points;
      current.weekly_stats[String(week)] = Object.fromEntries(
        Object.entries(stats || {})
          .filter(
            ([key, value]) => usefulStat(key) && Number.isFinite(Number(value)),
          )
          .map(([key, value]) => [key, number(value)]),
      );
      Object.entries(stats || {}).forEach(([key, value]) => {
        if (!usefulStat(key)) return;
        const parsed = Number(value);
        if (Number.isFinite(parsed))
          current.stats[key] = number(current.stats[key]) + parsed;
      });
      byPlayer.set(String(playerId), current);
    }),
  );
  const players = [...byPlayer.values()].filter(
    (player) => Object.keys(player.weeks).length > 0,
  );
  return {
    source: "Sleeper read-only weekly stats",
    season,
    updated: new Date().toISOString(),
    completed_weeks: weeks.filter((week) => Object.keys(week.rows).length)
      .length,
    count: players.length,
    players,
  };
}

async function nflSchedule(season) {
  const weeks = await Promise.all(
    Array.from({ length: 18 }, async (_, index) => {
      const week = index + 1;
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`,
        );
        if (!response.ok) return { week, games: [] };
        const payload = await response.json();
        const games = (payload?.events || [])
          .map((event) => {
            const teams = event?.competitions?.[0]?.competitors || [];
            const home = teams.find((team) => team.homeAway === "home")?.team
              ?.abbreviation;
            const away = teams.find((team) => team.homeAway === "away")?.team
              ?.abbreviation;
            return home && away
              ? { home, away, date: event.date || null }
              : null;
          })
          .filter(Boolean);
        return { week, games };
      } catch {
        return { week, games: [] };
      }
    }),
  );
  return {
    source: "ESPN public NFL scoreboard",
    season,
    updated: new Date().toISOString(),
    weeks,
  };
}

const manifestPath = path.join(
  root,
  "public",
  "stats",
  "history",
  "manifest.json",
);
function saveManifestEntry(entry) {
  let current = { seasons: [] };
  try {
    current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {}
  const rows = [
    entry,
    ...(current.seasons || []).filter(
      (row) => Number(row.season) !== Number(entry.season),
    ),
  ].sort((a, b) => Number(b.season) - Number(a.season));
  writeJson(manifestPath, { updated: new Date().toISOString(), seasons: rows });
}
let completed = 0;
for (const season of seasons) {
  const existingDirectory = path.join(
    root,
    "public",
    "stats",
    "history",
    String(season),
  );
  const requiresSleeper = season >= 2018;
  if (sleeperOnly) {
    if (!requiresSleeper) continue;
    console.log(`Enriching saved ${season} Sleeper weekly statistics...`);
    const [sleeperPayload, schedulePayload] = await Promise.all([
      sleeper(season),
      nflSchedule(season),
    ]);
    writeJson(path.join(existingDirectory, "sleeper.json"), sleeperPayload);
    writeJson(path.join(existingDirectory, "schedule.json"), schedulePayload);
    let fantasyProsPlayers = 0;
    try {
      fantasyProsPlayers = number(
        JSON.parse(
          fs.readFileSync(
            path.join(existingDirectory, "fantasypros.json"),
            "utf8",
          ),
        )?.count,
      );
    } catch {}
    saveManifestEntry({
      season,
      fantasypros_players: fantasyProsPlayers,
      fantasypros_file: "fantasypros.json",
      sleeper_players: sleeperPayload.count,
      completed_weeks: sleeperPayload.completed_weeks,
      weekly_box_scores: true,
    });
    completed += 1;
    continue;
  }
  if (
    !force &&
    fs.existsSync(path.join(existingDirectory, "fantasypros.json")) &&
    (!requiresSleeper ||
      fs.existsSync(path.join(existingDirectory, "sleeper.json")))
  ) {
    console.log(
      `Keeping saved ${season} historical statistics (use --force to rebuild).`,
    );
    continue;
  }
  console.log(`Building saved ${season} historical statistics...`);
  const directory = path.join(
    root,
    "public",
    "stats",
    "history",
    String(season),
  );
  const sleeperPayload = requiresSleeper
    ? await sleeper(season)
    : {
        source: "Sleeper read-only weekly stats",
        season,
        updated: new Date().toISOString(),
        completed_weeks: 0,
        count: 0,
        players: [],
      };
  const sleeperPath = path.join(directory, "sleeper.json");
  if (requiresSleeper) writeJson(sleeperPath, sleeperPayload);
  else if (fs.existsSync(sleeperPath)) fs.unlinkSync(sleeperPath);
  const scoringPayloads = {};
  for (const scoring of ["STD", "HALF", "PPR"]) {
    const payload = await fantasyPros(season, scoring);
    scoringPayloads[scoring] = payload;
    console.log(`  ${scoring}: ${payload.count} FantasyPros players`);
  }
  const identities = new Map();
  Object.entries(scoringPayloads).forEach(([scoring, payload]) =>
    payload.players.forEach((player) => {
      const key = String(
        player.player_id || `${player.name}|${player.position}`,
      );
      const current = identities.get(key) || {
        player_id: player.player_id,
        name: player.name,
        position: player.position,
        team: player.team,
        scoring: {},
      };
      current.scoring[scoring.toLowerCase()] = {
        games: player.games,
        points: player.points,
        average: player.average,
        weeks: player.weeks,
      };
      identities.set(key, current);
    }),
  );
  const fantasyProsPayload = {
    source: "FantasyPros official API",
    season,
    updated: new Date().toISOString(),
    scoring_variants: ["std", "half", "ppr"],
    count: identities.size,
    players: [...identities.values()],
  };
  writeJson(path.join(directory, "fantasypros.json"), fantasyProsPayload);
  for (const legacy of [
    "fantasypros_std.json",
    "fantasypros_half.json",
    "fantasypros_ppr.json",
  ]) {
    const legacyPath = path.join(directory, legacy);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  }
  saveManifestEntry({
    season,
    fantasypros_players: fantasyProsPayload.count,
    fantasypros_file: "fantasypros.json",
    sleeper_players: sleeperPayload.count,
    completed_weeks: sleeperPayload.completed_weeks,
  });
  completed += 1;
}
console.log(
  `Saved ${completed} new season${completed === 1 ? "" : "s"} using ${fantasyProsRequests}/${FANTASYPROS_RUN_BUDGET} permitted FantasyPros requests this run.`,
);
