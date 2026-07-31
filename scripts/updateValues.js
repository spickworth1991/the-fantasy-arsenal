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
import { gzipSync } from "zlib";
import {
  formatPickLabel,
  normalizeFantasyTeamAbbr,
  parsePickLabel,
} from "../src/lib/picks.js";

// For __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local updates automatically read secrets from the ignored `.env.local`.
// Existing shell/GitHub environment variables always take precedence.
function loadLocalEnvironment() {
  const envPath = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[match[1]] = value.replace(/\\n/g, "\n");
  }
}
loadLocalEnvironment();

// Configuration constants
const CONFIG = {
  REQUEST_TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  BROWSER_TIMEOUT: 60000,
  CACHE_MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
};

// Utility functions
async function retryOperation(operation, maxAttempts = CONFIG.RETRY_ATTEMPTS, delay = CONFIG.RETRY_DELAY) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.log(`  ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= 2; // Exponential backoff
      }
    }
  }
  throw lastError;
}

function validateDataStructure(data, expectedKeys, source) {
  if (!data || typeof data !== 'object') {
    throw new Error(`${source}: Invalid data structure - expected object, got ${typeof data}`);
  }

  const missingKeys = expectedKeys.filter(key => !(key in data));
  if (missingKeys.length > 0) {
    throw new Error(`${source}: Missing required keys: ${missingKeys.join(', ')}`);
  }

  return true;
}

function isCacheValid(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const age = Date.now() - stats.mtime.getTime();
    return age < CONFIG.CACHE_MAX_AGE;
  } catch {
    return false;
  }
}

function logProgress(message, current, total) {
  if (total) {
    const percentage = Math.round((current / total) * 100);
    console.log(`${message} (${percentage}%)`);
  } else {
    console.log(message);
  }
}
const CURRENT_SEASON = Number(process.env.NFL_SEASON) || new Date().getUTCFullYear();
const VERBOSE_LOGS =
  process.env.UPDATE_VERBOSE === "1" ||
  process.env.PPTR_DEBUG === "1" ||
  process.argv.includes("--verbose") ||
  process.argv.includes("--debug");
const QUIET_LOGS =
  !VERBOSE_LOGS &&
  (process.env.UPDATE_QUIET === "1" ||
    process.argv.includes("--quiet") ||
    process.argv.includes("--daily"));

if (QUIET_LOGS) {
  const writeLog = console.log.bind(console);
  console.log = (...args) => {
    const message = args.map((value) => String(value)).join(" ");
    if (
      /Starting update|^\s*\[\d+\/\d+\] Updating|completed \(|Archived \d+|Update process completed|Successful:|Failed:|All selected sources|Some sources failed|Using the existing/i.test(
        message,
      )
    ) {
      writeLog(...args);
    }
  };
}

// ---------- Output paths ----------
const FC_OUT_PATH = path.join(__dirname, "../public/fantasycalc_cache.json");
const DP_OUT_PATH = path.join(__dirname, "../public/dynastyprocess_cache.json");
const KTC_OUT_PATH = path.join(__dirname, "../public/ktc_cache.json");
const FN_OUT_PATH = path.join(__dirname, "../public/fantasynav_cache.json");
const FP_OUT_PATH = path.join(__dirname, "../public/fantasypros_cache.json");
const FP_ECR_OUT_PATH = path.join(__dirname, "../public/fantasypros_ecr_cache.json");
const IDP_OUT_PATH = path.join(__dirname, "../public/idynastyp_cache.json");
const IDPSHOW_OUT_PATH = path.join(__dirname, "../public/idpshow_cache.json");
const SP_OUT_PATH  = path.join(__dirname, "../public/stickypicky_cache.json");
const VALUE_OVERRIDES_PATH = path.join(__dirname, "../data/value-overrides.json");
const VALUE_CACHE_VERSION_PATH = path.join(__dirname, "../public/value-cache-version.json");
const PROJ_IN_PATH  = process.env.PROJ_CSV || path.join(__dirname, `../data/projections_${CURRENT_SEASON}.csv`);
const PROJ_OUT_PATH = path.join(__dirname, `../public/projections_${CURRENT_SEASON}.json`);
const ESPN_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_espn_${CURRENT_SEASON}.json`);
const CBS_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_cbs_${CURRENT_SEASON}.json`);
const SLEEPER_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_sleeper_${CURRENT_SEASON}.json`);
const FANTASYSHARKS_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_fantasysharks_${CURRENT_SEASON}.json`);
const DRAFTSHARKS_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_draftsharks_${CURRENT_SEASON}.json`);
const FANTASYPROS_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_fantasypros_${CURRENT_SEASON}.json`);
const ARSENAL_PROJ_OUT_PATH = path.join(__dirname, `../public/projections_thefantasyarsenal_${CURRENT_SEASON}.json`);
const ARCHIVE_DIR = path.join(__dirname, "../public/archive");
const SOURCE_FRESHNESS_PATH = path.join(__dirname, "../public/source-freshness.json");

function recordSourceFreshness(task, status = "success", error = "") {
  let ledger = { updated_at:null, sources:{} };
  try { ledger = JSON.parse(fs.readFileSync(SOURCE_FRESHNESS_PATH, "utf8")); } catch {}
  const now = new Date().toISOString();
  const previous = ledger.sources?.[task.key] || {};
  ledger.updated_at = now;
  ledger.sources = {
    ...(ledger.sources || {}),
    [task.key]: {
      key:task.key,
      name:task.name,
      status,
      last_attempt_at:now,
      last_success_at:status === "success" ? now : previous.last_success_at || null,
      last_error:status === "success" ? "" : String(error || "Update failed").slice(0, 300),
    },
  };
  fs.writeFileSync(SOURCE_FRESHNESS_PATH, JSON.stringify(ledger, null, 2));
}

function archiveUpdatedValues(failures = []) {
  const date = new Date().toISOString().slice(0, 10);
  const files = [
    FC_OUT_PATH, DP_OUT_PATH, KTC_OUT_PATH, FN_OUT_PATH, FP_OUT_PATH, FP_ECR_OUT_PATH, IDP_OUT_PATH, IDPSHOW_OUT_PATH, SP_OUT_PATH,
    PROJ_OUT_PATH, ESPN_PROJ_OUT_PATH, CBS_PROJ_OUT_PATH, SLEEPER_PROJ_OUT_PATH,
    FANTASYSHARKS_PROJ_OUT_PATH, DRAFTSHARKS_PROJ_OUT_PATH, FANTASYPROS_PROJ_OUT_PATH, ARSENAL_PROJ_OUT_PATH,
  ].filter((file) => fs.existsSync(file));
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const archived = files.map((file) => {
    const base = path.basename(file, ".json");
    const output = path.join(ARCHIVE_DIR, `${base}_${date}.json.gz`);
    const raw = fs.readFileSync(file);
    fs.writeFileSync(output, gzipSync(raw, { level: 9 }));
    return { source: path.basename(file), file: path.basename(output), bytes: fs.statSync(output).size };
  });
  const createdAt = new Date().toISOString();
  const manifestFile = `manifest_${date}.json`;
  const manifest = {
    date,
    created_at:createdAt,
    season:CURRENT_SEASON,
    compression:"gzip",
    partial_update:failures.length > 0,
    stale_sources:failures,
    files:archived,
  };
  fs.writeFileSync(path.join(ARCHIVE_DIR, manifestFile), JSON.stringify(manifest, null, 2));
  const indexPath = path.join(ARCHIVE_DIR, "index.json");
  let priorEntries = [];
  try {
    const priorIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    priorEntries = Array.isArray(priorIndex?.archives) ? priorIndex.archives : [];
  } catch {
    // The first archive creates the index.
  }
  const archives = [
    {
      date,
      created_at:createdAt,
      season:CURRENT_SEASON,
      manifest:manifestFile,
      files:archived.length,
      partial_update:failures.length > 0,
      stale_sources:failures,
    },
    ...priorEntries.filter((entry) => entry?.date !== date),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  fs.writeFileSync(indexPath, JSON.stringify({ updated_at:createdAt, archives }, null, 2));
  console.log(`📚 Archived ${archived.length} dated value/projection files for ${date}.`);
}

function loadValueOverrides() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VALUE_OVERRIDES_PATH, "utf8"));
    return {
      zeroValues: Array.isArray(parsed?.zeroValues) ? parsed.zeroValues : [],
      positionCorrections: Array.isArray(parsed?.positionCorrections) ? parsed.positionCorrections : [],
    };
  } catch (error) {
    throw new Error(`Unable to read value overrides: ${error.message}`);
  }
}

function applyValueOverridesToData(data, label = "value cache") {
  const overrides = loadValueOverrides();
  const normalizedName = (value) => normName(String(value || ""));
  const normalizedPosition = (value) => normalizePos(value);
  let zeroed = 0;
  let corrected = 0;

  const visit = (node, inheritedName = "") => {
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, inheritedName));
      return;
    }
    if (!node || typeof node !== "object") return;

    const rawName =
      node.name ||
      node.player_full_name ||
      node.player_name ||
      node.full_name ||
      node.player?.name ||
      inheritedName;
    const rawPosition =
      node.position ||
      node.pos ||
      node._position ||
      node.player?.position ||
      "";
    const nameKey = normalizedName(rawName);
    const originalPosition = normalizedPosition(rawPosition);

    const correction = overrides.positionCorrections.find((row) => normalizedName(row.name) === nameKey);
    if (correction && nameKey) {
      const nextPosition = normalizedPosition(correction.position);
      if (nextPosition && originalPosition !== nextPosition) {
        if ("position" in node || (!("pos" in node) && !("_position" in node))) node.position = nextPosition;
        if ("pos" in node) node.pos = nextPosition;
        if ("_position" in node) node._position = nextPosition;
        if (node.player && typeof node.player === "object") node.player.position = nextPosition;
        corrected += 1;
      }
    }

    const effectivePosition = correction
      ? normalizedPosition(correction.position)
      : originalPosition;
    const exclusion = overrides.zeroValues.find((row) =>
      normalizedName(row.name) === nameKey &&
      normalizedPosition(row.position) === effectivePosition
    );
    if (exclusion && nameKey) {
      ["value", "player_value", "sf_value", "one_qb_value", "one_qb", "oneQB", "superflex", "sf"].forEach((key) => {
        if (key in node && Number(node[key]) !== 0) {
          node[key] = 0;
          zeroed += 1;
        }
      });
      if (node.values && typeof node.values === "object") {
        Object.keys(node.values).forEach((key) => {
          if (Number(node.values[key]) !== 0) {
            node.values[key] = 0;
            zeroed += 1;
          }
        });
      }
    }

    Object.entries(node).forEach(([key, value]) => {
      if (key === "player") return;
      visit(value, rawName || key);
    });
  };

  visit(data);
  if (zeroed || corrected) console.log(`  Applied overrides to ${label}: ${corrected} position correction(s), ${zeroed} value field(s) zeroed.`);
  return data;
}

function applyValueOverridesToFile(filePath, label, compact = false) {
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  applyValueOverridesToData(data, label);
  fs.writeFileSync(filePath, compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
}

function applyValueOverridesToAllCaches() {
  [
    [FC_OUT_PATH, "FantasyCalc"],
    [DP_OUT_PATH, "DynastyProcess"],
    [KTC_OUT_PATH, "KTC"],
    [FN_OUT_PATH, "Fantasy Navigator"],
    [FP_OUT_PATH, "FantasyPros"],
    [FP_ECR_OUT_PATH, "FantasyPros ECR Rank Score", true],
    [IDP_OUT_PATH, "IDynastyP"],
    [IDPSHOW_OUT_PATH, "The IDP Show"],
    [SP_OUT_PATH, "StickyPicky"],
  ].forEach(([filePath, label, compact]) => applyValueOverridesToFile(filePath, label, compact));
}

function writeValueCacheVersion() {
  fs.writeFileSync(VALUE_CACHE_VERSION_PATH, JSON.stringify({
    version: new Date().toISOString(),
    overrides: path.basename(VALUE_OVERRIDES_PATH),
  }, null, 2));
}




// Bye weeks output (per season)
const BYE_DIR = path.join(__dirname, "../public/byes");

const IDPSHOW_URL =
  "https://script.google.com/macros/s/AKfycby5CIjDtutePQl6dZZDsWZBwkwBYTiZPXLB4NFNhwC9K3pdYWpkzg7ErzRkNYP56oLZ/exec";

// ---------- CLI helpers / Puppeteer debug switches ----------
function pickPointsKey(rec) {
  const keys = Object.keys(rec || {});
  const lc = (k) => k.toLowerCase();
  const candidates = [
    "proj_points","projected_points","points_ppr","pts_ppr","ppr",
    "points","pts","projection","proj","total","score"
  ];
  for (const c of candidates) {
    const k = keys.find((kk) => lc(kk) === c);
    if (k && !isNaN(Number(rec[k]))) return k;
  }
  return keys.find((k) => !isNaN(Number(rec[k])));
}
function normalizeTeamAbbr(x) {
  return normalizeFantasyTeamAbbr(x);
}
function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}

async function enableAdBlockLite(page, opts = {}) {
  const {
    // Add the site you are scraping here (ex: ["cbssports.com"])
    allowHostParts = [],

    // If true, we allow same-origin requests once navigation starts
    allowSameOrigin = true,

    // Extra speed-ups
    blockResourceTypes = new Set(["media", "font"]),
  } = opts;

  await page.setRequestInterception(true);

  // Known ad / tracking domains (extra safety)
  const BLOCK_HOST_PARTS = [
    "taboola",
    "doubleclick",
    "googlesyndication",
    "googleadservices",
    "googletagmanager",
    "adsystem",
    "adnxs",
    "criteo",
    "scorecardresearch",
    "quantserve",
    "outbrain",
    "zedo",
    "adservice",
    "hotjar",
    "mixpanel",
    "segment",
    "optimizely",
    "facebook",
    "fbcdn",
    "tiktok",
    "snapchat",
  ];

  // Always allow these common “infrastructure” domains
  const ALWAYS_ALLOW_HOST_PARTS = [
    "cloudfront.net",
    "amazonaws.com",
    "ajax.googleapis.com",
  ];

  page.on("request", (req) => {
    try {
      const url = req.url();
      const type = req.resourceType();

      // Let data/blob URLs go through
      if (url.startsWith("data:") || url.startsWith("blob:")) return req.continue();

      const host = new URL(url).hostname;

      // Speed: never needed for scraping
      if (blockResourceTypes.has(type)) return req.abort();

      // Block known ad/tracker domains
      if (BLOCK_HOST_PARTS.some((p) => host.includes(p))) return req.abort();

      // Allow “always allow”
      if (ALWAYS_ALLOW_HOST_PARTS.some((p) => host.includes(p))) return req.continue();

      // Allow whatever site(s) we’re scraping (CBS/KTC/etc.)
      if (allowHostParts.some((p) => host.includes(p))) return req.continue();

      // Allow same-origin after the page has a real URL
      if (allowSameOrigin) {
        const pageUrl = page.url();
        if (pageUrl && pageUrl.startsWith("http")) {
          const pageHost = new URL(pageUrl).hostname;
          if (host === pageHost) return req.continue();
        }
      }

      // Otherwise block 3rd-party noise
      // (Keep the log, but avoid logging gigantic data URLs)
      if (VERBOSE_LOGS) console.log("[adblock] aborting", host, type);
      return req.abort();
    } catch {
      return req.continue();
    }
  });
}

function safeNum(v) {
  const n =
    typeof v === "number"
      ? v
      : Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normNameForMap(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
async function fetchSleeperPlayersMap() {
  const { data } = await axios.get("https://api.sleeper.app/v1/players/nfl", { timeout: 120000 });
  const byId = {};
  for (const [pid, p] of Object.entries(data || {})) {
    const name =
      p.full_name ||
      (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.search_full_name) ||
      "";
    const position = (p.position || "").toString().replace(/\d+$/, "").trim();
    const team = p.team || "";
    const search_full_name = p.search_full_name || (name ? name.toLowerCase().replace(/\s+/g, "") : "");
    byId[String(pid)] = { name, search_full_name, team, position };
  }
  return byId;
}


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

    // ✅ IMPORTANT (hotspot / slow networks)
    protocolTimeout: Number(process.env.PPTR_PROTOCOL_TIMEOUT || 240000), // 4 minutes

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1400,900",
    ],
  };
}


function wirePageDebug(page, filterHost = "") {
  if (!VERBOSE_LOGS) return;
  page.on("console", (msg) => {
    const type = msg.type().toUpperCase();
    console.log(`[pptr:${type}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.error("[pptr:pageerror]", err));
  page.on("response", (res) => {
    const url = res.url();
    if (!filterHost || url.includes(filterHost)) {
      // console.log("[pptr:response]", res.status(), url);
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
  await enableAdBlockLite(page, {
  allowHostParts: [
    "keeptradecut.com",
    "api.keeptradecut.com",
    "cdn.keeptradecut.com",
    "cdn.usefathom.com", 
  ],
});

  wirePageDebug(page, "keeptradecut.com");
  await page.setViewport({ width: 1400, height: 900 });
  const shoot = makeShooter(page, "_ktc_debug");

  await page.goto("https://keeptradecut.com/dynasty-rankings", {
    waitUntil: "networkidle2",
    timeout: 80000,
  });
  await shoot("loaded");

  // Close KTC popup if it shows
  try {
    await page.waitForSelector(".modal-content", { timeout: 5000 });
    await page.click("#dont-know");
    await sleep(1500);
  } catch {}

  await page.waitForSelector(".sf-toggle-wrapper.superflex .sf-toggle", { timeout: 50000 });
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
    await page.waitForSelector("#rankings-page-rankings .onePlayer", { timeout: 60000 });
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
  console.log("🔄 Updating FantasyCalc values...");
  const results = {};

  for (let i = 0; i < combinations.length; i++) {
    const { isDynasty, numQbs, key } = combinations[i];
    const url = `https://api.fantasycalc.com/values/current?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=12&ppr=1`;

    logProgress(`  📡 Fetching FantasyCalc ${key}`, i + 1, combinations.length);

    try {
      const response = await retryOperation(async () => {
        const res = await axios.get(url, { timeout: CONFIG.REQUEST_TIMEOUT });
        validateDataStructure(res.data, [], 'FantasyCalc API');
        return res;
      });

      results[key] = response.data;
    } catch (error) {
      console.error(`  ❌ Failed to fetch FantasyCalc ${key}:`, error.message);
      // Continue with other combinations rather than failing completely
    }
  }

  if (Object.keys(results).length === 0) {
    throw new Error('Failed to fetch any FantasyCalc data');
  }

  fs.writeFileSync(FC_OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`✅ fantasycalc_cache.json updated (${Object.keys(results).length}/${combinations.length} combinations).`);
}

async function updateDynastyProcess() {
  console.log("🔄 Updating DynastyProcess values...");

  const dpUrl = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
  console.log("  📡 Fetching DynastyProcess data...");

  const dpRes = await retryOperation(async () => {
    const res = await axios.get(dpUrl, { timeout: CONFIG.REQUEST_TIMEOUT });
    if (!res.data) {
      throw new Error('Empty response from DynastyProcess API');
    }
    return res;
  });

  const parsed = Papa.parse(dpRes.data, { header: true }).data;

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Failed to parse DynastyProcess CSV data');
  }

  console.log(`  📊 Processing ${parsed.length} DynastyProcess rows...`);

  const dpValues = {};
  let processedCount = 0;

  parsed.forEach((row, index) => {
    try {
      if (!row.player || (!row.value_1qb && !row.value_2qb)) return;

      const rawName = row.player.trim();
      const pickMeta = String(row.pos || "").toUpperCase().trim() === "PICK" ? parsePickLabel(rawName) : null;
      const nameKey = pickMeta ? formatPickLabel(pickMeta) : rawName;

      dpValues[nameKey] = {
        pos: row.pos || "",
        team: row.team || "",
        one_qb: Number(row.value_1qb) || 0,
        superflex: Number(row.value_2qb) || 0,
      };

      processedCount++;
    } catch (error) {
      console.warn(`  ⚠️ Error processing DynastyProcess row ${index + 1}:`, error.message);
    }
  });

  fs.writeFileSync(DP_OUT_PATH, JSON.stringify(dpValues, null, 2));
  console.log(`✅ dynastyprocess_cache.json updated (${processedCount} players processed).`);
}

async function updateKTC() {
  const normalizeRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const pos = normalizePos(row?.position || row?.pos);
      const pickMeta = pos === "PICK" ? parsePickLabel(row?.name) : null;
      return {
        ...row,
        name: pickMeta ? formatPickLabel(pickMeta) : String(row?.name || "").trim(),
        team: pos === "PICK" ? "" : normalizeTeamAbbr(row?.team || ""),
        position: pos,
      };
    });

  const ktc_sf = normalizeRows(await scrapeKTC(false));   // SF
  const ktc_1qb = normalizeRows(await scrapeKTC(true)); // 1QB
  const ktcData = {
    Superflex: ktc_sf,
    OneQB: ktc_1qb,
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(KTC_OUT_PATH, JSON.stringify(ktcData, null, 2));
  console.log("✅ ktc_cache.json updated.");
}

async function updateFantasyNavigator() {
  const url = "https://fantasy-navigator-latest.onrender.com/ranks?platform=sf";
  const results = { Dynasty_SF: [], Dynasty_1QB: [], Redraft_SF: [], Redraft_1QB: [] };
  console.log("Fetching FantasyNavigator rankings API:", url);
  const res = await axios.get(url, { timeout: 120000, family: 4 });
  const data = res.data;
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected FantasyNavigator response format for ${url}`);
  }

  // This endpoint includes all four formats plus historical snapshots. Keep the
  // newest row for each player/pick in each format instead of mixing seasons.
  const latestByFormat = Object.fromEntries(Object.keys(results).map((key) => [key, new Map()]));
  data.forEach((row) => {
    const rankType = String(row?.rank_type || "").toLowerCase();
    const rosterType = String(row?.roster_type || "").toLowerCase();
    const formatKey =
      rankType === "dynasty"
        ? (rosterType === "sf_value" ? "Dynasty_SF" : rosterType === "one_qb_value" ? "Dynasty_1QB" : "")
        : rankType === "redraft"
          ? (rosterType === "sf_value" ? "Redraft_SF" : rosterType === "one_qb_value" ? "Redraft_1QB" : "")
          : "";
    if (!formatKey) return;

    const rawName = String(row?.player_full_name || "").trim();
    const pickMeta = parsePickLabel(rawName);
    const position = pickMeta ? "PICK" : normalizePos(row?._position || "");
    const name = pickMeta ? formatPickLabel(pickMeta) : rawName;
    const team = position === "PICK" ? "" : normalizeTeamAbbr(row?.team || "");
    const value = Number(row?.player_value) || 0;
    if (!name || value <= 0) return;

    const identity = `${normName(name)}|${position}`;
    const candidate = {
      name,
      position,
      team,
      value,
      source_date: String(row?._insert_date || ""),
      source_rank: Number(row?.player_rank) || null,
    };
    const current = latestByFormat[formatKey].get(identity);
    if (!current || candidate.source_date > current.source_date) {
      latestByFormat[formatKey].set(identity, candidate);
    }
  });

  Object.keys(results).forEach((key) => {
    results[key] = [...latestByFormat[key].values()].sort((a, b) => b.value - a.value);
    const newest = results[key].map((row) => row.source_date).sort().at(-1) || "unknown";
    console.log(`  ${key}: ${results[key].length} latest rows (newest source date ${newest})`);
  });

  fs.writeFileSync(FN_OUT_PATH, JSON.stringify(results, null, 2));
  console.log("✅ fantasynav_cache.json updated.");
}

async function updateFantasyPros() {
  const categoryUrl = "https://www.fantasypros.com/content/nfl/dynasty-nfl/nfl-trade-value-chart/";
  const category = await axios.get(categoryUrl, {
    timeout: CONFIG.REQUEST_TIMEOUT,
    headers: { "user-agent":"Mozilla/5.0", accept:"text/html" },
  });
  const articleMatches = [...String(category.data || "").matchAll(/href=["']([^"']*fantasy-football-rankings-dynasty-trade-value-chart-[^"']*update\/?)["']/gi)]
    .map((match) => new URL(match[1], categoryUrl).href);
  const articleUrl = articleMatches[0];
  if (!articleUrl) throw new Error("FantasyPros latest dynasty trade-value article was not found.");

  const article = await axios.get(articleUrl, {
    timeout: CONFIG.REQUEST_TIMEOUT,
    headers: { "user-agent":"Mozilla/5.0", accept:"text/html" },
  });
  const html = String(article.data || "");
  const chartIds = [...html.matchAll(/datawrapper\.dwcdn\.net\/([A-Za-z0-9]+)\/\d+/g)].map((match) => match[1]);
  const uniqueIds = [...new Set(chartIds)].slice(0, 4);
  if (uniqueIds.length < 4) throw new Error(`FantasyPros article exposed ${uniqueIds.length}/4 expected value charts.`);

  const title = html.match(/<title[^>]*>([^<]+)/i)?.[1] || "";
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const monthIndex = monthNames.findIndex((month) => title.toLowerCase().includes(month));
  const sourceYear = Number(title.match(/\b(20\d{2})\b/)?.[1]) || CURRENT_SEASON;
  const sourceDate = `${sourceYear}-${String(Math.max(0, monthIndex) + 1).padStart(2, "0")}-01`;
  const positions = ["QB","RB","WR","TE"];
  const output = {
    Dynasty_SF: [], Dynasty_1QB: [],
    updated:new Date().toISOString(), source_date:sourceDate, source:"FantasyPros",
    article_url:articleUrl, chart_ids:uniqueIds,
    scale_note:"FantasyPros published values multiplied by 100 for Arsenal tool-scale compatibility; source_value preserves the exact published number.",
  };

  for (let index=0; index<uniqueIds.length; index+=1) {
    const chartId=uniqueIds[index];
    const url=`https://datawrapper.dwcdn.net/${chartId}/1/dataset.csv`;
    const response=await axios.get(url,{timeout:CONFIG.REQUEST_TIMEOUT,responseType:"text"});
    const parsed=Papa.parse(String(response.data||""),{header:true,delimiter:"\t",skipEmptyLines:true}).data;
    parsed.forEach((row)=>{
      const name=String(row.Name||"").trim();
      const raw=Number(row["Trade Value"])||0;
      if(!name||raw<=0)return;
      const common={name,position:positions[index],team:normalizeTeamAbbr(row.Team||""),age:Number(row.Age)||null,source_value:raw,value:Math.round(raw*100),source_date:sourceDate,chart_id:chartId};
      if(positions[index]==="TE"&&Number(row["TEP Value"]))common.tep_source_value=Number(row["TEP Value"]);
      output.Dynasty_1QB.push(common);
      const sfRaw=positions[index]==="QB"?(Number(row["SF Value"])||raw):raw;
      output.Dynasty_SF.push({...common,source_value:sfRaw,value:Math.round(sfRaw*100)});
    });
  }
  output.Dynasty_SF.sort((a,b)=>b.value-a.value);
  output.Dynasty_1QB.sort((a,b)=>b.value-a.value);
  fs.writeFileSync(FP_OUT_PATH,JSON.stringify(output,null,2));
  console.log(`✅ fantasypros_cache.json updated (${output.Dynasty_SF.length} players, publisher date ${sourceDate}).`);
}

async function updateFantasyProsECR() {
  const apiKey = String(process.env.FANTASYPROS_API_KEY || "").trim();
  if (!apiKey) throw new Error("FANTASYPROS_API_KEY is required for FantasyPros ECR.");

  const formats = [
    { key:"Dynasty_1QB", type:"DYNASTY", position:"ALL", scoringSpecific:false },
    { key:"Dynasty_SF", type:"DYNASTY", position:"OP", scoringSpecific:false },
    { key:"Redraft_1QB", type:"DRAFT", position:"ALL", scoringSpecific:true },
    { key:"Redraft_SF", type:"DRAFT", position:"OP", scoringSpecific:true },
  ];
  const scoringTypes = [{ key:"std", api:"STD" },{ key:"half", api:"HALF" },{ key:"ppr", api:"PPR" }];
  const variants = formats.flatMap((format) =>
    (format.scoringSpecific ? scoringTypes : [{ key:"neutral", api:"PPR" }]).map((scoring) => ({ ...format, scoring }))
  );
  const output = {
    updated:new Date().toISOString(),
    source:"FantasyPros ECR Rank Score",
    source_type:"expert_consensus_rankings",
    season:CURRENT_SEASON,
    methodology:"Actual FantasyPros ECR order converted to a 10,000-to-100 rank score for Arsenal display compatibility. rank_ecr preserves the published ordinal rank. Dynasty ECR is scoring-neutral; redraft has distinct STD, HALF, and PPR boards. This score is not a FantasyPros trade value and is not inherently additive.",
    formats:{},
    experts_by_format:{},
    request_count:variants.length,
  };

  for (let offset=0; offset<variants.length; offset+=3) {
    const batch=variants.slice(offset,offset+3);
    const results=await Promise.all(batch.map(async(variant)=>{
      const params=new URLSearchParams({
        position:variant.position,
        scoring:variant.scoring.api,
        type:variant.type,
        experts:"show",
      });
      const endpoint=`https://api.fantasypros.com/public/v2/json/nfl/${CURRENT_SEASON}/consensus-rankings?${params}`;
      const response=await fetch(endpoint,{headers:{"x-api-key":apiKey,Accept:"application/json"}});
      if(!response.ok)throw new Error(`FantasyPros ECR ${variant.key} ${variant.scoring.api} returned HTTP ${response.status}.`);
      const payload=await response.json();
      const sourceRows=Array.isArray(payload?.players)?payload.players:[];
      const declaredCount=Number(payload?.count)||sourceRows.length;
      if(sourceRows.length<100||sourceRows.length<Math.min(100,declaredCount)){
        throw new Error(`FantasyPros ECR ${variant.key} ${variant.scoring.api} coverage is incomplete (${sourceRows.length}/${declaredCount}).`);
      }
      const listKey=variant.scoringSpecific?`${variant.key}_${variant.scoring.api}`:variant.key;
      const total=Math.max(1,sourceRows.length);
      const rows=sourceRows.map((row,index)=>{
        const rank=Number(row?.rank_ecr)||index+1;
        const value=Math.max(100,Math.round(10000-((Math.max(1,rank)-1)/Math.max(1,total-1))*9900));
        return {
          name:String(row?.player_name||"").trim(),
          position:String(row?.player_position_id||row?.player_positions||"").toUpperCase(),
          team:normalizeTeamAbbr(row?.player_team_id||""),
          value,
          rank_ecr:rank,
          position_rank:row?.pos_rank||null,
          rank_min:Number(row?.rank_min)||null,
          rank_max:Number(row?.rank_max)||null,
          rank_average:Number(row?.rank_ave)||null,
          rank_stddev:Number(row?.rank_std)||null,
          rank_delta:Number(row?.player_ecr_delta)||0,
          expert_count:Object.keys(row?.experts||{}).length,
          fantasypros_id:Number(row?.player_id)||null,
          player_url:row?.player_page_url||null,
        };
      }).filter((row)=>row.name&&row.rank_ecr>0).sort((a,b)=>a.rank_ecr-b.rank_ecr);
      const expertNames=payload?.expert_names||payload?.expert_name||{};
      return {
        listKey,
        rows,
        experts:{
          total:Number(payload?.total_experts)||Object.keys(expertNames).length,
          last_updated:payload?.last_updated||null,
          last_updated_ts:Number(payload?.last_updated_ts)||null,
          names:expertNames,
          twitter:payload?.expert_twitter||{},
          publications:payload?.expert_pub||{},
          ranking_type:payload?.type||payload?.ranking_type_name||variant.type,
          position:variant.position,
          scoring:variant.scoringSpecific?variant.scoring.api:"NEUTRAL",
        },
      };
    }));
    results.forEach(({listKey,rows,experts})=>{
      output.formats[listKey]=rows;
      output.experts_by_format[listKey]=experts;
    });
  }

  const counts=Object.values(output.formats).map((rows)=>rows.length);
  if(counts.length!==8)throw new Error(`FantasyPros ECR produced ${counts.length}/8 expected unique format tables.`);
  fs.writeFileSync(FP_ECR_OUT_PATH,JSON.stringify(output));
  console.log(`✅ fantasypros_ecr_cache.json updated (8 unique boards, ${counts.reduce((sum,count)=>sum+count,0)} ranked rows).`);
}

// ---------- IDynastyP (Google Sheets GViz) helpers ----------
function parseGvizResponseText(text) {
  // GViz returns JS like:
  // google.visualization.Query.setResponse({...});
  const s = String(text || "");

  const m =
    s.match(/google\.visualization\.Query\.setResponse\(\s*([\s\S]*?)\s*\)\s*;?\s*$/) ||
    s.match(/setResponse\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);

  if (!m) {
    throw new Error("Could not parse GViz wrapper (setResponse not found).");
  }

  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new Error("GViz JSON parse failed: " + (e?.message || e));
  }
}

function findColIndex(cols, patterns) {
  const labels = (cols || []).map((c) => String(c?.label || c?.id || "").trim());
  const lower = labels.map((x) => x.toLowerCase());

  for (const pat of patterns) {
    const rx = pat instanceof RegExp ? pat : new RegExp(pat, "i");
    const idx = lower.findIndex((l, i) => rx.test(labels[i]) || rx.test(l));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cellValue(cell) {
  if (!cell) return "";
  // GViz uses { v: <raw>, f: <formatted> }
  const v = cell.v ?? "";
  return typeof v === "string" ? v.trim() : v;
}

function parseIdpSheetToRows(gvizObj) {
  const table = gvizObj?.table;
  const cols = table?.cols || [];
  const rows = table?.rows || [];

  const nameIdx = findColIndex(cols, [/player/i, /^name$/i, /full\s*name/i]);
  const teamIdx = findColIndex(cols, [/team/i, /nfl/i, /club/i]);
  const posIdx  = findColIndex(cols, [/pos/i, /position/i]);
  const valIdx  = findColIndex(cols, [/value/i, /rank\s*value/i, /points/i]);

  if (nameIdx < 0 || valIdx < 0) {
    const colList = cols.map(c => c?.label || c?.id).filter(Boolean).join(", ");
    throw new Error(`IDynastyP GViz missing required columns (need name + value). Found: ${colList}`);
  }

  const out = [];

  for (const r of rows) {
    const c = r?.c || [];
    const name = String(cellValue(c[nameIdx]) || "").trim();
    if (!name) continue;

    const team = teamIdx >= 0 ? String(cellValue(c[teamIdx]) || "").trim() : "";
    const positionRaw = posIdx >= 0 ? String(cellValue(c[posIdx]) || "").trim() : "";
    const position = positionRaw.replace(/\d+$/, "").trim();

    const rawVal = cellValue(c[valIdx]);
    const value = Number(String(rawVal || "").replace(/,/g, "")) || 0;
    if (!value) continue;

    out.push({ name, team, position, value });
  }

  return out;
}

// ---------- UPDATED: IDynastyP now from GViz ----------
async function updateIDynastyP() {
  // iDynastyP appears to use these two sheets:
  // SF:
  const SF_URL =
    "https://docs.google.com/spreadsheets/d/1VPCr8ucfWVVhgEqlDgscZCQikHO7QpWTYdzYKBGsul0/gviz/tq?tqx=out:json";
  // 1QB:
  const ONEQB_URL =
    "https://docs.google.com/spreadsheets/d/1jmPKSQXHmB-3G02UHr5OB9P7Hpob82E3D61rnjXlRww/gviz/tq?tqx=out:json";

  console.log("Fetching IDynastyP (SF) GViz:", SF_URL);
  const sfRes = await axios.get(SF_URL, { timeout: 120000, responseType: "text" });
  const sfObj = parseGvizResponseText(sfRes.data);
  const sfRows = parseIdpSheetToRows(sfObj);

  console.log("Fetching IDynastyP (1QB) GViz:", ONEQB_URL);
  const qbRes = await axios.get(ONEQB_URL, { timeout: 120000, responseType: "text" });
  const qbObj = parseGvizResponseText(qbRes.data);
  const qbRows = parseIdpSheetToRows(qbObj);

  // Merge by normalized name (same normalization you use elsewhere)
  const byName = new Map(); // nn -> { name, team, position, one_qb, superflex }
  const upsert = (row, which) => {
    const nn = normName(row.name);
    if (!nn) return;

    const existing = byName.get(nn) || {
      name: row.name,
      team: row.team || "",
      position: row.position || "",
      one_qb: 0,
      superflex: 0,
    };

    // prefer filling missing meta
    if (!existing.team && row.team) existing.team = row.team;
    if (!existing.position && row.position) existing.position = row.position;

    // keep a nicer displayName if we already had a short/odd one
    if (!existing.name || existing.name.length < row.name.length) existing.name = row.name;

    if (which === "sf") existing.superflex = row.value || existing.superflex || 0;
    if (which === "1qb") existing.one_qb = row.value || existing.one_qb || 0;

    byName.set(nn, existing);
  };

  sfRows.forEach((r) => upsert(r, "sf"));
  qbRows.forEach((r) => upsert(r, "1qb"));

  const normalized = Array.from(byName.values()).map((r) => ({
    name: r.name || "",
    team: r.team || "",
    position: r.position || "",
    one_qb: Number(r.one_qb) || 0,
    superflex: Number(r.superflex) || 0,
  }));

  fs.writeFileSync(IDP_OUT_PATH, JSON.stringify(normalized, null, 2));
  console.log(`✅ idynastyp_cache.json updated from GViz with ${normalized.length} entries.`);
}

// ---------- The IDP Show (Google Apps Script JSON) ----------
function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}



// turns any payload into an array of { sheetName, rows[] }
function coerceSheets(payload) {
  // If it’s already an array, treat it as “one unnamed sheet”
  if (Array.isArray(payload)) return [{ sheetName: "", rows: payload }];

  // Common wrappers
  const maybe = payload?.rows || payload?.data || payload?.values;
  if (Array.isArray(maybe)) return [{ sheetName: "", rows: maybe }];

  // Apps Script often returns { sheets: { Sheet1: [...], ... } }
  if (payload?.sheets && typeof payload.sheets === "object") {
    return Object.entries(payload.sheets)
      .filter(([, v]) => Array.isArray(v))
      .map(([sheetName, rows]) => ({ sheetName, rows }));
  }

  // Or returns { Sheet1: [...], Sheet2: [...] } directly
  if (payload && typeof payload === "object") {
    const entries = Object.entries(payload).filter(
      ([k, v]) =>
        k !== "updated" &&
        k !== "meta" &&
        k !== "version" &&
        Array.isArray(v)
    );
    if (entries.length) {
      return entries.map(([sheetName, rows]) => ({ sheetName, rows }));
    }
  }

  return [];
}



// Convert a Sheets row into { name, position, team, v1qb, vsf, vtep, vsftep }
function normalizeRowToIdpShowRow(row) {
  if (!row || typeof row !== "object") return null;

  const name = String(
    pickFirst(row, ["name", "player", "player_name", "full_name", "Player", "PLAYER"])
  ).trim();
  if (!name) return null;

  const position = String(pickFirst(row, ["position", "pos", "Position", "POS"]))
    .replace(/\d+$/, "")
    .trim();

  const team = String(pickFirst(row, ["team", "nfl_team", "Team", "TEAM", "club"]))
    .trim()
    .toUpperCase();

  // These are the actual columns in your IDP Show feed
  const v1qb   = safeNum(pickFirst(row, ["value_1qb", "val_1qb", "1qb", "one_qb"]));
  const vsf    = safeNum(pickFirst(row, ["value_sf", "val_sf", "sf", "superflex"]));
  const vtep   = safeNum(pickFirst(row, ["value_tep", "val_tep", "tep"]));
  const vsftep = safeNum(pickFirst(row, ["value_sftep", "val_sftep", "sftep", "sf_tep"]));

  // If literally all values are 0, skip it
  if (!v1qb && !vsf && !vtep && !vsftep) return null;

  return { name, position, team, v1qb, vsf, vtep, vsftep };
}

async function updateIDPShow() {
  console.log("🔄 Updating The IDP Show values...");
  console.log("  📡 Fetching IDP Show data...");

  const res = await retryOperation(async () => {
    const response = await axios.get(IDPSHOW_URL, {
      timeout: CONFIG.REQUEST_TIMEOUT,
      responseType: "text",
    });

    if (!response.data) {
      throw new Error('Empty response from IDP Show API');
    }

    return response;
  });

  let payload = res.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      console.log("IDPShow raw (first 300 chars):", payload.slice(0, 300));
      throw new Error("IDPShow: response was not valid JSON (see raw snippet above).");
    }
  }

  // Debug: show top-level keys so we can see the sheets
  if (payload && typeof payload === "object") {
    console.log("IDPShow top-level keys:", Object.keys(payload).slice(0, 30));
    if (payload.sheets) console.log("IDPShow sheets keys:", Object.keys(payload.sheets).slice(0, 30));
  }

  const sheets = coerceSheets(payload);
  if (!sheets.length) {
    throw new Error("IDPShow: unexpected response shape (could not find any sheet arrays).");
  }

  console.log(`  📊 Processing ${sheets.length} sheets...`);

  // ✅ Output shape now matches the rest of your app: { name, team, position, value }
  const out = {
    Dynasty_SF: [],
    Dynasty_1QB: [],
    Redraft_SF: [],
    Redraft_1QB: [],
    updated: new Date().toISOString(),
  };

  const isRedraftSheet = (sheetName) => {
    const sn = String(sheetName || "").toLowerCase();
    return sn.includes("redraft") || sn.includes("re-draft") || sn.includes("seasonal");
  };

  let totalKept = 0;
  let processedSheets = 0;

  for (const { sheetName, rows } of sheets) {
    if (!Array.isArray(rows) || !rows.length) continue;

    logProgress(`    Processing sheet: ${sheetName}`, processedSheets + 1, sheets.length);

    const redraft = isRedraftSheet(sheetName);

    for (const r of rows) {
      try {
        const norm = normalizeRowToIdpShowRow(r);
        if (!norm) continue;

        const base = {
          name: norm.name,
          position: norm.position,
          team: norm.team,
        };

        // ✅ ONLY keep 1QB + SF; ignore TEP/SFTEP entirely
        const v1qb = Number(norm.v1qb) || 0;
        const vsf  = Number(norm.vsf) || 0;

        if (redraft) {
          if (v1qb > 0) out.Redraft_1QB.push({ ...base, value: v1qb });
          if (vsf  > 0) out.Redraft_SF.push({ ...base, value: vsf });
        } else {
          if (v1qb > 0) out.Dynasty_1QB.push({ ...base, value: v1qb });
          if (vsf  > 0) out.Dynasty_SF.push({ ...base, value: vsf });
        }

        if (v1qb > 0 || vsf > 0) totalKept++;
      } catch (error) {
        console.warn(`    ⚠️ Error processing row in sheet ${sheetName}:`, error.message);
      }
    }

    processedSheets++;
  }

  console.log("IDPShow bucket counts:", {
    Dynasty_SF: out.Dynasty_SF.length,
    Dynasty_1QB: out.Dynasty_1QB.length,
    Redraft_SF: out.Redraft_SF.length,
    Redraft_1QB: out.Redraft_1QB.length,
    totalKept,
  });

  if (!out.Dynasty_SF.length && !out.Dynasty_1QB.length) {
    const sampleSheet = sheets.find(s => Array.isArray(s.rows) && s.rows.length)?.rows?.[0];
    const sampleKeys = sampleSheet && typeof sampleSheet === "object" ? Object.keys(sampleSheet) : [];
    throw new Error(
      `IDPShow: parsed but produced 0 dynasty rows. Sample keys: ${sampleKeys.slice(0, 30).join(", ")}`
    );
  }

  // Sort high → low
  out.Dynasty_SF.sort((a, b) => (b.value || 0) - (a.value || 0));
  out.Dynasty_1QB.sort((a, b) => (b.value || 0) - (a.value || 0));
  out.Redraft_SF.sort((a, b) => (b.value || 0) - (a.value || 0));
  out.Redraft_1QB.sort((a, b) => (b.value || 0) - (a.value || 0));

  fs.writeFileSync(IDPSHOW_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✅ idpshow_cache.json updated (value-only). Kept ${totalKept} rows.`);
}


async function updateStickyPicky() {
  // StickyPicky must consume corrected inputs even when only `--only=sp` runs.
  applyValueOverridesToAllCaches();
  console.log("🔄 Building StickyPicky (averaged, scale-free)…");

  // Load all source data with validation
  console.log("  📂 Loading source data...");
  const sources = [
    { name: 'FantasyCalc', path: FC_OUT_PATH, required: true },
    { name: 'DynastyProcess', path: DP_OUT_PATH, required: true },
    { name: 'KTC', path: KTC_OUT_PATH, required: true },
    { name: 'FantasyNavigator', path: FN_OUT_PATH, required: true },
    { name: 'FantasyPros', path: FP_OUT_PATH, required: false },
    { name: 'IDynastyP', path: IDP_OUT_PATH, required: true },
    { name: 'IDPShow', path: IDPSHOW_OUT_PATH, required: true },
  ];

  const loadedData = {};
  for (const source of sources) {
    try {
      const data = JSON.parse(fs.readFileSync(source.path, "utf-8"));
      validateDataStructure(data, [], source.name);
      loadedData[source.name.toLowerCase().replace(/[^a-z]/g, '')] = data;
      console.log(`    ✅ ${source.name} loaded`);
    } catch (error) {
      if (source.required) {
        throw new Error(`Failed to load required source ${source.name}: ${error.message}`);
      } else {
        console.warn(`    ⚠️ ${source.name} failed to load, skipping: ${error.message}`);
      }
    }
  }

  const { fantasycalc: fcData, dynastyprocess: dpData, ktc: ktcData, fantasynavigator: fnData, fantasypros: fpData, idynastyp: idpData, idpshow: idpshowData } = loadedData;

  const tables = {
    Dynasty_SF:    { FC: {}, FN: {}, FP: {}, KTC: {}, DP: {}, IDP: {}, IDPSHOW: {} },
    Dynasty_1QB:   { FC: {}, FN: {}, FP: {}, KTC: {}, DP: {}, IDP: {}, IDPSHOW: {} },
    Redraft_SF:    { FC: {}, FN: {}, IDPSHOW: {} },
    Redraft_1QB:   { FC: {}, FN: {}, IDPSHOW: {} },
  };

  for (const key of ["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"]) {
    (fcData[key] || []).forEach((row) => {
      const name = row.player?.name || row.name;
      const team = row.player?.maybeTeam || row.team || "";
      const position = (row.player?.position || row.position || "").replace(/\d+$/, "").trim();
      tables[key].FC[normName(name)] = { name, value: row.value || 0, team, position };
    });
  }

  for (const key of ["Dynasty_SF","Dynasty_1QB"]) {
    (fpData?.[key] || []).forEach((row) => {
      tables[key].FP[normName(row.name)] = { name:row.name,value:row.value||0,team:row.team||"",position:row.position||"" };
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

  (idpshowData?.Dynasty_SF || []).forEach((row) => {
    const nn = normName(row.name);
    if (row.value) tables.Dynasty_SF.IDPSHOW[nn]  = { name: row.name, value: row.value, team: row.team || "", position: row.position || "" };
  });

  (idpshowData?.Dynasty_1QB || []).forEach((row) => {
    const nn = normName(row.name);
    if (row.value) tables.Dynasty_1QB.IDPSHOW[nn] = { name: row.name, value: row.value, team: row.team || "", position: row.position || "" };
  });

  (idpshowData?.Redraft_SF || []).forEach((row) => {
    const nn = normName(row.name);
    if (row.value) tables.Redraft_SF.IDPSHOW[nn]  = { name: row.name, value: row.value, team: row.team || "", position: row.position || "" };
  });

  (idpshowData?.Redraft_1QB || []).forEach((row) => {
    const nn = normName(row.name);
    if (row.value) tables.Redraft_1QB.IDPSHOW[nn] = { name: row.name, value: row.value, team: row.team || "", position: row.position || "" };
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
      const sourcePcts = sourceKeys
        .map((source) => {
          const row = sources[source][nn];
          return row && Number(row.value) > 0 ? { source, row, percentile: pctFns[source](row.value) } : null;
        })
        .filter(Boolean);
      const corroborating = sourcePcts.filter((entry) => entry.source !== "FN");

      // Fantasy Navigator publishes a much deeper list than the other markets.
      // A low raw value can therefore become a misleadingly high percentile when
      // FN is the only source carrying an inactive/deep player. It may confirm and
      // refine a consensus, but it must never create a StickyPicky value alone.
      if (!corroborating.length && sourcePcts.some((entry) => entry.source === "FN")) continue;

      const corroboratingSorted = corroborating.map((entry) => entry.percentile).sort((a, b) => a - b);
      const middle = Math.floor(corroboratingSorted.length / 2);
      const corroboratingMedian = corroboratingSorted.length % 2
        ? corroboratingSorted[middle]
        : (corroboratingSorted[middle - 1] + corroboratingSorted[middle]) / 2;
      const sourceWeights = { FC: 1.35, KTC: 1.25, FP: 1.15, DP: 1, FN: 0.55, IDP: 0.65, IDPSHOW: 0.55 };
      const allSorted = sourcePcts.map((entry) => entry.percentile).sort((a, b) => a - b);
      const allMiddle = Math.floor(allSorted.length / 2);
      const marketMedian = allSorted.length % 2
        ? allSorted[allMiddle]
        : (allSorted[allMiddle - 1] + allSorted[allMiddle]) / 2;
      const adjusted = sourcePcts.map((entry) => {
        const sourceCenter = entry.source === "FN" ? corroboratingMedian : marketMedian;
        const maxDistance = entry.source === "FN" ? 0.12 : 0.18;
        return {
          ...entry,
          adjustedPercentile: Math.max(sourceCenter - maxDistance, Math.min(sourceCenter + maxDistance, entry.percentile)),
          weight: sourceWeights[entry.source] || 0.5,
        };
      });
      if (!adjusted.length) continue;

      const totalWeight = adjusted.reduce((sum, entry) => sum + entry.weight, 0);
      const consensusPct = adjusted.reduce((sum, entry) => sum + entry.adjustedPercentile * entry.weight, 0) / Math.max(0.01, totalWeight);
      const independentCoverage = new Set(adjusted.map((entry) =>
        ["IDP", "IDPSHOW"].includes(entry.source) ? "IDP_FAMILY" : entry.source
      )).size;
      const coverageMultiplier = 0.72 + 0.28 * Math.min(1, independentCoverage / 3);
      // A linear percentile makes the median player worth about 5,000. A curved
      // market scale preserves ordering while creating realistic separation:
      // elite assets remain near 10k and replaceable depth falls much faster.
      const stickyValue = Math.round(Math.pow(consensusPct, 2.1) * 10000 * coverageMultiplier);
      const meta = pickMeta(
        [sources.FC?.[nn], sources.FN?.[nn], sources.FP?.[nn], sources.DP?.[nn], sources.KTC?.[nn], sources.IDP?.[nn], sources.IDPSHOW?.[nn]]
          .map((x) => (x ? { team: x.team, position: x.position } : null))
      );
      const displayName =
        (sources.FC?.[nn]?.name) || (sources.FP?.[nn]?.name) || (sources.FN?.[nn]?.name) ||
        (sources.DP?.[nn]?.name) || (sources.KTC?.[nn]?.name) ||
        (sources.IDP?.[nn]?.name) || (sources.IDPSHOW?.[nn]?.name) || nn;

      out[formatKey].push({
        name: displayName,
        team: meta.team || "",
        position: meta.position || "",
        value: stickyValue,
        source_count: adjusted.length,
        sources: adjusted.map((entry) => entry.source),
        confidence: independentCoverage >= 4 ? "high" : independentCoverage >= 2 ? "medium" : "low",
      });
    }

    out[formatKey].sort((a, b) => (b.value - a.value));
  }

  fs.writeFileSync(SP_OUT_PATH, JSON.stringify(out, null, 2));
  console.log("✅ stickypicky_cache.json updated.");
}

// ---------- Pick-slot normalization ----------
// Providers expose picks at different resolutions (exact slots, early/mid/late,
// or one generic round value). Preserve all supplied rows and add only missing
// exact slots for the current rookie class on that provider's own value scale.
const GENERATED_PICK_SLOTS = 16;

function pickAnchorSlot(meta) {
  if (meta?.kind === "exact") return Number(meta.slot) || 0;
  if (meta?.kind === "bucket") return meta.bucket === "early" ? 2 : meta.bucket === "late" ? 11 : 6.5;
  return meta?.kind === "generic" ? 6.5 : 0;
}

function interpolatePickSlot(anchors, slot) {
  const usable = anchors.filter((row) => row.slot > 0 && row.value > 0).sort((a,b) => a.slot-b.slot);
  if (!usable.length) return 0;
  if (usable.length === 1) return Math.round(usable[0].value * Math.pow(0.96, slot-usable[0].slot));
  let left = usable[0];
  let right = usable[usable.length-1];
  for (let index=0; index<usable.length-1; index+=1) {
    if (slot >= usable[index].slot && slot <= usable[index+1].slot) { left=usable[index]; right=usable[index+1]; break; }
    if (slot < usable[0].slot) { left=usable[0]; right=usable[1]; break; }
    if (slot > usable[usable.length-1].slot) { left=usable[usable.length-2]; right=usable[usable.length-1]; }
  }
  const distance = Math.max(0.5, right.slot-left.slot);
  const progress = (slot-left.slot)/distance;
  const raw = Math.exp(Math.log(left.value)+(Math.log(right.value)-Math.log(left.value))*progress);
  const floor = Math.min(...usable.map((row)=>row.value))*0.55;
  const ceiling = Math.max(...usable.map((row)=>row.value))*1.45;
  return Math.round(Math.max(floor,Math.min(ceiling,raw)));
}

function addCalculatedSlotsToArray(rows, valueOf, createRow) {
  if (!Array.isArray(rows)) return 0;
  const currentYear = new Date().getUTCFullYear();
  const groups = new Map();
  rows.forEach((row) => {
    const name = row?.player?.name || row?.name || "";
    const pos = normalizePos(row?.player?.position || row?.position || row?.pos);
    if (pos !== "PICK") return;
    const meta = parsePickLabel(name);
    const value = Number(valueOf(row)) || 0;
    if (!meta || meta.year !== currentYear || !value) return;
    const key = `${meta.year}:${meta.round}`;
    if (!groups.has(key)) groups.set(key,{ year:meta.year,round:meta.round,anchors:[],exact:new Set() });
    const group = groups.get(key);
    group.anchors.push({ slot:pickAnchorSlot(meta),value });
    if (meta.kind === "exact") group.exact.add(Number(meta.slot));
  });
  let added = 0;
  groups.forEach((group) => {
    for (let slot=1; slot<=GENERATED_PICK_SLOTS; slot+=1) {
      if (group.exact.has(slot)) continue;
      const value = interpolatePickSlot(group.anchors,slot);
      if (!value) continue;
      rows.push(createRow({ year:group.year,round:group.round,slot,value,method:"source-curve interpolation" }));
      added+=1;
    }
  });
  const playerScale = rows.filter((row)=>normalizePos(row?.player?.position || row?.position || row?.pos) !== "PICK").map((row)=>Number(valueOf(row))||0).filter((value)=>value>0).sort((a,b)=>b-a);
  const percentileValue = (percentile) => playerScale.length ? playerScale[Math.max(0,Math.min(playerScale.length-1,Math.round((1-percentile)*(playerScale.length-1))))] : 0;
  const percentileBands = { 1:[0.98,0.78],2:[0.76,0.55],3:[0.53,0.35],4:[0.33,0.20] };
  for (let round=1; round<=4; round+=1) {
    if (groups.has(`${currentYear}:${round}`)) continue;
    const [high,low]=percentileBands[round];
    for (let slot=1; slot<=GENERATED_PICK_SLOTS; slot+=1) {
      const progress=(slot-1)/Math.max(1,GENERATED_PICK_SLOTS-1);
      const value=Math.round(percentileValue(high+(low-high)*progress));
      if (!value) continue;
      rows.push(createRow({year:currentYear,round,slot,value,method:"player-scale percentile model"}));
      added+=1;
    }
  }
  return added;
}

function normalizeCalculatedPickSlots(selectedSources) {
  const selected = new Set(selectedSources || []);
  let total = 0;
  const updateJson = (key,filePath,mutate) => {
    if (!selected.has(key) || !fs.existsSync(filePath)) return;
    const data=JSON.parse(fs.readFileSync(filePath,"utf8"));
    const added=mutate(data);
    if (added) fs.writeFileSync(filePath,JSON.stringify(data,null,2));
    total+=added;
    console.log(`  🧮 ${path.basename(filePath)}: ${added} calculated exact pick values added`);
  };
  const standardRow = ({year,round,slot,value,method}) => ({ name:formatPickLabel({year,round,slot,kind:"exact"}),team:"",position:"PICK",value,generatedPickValue:true,pickValueMethod:method });
  updateJson("fc",FC_OUT_PATH,(data)=>["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"].reduce((sum,key)=>sum+addCalculatedSlotsToArray(data[key],(row)=>row.value,({year,round,slot,value,method})=>({player:{name:formatPickLabel({year,round,slot,kind:"exact"}),sleeperId:`DP_${round-1}_${slot-1}`,position:"PICK",maybeTeam:null},value,generatedPickValue:true,pickValueMethod:method})),0));
  updateJson("ktc",KTC_OUT_PATH,(data)=>["Superflex","OneQB"].reduce((sum,key)=>sum+addCalculatedSlotsToArray(data[key],(row)=>row.value,standardRow),0));
  updateJson("fn",FN_OUT_PATH,(data)=>["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"].reduce((sum,key)=>sum+addCalculatedSlotsToArray(data[key],(row)=>row.value,standardRow),0));
  updateJson("sp",SP_OUT_PATH,(data)=>["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"].reduce((sum,key)=>sum+addCalculatedSlotsToArray(data[key],(row)=>row.value,standardRow),0));
  updateJson("idp",IDP_OUT_PATH,(data)=>{
    const sf=addCalculatedSlotsToArray(data,(row)=>row.superflex,({year,round,slot,value,method})=>({name:formatPickLabel({year,round,slot,kind:"exact"}),position:"PICK",team:"",superflex:value,one_qb:0,generatedPickValue:true,pickValueMethod:method,year,round,slot}));
    const qbRows=data.map((row)=>({...row,value:row.one_qb})); const generated=[];
    const qb=addCalculatedSlotsToArray(qbRows,(row)=>row.value,({year,round,slot,value,method})=>({name:formatPickLabel({year,round,slot,kind:"exact"}),position:"PICK",team:"",value,generatedPickValue:true,pickValueMethod:method,year,round,slot}));
    qbRows.filter((row)=>row.year).forEach((row)=>generated.push(row));
    generated.forEach((row)=>{const target=data.find((item)=>item.name===row.name);if(target)target.one_qb=row.value;else data.push({...row,one_qb:row.value,superflex:0});});
    return sf+qb;
  });
  updateJson("idpshow",IDPSHOW_OUT_PATH,(data)=>["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"].reduce((sum,key)=>sum+addCalculatedSlotsToArray(data[key],(row)=>row.value,standardRow),0));
  updateJson("dp",DP_OUT_PATH,(data)=>{
    const rows=Object.entries(data).map(([name,row])=>({name,position:row.pos,value:row.superflex,raw:row}));
    const generated=[];
    const sfAdded=addCalculatedSlotsToArray(rows,(row)=>row.value,({year,round,slot,value})=>({name:formatPickLabel({year,round,slot,kind:"exact"}),position:"PICK",value,year,round,slot}));
    rows.filter((row)=>row.year).forEach((row)=>generated.push(row));
    generated.forEach((row)=>{data[row.name]={...(data[row.name]||{}),pos:"PICK",team:"",superflex:row.value,generatedPickValue:true,pickValueMethod:"source-curve interpolation"};});
    const qbRows=Object.entries(data).map(([name,row])=>({name,position:row.pos,value:row.one_qb,raw:row}));
    const qbGenerated=[];
    const qbAdded=addCalculatedSlotsToArray(qbRows,(row)=>row.value,({year,round,slot,value})=>({name:formatPickLabel({year,round,slot,kind:"exact"}),position:"PICK",value,year,round,slot}));
    qbRows.filter((row)=>row.year).forEach((row)=>qbGenerated.push(row));
    qbGenerated.forEach((row)=>{data[row.name]={...(data[row.name]||{}),pos:"PICK",team:"",one_qb:row.value,generatedPickValue:true,pickValueMethod:"source-curve interpolation"};});
    return sfAdded+qbAdded;
  });
  if (total) console.log(`✅ Added ${total} calculated current-year exact pick values without replacing provider values.`);
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

  await page.goto(url, { waitUntil: "networkidle2", timeout: 80000 });
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

async function updateProjectionsFromCSV() {
  console.log("Reading projections CSV:", PROJ_IN_PATH);
  if (!fs.existsSync(PROJ_IN_PATH)) {
    throw new Error(`CSV not found at ${PROJ_IN_PATH}. Pass PROJ_CSV=/path/to/file.csv or move the file to /data.`);
  }

  const csv = fs.readFileSync(PROJ_IN_PATH, "utf-8");
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error("No rows found in projections CSV.");
  }

  // detect column names
  const sample = parsed.find(Boolean) || {};
  const keys = Object.keys(sample);
  const keyOf = (names) => keys.find((k) => names.includes(k.toLowerCase()));

  const nameKey  = keyOf(keys.map(k => k.toLowerCase()).includes("player") ? ["player"] : ["player","name","full_name"]);
  const idKey    = keyOf(["player_id","sleeper_id","id","playerid"]);
  const teamKey  = keyOf(["team","nfl","tm"]);
  const posKey   = keyOf(["position","pos"]);
  const pointsKey = pickPointsKey(sample);

  if (!nameKey)   throw new Error("Could not find a name column (expected 'player' or 'name').");
  if (!pointsKey) throw new Error("Could not detect a numeric points column.");

  // only fetch Sleeper if we may need enrichment
  const needMeta = !teamKey || !posKey || !idKey;
  const sleeperById = needMeta ? await fetchSleeperPlayersMap() : {};

  const rows = [];
  const by_id = {};
  const by_name = {};

  for (const r of parsed) {
    const rawPoints = Number(r[pointsKey]);
    if (!Number.isFinite(rawPoints)) continue;

    const player_id = r[idKey] ? String(r[idKey]).trim() : "";
    const csvName = (r[nameKey] || "").toString().trim();
    if (!csvName && !player_id) continue;

    // prefer CSV team/pos; fall back to Sleeper if missing
    let team = (r[teamKey] || "").toString().trim().toUpperCase();
    let position = (r[posKey] || "").toString().replace(/\d+$/, "").trim().toUpperCase();

    if ((!team || !position) && player_id && sleeperById[player_id]) {
      team = team || (sleeperById[player_id].team || "").toUpperCase();
      position = position || (sleeperById[player_id].position || "").toUpperCase();
    }

    const points = Math.max(0, Number(rawPoints) || 0);
    const name = csvName; // <- use your CSV's Player column

    rows.push({ player_id, name, team, position, points });

    if (player_id) by_id[player_id] = points;
    if (name)      by_name[normNameForMap(name)] = points;

    // add Sleeper search_full_name index when available
    if (player_id && sleeperById[player_id]?.search_full_name) {
      by_name[sleeperById[player_id].search_full_name] = points;
    }
  }

  const out = {
    updated: new Date().toISOString(),
    season: CURRENT_SEASON,
    pointsKey,
    count: rows.length,
    rows,
    by_id,
    by_name,
  };

  fs.writeFileSync(PROJ_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✅ projections_${CURRENT_SEASON}.json written with ${rows.length} rows.`);
}

async function updateESPNProjections() {
  console.log("\nScraping ESPN Projections via API…");

  const API_BASE =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${CURRENT_SEASON}/segments/0/leaguedefaults/3`;

  // Copied from your devtools capture (limit/offset are paginated)
  const fantasyFilter = {
    players: {
      filterSlotIds: { value: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,23,24] },
      filterStatsForExternalIds: { value: [CURRENT_SEASON] },
      filterStatsForSourceIds: { value: [1] },
      sortAppliedStatTotal: { sortAsc: false, sortPriority: 3, value: `10${CURRENT_SEASON}` },
      sortDraftRanks: { sortPriority: 2, sortAsc: true, value: "PPR" },
      sortPercOwned: { sortAsc: false, sortPriority: 4 },
      limit: 50,
      offset: 0,
      filterRanksForScoringPeriodIds: { value: [19] },
      filterRanksForRankTypes: { value: ["PPR"] },
      filterRanksForSlotIds: { value: [0,2,4,6,17,16,8,9,10,12,13,24,11,14,15] },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${CURRENT_SEASON}`,`10${CURRENT_SEASON}`,`00${CURRENT_SEASON-1}`,`02${CURRENT_SEASON}`] }
    }
  };

  const TEAM_BY_ID = {
    0: "", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
    15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
    22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
    29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
  };

  const POS_BY_ID = {
    0: "", 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF",
  };

  function teamFromPlayer(pl) {
    const a =
      pl?.proTeamAbbrev ||
      pl?.teamAbbrev ||
      pl?.proTeam ||
      pl?.team ||
      "";

    if (a) return normalizeTeamAbbr(a);

    const id = pl?.proTeamId ?? pl?.teamId;
    if (id != null && TEAM_BY_ID[id]) return normalizeTeamAbbr(TEAM_BY_ID[id]);

    return "";
  }

  function posFromPlayer(pl) {
    const p =
      pl?.defaultPosition ||
      pl?.position ||
      pl?.pos ||
      "";

    if (p) return normalizePos(p);

    const pid = pl?.defaultPositionId ?? pl?.positionId;
    if (pid != null && POS_BY_ID[pid]) return normalizePos(POS_BY_ID[pid]);

    return "";
  }


  const normalizeTeamAbbr = (s) => {
    const t = String(s || "").toUpperCase().trim();
    const map = { JAX:"JAC", LA:"LAR", STL:"LAR", SD:"LAC", OAK:"LV", WSH:"WAS" };
    return map[t] || t;
  };
  const normalizePos = (p) => {
    const t = String(p || "").toUpperCase().trim();
    if (t === "DST" || t === "D/ST" || t === "DEFENSE") return "DEF";
    if (t === "PK") return "K";
    return t;
  };
  


  async function getJson(url, headers) {
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ESPN API ${res.status}: ${t.slice(0, 200)}`);
    }
    return await res.json();
  }

  const baseHeaders = {
    "accept": "application/json",
    "x-fantasy-platform": "espn-fantasy-web",
    "x-fantasy-source": "kona",
    "origin": "https://fantasy.espn.com",
    "referer": "https://fantasy.espn.com/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
  };

  const all = [];
  const seen = new Set();

  let offset = 0;
  const limit = fantasyFilter.players.limit || 50;

  for (let page = 1; page <= 1000; page++) {
    fantasyFilter.players.offset = offset;

    const url = `${API_BASE}?scoringPeriodId=19&view=kona_player_info`;

    const headers = {
      ...baseHeaders,
      "x-fantasy-filter": JSON.stringify(fantasyFilter),
    };

    const json = await getJson(url, headers);

    const players = Array.isArray(json?.players) ? json.players : [];
    console.log(`ESPN API page ${page}: offset=${offset} got=${players.length}`);

    if (!players.length) break;

    for (const p of players) {
      const pl = p?.player || {};
      const name = String(pl.fullName || pl.name || "").trim();
      if (!name) continue;

      const team = teamFromPlayer(pl);
      const pos = posFromPlayer(pl);


      // Most reliable: find the projection stat for the requested season.
      let points = 0;
      const stats = Array.isArray(pl.stats) ? pl.stats : [];
      if (stats.length) {
        const proj =
          stats.find(s => s && s.statSourceId === 1 && (s.seasonId === CURRENT_SEASON || s.externalId === CURRENT_SEASON)) ||
          stats.find(s => s && s.statSourceId === 1) ||
          null;
        if (proj) points = safeNum(proj.appliedTotal ?? proj.total ?? proj.points ?? proj.fantasyPoints);
      }

      if (!points) points = safeNum(p?.appliedStatTotal);

      // Dedupe safely
      const key = `${name.toLowerCase()}|${pos}|${team}`;
      if (seen.has(key)) continue;
      seen.add(key);

      all.push({ name, team, position: pos, points });
    }

    if (players.length < limit) break;
    offset += limit;
  }

  console.log(`✅ ESPN projections collected for ${all.length} players.`);

  const by_id = {};
  const by_name = {};
  const rows = all.map(r => ({
    player_id: "",
    name: r.name,
    team: r.team,
    position: r.position,
    points: r.points
  }));

  for (const r of rows) {
    if (r.name) {
      const key1 = r.name.toLowerCase().replace(/\s+/g, "");
      const key2 = r.name.toLowerCase().replace(/[^a-z0-9 ]/g, "")
        .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
        .replace(/\s+/g, " ").trim();
      by_name[key1] = r.points;
      by_name[key2] = r.points;
    }
  }

  const out = {
    updated: new Date().toISOString(),
    season: CURRENT_SEASON,
    source: "ESPN",
    count: rows.length,
    rows,
    by_id,
    by_name,
  };

  fs.writeFileSync(ESPN_PROJ_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✅ projections_espn_${CURRENT_SEASON}.json written (${rows.length} rows).`);
}



function decodeCBSHtml(value) {
  return String(value || "").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
}

async function updateSleeperProjections() {
  console.log(`Fetching Sleeper ${CURRENT_SEASON} weekly projections (undocumented read-only endpoint)...`);
  const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
  const weekly = await Promise.all(weeks.map(async (week) => {
    const url = `https://api.sleeper.app/v1/projections/nfl/regular/${CURRENT_SEASON}/${week}?season_type=regular`;
    const response = await retryOperation(() => axios.get(url, { timeout: 60000, family: 4 }));
    if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
      throw new Error(`Sleeper returned an invalid projection payload for Week ${week}`);
    }
    const projected = Object.values(response.data).filter((row) =>
      Number(row?.pts_ppr) > 0 || Number(row?.pts_half_ppr) > 0 || Number(row?.pts_std) > 0
    ).length;
    console.log(`  Week ${week}: ${projected} projected players`);
    return { week, data: response.data };
  }));

  const playerMap = await fetchSleeperPlayersMap();
  const totals = new Map();
  weekly.forEach(({ week, data }) => {
    Object.entries(data).forEach(([playerId, projection]) => {
      const ppr = Number(projection?.pts_ppr) || 0;
      const halfPpr = Number(projection?.pts_half_ppr) || 0;
      const standard = Number(projection?.pts_std) || 0;
      if (ppr <= 0 && halfPpr <= 0 && standard <= 0) return;
      const current = totals.get(String(playerId)) || {
        player_id: String(playerId),
        points: 0,
        points_ppr: 0,
        points_half_ppr: 0,
        points_standard: 0,
        projected_weeks: 0,
        weekly: {},
      };
      current.points += ppr;
      current.points_ppr += ppr;
      current.points_half_ppr += halfPpr;
      current.points_standard += standard;
      current.projected_weeks += 1;
      current.weekly[week] = { ppr, half_ppr: halfPpr, standard };
      totals.set(String(playerId), current);
    });
  });

  const rows = [...totals.values()].map((row) => {
    const player = playerMap[row.player_id] || {};
    const isDefense = /^[A-Z]{2,3}$/.test(row.player_id);
    return {
      ...row,
      name: player.name || (isDefense ? `${row.player_id} Defense` : `Player ${row.player_id}`),
      team: player.team || (isDefense ? row.player_id : ""),
      position: player.position || (isDefense ? "DEF" : ""),
      points: Number(row.points.toFixed(2)),
      points_ppr: Number(row.points_ppr.toFixed(2)),
      points_half_ppr: Number(row.points_half_ppr.toFixed(2)),
      points_standard: Number(row.points_standard.toFixed(2)),
    };
  }).filter((row) => row.name && row.position && row.points > 0)
    .sort((a, b) => b.points - a.points);

  const coreCounts = rows.reduce((counts, row) => {
    counts[row.position] = (counts[row.position] || 0) + 1;
    return counts;
  }, {});
  const missingCore = ["QB", "RB", "WR", "TE"].filter((position) => Number(coreCounts[position] || 0) < 20);
  if (missingCore.length) {
    throw new Error(`Sleeper projection coverage is incomplete (${JSON.stringify(coreCounts)}). Existing cache was not overwritten.`);
  }

  const by_id = Object.fromEntries(rows.map((row) => [row.player_id, row.points]));
  const by_name = {};
  rows.forEach((row) => {
    by_name[normNameForMap(row.name)] = row.points;
    by_name[String(row.name).toLowerCase().replace(/\s+/g, "")] = row.points;
  });
  const out = {
    updated: new Date().toISOString(),
    season: CURRENT_SEASON,
    source: "Sleeper",
    endpoint_status: "undocumented",
    scoring: "PPR",
    weeks_requested: weeks,
    count: rows.length,
    rows,
    by_id,
    by_name,
  };
  fs.writeFileSync(SLEEPER_PROJ_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✅ projections_sleeper_${CURRENT_SEASON}.json written (${rows.length} players).`);
}

function decodeHtml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function projectionOutput(source, rows, extra = {}) {
  const clean = rows.filter((row) => row.name && row.position && Number(row.points) > 0).sort((a, b) => b.points - a.points);
  const by_name = {};
  clean.forEach((row) => {
    by_name[normNameForMap(row.name)] = row.points;
    by_name[String(row.name).toLowerCase().replace(/\s+/g, "")] = row.points;
  });
  return { updated: new Date().toISOString(), season: CURRENT_SEASON, source, scoring: "PPR", count: clean.length, rows: clean, by_id: {}, by_name, ...extra };
}

async function updateFantasyProsProjections() {
  const apiKey = String(process.env.FANTASYPROS_API_KEY || "").trim();
  if (!apiKey) throw new Error("FANTASYPROS_API_KEY is not configured.");
  const endpoint = `https://api.fantasypros.com/public/v2/json/nfl/${CURRENT_SEASON}/projections?position=ALL&week=0`;
  const response = await fetch(endpoint, {
    headers: { "x-api-key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`FantasyPros projections returned HTTP ${response.status}.`);
  const payload = await response.json();
  const sourceRows = Array.isArray(payload?.players) ? payload.players : [];
  const declaredCount = Number(payload?.count || 0);
  if (declaredCount > sourceRows.length && sourceRows.length <= 10) {
    throw new Error(`FantasyPros API access returned only ${sourceRows.length} of ${declaredCount} declared projections. The key works, but its current access tier is returning a sample rather than the complete projection set.`);
  }
  const rows = sourceRows.map((player) => {
    const stats = player?.stats || {};
    const pointsStd = Number(stats.points ?? player.points ?? 0) || 0;
    const pointsPpr = Number(stats.points_ppr ?? player.points_ppr ?? pointsStd) || pointsStd;
    const pointsHalf = Number(stats.points_half ?? player.points_half ?? ((pointsStd + pointsPpr) / 2)) || pointsStd;
    return {
      player_id: "",
      source_player_id: String(player.fpid ?? player.player_id ?? ""),
      name: String(player.name || player.player_name || "").trim(),
      team: normalizeFantasyTeamAbbr(player.team_id || player.team || ""),
      position: normalizePos(player.position_id || player.position || ""),
      points: Number(pointsPpr.toFixed(3)),
      points_std: Number(pointsStd.toFixed(3)),
      points_half: Number(pointsHalf.toFixed(3)),
      points_ppr: Number(pointsPpr.toFixed(3)),
      stats,
    };
  }).filter((row) => row.name && row.position && row.points > 0);
  const coreCount = rows.filter((row) => ["QB","RB","WR","TE"].includes(row.position)).length;
  if (coreCount < 100) throw new Error(`FantasyPros projection coverage is incomplete (${coreCount} offensive players); existing cache was not overwritten.`);
  const output = projectionOutput("FantasyPros", rows, {
    scoring: "STD/HALF/PPR",
    scoring_variants: ["std","half","ppr"],
    default_scoring: "ppr",
    endpoint,
    api_requests: 1,
    source_updated: payload.last_updated || payload.updated || null,
  });
  fs.writeFileSync(FANTASYPROS_PROJ_OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ projections_fantasypros_${CURRENT_SEASON}.json written (${rows.length} players, one API request).`);
}

function updateArsenalProjections() {
  const sourceFiles = [
    { key: "FFA", path: PROJ_OUT_PATH, weight: 1 },
    { key: "ESPN", path: ESPN_PROJ_OUT_PATH, weight: 1 },
    { key: "CBS", path: CBS_PROJ_OUT_PATH, weight: 1 },
    // Sleeper's feed is useful corroborating data, but receives less influence
    // because its season totals can be inconsistent while weekly data is changing.
    { key: "Sleeper", path: SLEEPER_PROJ_OUT_PATH, weight: 0.35 },
    { key: "FantasySharks", path: FANTASYSHARKS_PROJ_OUT_PATH, weight: 1 },
    { key: "DraftSharks", path: DRAFTSHARKS_PROJ_OUT_PATH, weight: 1 },
    { key: "FantasyPros", path: FANTASYPROS_PROJ_OUT_PATH, weight: 1 },
  ];
  const available = sourceFiles.filter((source) => fs.existsSync(source.path));
  if (available.length < 2) throw new Error("At least two projection caches are required to calculate The Fantasy Arsenal Projections.");

  const players = new Map();
  available.forEach((source) => {
    const data = JSON.parse(fs.readFileSync(source.path, "utf8"));
    if (Number(data?.season) !== CURRENT_SEASON) return;
    (Array.isArray(data?.rows) ? data.rows : []).forEach((row) => {
      const name = String(row?.name || row?.full_name || "").trim();
      const position = normalizePos(row?.position || row?.pos || "");
      const points = Number(row?.points);
      if (!name || !position || !Number.isFinite(points) || points <= 0) return;
      const key = `${normNameForMap(name)}|${position}`;
      if (!players.has(key)) players.set(key, { name, position, team: normalizeFantasyTeamAbbr(row?.team || ""), inputs: [] });
      const player = players.get(key);
      if (!player.team && row?.team) player.team = normalizeFantasyTeamAbbr(row.team);
      player.inputs.push({ source: source.key, points, weight: source.weight });
    });
  });

  const rows = [...players.values()].filter((player) => player.inputs.length >= 2).map((player) => {
    const totalWeight = player.inputs.reduce((sum, input) => sum + input.weight, 0);
    const points = player.inputs.reduce((sum, input) => sum + input.points * input.weight, 0) / totalWeight;
    return {
      player_id: "",
      name: player.name,
      team: player.team,
      position: player.position,
      points: Number(points.toFixed(3)),
      source_count: player.inputs.length,
      sources: Object.fromEntries(player.inputs.map((input) => [input.source, Number(input.points.toFixed(3))])),
    };
  });
  const coreCount = rows.filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position)).length;
  if (coreCount < 100) throw new Error(`Calculated projection coverage is incomplete (${coreCount} core offensive players). Existing cache was not overwritten.`);

  const output = projectionOutput("The Fantasy Arsenal", rows, {
    method: "weighted_mean",
    minimum_sources: 2,
    source_weights: Object.fromEntries(sourceFiles.map((source) => [source.key, source.weight])),
  });
  fs.writeFileSync(ARSENAL_PROJ_OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ projections_thefantasyarsenal_${CURRENT_SEASON}.json written (${rows.length} players from ${available.length} caches).`);
}

async function updateFantasySharksProjections() {
  let segment = "";
  try {
    const landing = await fetch("https://www.fantasysharks.com/apps/bert/forecasts/projections.php?Position=", { headers: { "user-agent": "Mozilla/5.0" } }).then((response) => {
      if (!response.ok) throw new Error(`FantasySharks landing page returned HTTP ${response.status}`);
      return response.text();
    });
    const segmentMatch = landing.match(new RegExp(`<option value="(\\d+)"[^>]*selected[^>]*>${CURRENT_SEASON} NFL Season`, "i"));
    segment = segmentMatch?.[1] || "";
  } catch (error) {
    try {
      const cached = JSON.parse(fs.readFileSync(FANTASYSHARKS_PROJ_OUT_PATH, "utf8"));
      if (Number(cached?.season) === CURRENT_SEASON && cached?.segment) {
        segment = String(cached.segment);
        console.warn(`⚠️ ${error.message}; retrying the last verified FantasySharks season segment (${segment}).`);
      } else {
        throw error;
      }
    } catch {
      throw error;
    }
  }
  if (!segment) throw new Error(`FantasySharks did not expose a ${CURRENT_SEASON} season segment.`);
  const url = `https://www.fantasysharks.com/apps/bert/forecasts/projections.php?csv=1&Sort=&Segment=${segment}&Position=99&scoring=2&League=&uid=4&uid2=&printable=`;
  const csv = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "text/csv,*/*" } }).then((response) => {
    if (!response.ok) throw new Error(`FantasySharks CSV returned HTTP ${response.status}`);
    return response.text();
  });
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors?.length && !parsed.data?.length) throw new Error(`FantasySharks CSV parse failed: ${parsed.errors[0].message}`);
  const rows = parsed.data.map((row) => {
    const raw = String(row["Player Name"] || "").trim();
    const parts = raw.split(",").map((value) => value.trim()).filter(Boolean);
    const name = parts.length > 1 ? `${parts.slice(1).join(" ")} ${parts[0]}` : raw;
    return {
      player_id: "",
      source_player_id: String(row["Player ID"] || ""),
      name,
      team: normalizeFantasyTeamAbbr(row.Team || ""),
      position: normalizePos(row.Position || ""),
      points: Number(row.Pts) || 0,
      source_rank: Number(row.Rank) || null,
      stats: {
        pass_yds: Number(row["Pass Yds"]) || 0, pass_tds: Number(row["Pass TDs"]) || 0,
        rush_yds: Number(row["Rush Yds"]) || 0, rush_tds: Number(row["Rush TDs"]) || 0,
        receptions: Number(row.Rec) || 0, rec_yds: Number(row["Rec Yds"]) || 0, rec_tds: Number(row["Rec TDs"]) || 0,
      },
    };
  });
  if (rows.filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position) && row.points > 0).length < 100) throw new Error("FantasySharks projection coverage is incomplete; existing cache was not overwritten.");
  fs.writeFileSync(FANTASYSHARKS_PROJ_OUT_PATH, JSON.stringify(projectionOutput("FantasySharks", rows, { endpoint: url, segment }), null, 2));
  console.log(`✅ projections_fantasysharks_${CURRENT_SEASON}.json written (${rows.length} rows).`);
}

function parseDraftSharksRows(html) {
  const rows = [];
  const blocks = String(html || "").match(/<tbody\b[^>]*\bdata-player-row\b[\s\S]*?<\/tbody>/gi) || [];
  blocks.forEach((block, index) => {
    const attr = (name) => decodeHtml(block.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "");
    const cells = {};
    for (const match of block.matchAll(/<td[^>]*data-value="([^"]*)"[^>]*data-attribute="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi)) cells[decodeHtml(match[2])] = Number(match[1]) || stripHtml(match[3]);
    const analysis = {};
    const analysis_links = {};
    for (const match of block.matchAll(/<td[^>]*data-attribute="([^"]*(?:analysis|bottom|risk|upside|floor|ceiling)[^"]*)"[^>]*>([\s\S]*?)<\/td>/gi)) {
      const key = decodeHtml(match[1]);
      analysis[key] = stripHtml(match[2]);
      const href = decodeHtml(match[2].match(/<a[^>]*class="[^"]*bottom-line-profile-link[^"]*"[^>]*href="([^"]+)"/i)?.[1] || match[2].match(/<a[^>]*href="([^"]+)"[^>]*>\s*(?:Read Full Profile|Click to Read)/i)?.[1] || "");
      if (href) analysis_links[key] = new URL(href, "https://www.draftsharks.com").href;
    }
    rows.push({
      player_id: "", source_player_id: attr("data-key"), name: attr("data-player-name"),
      team: normalizeFantasyTeamAbbr(stripHtml(block.match(/player-details-group__team-name[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "")),
      position: normalizePos(attr("data-fantasy-position")), points: Number(cells.weekly3dPts) || 0,
      source_rank: index + 1, projections: cells, analysis, analysis_links,
    });
  });
  return rows;
}

async function updateDraftSharksProjections() {
  const base = "https://www.draftsharks.com/rankings/load-table";
  const query = (depth) => `${base}?pprSuperflexSlug=&fantasyPosition=&researchDepth=${depth}&playerGroup=all&sort=-dsValue&selectedTeam=&playerSearchTerm=`;
  const [projectionHtml, analysisHtml] = await Promise.all(["projections", "analysis"].map((depth) => fetch(query(depth), { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } }).then((response) => {
    if (!response.ok) throw new Error(`DraftSharks ${depth} endpoint returned HTTP ${response.status}`);
    return response.text();
  })));
  const rows = parseDraftSharksRows(projectionHtml);
  const analysisRows = new Map(parseDraftSharksRows(analysisHtml).map((row) => [row.source_player_id, row]));
  rows.forEach((row) => {
    const analysisRow = analysisRows.get(row.source_player_id);
    row.analysis = analysisRow?.analysis || row.analysis || {};
    row.analysis_links = analysisRow?.analysis_links || row.analysis_links || {};
    row.analysis_articles = Object.entries(row.analysis).map(([key, text]) => ({ key, text, url: row.analysis_links[key] || null }));
  });
  const coreRows = rows.filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position) && row.points > 0);
  const coverage = rows.reduce((map, row) => { map[row.position || "UNKNOWN"] = (map[row.position || "UNKNOWN"] || 0) + (row.points > 0 ? 1 : 0); return map; }, {});
  if (coreRows.length < 50) throw new Error(`DraftSharks projection coverage is incomplete (${JSON.stringify(coverage)}); existing cache was not overwritten.`);
  fs.writeFileSync(DRAFTSHARKS_PROJ_OUT_PATH, JSON.stringify(projectionOutput("DraftSharks", rows, { endpoints: { projections: query("projections"), analysis: query("analysis") }, includes_analysis: true }), null, 2));
  console.log(`✅ projections_draftsharks_${CURRENT_SEASON}.json written (${rows.length} rows).`);
}

async function fetchCBSProjectionRows(position, url) {
  const candidates=[url,url.replace("https://www.cbssports.com","https://secure-www.cbssports.com")];
  let html=""; let lastError=null;
  for (const candidate of candidates) {
    try {
      html=await retryOperation(async()=>{const response=await fetch(candidate,{headers:{"user-agent":"Mozilla/5.0","accept":"text/html"},signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(`CBS ${position} returned HTTP ${response.status}`);return response.text();},2,1200);
      if (html) break;
    } catch (error) { lastError=error; }
  }
  if (!html) throw lastError || new Error(`CBS ${position} returned no HTML.`);
  const table=[...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match)=>match[0]).find((value)=>/TableBase-bodyTr/i.test(value)&&/>\s*fpts\s*</i.test(value));
  if (!table) throw new Error("CBS projection table was not present in the response.");
  const header=table.match(/<thead\b[\s\S]*?<\/thead>/i)?.[0]||"";
  const headerRows=[...header.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((match)=>match[0]);
  const columnHeader=headerRows[headerRows.length-1]||header;
  const headers=[...columnHeader.matchAll(/<th\b[\s\S]*?<\/th>/gi)].map((match)=>decodeCBSHtml(match[0]).toLowerCase());
  const pointsIndex=headers.findIndex((label)=>label.split(/\s+/).includes("fpts"));
  if (pointsIndex<0) throw new Error("CBS Fantasy Points column was not found.");
  const rows=[];
  for (const match of table.matchAll(/<tr\b[^>]*TableBase-bodyTr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...match[1].matchAll(/<td\b[\s\S]*?<\/td>/gi)].map((cell)=>cell[0]);
    if (cells.length<=pointsIndex) continue;
    const playerCell=cells[0]||"";
    const longBlock=playerCell.match(/CellPlayerName--long[\s\S]*?<\/span>\s*<\/span>/i)?.[0]||playerCell;
    const name=decodeCBSHtml(longBlock.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1]);
    const team=normalizeTeamAbbr(decodeCBSHtml(longBlock.match(/CellPlayerName-team[^>]*>([\s\S]*?)<\/span>/i)?.[1]));
    const parsedPosition=normalizePos(decodeCBSHtml(longBlock.match(/CellPlayerName-position[^>]*>([\s\S]*?)<\/span>/i)?.[1])||position);
    const points=Number(decodeCBSHtml(cells[pointsIndex]).replace(/,/g,""))||0;
    if (name) rows.push({name,team,position:parsedPosition==="DST"?"DEF":parsedPosition,points});
  }
  return rows;
}

async function updateCBSProjections() {
  console.log("\nScraping CBS PPR season projections…");

  const POS_CFG = {
    QB:  { url: `https://www.cbssports.com/fantasy/football/stats/QB/${CURRENT_SEASON}/season/projections/ppr/`,  ptsTdIndex1: 15 },
    RB:  { url: `https://www.cbssports.com/fantasy/football/stats/RB/${CURRENT_SEASON}/season/projections/ppr/`,  ptsTdIndex1: 14 },
    WR:  { url: `https://www.cbssports.com/fantasy/football/stats/WR/${CURRENT_SEASON}/season/projections/ppr/`,  ptsTdIndex1: 14 },
    TE:  { url: `https://www.cbssports.com/fantasy/football/stats/TE/${CURRENT_SEASON}/season/projections/ppr/`,  ptsTdIndex1: 10 },
    K:   { url: `https://www.cbssports.com/fantasy/football/stats/K/${CURRENT_SEASON}/season/projections/ppr/`,   ptsTdIndex1: 18 },
    DEF: { url: `https://www.cbssports.com/fantasy/football/stats/DST/${CURRENT_SEASON}/season/projections/ppr/`, ptsTdIndex1: 15 },
  };

  const directRows=[];
  for (const [position,cfg] of Object.entries(POS_CFG)) {
    const rows=await fetchCBSProjectionRows(position,cfg.url);
    directRows.push(...rows);
    console.log(`  → found ${rows.length} ${position} rows`);
  }
  const directCounts=directRows.reduce((counts,row)=>({...counts,[row.position]:(counts[row.position]||0)+1}),{});
  const missingDirectCore=["QB","RB","WR","TE"].filter((position)=>(directCounts[position]||0)<10);
  if (missingDirectCore.length) throw new Error(`CBS returned incomplete projections (${Object.entries(directCounts).map(([position,count])=>`${position} ${count}`).join(", ")||"no rows"}). Existing cache preserved.`);
  const directByName={};
  directRows.forEach((row)=>{directByName[row.name.toLowerCase().replace(/\s+/g,"")]=row.points;directByName[row.name.toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/\s+/g," ").trim()]=row.points;});
  fs.writeFileSync(CBS_PROJ_OUT_PATH,JSON.stringify({updated:new Date().toISOString(),season:CURRENT_SEASON,source:"CBS",count:directRows.length,rows:directRows.map((row)=>({player_id:"",...row})),by_id:{},by_name:directByName},null,2));
  console.log(`✅ projections_cbs_${CURRENT_SEASON}.json written (${directRows.length} rows).`);
  return;

  // Map full CBS team names ➜ standard 2–3 char abbr used across your app
  const TEAM_FULL_TO_ABBR = {
    "ARIZONA CARDINALS":"ARI","ATLANTA FALCONS":"ATL","BALTIMORE RAVENS":"BAL","BUFFALO BILLS":"BUF",
    "CAROLINA PANTHERS":"CAR","CHICAGO BEARS":"CHI","CINCINNATI BENGALS":"CIN","CLEVELAND BROWNS":"CLE",
    "DALLAS COWBOYS":"DAL","DENVER BRONCOS":"DEN","DETROIT LIONS":"DET","GREEN BAY PACKERS":"GB",
    "HOUSTON TEXANS":"HOU","INDIANAPOLIS COLTS":"IND","JACKSONVILLE JAGUARS":"JAX","KANSAS CITY CHIEFS":"KC",
    "LAS VEGAS RAIDERS":"LV","LOS ANGELES CHARGERS":"LAC","LOS ANGELES RAMS":"LAR",
    "MIAMI DOLPHINS":"MIA","MINNESOTA VIKINGS":"MIN","NEW ENGLAND PATRIOTS":"NE",
    "NEW ORLEANS SAINTS":"NO","NEW YORK GIANTS":"NYG","NEW YORK JETS":"NYJ","PHILADELPHIA EAGLES":"PHI",
    "PITTSBURGH STEELERS":"PIT","SAN FRANCISCO 49ERS":"SF","SEATTLE SEAHAWKS":"SEA",
    "TAMPA BAY BUCCANEERS":"TB","TENNESSEE TITANS":"TEN","WASHINGTON COMMANDERS":"WAS"
  };

  const browser = await puppeteer.launch(makePptrLaunchOpts());
  const page = await browser.newPage();
  await enableAdBlockLite(page, {
  allowHostParts: [
    "cbssports.com",
    "www.cbssports.com",
    "cbsi.com",
    "cbsistatic.com",
    "cbsinteractive.com",
    "paramount.com",
    "sports.cbsimg.net"
  ],
  });

  wirePageDebug(page, "cbssports.com");
  await page.setViewport({ width: 1400, height: 900 });

  async function acceptCookiesIfPresent() {
    try {
      await page.waitForSelector("button, .btn", { timeout: 5000 });
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, .btn"));
        const hit = btns.find(b => /accept|agree|consent|got it|continue/i.test(b.textContent || ""));
        if (hit) hit.click();
      });
      await page.waitForTimeout(500);
    } catch {}
  }

  async function scrapePos(posKey, cfg) {
    const { url, ptsTdIndex1 } = cfg;
    console.log("CBS:", posKey, url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await acceptCookiesIfPresent();
    await page.waitForSelector("#TableBase table, main table", { timeout: 15000 });

    const rows = await page.evaluate((posKey, ptsTdIndex1, TEAM_FULL_TO_ABBR) => {
      function text(n){ return (n?.textContent || "").trim(); }
      function normTeamAbbr(s) {
        const t = String(s || "").toUpperCase().trim();
        const map = { JAX:"JAC", LA:"LAR", STL:"LAR", SD:"LAC", OAK:"LV", WSH:"WAS" };
        return map[t] || t;
      }
      function normPos(p) {
        const t = String(p || "").toUpperCase().trim();
        if (t === "DST" || t === "D/ST" || t === "DEFENSE" || t === "DEF") return "DEF";
        if (t === "PK") return "K";
        return t;
      }
      function teamFullToAbbr(full) {
        const k = String(full || "").toUpperCase().trim();
        return TEAM_FULL_TO_ABBR[k] || "";
      }

      // table can be under #TableBase or the first table under <main>
      const root = document.querySelector("#TableBase table") ||
                   (document.querySelector("main") || document.body).querySelector("table");
      if (!root) return [];

      const tbody = root.querySelector("tbody");
      if (!tbody) return [];
      const headerCells = Array.from(root.querySelectorAll("thead tr:last-child th"));
      const detectedPointsIndex = headerCells.findIndex((cell) => {
        const label = `${cell.getAttribute("data-label") || ""} ${cell.getAttribute("aria-label") || ""} ${cell.getAttribute("title") || ""} ${text(cell)}`.toLowerCase().replace(/[^a-z]/g, " ").replace(/\s+/g, " ").trim();
        return label === "fpts" || label === "fantasy points" || (label.includes("fantasy points") && !label.includes("per game"));
      });

      const out = [];
      const trs = Array.from(tbody.querySelectorAll("tr"));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (!tds.length) continue;

        // ===== Name (force full) =====
        // Try long-name node, then aria-label/title, then plain anchor
        const nameNode =
          tds[0].querySelector(".CellPlayerName--long a") ||
          tds[0].querySelector(".CellPlayerName a") ||
          tds[0].querySelector("a");
        let name = "";
        if (nameNode) {
          name = nameNode.getAttribute("aria-label") || nameNode.getAttribute("title") || text(nameNode);
        }
        // Don’t accept single-letter first names like "J. Jefferson" if aria/title existed
        name = name?.trim() || "";

        // ===== Position + Team =====
        let teamAbbr = "";
        let pos = posKey; // trust the page we hit
        if (posKey !== "DEF") {
          // Non-DST: look for small meta tokens in the first cell
          const posExplicit = tds[0].querySelector(".CellPlayerName-position");
          if (posExplicit) pos = text(posExplicit) || pos;

          const tokenTexts = Array.from(tds[0].querySelectorAll("span, small"))
            .map(text).filter(Boolean)
            .flatMap(t => t.split(/[•|,()\s]+/)).map(s => s.trim()).filter(Boolean);

          // team abbr is usually a 2–3 letter token not equal to POS
          const teamTok = tokenTexts.find(tok => tok !== pos && /^[A-Z]{2,3}$/.test(tok));
          if (teamTok) teamAbbr = normTeamAbbr(teamTok);
        } else {
          // DST: team name lives deeper (you gave an XPath); grab the deepest span in first cell
          // path seen: td[1]/span/div/div[2]/div/span (but we’ll be flexible)
          let teamFull = "";
          const candidate =
            tds[0].querySelector("span div div:nth-child(2) div span") ||
            tds[0].querySelector("span div div div span:last-child") ||
            tds[0].querySelector("span div div div span") ||
            tds[0].querySelector("span div span:last-child");
          teamFull = text(candidate);
          if (!teamFull) {
            // fallback: any long text in first cell that looks like team words
            const spans = Array.from(tds[0].querySelectorAll("span"));
            const long = spans.map(text).filter(v => v.split(" ").length >= 2).find(Boolean);
            if (long) teamFull = long;
          }
          teamAbbr = teamFullToAbbr(teamFull) || normTeamAbbr(teamFull);
          // for DEF, we want the "name" to be the team, to match your name+team lookup
          if (!name) name = teamFull || teamAbbr;
          pos = "DEF";
        }

        // ===== Points column (1-based index provided) =====
        const labeledPointsIndex = tds.findIndex((cell) => {
          const label = `${cell.getAttribute("data-label") || ""} ${cell.getAttribute("aria-label") || ""}`.toLowerCase();
          return (label.includes("fpts") || label.includes("fantasy points")) && !label.includes("per game") && !label.includes("fppg");
        });
        const idx0 = labeledPointsIndex >= 0 ? labeledPointsIndex : detectedPointsIndex >= 0 ? detectedPointsIndex : Math.max(1, ptsTdIndex1) - 1;
        const ptsCell = tds[idx0];
        const points = Number((text(ptsCell) || "0").replace(/,/g, "")) || 0;

        if (name) {
          out.push({ name, team: teamAbbr, position: normPos(pos), points });
        }
      }
      return out;
    }, posKey, ptsTdIndex1, TEAM_FULL_TO_ABBR);

    console.log(`  → found ${rows.length} ${posKey} rows`);
    return rows;
  }

  const allRows = [];
  for (const [pos, cfg] of Object.entries(POS_CFG)) {
    try {
      const rows = await scrapePos(pos, cfg);
      allRows.push(...rows);
    } catch (e) {
      console.log(`  ⚠️ ${pos} scrape failed:`, e?.message || e);
    }
  }

  const positionCounts = allRows.reduce((counts,row)=>({ ...counts,[row.position]:(counts[row.position]||0)+1 }),{});
  const missingCore = ["QB","RB","WR","TE"].filter((position)=>(positionCounts[position]||0)<10);
  if (missingCore.length) {
    if (!KEEP_OPEN) await browser.close();
    throw new Error(`CBS returned an incomplete projection table (${Object.entries(positionCounts).map(([position,count])=>`${position} ${count}`).join(", ") || "no rows"}). Refusing to overwrite the cache.`);
  }

  if (!KEEP_OPEN) await browser.close();

  // Build JSON (same shape as ESPN/CSV)
  const by_id = {};
  const by_name = {};
  const rows = [];

  for (const r of allRows) {
    const player_id = "";
    const { name, team, position, points } = r;

    rows.push({ player_id, name, team, position, points });

    if (name) {
      const key1 = name.toLowerCase().replace(/\s+/g, "");
      const key2 = name.toLowerCase().replace(/[^a-z0-9 ]/g, "")
                    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
                    .replace(/\s+/g, " ").trim();
      by_name[key1] = points;
      by_name[key2] = points;
    }
  }

  const out = {
    updated: new Date().toISOString(),
    season: CURRENT_SEASON,
    source: "CBS",
    count: rows.length,
    rows,
    by_id,
    by_name,
  };

  fs.writeFileSync(CBS_PROJ_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✅ projections_cbs_${CURRENT_SEASON}.json written (${rows.length} rows).`);
}





// ---------- Interactive menu ----------
(async () => {
  try {
    if (process.argv.includes("--archive-only")) {
      archiveUpdatedValues();
      return;
    }
    if (process.argv.includes("--normalize-picks-only")) {
      console.log("🧮 Normalizing current-year pick slots in existing value caches...");
      normalizeCalculatedPickSlots(["fc","dp","ktc","fn","idp","idpshow","sp"]);
      return;
    }
    const onlyArg = process.argv.find((arg)=>arg.startsWith("--only="));
    const dailySources = ["fc","dp","ktc","fn","fp","fantasypros_ecr","idp","idpshow","sp","proj","sleeper_proj","fantasysharks_proj","draftsharks_proj","fantasypros_proj","espn_proj","cbs_proj","arsenal_proj"];
    const requestedSources = process.argv.includes("--daily") ? dailySources : onlyArg ? onlyArg.slice("--only=".length).split(",").map((value)=>value.trim()).filter(Boolean) : null;
    const { sources } = requestedSources ? { sources:requestedSources } : await inquirer.prompt([
      {
        type: "checkbox",
        name: "sources",
        message: "Which values do you want to update?",
        choices: [
          { name: "FantasyCalc", value: "fc" },
          { name: "DynastyProcess", value: "dp" },
          { name: "KeepTradeCut (KTC)", value: "ktc" },
          { name: "FantasyNavigator", value: "fn" },
          { name: "FantasyPros (official public dynasty charts)", value: "fp" },
          { name: "FantasyPros ECR Rank Score (8 unique official API ranking boards)", value: "fantasypros_ecr" },
          { name: "IDynastyP", value: "idp" },
          { name: "The IDP Show", value: "idpshow" },
          { name: "StickyPicky (averaged)", value: "sp" },
          { name: "Bye Weeks (auto)", value: "byes" },
          { name: "Projections (CSV ➜ JSON)", value: "proj" },
          { name: "Sleeper Projections (undocumented API)", value: "sleeper_proj" },
          { name: "FantasySharks Projections (first-party CSV)", value: "fantasysharks_proj" },
          { name: "DraftSharks Projections + Analysis (first-party table feed)", value: "draftsharks_proj" },
          { name: "FantasyPros Projections (official API · STD/Half/PPR)", value: "fantasypros_proj" },
          { name: "The Fantasy Arsenal Projections (calculated average)", value: "arsenal_proj" },
          { name: "ESPN Projections (scrape)", value: "espn_proj" },
          { name: "CBS Projections (scrape)", value: "cbs_proj" },

        ],
        validate: (input) => (input.length === 0 ? "Please select at least one." : true),
      },
    ]);

    console.log(`\n🚀 Starting update of ${sources.length} selected sources...\n`);

    const updateTasks = [
      { key: "fc", name: "FantasyCalc", fn: updateFantasyCalc },
      { key: "dp", name: "DynastyProcess", fn: updateDynastyProcess },
      { key: "ktc", name: "KeepTradeCut", fn: updateKTC },
      { key: "fn", name: "FantasyNavigator", fn: updateFantasyNavigator },
      { key: "fp", name: "FantasyPros", fn: updateFantasyPros },
      { key: "fantasypros_ecr", name: "FantasyPros ECR Rank Score", fn: updateFantasyProsECR },
      { key: "idp", name: "IDynastyP", fn: updateIDynastyP },
      { key: "idpshow", name: "The IDP Show", fn: updateIDPShow },
      { key: "sp", name: "StickyPicky", fn: updateStickyPicky },
      { key: "byes", name: "Bye Weeks", fn: updateByeWeeksAuto },
      { key: "proj", name: "Projections", fn: updateProjectionsFromCSV },
      { key: "sleeper_proj", name: "Sleeper Projections", fn: updateSleeperProjections },
      { key: "fantasysharks_proj", name: "FantasySharks Projections", fn: updateFantasySharksProjections },
      { key: "draftsharks_proj", name: "DraftSharks Projections", fn: updateDraftSharksProjections },
      { key: "fantasypros_proj", name: "FantasyPros Projections", fn: updateFantasyProsProjections },
      { key: "espn_proj", name: "ESPN Projections", fn: updateESPNProjections },
      { key: "cbs_proj", name: "CBS Projections", fn: updateCBSProjections },
      { key: "arsenal_proj", name: "The Fantasy Arsenal Projections", fn: updateArsenalProjections },
    ];

    let completed = 0;
    let attempted = 0;
    const failed = [];

    for (const task of updateTasks) {
      if (sources.includes(task.key)) {
        attempted++;
        try {
          console.log(`\n[${attempted}/${sources.length}] Updating ${task.name}...`);
          await task.fn();
          recordSourceFreshness(task, "success");
          completed++;
          logProgress(`✅ ${task.name} completed`, completed, sources.length);
        } catch (error) {
          if (!error?.message) error = new Error(String(error || "Unknown error"));
          console.error(`❌ ${task.name} failed:`, error.message);
          recordSourceFreshness(task, "failed", error.message);
          failed.push(task.name);
          // Continue with other tasks rather than stopping completely
        }
      }
    }

    applyValueOverridesToAllCaches();
    writeValueCacheVersion();
    normalizeCalculatedPickSlots(sources);
    if (process.argv.includes("--archive") || process.argv.includes("--daily")) {
      if (failed.length && !process.argv.includes("--daily")) {
        throw new Error(`Archive skipped because these updates failed: ${failed.join(", ")}`);
      }
      if (completed === 0) throw new Error("Archive skipped because no sources updated successfully.");
      archiveUpdatedValues(failed);
    }

    console.log(`\n🎉 Update process completed!`);
    console.log(`   ✅ Successful: ${completed}/${sources.length}`);
    if (failed.length > 0) {
      console.log(`   ❌ Failed: ${failed.join(', ')}`);
      console.log(`   💡 Some sources failed but others completed successfully.`);
    } else {
      console.log(`   ✨ All selected sources updated successfully!`);
    }
  } catch (err) {
    console.error("❌ Failed to update trade calc data:", err?.message || err);
    process.exit(1);
  }
})();
