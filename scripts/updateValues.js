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
// ✅ Update FantasyNavigator
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
          { name: "FantasyNavigator", value: "fn" }, // ✅ New option
        ],
        validate: (input) => (input.length === 0 ? "Please select at least one." : true),
      },
    ]);

    console.log("\n✅ Updating selected sources...\n");

    if (sources.includes("fc")) await updateFantasyCalc();
    if (sources.includes("dp")) await updateDynastyProcess();
    if (sources.includes("ktc")) await updateKTC();
    if (sources.includes("fn")) await updateFantasyNavigator();

    console.log("\n✅ All selected updates completed!");
  } catch (err) {
    console.error("❌ Failed to update trade calc data:", err.message);
    process.exit(1);
  }
})();
