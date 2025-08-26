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

// Output paths
const FC_OUT_PATH = path.join(__dirname, "../public/fantasycalc_cache.json");
const DP_OUT_PATH = path.join(__dirname, "../public/dynastyprocess_cache.json");
const KTC_OUT_PATH = path.join(__dirname, "../public/ktc_cache.json");
const FN_OUT_PATH = path.join(__dirname, "../public/fantasynav_cache.json");
const IDP_OUT_PATH = path.join(__dirname, "../public/idynastyp_cache.json");
const SP_OUT_PATH  = path.join(__dirname, "../public/stickypicky_cache.json");

// FantasyCalc combinations
const combinations = [
  { isDynasty: true, numQbs: 1, key: "Dynasty_1QB" },
  { isDynasty: true, numQbs: 2, key: "Dynasty_SF" },
  { isDynasty: false, numQbs: 1, key: "Redraft_1QB" },
  { isDynasty: false, numQbs: 2, key: "Redraft_SF" },
];

// ✅ Close popup if it appears
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

// ---------- StickyPicky helpers ----------
const normName = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

// rank -> percentile in [0,1]
function percentilesFromList(items, getVal) {
  const vals = items.map(getVal).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length === 0) return () => 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const N = sorted.length;
  return (v) => {
    if (!Number.isFinite(v) || v <= 0) return 0;
    // position where v would be inserted
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    // rank percentile (0..1). Using (lo-1) to give equal values same pct.
    if (N === 1) return 1;
    return Math.max(0, Math.min(1, (lo - 1) / (N - 1)));
  };
}

function pickMeta(metaSources) {
  // prefer richer meta: FC -> FN -> DP -> KTC
  for (const m of metaSources) {
    if (m && (m.team || m.position)) return m;
  }
  return { team: "", position: "" };
}


// ✅ Scrape KTC rankings (Superflex or 1QB)
async function scrapeKTC(superflex = true) {
  console.log(`\nScraping KTC rankings (${superflex ? "Superflex" : "1QB"})...`);
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  await page.goto("https://keeptradecut.com/dynasty-rankings", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await closePopupIfPresent(page);

  await page.waitForSelector(".sf-toggle-wrapper.superflex .sf-toggle", { timeout: 10000 });
  await page.evaluate((superflex) => {
    const toggle = document.querySelector(".sf-toggle-wrapper.superflex .sf-toggle");
    const isActive = toggle?.classList.contains("active");
    if (toggle) {
      if (superflex && !isActive) {
        toggle.click(); // turn ON for SF
      } else if (!superflex && isActive) {
        toggle.click(); // turn OFF for 1QB
      }
    }
  }, superflex);
  await new Promise((r) => setTimeout(r, 1500));

  const allPlayers = [];
  const options = await page.$$eval("#ranking-pagination-dropdown option", (opts) =>
    opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
  );

  for (const opt of options) {
    await page.select("#ranking-pagination-dropdown", opt.value);
    await page.waitForSelector("#rankings-page-rankings .onePlayer", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));

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

  await browser.close();
  console.log(`✅ Collected ${allPlayers.length} players (${superflex ? "SF" : "1QB"})`);
  return allPlayers;
}

// ✅ Update FantasyCalc
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

// ✅ Update DynastyProcess
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

// ✅ Update KTC
async function updateKTC() {
  const ktc_sf = await scrapeKTC(true);  // ✅ SF first
  const ktc_1qb = await scrapeKTC(false); // ✅ 1QB second
  const ktcData = {
    Superflex: ktc_sf,
    OneQB: ktc_1qb,
    updated: new Date().toISOString(),
  };

  fs.writeFileSync(KTC_OUT_PATH, JSON.stringify(ktcData, null, 2));
  console.log("✅ ktc_cache.json updated.");
}

// ✅ Update FantasyNavigator (download & parse 4 CSVs)

async function updateFantasyNavigator() {
  const FN_OUT_PATH = path.join(__dirname, "../public/fantasynav_cache.json");
  const url = "https://fantasy-navigator-latest.onrender.com/ranks?platform=sf";

  console.log("Fetching FantasyNavigator data:", url);
  const res = await axios.get(url);
  const data = res.data;

  if (!Array.isArray(data)) {
    throw new Error("Unexpected FantasyNavigator response format.");
  }

  // Organize into four categories
  const results = {
    Dynasty_SF: [],
    Dynasty_1QB: [],
    Redraft_SF: [],
    Redraft_1QB: [],
  };

  data.forEach((row) => {
    const name = row.player_full_name?.trim();
    const position = row._position || "";
    const team = row.team || "";
    const value = Number(row.player_value) || 0;
    const rankType = row.rank_type; // dynasty | redraft
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

  fs.writeFileSync(FN_OUT_PATH, JSON.stringify(results, null, 2));
  console.log("✅ fantasynav_cache.json updated.");
}


// ✅ Update IDynastyP
async function updateIDynastyP() {
  const idpUrl = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLhvQECWwDmYCHgmBpi0kD7buPur9ToFc6ssnEqrFLAH24azxxAHP8jO7p0PSq6J6UkZrK0drR0-qnxmBnf2NSFW8s9cQ59sryzufM0iYCM-ZnOF9GidRgV3TUNKq8edwkDaJsm9t-hS7BOsYFIHMfN0GKNyBYzKU45mPR1NIEgk1-2HfDh5wevSPCe8FKmvxEU6u0QBtkD9d6aCV9j22mWF5tsMSdiEbpX80Axls6d06EPOoaSkscgi4yO8ds5zHarOCYIJgEgAzqH2XN0B2RM9tjkg9A&lib=MknHs2mWMhCl6DOSqHwTywMicp6k4geWO";

  console.log("Fetching IDynastyP data:", idpUrl);
  const res = await axios.get(idpUrl);
  const data = res.data;

  if (!data || !data.Sheet1) {
    throw new Error("Unexpected IDynastyP response format.");
  }

  // Combine all sheets (players and picks)
  const combined = [...(data.Sheet1 || []), ...(data.Sheet2 || []), ...(data.Sheet3 || [])];

  const normalized = combined.map((row) => ({
    name: row.name || "",
    team: row.team || "",
    position: row.position || "",
    one_qb: Number(row.value_1qb) || 0,
    superflex: Number(row.value_sf) || 0,
    // Optional: keep TEP and SFTEP if needed later
  }));

  fs.writeFileSync(IDP_OUT_PATH, JSON.stringify(normalized, null, 2));
  console.log(`✅ idynastyp_cache.json updated with ${normalized.length} entries.`);
}

// ✅ Build StickyPicky by averaging normalized (percentile) scores across sources
async function updateStickyPicky() {
  console.log("\nBuilding StickyPicky (averaged, scale-free)…");

  // Load existing caches from /public
  const fcData  = JSON.parse(fs.readFileSync(FC_OUT_PATH,  "utf-8"));
  const dpData  = JSON.parse(fs.readFileSync(DP_OUT_PATH,  "utf-8"));
  const ktcData = JSON.parse(fs.readFileSync(KTC_OUT_PATH, "utf-8"));
  const fnData  = JSON.parse(fs.readFileSync(FN_OUT_PATH,  "utf-8"));
  const idpData = JSON.parse(fs.readFileSync(IDP_OUT_PATH, "utf-8"));

  // Build per-format tables { name -> { value, team, position } } for each source
  const tables = {
    Dynasty_SF:    { FC: {}, FN: {}, KTC: {}, DP: {}, IDP: {} },
    Dynasty_1QB:   { FC: {}, FN: {}, KTC: {}, DP: {}, IDP: {} },
    Redraft_SF:    { FC: {}, FN: {}, /* KTC/DP not redraft */ },
    Redraft_1QB:   { FC: {}, FN: {} },
  };

  // --- FantasyCalc -> 4 formats ---
  for (const key of ["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"]) {
    (fcData[key] || []).forEach((row) => {
      const name = row.player?.name || row.name; // schema from cache
      const team = row.player?.maybeTeam || row.team || "";
      const position = (row.player?.position || row.position || "").replace(/\d+$/, "").trim();
      tables[key].FC[normName(name)] = { name, value: row.value || 0, team, position };
    });
  }

  // --- FantasyNavigator -> 4 formats ---
  for (const key of ["Dynasty_SF","Dynasty_1QB","Redraft_SF","Redraft_1QB"]) {
    (fnData[key] || []).forEach((row) => {
      tables[key].FN[normName(row.name)] = {
        name: row.name, value: row.value || 0, team: row.team || "", position: row.position || ""
      };
    });
  }

  // --- KeepTradeCut -> dynasty only ---
  (ktcData.Superflex || []).forEach((p) => {
    tables.Dynasty_SF.KTC[normName(p.name)] = { name: p.name, value: p.value || 0, team: p.team || "", position: p.position || "" };
  });
  (ktcData.OneQB || []).forEach((p) => {
    tables.Dynasty_1QB.KTC[normName(p.name)] = { name: p.name, value: p.value || 0, team: p.team || "", position: p.position || "" };
  });

  // --- DynastyProcess -> dynasty only ---
  Object.entries(dpData || {}).forEach(([name, v]) => {
    const nn = normName(name);
    if (v?.superflex) tables.Dynasty_SF.DP[nn]  = { name, value: v.superflex, team: v.team || "", position: v.pos || "" };
    if (v?.one_qb)   tables.Dynasty_1QB.DP[nn] = { name, value: v.one_qb,   team: v.team || "", position: v.pos || "" };
  });

  // --- IDynastyP -> dynasty only (defense included) ---
  (idpData || []).forEach((row) => {
    const nn = normName(row.name);
    if (row.superflex) tables.Dynasty_SF.IDP[nn]  = { name: row.name, value: row.superflex, team: row.team || "", position: row.position || "" };
    if (row.one_qb)   tables.Dynasty_1QB.IDP[nn] = { name: row.name, value: row.one_qb,     team: row.team || "", position: row.position || "" };
  });

  // Normalize (rank-percentile) per source+format; then average per player
  const out = { Dynasty_SF: [], Dynasty_1QB: [], Redraft_SF: [], Redraft_1QB: [] };

  for (const formatKey of Object.keys(out)) {
    const sources = tables[formatKey];
    const sourceKeys = Object.keys(sources);

    // Build percentile functions per source on that format
    const pctFns = {};
    for (const S of sourceKeys) {
      const rows = Object.values(sources[S]);
      pctFns[S] = percentilesFromList(rows, (r) => r.value);
    }

    // union of player names across available sources for the format
    const nameSet = new Set();
    for (const S of sourceKeys) Object.keys(sources[S]).forEach((nn) => nameSet.add(nn));

    for (const nn of nameSet) {
      const perSource = sourceKeys
        .map((S) => sources[S][nn])
        .filter(Boolean);

      // average of available percentiles
      const pcts = perSource.map((r, i) => {
        const S = sourceKeys[sourceKeys.findIndex((s) => sources[s][nn] === r)];
        return pctFns[S](r.value);
      });
      if (pcts.length === 0) continue;

      const avgPct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      const stickyValue = Math.round(avgPct * 10000);

      // choose best meta
      const meta = pickMeta(
        [
          sources.FC?.[nn],
          sources.FN?.[nn],
          sources.DP?.[nn],
          sources.KTC?.[nn],
          sources.IDP?.[nn],
        ].map((x) => (x ? { team: x.team, position: x.position } : null))
      );

      // keep original (pre-normalized) name when available
      const displayName = (sources.FC?.[nn]?.name) || (sources.FN?.[nn]?.name) ||
                          (sources.DP?.[nn]?.name) || (sources.KTC?.[nn]?.name) ||
                          (sources.IDP?.[nn]?.name) || nn;

      out[formatKey].push({
        name: displayName,
        team: meta.team || "",
        position: meta.position || "",
        value: stickyValue,
      });
    }

    // sort descending like other caches
    out[formatKey].sort((a, b) => (b.value - a.value));
  }

  fs.writeFileSync(SP_OUT_PATH, JSON.stringify(out, null, 2));
  console.log("✅ stickypicky_cache.json updated.");
}



// ✅ Interactive menu
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
        ],
        validate: (input) => (input.length === 0 ? "Please select at least one." : true),
      },
    ]);

    console.log("\n✅ Updating selected sources...\n");

    if (sources.includes("fc")) await updateFantasyCalc();
    if (sources.includes("dp")) await updateDynastyProcess();
    if (sources.includes("ktc")) await updateKTC();
    if (sources.includes("fn")) await updateFantasyNavigator();
    if (sources.includes("idp")) await updateIDynastyP();
    if (sources.includes("sp"))  await updateStickyPicky();


    console.log("\n✅ All selected updates completed!");
  } catch (err) {
    console.error("❌ Failed to update trade calc data:", err.message);
    process.exit(1);
  }
})();
