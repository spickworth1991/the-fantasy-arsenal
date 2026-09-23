import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : true];
}));
const destination = path.join(process.cwd(), "public", "data", "odds", "nfl-props-snapshot.json");
const existing = (() => { try { return JSON.parse(fs.readFileSync(destination, "utf8")); } catch { return null; } })();
const reserve = Math.max(0, Number(args.reserve ?? 100));

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
if (!env.SPORTSGAMEODDS_API_KEY && !args["dry-run"]) throw new Error("SPORTSGAMEODDS_API_KEY is missing.");

const headers = { "x-api-key": env.SPORTSGAMEODDS_API_KEY };
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

const startsAfter = args.date ? new Date(`${args.date}T00:00:00-04:00`) : new Date();
if (!args.date) startsAfter.setHours(startsAfter.getHours() - 1);
if (!Number.isFinite(startsAfter.getTime())) throw new Error("--date must use YYYY-MM-DD.");
const startsBefore = new Date(startsAfter);
startsBefore.setDate(startsBefore.getDate() + (args.date ? 1 : 6));
const url = new URL("https://api.sportsgameodds.com/v2/events");
const eventIDs = String(args.events || "").split(",").map((value) => value.trim()).filter(Boolean);
if (eventIDs.length) url.searchParams.set("eventIDs", eventIDs.join(","));
else url.searchParams.set("leagueID", "NFL");
url.searchParams.set("oddsAvailable", "true");
url.searchParams.set("includeAltLines", "true");
url.searchParams.set("bookmakerID", "draftkings");
url.searchParams.set("startsAfter", startsAfter.toISOString());
url.searchParams.set("startsBefore", startsBefore.toISOString());
url.searchParams.set("limit", "100");

if (args["dry-run"]) {
  const localEvents = (existing?.events || []).filter((event) => {
    const kickoff = Date.parse(event.commence_time);
    return eventIDs.length ? eventIDs.includes(String(event.id)) : kickoff >= startsAfter.getTime() && kickoff < startsBefore.getTime();
  });
  console.log(`Dry run: ${url.toString()}`);
  console.log(`Local snapshot suggests ${localEvents.length || (args.date ? "up to 16" : "up to 32")} event objects; ${reserve} monthly objects are reserved. No API request was made.`);
  process.exit(0);
}

const signature = `${eventIDs.join(",")}|${args.date || "rolling"}|draftkings|alternates`;
if (!args.force && existing?.query_signature === signature && Date.now() - Date.parse(existing.fetched_at || "") < 5 * 60 * 1000) {
  console.log("Skipped duplicate Prop Lab refresh: the same query completed less than five minutes ago. Use --force to override.");
  process.exit(3);
}

const before = await usage();
const localEstimate = (existing?.events || []).filter((event) => {
  const kickoff = Date.parse(event.commence_time);
  return eventIDs.length ? eventIDs.includes(String(event.id)) : kickoff >= startsAfter.getTime() && kickoff < startsBefore.getTime();
}).length;
const estimatedObjects = Math.max(1, eventIDs.length || localEstimate || (args.date ? 16 : 32));
if (before.remaining - estimatedObjects < reserve) throw new Error(`SportsGameOdds refresh stopped: about ${estimatedObjects} objects are expected, ${before.remaining} remain, and ${reserve} must stay reserved.`);

const response = await fetch(url, { headers });
const payload = await response.json();
if (!response.ok || !payload.success) throw new Error(payload?.error || `SportsGameOdds HTTP ${response.status}`);

const events = (payload.data || []).map((event) => {
  const markets = new Map();
  for (const odd of Object.values(event.odds || {})) {
    const marketKey = STAT_MARKETS[odd.statID];
    const providerPlayerId = odd.playerID || odd.statEntityID;
    const player = event.players?.[providerPlayerId];
    const book = odd.byBookmaker?.draftkings;
    if (!marketKey || !player?.name || odd.periodID !== "game" || odd.betTypeID !== "ou" || !["over", "under"].includes(odd.sideID) || !book) continue;
    if (!markets.has(marketKey)) markets.set(marketKey, []);
    const outcomes = markets.get(marketKey);
    const add = (line) => {
      if (!line?.available || !Number.isFinite(Number(line.odds)) || !Number.isFinite(Number(line.overUnder))) return;
      const key = `${odd.sideID}:${player.name}:${line.overUnder}`;
      if (outcomes.some((row) => row._key === key)) return;
      outcomes.push({
        _key: key, name: odd.sideID === "over" ? "Over" : "Under", description: player.name,
        player_id: providerPlayerId || null, price: Number(line.odds), point: Number(line.overUnder),
        available: line.available !== false, updated_at: line.lastUpdatedAt || book.lastUpdatedAt || odd.lastUpdatedAt || null,
        deeplink: line.deeplink || book.deeplink || null,
      });
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
    links: event.links || null,
    bookmakers: [{ key: "draftkings", title: "DraftKings", last_update: new Date().toISOString(), markets: [...markets.entries()].map(([key, outcomes]) => ({ key, outcomes: outcomes.map(({ _key, ...row }) => row) })) }],
  };
}).filter((event) => event.bookmakers[0].markets.some((market) => market.outcomes.length));

const after = await usage();
const snapshot = {
  fetched_at: new Date().toISOString(),
  provider: "SportsGameOdds",
  jurisdiction: "Michigan default; verify availability and price in the bettor's state",
  quota: {
    maximum: after.maximum,
    used: after.used,
    remaining: after.remaining,
    this_capture: after.used - before.used,
    reserve,
  },
  query_signature: signature,
  requested_bookmakers: ["DraftKings"],
  includes_alternate_lines: true,
  events,
};
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
const outcomes = events.reduce((sum, event) => sum + event.bookmakers[0].markets.reduce((marketSum, market) => marketSum + market.outcomes.length, 0), 0);
console.log(`Saved ${events.length} NFL events and ${outcomes} available DraftKings lines; used ${snapshot.quota.this_capture} objects, ${snapshot.quota.remaining} remaining.`);
