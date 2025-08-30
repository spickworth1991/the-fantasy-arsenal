// scripts/updateValues.js (or tools/update-values.js)
// ESM
// node scripts/updateValues --show-browser --devtools --slowmo=200 --shots --keep-open


import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";
import puppeteer from "puppeteer";
import inquirer from "inquirer";
import { fileURLToPath } from "url";

// For __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Output paths ----------
const FC_OUT_PATH = path.join(__dirname, "../public/fantasycalc_cache.json");
const DP_OUT_PATH = path.join(__dirname, "../public/dynastyprocess_cache.json");
const KTC_OUT_PATH = path.join(__dirname, "../public/ktc_cache.json");
const FN_OUT_PATH = path.join(__dirname, "../public/fantasynav_cache.json");
const IDP_OUT_PATH = path.join(__dirname, "../public/idynastyp_cache.json");
const SP_OUT_PATH  = path.join(__dirname, "../public/stickypicky_cache.json");

// Bye weeks output (per season)
const BYE_DIR = path.join(__dirname, "../public/byes");

// ---------- CLI helpers / Puppeteer debug switches ----------
function getArgFlag(flag) {
  return process.argv.includes(flag);
}
function getArgValue(flagEq) {
  // e.g. --slowmo=200
  const hit = process.argv.find(a => a.startsWith(flagEq + "="));
  if (!hit) return null;
  return hit.split("=")[1];
}
// Turn on headful+devtools+slowMo screenshots by either env or flags:
//   PPTR_SHOW=1 node scripts/updateValues
//   node scripts/updateValues --show-browser --devtools --slowmo=200 --shots --keep-open
function makePptrLaunchOpts() {
  const show =
    process.env.PPTR_SHOW === "1" ||
    process.env.PUPPETEER_SHOW === "1" ||
    getArgFlag("--show-browser") ||
    getArgFlag("--pptr-show");

  const devtools =
    process.env.PPTR_DEVTOOLS === "1" ||
    getArgFlag("--devtools");

  const slowMoArg = getArgValue("--slowmo");
  const slowMoEnv = process.env.PPTR_SLOWMO;
  const slowMo = Number(slowMoArg ?? slowMoEnv ?? (show ? 60 : 0)) || 0;

  return {
    headless: show ? false : "new",
    devtools,
    slowMo,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1400,900",
    ],
  };
}

function wirePageDebug(page, filterHost = "") {
  page.on("console", (msg) => {
    const type = msg.type().toUpperCase();
    console.log(`[pptr:${type}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.error("[pptr:pageerror]", err));
  page.on("response", (res) => {
    const url = res.url();
    if (!filterHost || url.includes(filterHost)) {
      console.log("[pptr:response]", res.status(), url);
    }
  });
}

const WANT_SHOTS =
  process.env.PPTR_SHOTS === "1" || getArgFlag("--shots");
const KEEP_OPEN =
  process.env.PPTR_KEEP === "1" || getArgFlag("--keep-open");

function makeShooter(page, subdir = "_debug") {
  if (!WANT_SHOTS) return async () => {};
  const debugDir = path.join(BYE_DIR, subdir);
  fs.mkdirSync(debugDir, { recursive: true });
  const stampBase = new Date().toISOString().replace(/[:.]/g, "-");
  return async (name) => {
    try {
      const file = path.join(debugDir, `${stampBase}-${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("saved screenshot:", path.relative(process.cwd(), file));
    } catch (e) {
      console.log("screenshot failed:", e?.message || e);
    }
  };
}

// ---------- Helpers for StickyPicky ----------
// Simple sleep (v22+ removed page.waitForTimeout)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---------- Data sources ----------
// 1. FantasyCalc (API, 1QB + SF, Dynasty + Redraft)
// 2. DynastyProcess (CSV, 1QB + SF, Dynasty only)
// 3. KeepTradeCut (scrape, 1QB + SF, Dynasty only)
// 4. FantasyNavigator (API, 1QB + SF, Dynasty + Redraft)
// 5. IDynastyP (Google Sheets API, 1QB + SF, Dynasty only)
const combinations = [
  { isDynasty: true, numQbs: 1, key: "Dynasty_1QB" },
  { isDynasty: true, numQbs: 2, key: "Dynasty_SF" },
  { isDynasty: false, numQbs: 1, key: "Redraft_1QB" },
  { isDynasty: false, numQbs: 2, key: "Redraft_SF" },
];

const normName = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

function percentilesFromList(items, getVal) {
  const vals = items.map(getVal).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length === 0) return () => 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const N = sorted.length;
  return (v) => {
    if (!Number.isFinite(v) || v <= 0) return 0;
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1; else hi = mid;
    }
    if (N === 1) return 1;
    return Math.max(0, Math.min(1, (lo - 1) / (N - 1)));
  };
}

function pickMeta(metaSources) {
  for (const m of metaSources) {
    if (m && (m.team || m.position)) return m;
  }
  return { team: "", position: "" };
}

// ---------- KTC scraping helpers ----------
async function closePopupIfPresent(page) {
  try {
    await page.waitForSelector(".modal-content", { timeout: 5000 });
    await page.click("#dont-know");
    await new Promise((r) => setTimeout(r, 1500));
    console.log("Popup closed.");
  } catch {
    console.log("No popup detected.");
  }
}

// ✅ Scrape KTC rankings (Superflex or 1QB) — debuggable
async function scrapeKTC(superflex = true) {
  console.log(`\nScraping KTC rankings (${superflex ? "Superflex" : "1QB"})...`);
  const browser = await puppeteer.launch(makePptrLaunchOpts());
  const page = await browser.newPage();
  wirePageDebug(page, "keeptradecut.com");
  await page.setViewport({ width: 1400, height: 900 });
  const shoot = makeShooter(page, "_ktc_debug");

  await page.goto("https://keeptradecut.com/dynasty-rankings", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await shoot("loaded");

  // Close KTC popup if it shows
  try {
    await page.waitForSelector(".modal-content", { timeout: 5000 });
    await page.click("#dont-know");
    await sleep(1500);
  } catch {}

  await page.waitForSelector(".sf-toggle-wrapper.superflex .sf-toggle", { timeout: 10000 });
  await page.evaluate((isSF) => {
    const toggle = document.querySelector(".sf-toggle-wrapper.superflex .sf-toggle");
    const active = toggle?.classList.contains("active");
    if (!toggle) return;
    if (isSF && !active) toggle.click();
    if (!isSF && active) toggle.click();
  }, superflex);
  await sleep(1000);
  await shoot("mode-toggled");

  const allPlayers = [];
  const options = await page.$$eval("#ranking-pagination-dropdown option", (opts) =>
    opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
  );

  for (const opt of options) {
    await page.select("#ranking-pagination-dropdown", opt.value);
    await page.waitForSelector("#rankings-page-rankings .onePlayer", { timeout: 10000 });
    await sleep(800);

    const playersOnPage = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#rankings-page-rankings .onePlayer")).map((el) => ({
        rank: parseInt(el.querySelector(".rank-number p")?.innerText.trim() || "0"),
        name: el.querySelector(".player-name a")?.innerText.trim() || "",
        team: el.querySelector(".player-name .player-team")?.innerText.trim() || "",
        position: (el.querySelector(".position-team .position")?.innerText || "").replace(/\d+$/, "").trim(),
        value: parseInt(el.querySelector(".value p")?.innerText.trim() || "0"),
      }));
    });

    allPlayers.push(...playersOnPage);
  }

  await shoot("after-scrape");
  if (!KEEP_OPEN) await browser.close();

  console.log(`✅ Collected ${allPlayers.length} players (${superflex ? "SF" : "1QB"})`);
  return allPlayers;
}


// ---------- Value updaters (unchanged) ----------
async function updateFantasyCalc() {
  const results = {};
  for (const { isDynasty, numQbs, key } of combinations) {
    const url = `https://api.fantasycalc.com/values/current?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=12&ppr=1`;
    console.log("Fetching FantasyCalc:", url);
    const res = await axios.get(url);
    results[key] = res.data;
  }
  fs.writeFileSync(FC_OUT_PATH, JSON.stringify(results, null, 2));
  console.log("✅ fantasycalc_cache.json updated.");
}

async function updateDynastyProcess() {
  const dpUrl = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
  console.log("Fetching DynastyProcess:", dpUrl);
  const dpRes = await axios.get(dpUrl);
  const parsed = Papa.parse(dpRes.data, { header: true }).data;

  const dpValues = {};
  parsed.forEach((row) => {
    if (!row.player || (!row.value_1qb && !row.value_2qb)) return;
    const nameKey = row.player.trim();
    dpValues[nameKey] = {
      pos: row.pos || "",
      team: row.team || "",
      one_qb: Number(row.value_1qb) || 0,
      superflex: Number(row.value_2qb) || 0,
    };
  });

  fs.writeFileSync(DP_OUT_PATH, JSON.stringify(dpValues, null, 2));
  console.log("✅ dynastyprocess_cache.json updated.");
}

async function updateKTC() {
  const ktc_sf = await scrapeKTC(true);   // SF
  const ktc_1qb = await scrapeKTC(false); // 1QB
  const ktcData = {
    Superflex: ktc_sf,
    OneQB: ktc_1qb,
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(KTC_OUT_PATH, JSON.stringify(ktcData, null, 2));
  console.log("✅ ktc_cache.json updated.");
}

async function updateFantasyNavigator() {
  const OUT_PATH = path.join(__dirname, "../public/fantasynav_cache.json");
  const url = "https://fantasy-navigator-latest.onrender.com/ranks?platform=sf";

  console.log("Fetching FantasyNavigator data:", url);
  const res = await axios.get(url);
  const data = res.data;

  if (!Array.isArray(data)) throw new Error("Unexpected FantasyNavigator response format.");

  const results = { Dynasty_SF: [], Dynasty_1QB: [], Redraft_SF: [], Redraft_1QB: [] };

  data.forEach((row) => {
    const name = row.player_full_name?.trim();
    const position = row._position || "";
    const team = row.team || "";
    const value = Number(row.player_value) || 0;
    const rankType = row.rank_type;     // dynasty | redraft
    const rosterType = row.roster_type; // sf_value | one_qb_value
    if (!name || !value) return;

    if (rankType === "dynasty" && rosterType === "sf_value") {
      results.Dynasty_SF.push({ name, position, team, value });
    } else if (rankType === "dynasty" && rosterType === "one_qb_value") {
      results.Dynasty_1QB.push({ name, position, team, value });
    } else if (rankType === "redraft" && rosterType === "sf_value") {
      results.Redraft_SF.push({ name, position, team, value });
    } else if (rankType === "redraft" && rosterType === "one_qb_value") {
      results.Redraft_1QB.push({ name, position, team, value });
    }
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log("✅ fantasynav_cache.json updated.");
}

async function updateIDynastyP() {
  const idpUrl = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLhvQECWwDmYCHgmBpi0kD7buPur9ToFc6ssnEqrFLAH24azxxAHP8jO7p0PSq6J6UkZrK0drR0-qnxmBnf2NSFW8s9cQ59sryzufM0iYCM-ZnOF9GidRgV3TUNKq8edwkDaJsm9t-hS7BOsYFIHMfN0GKNyBYzKU45mPR1NIEgk1-2HfDh5wevSPCe8FKmvxEU6u0QBtkD9d6aCV9j22mWF5tsMSdiEbpX80Axls6d06EPOoaSkscgi4yO8ds5zHarOCYIJgEgAzqH2XN0B2RM9tjkg9A&lib=MknHs2mWMhCl6DOSqHwTywMicp6k4geWO";
  console.log("Fetching IDynastyP data:", idpUrl);
  const res = await axios.get(idpUrl);
  const data = res.data;
  if (!data || !data.Sheet1) throw new Error("Unexpected IDynastyP response format.");

  const combined = [...(data.Sheet1 || []), ...(data.Sheet2 || []), ...(data.Sheet3 || [])];
  const normalized = combined.map((row) => ({
    name: row.name || "",
    team: row.team || "",
    position: row.position || "",
    one_qb: Number(row.value_1qb) || 0,
    superflex: Number(row.value_sf) || 0,
  }));

  fs.writeFileSync(IDP_OUT_PATH, JSON.stringify(normalized, null, 2));
  console.log(`✅ idynastyp_cache.json updated with ${normalized.length} entries.`);
}

async function updateStickyPicky() {
  console.log("\nBuilding StickyPicky (averaged, scale-free)…");
  const fcData  = JSON.parse(fs.readFileSync(FC_OUT_PATH,  "utf-8"));
  const dpData  = JSON.parse(fs.readFileSync(DP_OUT_PATH,  "utf-8"));
  const ktcData = JSON.parse(fs.readFileSync(KTC_OUT_PATH, "utf-8"));
  const fnData  = JSON.parse(fs.readFileSync(FN_OUT_PATH,  "utf-8"));
  const idpData = JSON.parse(fs.readFileSync(IDP_OUT_PATH, "utf-8"));

  const tables = {
    Dynasty_SF:    { FC: {}, FN: {}, KTC: {}, DP: {}, IDP: {} },
    Dynasty_1QB:   { FC: {}, FN: {}, KTC: {}, DP: {}, IDP: {} },
    Redraft_SF:    { FC: {}, FN: {} },
    Redraft_1QB:   { FC: {}, FN: {} },
  };

  for (const key of ["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"]) {
    (fcData[key] || []).forEach((row) => {
      const name = row.player?.name || row.name;
      const team = row.player?.maybeTeam || row.team || "";
      const position = (row.player?.position || row.position || "").replace(/\d+$/, "").trim();
      tables[key].FC[normName(name)] = { name, value: row.value || 0, team, position };
    });
  }

  for (const key of ["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"]) {
    (fnData[key] || []).forEach((row) => {
      tables[key].FN[normName(row.name)] = {
        name: row.name, value: row.value || 0, team: row.team || "", position: row.position || ""
      };
    });
  }

  (ktcData.Superflex || []).forEach((p) => {
    tables.Dynasty_SF.KTC[normName(p.name)] = { name: p.name, value: p.value || 0, team: p.team || "", position: p.position || "" };
  });
  (ktcData.OneQB || []).forEach((p) => {
    tables.Dynasty_1QB.KTC[normName(p.name)] = { name: p.name, value: p.value || 0, team: p.team || "", position: p.position || "" };
  });

  Object.entries(dpData || {}).forEach(([name, v]) => {
    const nn = normName(name);
    if (v?.superflex) tables.Dynasty_SF.DP[nn]  = { name, value: v.superflex, team: v.team || "", position: v.pos || "" };
    if (v?.one_qb)   tables.Dynasty_1QB.DP[nn] = { name, value: v.one_qb,   team: v.team || "", position: v.pos || "" };
  });

  (idpData || []).forEach((row) => {
    const nn = normName(row.name);
    if (row.superflex) tables.Dynasty_SF.IDP[nn]  = { name: row.name, value: row.superflex, team: row.team || "", position: row.position || "" };
    if (row.one_qb)   tables.Dynasty_1QB.IDP[nn] = { name: row.name, value: row.one_qb,     team: row.team || "", position: row.position || "" };
  });

  const out = { Dynasty_SF: [], Dynasty_1QB: [], Redraft_SF: [], Redraft_1QB: [] };

  for (const formatKey of Object.keys(out)) {
    const sources = tables[formatKey];
    const sourceKeys = Object.keys(sources);
    const pctFns = {};
    for (const S of sourceKeys) {
      const rows = Object.values(sources[S]);
      pctFns[S] = percentilesFromList(rows, (r) => r.value);
    }
    const nameSet = new Set();
    for (const S of sourceKeys) Object.keys(sources[S]).forEach((nn) => nameSet.add(nn));

    for (const nn of nameSet) {
      const perSource = sourceKeys.map((S) => sources[S][nn]).filter(Boolean);
      const pcts = perSource.map((r, i) => {
        const S = sourceKeys[sourceKeys.findIndex((s) => sources[s][nn] === r)];
        return pctFns[S](r.value);
      });
      if (!pcts.length) continue;

      const avgPct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      const stickyValue = Math.round(avgPct * 10000);
      const meta = pickMeta(
        [sources.FC?.[nn], sources.FN?.[nn], sources.DP?.[nn], sources.KTC?.[nn], sources.IDP?.[nn]]
          .map((x) => (x ? { team: x.team, position: x.position } : null))
      );
      const displayName =
        (sources.FC?.[nn]?.name) || (sources.FN?.[nn]?.name) ||
        (sources.DP?.[nn]?.name) || (sources.KTC?.[nn]?.name) ||
        (sources.IDP?.[nn]?.name) || nn;

      out[formatKey].push({
        name: displayName,
        team: meta.team || "",
        position: meta.position || "",
        value: stickyValue,
      });
    }

    out[formatKey].sort((a, b) => (b.value - a.value));
  }

  fs.writeFileSync(SP_OUT_PATH, JSON.stringify(out, null, 2));
  console.log("✅ stickypicky_cache.json updated.");
}

// ---------- BYE WEEK AUTOMATION (Gridiron only) ----------

// team name → Abbr patterns (handles city + nickname variants)
const TEAM_PATTERNS = [
  ["ARI", /(arizona|cardinals)/i],
  ["ATL", /(atlanta|falcons)/i],
  ["BAL", /(baltimore|ravens)/i],
  ["BUF", /(buffalo|bills)/i],
  ["CAR", /(carolina|panthers)/i],
  ["CHI", /(chicago|bears)/i],
  ["CIN", /(cincinnati|bengals)/i],
  ["CLE", /(cleveland|browns)/i],
  ["DAL", /(dallas|cowboys)/i],
  ["DEN", /(denver|broncos)/i],
  ["DET", /(detroit|lions)/i],
  ["GB",  /(green bay|packers)/i],
  ["HOU", /(houston|texans)/i],
  ["IND", /(indianapolis|colts)/i],
  ["JAX", /(jacksonville|jaguars|jags)/i],
  ["KC",  /(kansas city|chiefs)/i],
  ["LAC", /(los angeles chargers|la chargers|chargers)/i],
  ["LAR", /(los angeles rams|la rams|rams)/i],
  ["LV",  /(las vegas|raiders)/i],
  ["MIA", /(miami|dolphins)/i],
  ["MIN", /(minnesota|vikings)/i],
  ["NE",  /(new england|patriots)/i],
  ["NO",  /(new orleans|saints)/i],
  ["NYG", /(new york giants|giants)\b/i],
  ["NYJ", /(new york jets|jets)\b/i],
  ["PHI", /(philadelphia|eagles)/i],
  ["PIT", /(pittsburgh|steelers)/i],
  ["SEA", /(seattle|seahawks)/i],
  ["SF",  /(san francisco|49ers|niners)/i],
  ["TB",  /(tampa bay|buccaneers|bucs)/i],
  ["TEN", /(tennessee|titans)/i],
  ["WAS", /(washington|commanders)/i],
];

function extractTeamsFromText(text) {
  const found = new Set();
  const chunk = String(text || "").toLowerCase();
  for (const [abbr, rx] of TEAM_PATTERNS) {
    if (rx.test(chunk)) found.add(abbr);
  }
  // Also catch explicit 2–4 letter abbreviations separated by /, commas, & or spaces
  const shortHits = chunk.match(/\b([A-Z]{2,4})\b/gi) || [];
  shortHits.forEach(s => {
    const up = s.toUpperCase();
    // map common variants
    if (up === "WSH") found.add("WAS");
    if (up === "LVR") found.add("LV");
    if (["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"].includes(up)) {
      found.add(up);
    }
  });
  return Array.from(found);
}

// Pull current season (for filename) — safe default to current year
async function fetchCurrentSeasonFromSleeper() {
  try {
    const { data } = await axios.get("https://api.sleeper.app/v1/state/nfl");
    return Number(data?.league_season || data?.season || new Date().getFullYear());
  } catch {
    return new Date().getFullYear();
  }
}

// Scrape the SECOND table in article content
async function scrapeGridironGamesByes(season) {
  console.log(`Scraping GridironGames byes for ${season}…`);
  const url = "https://gridirongames.com/nfl-bye-weeks-schedule/";
  const browser = await puppeteer.launch(makePptrLaunchOpts());
  const page = await browser.newPage();
  wirePageDebug(page, "gridirongames.com");
  await page.setViewport({ width: 1400, height: 900 });
  const shoot = makeShooter(page, "_gridiron_debug");

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await shoot("loaded");

  // Accept cookie banner if present (WordPress cookie-notice plugin)
  try {
    await page.waitForSelector("#cn-accept-cookie, .cn-set-cookie", { timeout: 3000 });
    const accept = await page.$("#cn-accept-cookie") || await page.$(".cn-set-cookie");
    if (accept) { await accept.click(); await sleep(500); }
  } catch {}

  // Nudge lazy content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await shoot("scrolled");

  // Prefer the SECOND table under the article content; fallback: table whose header says BYE WEEKS SCHEDULE
  const parsed = await page.evaluate(() => {
    const root = document.querySelector(".entry-content") || document.body;
    const tables = Array.from(root.querySelectorAll("table"));
    let target = null;

    if (tables.length >= 2) {
      target = tables[1];
    } else if (tables.length === 1) {
      target = tables[0];
    } else {
      // Try within <main> if .entry-content failed
      const main = document.querySelector("main");
      const mt = main ? main.querySelectorAll("table") : [];
      if (mt.length) target = mt[1] || mt[0];
    }

    // If still null, try any table whose header row contains "BYE WEEKS"
    if (!target) {
      target = tables.find(t => /bye\s+weeks/i.test(t.textContent || ""));
    }
    if (!target) return null;

    const rows = Array.from(target.querySelectorAll("tr"));
    const out = [];
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll("th,td")).map(td => (td.textContent || "").trim());
      if (cells.length < 2) continue;

      // Heuristics: first cell has "Week"/number; second cell lists teams
      const weekMatch = cells[0].match(/\b(\d{1,2})\b/);
      const week = weekMatch ? Number(weekMatch[1]) : null;
      const teamsText = cells[1];

      if (Number.isFinite(week) && teamsText) {
        out.push({ week, teamsText });
      }
    }
    return out;
  });

  await shoot("table-parsed");
  if (!parsed || !parsed.length) {
    if (!KEEP_OPEN) await browser.close();
    throw new Error("Could not parse bye week table from GridironGames.");
  }

  // Build maps
  const by_week = {};
  const by_team = {};
  parsed.forEach(({ week, teamsText }) => {
    const teams = extractTeamsFromText(teamsText).sort();
    if (teams.length) {
      by_week[String(week)] = teams;
      teams.forEach(t => {
        if (!by_team[t]) by_team[t] = [];
        by_team[t].push(week);
      });
    }
  });

  if (!Object.keys(by_week).length) {
    if (!KEEP_OPEN) await browser.close();
    throw new Error("No bye data extracted from the table.");
  }

  await shoot("done");
  if (!KEEP_OPEN) await browser.close();

  return {
    season: Number(season),
    source: "GridironGames (table scraped)",
    source_url: "https://gridirongames.com/nfl-bye-weeks-schedule/",
    generated_at: new Date().toISOString(),
    by_week,
    by_team,
  };
}


// Master updater: Gridiron only
async function updateByeWeeksAuto() {
  fs.mkdirSync(BYE_DIR, { recursive: true });
  const season = await fetchCurrentSeasonFromSleeper();
  console.log(`\nBuilding bye map for ${season}…`);

  const data = await scrapeGridironGamesByes(season);

  const outPath = path.join(BYE_DIR, `${season}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`✅ Bye weeks written: ${path.relative(process.cwd(), outPath)} (source: ${data.source})`);
}

// ---------- Interactive menu ----------
(async () => {
  try {
    const { sources } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "sources",
        message: "Which values do you want to update?",
        choices: [
          { name: "FantasyCalc", value: "fc" },
          { name: "DynastyProcess", value: "dp" },
          { name: "KeepTradeCut (KTC)", value: "ktc" },
          { name: "FantasyNavigator", value: "fn" },
          { name: "IDynastyP", value: "idp" },
          { name: "StickyPicky (averaged)", value: "sp" },
          { name: "Bye Weeks (auto)", value: "byes" }, // Gridiron only
        ],
        validate: (input) => (input.length === 0 ? "Please select at least one." : true),
      },
    ]);

    console.log("\n✅ Updating selected sources...\n");

    if (sources.includes("fc"))  await updateFantasyCalc();
    if (sources.includes("dp"))  await updateDynastyProcess();
    if (sources.includes("ktc")) await updateKTC();
    if (sources.includes("fn"))  await updateFantasyNavigator();
    if (sources.includes("idp")) await updateIDynastyP();
    if (sources.includes("sp"))  await updateStickyPicky();
    if (sources.includes("byes")) await updateByeWeeksAuto();

    console.log("\n✅ All selected updates completed!");
  } catch (err) {
    console.error("❌ Failed to update trade calc data:", err?.message || err);
    process.exit(1);
  }
})();
