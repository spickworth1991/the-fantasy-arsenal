// scripts/updateValues.js

import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";
import { fileURLToPath } from "url";

// For __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FC_OUT_PATH = path.join(__dirname, "../public/fantasycalc_cache.json");
const DP_OUT_PATH = path.join(__dirname, "../public/dynastyprocess_cache.json");

const combinations = [
  { isDynasty: true, numQbs: 1, key: "Dynasty_1QB" },
  { isDynasty: true, numQbs: 2, key: "Dynasty_SF" },
  { isDynasty: false, numQbs: 1, key: "Redraft_1QB" },
  { isDynasty: false, numQbs: 2, key: "Redraft_SF" },
];

(async () => {
  try {
    const results = {};

    // ✅ Fetch FantasyCalc values
    for (const { isDynasty, numQbs, key } of combinations) {
      const url = `https://api.fantasycalc.com/values/current?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=12&ppr=1`;
      console.log("Fetching FantasyCalc:", url);
      const res = await axios.get(url);
      results[key] = res.data;
    }

    fs.writeFileSync(FC_OUT_PATH, JSON.stringify(results, null, 2));
    console.log("✅ fantasycalc_cache.json updated.");

    // ✅ Fetch DynastyProcess values
    const dpUrl = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
    console.log("Fetching DynastyProcess:", dpUrl);
    const dpRes = await axios.get(dpUrl);

    // ✅ Parse CSV
    const parsed = Papa.parse(dpRes.data, { header: true }).data;

    // ✅ Convert to JSON map
    const dpValues = {};
    parsed.forEach(row => {
      if (!row.player || (!row.value_1qb && !row.value_2qb)) return;
      const nameKey = row.player.trim();
      dpValues[nameKey] = {
        pos: row.pos || "",
        team: row.team || "",
        one_qb: Number(row.value_1qb) || 0,
        superflex: Number(row.value_2qb) || 0
      };
    });

    fs.writeFileSync(DP_OUT_PATH, JSON.stringify(dpValues, null, 2));
    console.log("✅ dynastyprocess_cache.json updated.");

  } catch (err) {
    console.error("❌ Failed to update trade calc data:", err.message);
    process.exit(1);
  }
})();
