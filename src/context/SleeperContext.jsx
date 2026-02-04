"use client";

import { createContext, useRef, useContext, useState, useEffect } from "react";
import { get, set } from "idb-keyval";

const SleeperContext = createContext();
export const useSleeper = () => useContext(SleeperContext);

// ---- SSR-safe localStorage helpers (no-ops on server) ----
const isBrowser = typeof window !== "undefined";
const lsGet = (key, fallback = null) => {
  if (!isBrowser) return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const lsSet = (key, value) => {
  if (!isBrowser) return;
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {}
};
const lsClear = () => {
  if (!isBrowser) return;
  try {
    window.localStorage.clear();
  } catch {}
};

// ---- Normalization helpers ----
const normalizeName = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normPos = (pos) => String(pos || "").toUpperCase().trim();
const normTeam = (team) => String(team || "").toUpperCase().trim();
const keyName = (n) => normalizeName(n);

// Safe number (handles "123", null, etc)
const safeNum = (v) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

// Formats that exist in FN/SP caches
const VALUE_KEYS = ["dynasty_sf", "dynasty_1qb", "redraft_sf", "redraft_1qb"];

// Sleeper positions you typically want values for.
// NOTE: we still use fantasy_positions as the main “is fantasy relevant” gate.
const FANTASY_RELEVANT = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF", // team D/ST on sleeper
  // common IDP slots / labels
  "DL",
  "LB",
  "DB",
  "IDP",
  // some sources may use these
  "DE",
  "DT",
  "EDGE",
  "CB",
  "S",
]);

function getSleeperFantasyPosSet(p) {
  const set = new Set();
  const fp = Array.isArray(p?.fantasy_positions) ? p.fantasy_positions : [];
  fp.forEach((x) => set.add(normPos(x)));
  const pos = normPos(p?.position);
  if (pos) set.add(pos);
  return set;
}

// Some Sleeper records (notably dup-name entries) can have an empty `position`
// while still having `fantasy_positions`. Use a stable primary position so
// name-based matching can safely enforce pos compatibility.
function getPrimaryPos(p) {
  const pos = normPos(p?.position);
  if (pos) return pos;

  const fp = Array.isArray(p?.fantasy_positions) ? p.fantasy_positions : [];
  // Prefer a fantasy-relevant slot if present.
  for (const x of fp) {
    const nx = normPos(x);
    if (nx && FANTASY_RELEVANT.has(nx)) return nx;
  }
  // Fall back to the first non-empty.
  for (const x of fp) {
    const nx = normPos(x);
    if (nx) return nx;
  }
  return "";
}

function isFantasyRelevantSleeperPlayer(p) {
  const set = getSleeperFantasyPosSet(p);
  for (const x of set) {
    if (FANTASY_RELEVANT.has(x)) return true;
  }
  return false;
}

// ---- Candidate-based matching (prevents name-only collisions) ----
function createCandidateIndex4() {
  // nameKey -> array of candidates: { pos, team, values: {dynasty_sf,...} }
  const byName = Object.create(null);

  function addCandidate({ name, pos, team, values }) {
    const nn = keyName(name);
    if (!nn) return;

    const cand = {
      pos: normPos(pos),
      team: normTeam(team),
      values: {},
    };

    VALUE_KEYS.forEach((k) => {
      cand.values[k] = safeNum(values?.[k]);
    });

    const hasAny = VALUE_KEYS.some((k) => cand.values[k] > 0);
    if (!hasAny) return;

    if (!byName[nn]) byName[nn] = [];
    byName[nn].push(cand);
  }

  function pickBest(name, pos, team) {
    const nn = keyName(name);
    if (!nn) return null;

    const cands = byName[nn];
    if (!Array.isArray(cands) || cands.length === 0) return null;

    const pos0 = normPos(pos);
    const team0 = normTeam(team);

    // Collision guard: if ANY candidates have a declared position and the Sleeper
    // player has a position, require an exact position match.
    //
    // This prevents name-only collisions where a different-position player with
    // the same name (e.g. Kenneth Walker RB vs a Kenneth Walker WR) can steal
    // values from sources that don't have Sleeper IDs.
    const anyCandHasPos = pos0 ? cands.some((c) => !!c.pos) : false;
    const candidatesToScore = anyCandHasPos ? cands.filter((c) => c.pos === pos0) : cands;
    if (anyCandHasPos && candidatesToScore.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const c of candidatesToScore) {
      const candPos = c.pos;
      const candTeam = c.team;

      // Hard guard: if candidate declares pos and sleeper pos exists, must match.
      if (candPos && pos0 && candPos !== pos0) continue;

      let score = 0;
      if (candPos && pos0 && candPos === pos0) score += 80;
      if (candTeam && team0 && candTeam === team0) score += 20;
      if (!candPos && candTeam && team0 && candTeam === team0) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore >= 0 ? best : null;
  }

  return { addCandidate, pickBest, raw: byName };
}

function createCandidateIndex2() {
  // nameKey -> array of candidates: { pos, team, one_qb, superflex }
  const byName = Object.create(null);

  function addCandidate({ name, pos, team, one_qb, superflex }) {
    const nn = keyName(name);
    if (!nn) return;

    const cand = {
      pos: normPos(pos),
      team: normTeam(team),
      one_qb: safeNum(one_qb),
      superflex: safeNum(superflex),
    };

    if (!(cand.one_qb > 0 || cand.superflex > 0)) return;

    if (!byName[nn]) byName[nn] = [];
    byName[nn].push(cand);
  }

  function pickBest(name, pos, team) {
    const nn = keyName(name);
    if (!nn) return null;

    const cands = byName[nn];
    if (!Array.isArray(cands) || cands.length === 0) return null;

    const pos0 = normPos(pos);
    const team0 = normTeam(team);

    // Collision guard: if the source provides positions for any candidates and
    // the Sleeper player has a position, only consider candidates with an exact
    // position match. If none match, return null (don't mis-assign values).
    const anyCandHasPos = pos0 ? cands.some((c) => !!c.pos) : false;
    const candidatesToScore = anyCandHasPos ? cands.filter((c) => c.pos === pos0) : cands;
    if (anyCandHasPos && candidatesToScore.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const c of candidatesToScore) {
      const candPos = c.pos;
      const candTeam = c.team;

      if (candPos && pos0 && candPos !== pos0) continue;

      let score = 0;
      if (candPos && pos0 && candPos === pos0) score += 80;
      if (candTeam && team0 && candTeam === team0) score += 20;
      if (!candPos && candTeam && team0 && candTeam === team0) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore >= 0 ? best : null;
  }

  return { addCandidate, pickBest, raw: byName };
}

export const SleeperProvider = ({ children }) => {
  const [username, setUsername] = useState(() => lsGet("username", null));
  const [year, setYear] = useState(() => {
    const y = lsGet("year");
    return y != null && y !== "" ? Number(y) : new Date().getFullYear();
  });

  const [players, setPlayers] = useState({});
  const [leagues, setLeagues] = useState([]);
  const [format, setFormat] = useState("dynasty");
  const [qbType, setQbType] = useState("sf");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [activeLeague, setActiveLeague] = useState(() => lsGet("activeLeague", null));

  const preloadCalled = useRef(false);

  useEffect(() => {
    lsSet("username", username);
  }, [username]);
  useEffect(() => {
    lsSet("year", year);
  }, [year]);
  useEffect(() => {
    if (activeLeague) lsSet("activeLeague", activeLeague);
    else lsSet("activeLeague", null);
  }, [activeLeague]);

  useEffect(() => {
    if (username && !preloadCalled.current) {
      preloadCalled.current = true;
      preloadPlayers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const updateProgress = (value) => setProgress((prev) => Math.min(value, 100));

  const login = async (uname, yr) => {
    try {
      setLoading(true);
      setProgress(5);
      setError("");

      lsSet("username", uname);
      lsSet("year", yr);
      setUsername(uname);
      setYear(yr);

      const userRes = await fetch(`https://api.sleeper.app/v1/user/${uname}`);
      if (!userRes.ok) throw new Error("User not found");
      const user = await userRes.json();
      updateProgress(20);

      const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yr}`);
      const leaguesData = await leaguesRes.json();
      setLeagues(Array.isArray(leaguesData) ? leaguesData : []);
      updateProgress(50);

      if (!preloadCalled.current) {
        preloadCalled.current = true;
        await preloadPlayers();
      }
    } catch (err) {
      console.error("❌ Login error:", err);
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ Player DB caching and merging:
   * - FantasyCalc: match by Sleeper ID
   * - DP/KTC: strict position match
   * - FN/SP: candidate-based (pos compatible required)
   * - iDynastyP: candidate-based -> idp_values stays {one_qb, superflex}
   */
  const CACHE_KEY = "playerDB_v1.25"; // bump to invalidate old cache

  const preloadPlayers = async () => {
    try {
      setLoading(true);
      setProgress(60);
      setError("");

      const cachedPlayers = await get(CACHE_KEY);
      if (cachedPlayers && typeof cachedPlayers === "object") {
        console.log("✅ Loaded player DB from cache:", Object.keys(cachedPlayers).length);
        setPlayers(cachedPlayers);
        setProgress(100);
        return;
      }

      // 1) Sleeper players
      const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
      const playersData = await playersRes.json();
      updateProgress(68);

      // 2) Value/projection caches
      const [fcRes, dpRes, ktcRes, fnRes, idpRes, spRes] = await Promise.all([
        fetch("/fantasycalc_cache.json"),
        fetch("/dynastyprocess_cache.json"),
        fetch("/ktc_cache.json"),
        fetch("/fantasynav_cache.json"),
        fetch("/idynastyp_cache.json"),
        fetch("/stickypicky_cache.json"),
      ]);

      const [fcData, dpData, ktcData, fnData, idpData, spData] = await Promise.all([
        fcRes.json(),
        dpRes.json(),
        ktcRes.json(),
        fnRes.json(),
        idpRes.json(),
        spRes.json(),
      ]);
      updateProgress(78);

      // ---------- FantasyCalc maps (by Sleeper ID) ----------
      const mapBySleeperId = (arr) => {
        const map = {};
        (Array.isArray(arr) ? arr : []).forEach((item) => {
          const sleeperId = item?.player?.sleeperId;
          if (!sleeperId) return;
          map[String(sleeperId)] = safeNum(item?.value);
        });
        return map;
      };

      const dynastySFMap = mapBySleeperId(fcData?.Dynasty_SF);
      const dynasty1QBMap = mapBySleeperId(fcData?.Dynasty_1QB);
      const redraftSFMap = mapBySleeperId(fcData?.Redraft_SF);
      const redraft1QBMap = mapBySleeperId(fcData?.Redraft_1QB);

      // ---------- DynastyProcess ----------
      const dpByName = {};
      const dpByNamePos = {};
      if (dpData && typeof dpData === "object") {
        Object.keys(dpData).forEach((name) => {
          const v = dpData[name];
          const nn = keyName(name);
          dpByName[nn] = v;
          const p = normPos(v?.pos);
          if (p) dpByNamePos[`${nn}|${p}`] = v;
        });
      }

      // ---------- KTC ----------
      const ktcByName = {};
      const ktcByNamePos = {};
      const ingestKTC = (arr, which) => {
        (Array.isArray(arr) ? arr : []).forEach((p) => {
          const n = keyName(p?.name);
          if (!n) return;

          const pos = normPos(p?.position || p?.pos);
          const value = safeNum(p?.value);

          if (!ktcByName[n]) ktcByName[n] = { one_qb: 0, superflex: 0 };
          if (which === "one_qb") ktcByName[n].one_qb = value;
          if (which === "superflex") ktcByName[n].superflex = value;

          if (pos) {
            const k = `${n}|${pos}`;
            if (!ktcByNamePos[k]) ktcByNamePos[k] = { one_qb: 0, superflex: 0 };
            if (which === "one_qb") ktcByNamePos[k].one_qb = value;
            if (which === "superflex") ktcByNamePos[k].superflex = value;
          }
        });
      };
      ingestKTC(ktcData?.OneQB, "one_qb");
      ingestKTC(ktcData?.Superflex, "superflex");

      // ---------- FantasyNavigator + StickyPicky (4-way candidate indexes) ----------
      const fnIndex = createCandidateIndex4();
      const spIndex = createCandidateIndex4();

      const ingest4WayList = (data, index) => {
        const KEY_MAP = {
          Dynasty_SF: "dynasty_sf",
          Dynasty_1QB: "dynasty_1qb",
          Redraft_SF: "redraft_sf",
          Redraft_1QB: "redraft_1qb",
        };

        Object.keys(KEY_MAP).forEach((k) => {
          const outKey = KEY_MAP[k];
          (Array.isArray(data?.[k]) ? data[k] : []).forEach((row) => {
            const name = row?.name;
            if (!name) return;

            index.addCandidate({
              name,
              pos: row?.position || row?.pos,
              team: row?.team,
              values: { [outKey]: row?.value },
            });
          });
        });
      };

      ingest4WayList(fnData, fnIndex);
      ingest4WayList(spData, spIndex);

      // ---------- iDynastyP (2-way candidate index) ----------
      const idpIndex = createCandidateIndex2();

      // tolerate different schemas / field names
      const idpRows = Array.isArray(idpData)
        ? idpData
        : Array.isArray(idpData?.players)
        ? idpData.players
        : Array.isArray(idpData?.data)
        ? idpData.data
        : [];

      idpRows.forEach((row) => {
        const name = row?.name || row?.player || row?.player_name || row?.full_name;
        if (!name) return;

        const pos = row?.position || row?.pos;
        const team = row?.team || row?.nfl_team;

        const oneQb =
          row?.one_qb ??
          row?.oneQB ??
          row?.oneqb ??
          row?.one_qb_rank ??
          row?.value_one_qb ??
          row?.value_1qb ??
          row?.one_qb_value;

        const sf =
          row?.superflex ??
          row?.sf ??
          row?.super_flex ??
          row?.superflex_rank ??
          row?.value_superflex ??
          row?.value_sf ??
          row?.sf_value;

        idpIndex.addCandidate({
          name,
          pos,
          team,
          one_qb: oneQb,
          superflex: sf,
        });
      });

      // ---------- Helpers ----------
      const getDPValues = (normName0, pos0) => {
        const best = dpByNamePos[`${normName0}|${pos0}`] || dpByName[normName0] || null;
        const dpPos = normPos(best?.pos);
        if (dpPos && dpPos !== pos0) return { one_qb: 0, superflex: 0 };
        return { one_qb: safeNum(best?.one_qb), superflex: safeNum(best?.superflex) };
      };

      const getKTCValues = (normName0, pos0) => {
        const best = ktcByNamePos[`${normName0}|${pos0}`] || ktcByName[normName0] || null;
        return { one_qb: safeNum(best?.one_qb), superflex: safeNum(best?.superflex) };
      };

      const get4WayFromIndex = (index, fullName, pos0, team0) => {
        const cand = index.pickBest(fullName, pos0, team0);
        const v = cand?.values || null;
        return {
          dynasty_sf: safeNum(v?.dynasty_sf),
          dynasty_1qb: safeNum(v?.dynasty_1qb),
          redraft_sf: safeNum(v?.redraft_sf),
          redraft_1qb: safeNum(v?.redraft_1qb),
        };
      };

      const getIDP2FromIndex = (index, fullName, pos0, team0) => {
        const cand = index.pickBest(fullName, pos0, team0);
        return {
          one_qb: safeNum(cand?.one_qb),
          superflex: safeNum(cand?.superflex),
        };
      };

      // ---------- Build final players ----------
      const finalPlayers = {};

      Object.keys(playersData || {}).forEach((id) => {
        const p = playersData[id];
        if (!p) return;

        const fullName = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
        const nn = normalizeName(fullName);
        const pos = getPrimaryPos(p);
        const team = normTeam(p.team);

        const fc_values = {
          dynasty_sf: safeNum(dynastySFMap[id]),
          dynasty_1qb: safeNum(dynasty1QBMap[id]),
          redraft_sf: safeNum(redraftSFMap[id]),
          redraft_1qb: safeNum(redraft1QBMap[id]),
        };

        const fantasyRelevant = isFantasyRelevantSleeperPlayer(p);

        const dp_values = fantasyRelevant ? getDPValues(nn, pos) : { one_qb: 0, superflex: 0 };

        const ktc_values =
          fantasyRelevant && ["QB", "RB", "WR", "TE"].includes(pos)
            ? getKTCValues(nn, pos)
            : { one_qb: 0, superflex: 0 };

        const fn_values = fantasyRelevant
          ? get4WayFromIndex(fnIndex, fullName, pos, team)
          : { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0 };

        const sp_values = fantasyRelevant
          ? get4WayFromIndex(spIndex, fullName, pos, team)
          : { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0 };

        // ✅ iDynastyP stays 2-way
        const idp_values = fantasyRelevant
          ? getIDP2FromIndex(idpIndex, fullName, pos, team)
          : { one_qb: 0, superflex: 0 };

        const keep =
          Object.values(fc_values).some((v) => v > 0) ||
          Object.values(dp_values).some((v) => v > 0) ||
          Object.values(ktc_values).some((v) => v > 0) ||
          Object.values(fn_values).some((v) => v > 0) ||
          Object.values(sp_values).some((v) => v > 0) ||
          Object.values(idp_values).some((v) => v > 0);

        if (keep) {
          finalPlayers[id] = {
            ...p,
            // Ensure consumers see a consistent position even when Sleeper's
            // raw `position` is blank for certain duplicate-name entries.
            position: pos || p.position,
            fc_values,
            dp_values,
            ktc_values,
            fn_values,
            sp_values,
            idp_values,
          };
        }
      });

      updateProgress(95);

      await set(CACHE_KEY, finalPlayers);
      setPlayers(finalPlayers);
      setProgress(100);
    } catch (err) {
      console.error("❌ Player preload error:", err);
      setError("Failed to preload player database.");
    } finally {
      setLoading(false);
    }
  };

  /** ✅ Fetch rosters dynamically for one league */
  const fetchLeagueRosters = async (leagueId) => {
    try {
      setLoading(true);
      setProgress(10);

      const [rostersRes, usersRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      ]);

      const rosters = await rostersRes.json();
      const users = await usersRes.json();

      const updatedLeagues = leagues.map((lg) => (lg.league_id === leagueId ? { ...lg, rosters, users } : lg));
      setLeagues(updatedLeagues);
      updateProgress(100);
    } catch (err) {
      console.error("❌ Roster fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  /** ✅ Silent roster fetch: no global overlay, returns data, still updates context leagues */
  const fetchLeagueRostersSilent = async (leagueId) => {
    try {
      const [rostersRes, usersRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      ]);

      if (!rostersRes.ok) throw new Error(`Rosters fetch failed for ${leagueId}`);
      if (!usersRes.ok) throw new Error(`Users fetch failed for ${leagueId}`);

      const rosters = await rostersRes.json();
      const users = await usersRes.json();

      const updatedLeagues = leagues.map((lg) => (lg.league_id === leagueId ? { ...lg, rosters, users } : lg));
      setLeagues(updatedLeagues);

      return { rosters, users };
    } catch (err) {
      console.error("❌ Silent roster fetch error:", err);
      throw err;
    }
  };

  const logout = () => {
    lsClear();
    setUsername(null);
    setLeagues([]);
    setPlayers({});
    setActiveLeague(null);
    preloadCalled.current = false;
  };

  return (
    <SleeperContext.Provider
      value={{
        username,
        year,
        players,
        leagues,
        activeLeague,
        setActiveLeague,
        format,
        qbType,
        setFormat,
        setQbType,
        login,
        logout,
        fetchLeagueRosters,
        fetchLeagueRostersSilent,
        loading,
        progress,
        error,
      }}
    >
      {children}
    </SleeperContext.Provider>
  );
};
