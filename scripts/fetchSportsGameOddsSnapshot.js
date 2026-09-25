import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : true];
}));
const destination = path.join(process.cwd(), "public", "data", "odds", "nfl-props-snapshot.json");
const existing = (() => { try { return JSON.parse(fs.readFileSync(destination, "utf8")); } catch { return null; } })();
const reserve = Math.max(0, Number(args.reserve ?? 100));
const now = new Date(args.now || Date.now());
if (!Number.isFinite(now.getTime())) throw new Error("--now must be a valid ISO timestamp.");

const STAT_MARKETS = {
  passing_yards: "player_pass_yds", passing_touchdowns: "player_pass_tds", passing_completions: "player_pass_completions",
  rushing_yards: "player_rush_yds", rushing_attempts: "player_rush_attempts", receptions: "player_receptions",
  receiving_receptions: "player_receptions", receiving_yards: "player_reception_yds", receiving_targets: "player_targets",
};
const TEAM_NAMES = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers",
  CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos",
  DET: "Detroit Lions", GB: "Green Bay Packers", HOU: "Houston Texans", IND: "Indianapolis Colts", JAC: "Jacksonville Jaguars",
  JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins", MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks", SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders", WSH: "Washington Commanders",
};
const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const gameKey = (game) => `${game.away}@${game.home}:${new Date(game.date).toISOString()}`;
const sameGame = (game, event) => Math.abs(Date.parse(game.date) - Date.parse(event.commence_time)) < 15 * 60000
  && normalized(TEAM_NAMES[game.home] || game.home) === normalized(event.home_team)
  && normalized(TEAM_NAMES[game.away] || game.away) === normalized(event.away_team);
const scheduleCandidates = [Number(args.season), now.getUTCFullYear(), now.getUTCFullYear() - 1].filter(Number.isFinite);
const scheduleFile = scheduleCandidates.map((season) => path.join(process.cwd(), "public", "stats", "projections", String(season), "schedule.json")).find((file) => fs.existsSync(file));
const schedule = (() => { try { return JSON.parse(fs.readFileSync(scheduleFile, "utf8")); } catch { return { weeks: [] }; } })();
const scheduledGames = (schedule.weeks || []).flatMap((week) => (week.games || []).map((game) => ({ ...game, week: week.week })))
  .filter((game) => !game.completed && Number.isFinite(Date.parse(game.date))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
const knownEvent = (game) => (existing?.events || []).find((event) => sameGame(game, event));
const formatGame = (game, index) => `${String(index + 1).padStart(2, " ")}. Week ${game.week}: ${game.away} at ${game.home} — ${new Date(game.date).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}${knownEvent(game)?.id ? "" : " (provider ID not cached)"}`;

let mode = args.manual || args.mode === "manual" ? "manual" : "auto";
if (args.auto || args.mode === "auto") mode = "auto";
if ((args.manual || args.mode === "manual") && (args.auto || args.mode === "auto")) throw new Error("Choose either auto or manual mode, not both.");
const listHorizon = now.getTime() + Math.max(1, Number(args["list-days"] || 7)) * 86400000;
const menuGames = scheduledGames.filter((game) => Date.parse(game.date) > now.getTime() && Date.parse(game.date) <= listHorizon);

if (args.list) {
  console.log(`Upcoming NFL matchups from the saved schedule (${schedule.updated || "unknown update time"}):`);
  menuGames.forEach((game, index) => console.log(formatGame(game, index)));
  if (!menuGames.length) console.log("No games are scheduled in this range.");
  process.exit(0);
}

const explicitEventIDs = String(args.events || "").split(",").map((value) => value.trim()).filter(Boolean);
let selectedGames = [];
if (args.date) {
  const start = new Date(`${args.date}T00:00:00-04:00`);
  if (!Number.isFinite(start.getTime())) throw new Error("--date must use YYYY-MM-DD.");
  const end = new Date(start.getTime() + 86400000);
  selectedGames = scheduledGames.filter((game) => Date.parse(game.date) >= start.getTime() && Date.parse(game.date) < end.getTime());
  mode = "manual";
} else if (!explicitEventIDs.length && mode === "manual") {
  console.log("Select matchup numbers separated by commas:");
  menuGames.forEach((game, index) => console.log(formatGame(game, index)));
  if (!menuGames.length) { console.log("No upcoming games are available to select."); process.exit(3); }
  let selection = String(args.games || "");
  if (!selection) {
    if (!process.stdin.isTTY) throw new Error("Manual mode needs --games=1,3 when no interactive terminal is available.");
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    selection = await prompt.question("Matchups: "); prompt.close();
  }
  const indexes = [...new Set(selection.split(",").map((value) => Number(value.trim()) - 1))];
  if (!indexes.length || indexes.some((index) => !Number.isInteger(index) || !menuGames[index])) throw new Error("Enter valid matchup numbers, for example --games=1,3.");
  selectedGames = indexes.map((index) => menuGames[index]);
} else if (!explicitEventIDs.length) {
  const windowMinutes = Math.max(1, Number(args["window-minutes"] ?? 45));
  const end = now.getTime() + windowMinutes * 60000;
  selectedGames = scheduledGames.filter((game) => Date.parse(game.date) > now.getTime() && Date.parse(game.date) <= end);
  console.log(`Automatic mode: checking only games kicking off in the next ${windowMinutes} minutes.`);
  if (!selectedGames.length) { console.log("No NFL matchup is inside the update window. No API request was made."); process.exit(3); }
}

selectedGames.forEach((game) => console.log(`Selected: Week ${game.week} ${game.away} at ${game.home} (${new Date(game.date).toLocaleString("en-US", { timeZone: "America/New_York" })} ET)`));
const cachedIDs = selectedGames.map(knownEvent).filter(Boolean).map((event) => String(event.id));
const eventIDs = [...new Set([...explicitEventIDs, ...cachedIDs])];
const unknownGames = selectedGames.filter((game) => !knownEvent(game));

const envFile = path.join(process.cwd(), ".env.local");
const fileEnv = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
  const split = line.indexOf("="); return [line.slice(0, split), line.slice(split + 1)];
})) : {};
const apiKey = process.env.SPORTSGAMEODDS_API_KEY || fileEnv.SPORTSGAMEODDS_API_KEY;
if (!apiKey && !args["dry-run"]) throw new Error("SPORTSGAMEODDS_API_KEY is missing.");
const headers = { "x-api-key": apiKey };
const monthlyUsage = (payload) => {
  const row = payload?.data?.rateLimits?.["per-month"] || payload?.data?.rate_limits?.monthly || {};
  const maximum = Number(row["max-entities"] ?? row.maxEntitiesPerInterval ?? row.max_entities);
  const used = Number(row["current-entities"] ?? row.currentIntervalEntities ?? row.current_entities);
  if (!Number.isFinite(maximum) || !Number.isFinite(used)) throw new Error("Monthly SportsGameOdds allowance could not be read safely.");
  return { maximum, used, remaining: maximum - used };
};
const usage = async () => {
  const response = await fetch("https://api.sportsgameodds.com/v2/account/usage", { headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "Usage check failed.");
  return monthlyUsage(payload);
};
const makeUrl = ({ ids = [], games = [] }) => {
  const url = new URL("https://api.sportsgameodds.com/v2/events");
  if (ids.length) url.searchParams.set("eventIDs", ids.join(",")); else url.searchParams.set("leagueID", "NFL");
  let startsAfter; let startsBefore;
  if (games.length) {
    const times = games.map((game) => Date.parse(game.date));
    startsAfter = new Date(Math.min(...times) - 10 * 60000); startsBefore = new Date(Math.max(...times) + 10 * 60000);
  } else { startsAfter = new Date(now.getTime() - 3600000); startsBefore = new Date(now.getTime() + 6 * 86400000); }
  url.searchParams.set("oddsAvailable", "true"); url.searchParams.set("includeAltLines", "true");
  url.searchParams.set("bookmakerID", "draftkings"); url.searchParams.set("startsAfter", startsAfter.toISOString());
  url.searchParams.set("startsBefore", startsBefore.toISOString()); url.searchParams.set("limit", "100"); return url;
};
const requestGroups = [];
if (eventIDs.length) requestGroups.push({ ids: eventIDs, games: selectedGames.filter((game) => knownEvent(game)) });
for (const kickoff of [...new Set(unknownGames.map((game) => new Date(game.date).toISOString()))]) requestGroups.push({ ids: [], games: unknownGames.filter((game) => new Date(game.date).toISOString() === kickoff) });
if (!requestGroups.length) throw new Error("No matchups were selected.");
const urls = requestGroups.map(makeUrl);

if (args["dry-run"]) {
  urls.forEach((url) => console.log(`Dry run: ${url.toString()}`));
  const note = unknownGames.length ? ` ${unknownGames.length} selected game(s) have no cached provider ID, so their shared kickoff batch must be discovered once.` : "";
  console.log(`Would refresh ${selectedGames.length || eventIDs.length} selected matchup(s); ${reserve} monthly objects remain reserved.${note} No API request was made.`);
  process.exit(0);
}

const signature = `${mode}|${[...eventIDs].sort().join(",")}|${selectedGames.map(gameKey).sort().join(",")}|draftkings|alternates`;
if (!args.force && existing?.query_signature === signature && Date.now() - Date.parse(existing.fetched_at || "") < 5 * 60000) {
  console.log("Skipped duplicate Prop Lab refresh: the same selection completed less than five minutes ago. Use --force to override."); process.exit(3);
}
const before = await usage();
const discoveryEstimate = requestGroups.filter((group) => !group.ids.length).reduce((sum, group) => {
  const earliest = Math.min(...group.games.map((game) => Date.parse(game.date))) - 10 * 60000;
  const latest = Math.max(...group.games.map((game) => Date.parse(game.date))) + 10 * 60000;
  return sum + scheduledGames.filter((game) => Date.parse(game.date) >= earliest && Date.parse(game.date) <= latest).length;
}, 0);
const expected = Math.max(1, eventIDs.length + discoveryEstimate);
if (before.remaining - expected < reserve) throw new Error(`SportsGameOdds refresh stopped: at least ${expected} objects are expected, ${before.remaining} remain, and ${reserve} must stay reserved.`);

const captureTime = new Date().toISOString();
const rawEvents = [];
for (let index = 0; index < urls.length; index += 1) {
  const response = await fetch(urls[index], { headers }); const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload?.error || `SportsGameOdds HTTP ${response.status}`);
  const group = requestGroups[index];
  rawEvents.push(...(payload.data || []).filter((event) => group.ids.length || group.games.some((game) => sameGame(game, {
    commence_time: event.status?.startsAt || event.startsAt || "", home_team: event.teams?.home?.names?.long || "", away_team: event.teams?.away?.names?.long || "",
  }))));
}

const refreshedEvents = rawEvents.map((event) => {
  const markets = new Map();
  for (const odd of Object.values(event.odds || {})) {
    const marketKey = STAT_MARKETS[odd.statID]; const providerPlayerId = odd.playerID || odd.statEntityID;
    const player = event.players?.[providerPlayerId]; const book = odd.byBookmaker?.draftkings;
    if (!marketKey || !player?.name || odd.periodID !== "game" || odd.betTypeID !== "ou" || !["over", "under"].includes(odd.sideID) || !book) continue;
    if (!markets.has(marketKey)) markets.set(marketKey, []); const outcomes = markets.get(marketKey);
    const add = (line) => {
      if (!line?.available || !Number.isFinite(Number(line.odds)) || !Number.isFinite(Number(line.overUnder))) return;
      const key = `${odd.sideID}:${player.name}:${line.overUnder}`; if (outcomes.some((row) => row._key === key)) return;
      outcomes.push({ _key: key, name: odd.sideID === "over" ? "Over" : "Under", description: player.name, player_id: providerPlayerId || null,
        price: Number(line.odds), point: Number(line.overUnder), available: line.available !== false,
        updated_at: line.lastUpdatedAt || book.lastUpdatedAt || odd.lastUpdatedAt || null, deeplink: line.deeplink || book.deeplink || null });
    };
    add(book); (book.altLines || []).forEach(add);
  }
  return { id: event.eventID, sport_key: "americanfootball_nfl", sport_title: "NFL", commence_time: event.status?.startsAt || event.startsAt || "",
    home_team: event.teams?.home?.names?.long || "", away_team: event.teams?.away?.names?.long || "", links: event.links || null, captured_at: captureTime,
    bookmakers: [{ key: "draftkings", title: "DraftKings", last_update: captureTime, markets: [...markets.entries()].map(([key, outcomes]) => ({ key, outcomes: outcomes.map(({ _key, ...row }) => row) })) }],
  };
}).filter((event) => event.bookmakers[0].markets.some((market) => market.outcomes.length));
if (!refreshedEvents.length) throw new Error("SportsGameOdds returned no usable DraftKings player props for the selected matchup(s). The previous snapshot was preserved.");

const after = await usage(); const refreshedIDs = new Set(refreshedEvents.map((event) => String(event.id)));
const retainedEvents = (existing?.events || []).filter((event) => !refreshedIDs.has(String(event.id))).map((event) => ({ ...event, captured_at: event.captured_at || existing.fetched_at || null }));
const events = [...retainedEvents, ...refreshedEvents].sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));
const snapshot = {
  schema_version: 2, fetched_at: captureTime, provider: "SportsGameOdds", jurisdiction: "Michigan default; verify availability and price in the bettor's state",
  quota: { maximum: after.maximum, used: after.used, remaining: after.remaining, this_capture: after.used - before.used, reserve },
  query_signature: signature, capture_mode: mode, active_event_ids: [...refreshedIDs],
  selected_games: selectedGames.map((game) => ({ week: game.week, away: game.away, home: game.home, kickoff: game.date })),
  requested_bookmakers: ["DraftKings"], includes_alternate_lines: true, events,
};
fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
const outcomes = refreshedEvents.reduce((sum, event) => sum + event.bookmakers[0].markets.reduce((marketSum, market) => marketSum + market.outcomes.length, 0), 0);
console.log(`Refreshed ${refreshedEvents.length} selected NFL matchup(s) and ${outcomes} DraftKings lines; used ${snapshot.quota.this_capture} objects, ${snapshot.quota.remaining} remaining.`);
console.log(`${retainedEvents.length} other cached matchup(s) were retained with their original capture times and were not published as fresh recommendations.`);
