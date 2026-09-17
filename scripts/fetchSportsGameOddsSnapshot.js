import fs from "node:fs";
import path from "node:path";

const STAT_MARKETS = {
  passing_yards: "player_pass_yds",
  passing_touchdowns: "player_pass_tds",
  passing_completions: "player_pass_completions",
  rushing_yards: "player_rush_yds",
  rushing_attempts: "player_rush_attempts",
  receptions: "player_receptions",
  receiving_receptions: "player_receptions",
  receiving_yards: "player_reception_yds",
  receiving_targets: "player_targets",
};

const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
  const split = line.indexOf("=");
  return [line.slice(0, split), line.slice(split + 1)];
}));
if (!env.SPORTSGAMEODDS_API_KEY) throw new Error("SPORTSGAMEODDS_API_KEY is missing.");

const headers = { "x-api-key": env.SPORTSGAMEODDS_API_KEY };
const usage = async () => {
  const response = await fetch("https://api.sportsgameodds.com/v2/account/usage", { headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "Usage check failed.");
  return payload.data?.rateLimits?.["per-month"] || {};
};

const before = await usage();
const startsAfter = new Date();
startsAfter.setHours(startsAfter.getHours() - 6);
const startsBefore = new Date(startsAfter);
startsBefore.setDate(startsBefore.getDate() + 6);
const url = new URL("https://api.sportsgameodds.com/v2/events");
url.searchParams.set("leagueID", "NFL");
url.searchParams.set("oddsAvailable", "true");
url.searchParams.set("includeAltLines", "true");
url.searchParams.set("bookmakerID", "draftkings");
url.searchParams.set("startsAfter", startsAfter.toISOString());
url.searchParams.set("startsBefore", startsBefore.toISOString());
url.searchParams.set("limit", "100");

const response = await fetch(url, { headers });
const payload = await response.json();
if (!response.ok || !payload.success) throw new Error(payload?.error || `SportsGameOdds HTTP ${response.status}`);

const events = (payload.data || []).map((event) => {
  const markets = new Map();
  for (const odd of Object.values(event.odds || {})) {
    const marketKey = STAT_MARKETS[odd.statID];
    const player = event.players?.[odd.playerID || odd.statEntityID];
    const book = odd.byBookmaker?.draftkings;
    if (!marketKey || !player?.name || odd.periodID !== "game" || odd.betTypeID !== "ou" || !["over", "under"].includes(odd.sideID) || !book) continue;
    if (!markets.has(marketKey)) markets.set(marketKey, []);
    const outcomes = markets.get(marketKey);
    const add = (line) => {
      if (!line?.available || !Number.isFinite(Number(line.odds)) || !Number.isFinite(Number(line.overUnder))) return;
      const key = `${odd.sideID}:${player.name}:${line.overUnder}`;
      if (outcomes.some((row) => row._key === key)) return;
      outcomes.push({ _key: key, name: odd.sideID === "over" ? "Over" : "Under", description: player.name, price: Number(line.odds), point: Number(line.overUnder) });
    };
    add(book);
    (book.altLines || []).forEach(add);
  }
  return {
    id: event.eventID,
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: event.status?.startsAt || event.startsAt || "",
    home_team: event.teams?.home?.names?.long || "",
    away_team: event.teams?.away?.names?.long || "",
    bookmakers: [{ key: "draftkings", title: "DraftKings", last_update: new Date().toISOString(), markets: [...markets.entries()].map(([key, outcomes]) => ({ key, outcomes: outcomes.map(({ _key, ...row }) => row) })) }],
  };
}).filter((event) => event.bookmakers[0].markets.some((market) => market.outcomes.length));

const after = await usage();
const snapshot = {
  fetched_at: new Date().toISOString(),
  provider: "SportsGameOdds",
  jurisdiction: "Michigan default; verify availability and price in the bettor's state",
  quota: {
    maximum: Number(after["max-entities"]),
    used: Number(after["current-entities"]),
    remaining: Number(after["max-entities"]) - Number(after["current-entities"]),
    this_capture: Number(after["current-entities"]) - Number(before["current-entities"]),
  },
  requested_bookmakers: ["DraftKings"],
  includes_alternate_lines: true,
  events,
};
const destination = path.join(process.cwd(), "public", "data", "odds", "nfl-props-snapshot.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
const outcomes = events.reduce((sum, event) => sum + event.bookmakers[0].markets.reduce((marketSum, market) => marketSum + market.outcomes.length, 0), 0);
console.log(`Saved ${events.length} NFL events and ${outcomes} available DraftKings lines; used ${snapshot.quota.this_capture} objects, ${snapshot.quota.remaining} remaining.`);
