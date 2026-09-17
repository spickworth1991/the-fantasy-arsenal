import fs from "node:fs";
import path from "node:path";

const eventId = process.argv[2];
const baseMarkets = ["player_pass_yds", "player_rush_yds", "player_receptions", "player_reception_yds"];
const markets = process.argv.includes("--alternate") ? baseMarkets.map((market) => `${market}_alternate`) : baseMarkets;
const bookmakers = ["draftkings", "fanduel"];
if (!eventId || !/^[a-f0-9]{32}$/i.test(eventId)) throw new Error("Usage: node scripts/fetchOddsSnapshot.js <event-id>");

const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
  const split = line.indexOf("=");
  return [line.slice(0, split), line.slice(split + 1)];
}));
if (!env.THE_ODDS_API_KEY) throw new Error("THE_ODDS_API_KEY is missing.");

const url = new URL(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${eventId}/odds`);
url.searchParams.set("apiKey", env.THE_ODDS_API_KEY);
url.searchParams.set("bookmakers", bookmakers.join(","));
url.searchParams.set("markets", markets.join(","));
url.searchParams.set("oddsFormat", "american");
const response = await fetch(url);
const body = await response.json();
if (!response.ok) throw new Error(body?.message || `Odds API HTTP ${response.status}`);

const snapshot = {
  fetched_at: new Date().toISOString(), provider: "The Odds API",
  quota: {
    remaining: Number(response.headers.get("x-requests-remaining")),
    used: Number(response.headers.get("x-requests-used")),
    last: Number(response.headers.get("x-requests-last")),
  },
  requested_markets: markets, requested_bookmakers: bookmakers, events: [body],
};
const destination = path.join(process.cwd(), "public", "data", "odds", "nfl-props-snapshot.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved 1 event; cost ${snapshot.quota.last}, remaining ${snapshot.quota.remaining}.`);
