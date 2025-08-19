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
    if (value === undefined || value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(value));
    }
  } catch {}
};
const lsClear = () => {
  if (!isBrowser) return;
  try {
    window.localStorage.clear();
  } catch {}
};

export const SleeperProvider = ({ children }) => {
  // (Changed to lazy initializers so SSR won't touch localStorage)
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

  // Persist a few keys to localStorage on the client
  useEffect(() => { lsSet("username", username); }, [username]);
  useEffect(() => { lsSet("year", year); }, [year]);
  useEffect(() => {
    if (activeLeague) lsSet("activeLeague", activeLeague);
    else lsSet("activeLeague", null);
  }, [activeLeague]);

  useEffect(() => {
    if (username && !preloadCalled.current) {
      preloadCalled.current = true;
      preloadPlayers();
    }
  }, [username]);

  const updateProgress = (value) => setProgress((prev) => Math.min(value, 100));

  /** ✅ Login loads leagues + triggers preload */
  const login = async (uname, yr) => {
    try {
      setLoading(true);
      setProgress(5);
      lsSet("username", uname);
      lsSet("year", yr);
      setUsername(uname);
      setYear(yr);

      const userRes = await fetch(`https://api.sleeper.app/v1/user/${uname}`);
      if (!userRes.ok) throw new Error("User not found");
      const user = await userRes.json();
      updateProgress(20);

      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yr}`
      );
      const leaguesData = await leaguesRes.json();
      setLeagues(leaguesData);
      updateProgress(50);

      console.log("✅ Login loaded leagues:", leaguesData.length);

      if (!preloadCalled.current) {
        preloadCalled.current = true;
        await preloadPlayers();
      }
    } catch (err) {
      console.error("❌ Login error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /** ✅ Player DB caching and merging FC + DP values */
  const CACHE_KEY = "playerDB_v1.14"; // bump version when logic changes

  const preloadPlayers = async () => {
    try {
      setLoading(true);
      setProgress(60);

      const cachedPlayers = await get(CACHE_KEY);
      if (cachedPlayers) {
        console.log("✅ Loaded player DB from cache:", Object.keys(cachedPlayers).length);
        setPlayers(cachedPlayers);
        setProgress(100);
        return;
      }

      const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
      const playersData = await playersRes.json();

      const fcRes = await fetch("/fantasycalc_cache.json");
      const fcData = await fcRes.json();
      const dpRes = await fetch("/dynastyprocess_cache.json");
      const dpData = await dpRes.json();
      const ktcRes = await fetch("/ktc_cache.json");
      const ktcData = await ktcRes.json();
      const fnRes = await fetch("/fantasynav_cache.json");
      const fnData = await fnRes.json();
      const idpRes = await fetch("/idynastyp_cache.json");
      const idpData = await idpRes.json();

      const mapBySleeperId = (arr) => {
        const map = {};
        arr.forEach((item) => {
          const sleeperId = item.player?.sleeperId;
          if (sleeperId) map[sleeperId] = item.value || 0;
        });
        return map;
      };

      const dynastySFMap = mapBySleeperId(fcData.Dynasty_SF || []);
      const dynasty1QBMap = mapBySleeperId(fcData.Dynasty_1QB || []);
      const redraftSFMap = mapBySleeperId(fcData.Redraft_SF || []);
      const redraft1QBMap = mapBySleeperId(fcData.Redraft_1QB || []);

      const normalizeName = (name) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
          .replace(/\s+/g, " ")
          .trim();

      const normalizedDPMap = {};
      Object.keys(dpData).forEach((name) => {
        normalizedDPMap[normalizeName(name)] = dpData[name];
      });

      const normalizedKTCMap = {};
      (ktcData.OneQB || []).forEach((p) => {
        normalizedKTCMap[normalizeName(p.name)] = { one_qb: p.value, superflex: 0 };
      });
      (ktcData.Superflex || []).forEach((p) => {
        const normName = normalizeName(p.name);
        normalizedKTCMap[normName] = normalizedKTCMap[normName] || { one_qb: 0 };
        normalizedKTCMap[normName].superflex = p.value;
      });

      const normalizedFNMap = {};
      ["Dynasty_SF", "Dynasty_1QB", "Redraft_SF", "Redraft_1QB"].forEach((key) => {
        (fnData[key] || []).forEach((p) => {
          normalizedFNMap[normalizeName(p.name)] = {
            ...(normalizedFNMap[normalizeName(p.name)] || {}),
            [key.toLowerCase()]: p.value,
            position: p.position,
            team: p.team,
          };
        });
      });

      const normalizedIDPMap = {};
      (idpData || []).forEach((p) => {
        normalizedIDPMap[normalizeName(p.name)] = {
          one_qb: p.one_qb || 0,
          superflex: p.superflex || 0,
          position: (p.position || "").toUpperCase(),
          team: (p.team || "").toUpperCase(),
        };
      });

      const finalPlayers = {};

      Object.keys(playersData).forEach((id) => {
        const p = playersData[id];
        const normName = normalizeName(p.full_name || `${p.first_name} ${p.last_name}`);
        const pos = (p.position || "").toUpperCase();
        const team = (p.team || "").toUpperCase();
        const idpCandidate = normalizedIDPMap[normName];
        const idp_values =
          idpCandidate
            ? { one_qb: idpCandidate.one_qb, superflex: idpCandidate.superflex }
            : { one_qb: 0, superflex: 0 };

        const fc_values = {
          dynasty_sf: dynastySFMap[id] || 0,
          dynasty_1qb: dynasty1QBMap[id] || 0,
          redraft_sf: redraftSFMap[id] || 0,
          redraft_1qb: redraft1QBMap[id] || 0,
        };

        const dpCandidate = normalizedDPMap[normName];
        const dp_values = dpCandidate && dpCandidate.pos === pos ? dpCandidate : { one_qb: 0, superflex: 0 };

        const ktcCandidate = normalizedKTCMap[normName];
        const ktc_values =
          ktcCandidate && ["QB", "RB", "WR", "TE"].includes(pos) ? ktcCandidate : { one_qb: 0, superflex: 0 };

        const fnCandidate = normalizedFNMap[normName];
        const fn_values =
          fnCandidate && fnCandidate.position === pos && (!fnCandidate.team || fnCandidate.team === team)
            ? fnCandidate
            : { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0 };

        if (
          Object.values(fc_values).some((v) => v > 0) ||
          Object.values(dp_values).some((v) => v > 0) ||
          Object.values(ktc_values).some((v) => v > 0) ||
          Object.values(fn_values).some((v) => v > 0) ||
          Object.values(idp_values).some((v) => v > 0)
        ) {
          finalPlayers[id] = { ...p, fc_values, dp_values, ktc_values, fn_values, idp_values };
        }
      });

      // 🚨🚨 STEP 2 - Explicitly Add Draft Picks 🚨🚨
      const addDraftPick = (name, source, values) => {
        const syntheticId = `pick_${normalizeName(name)}`;

        if (!finalPlayers[syntheticId]) {
          finalPlayers[syntheticId] = {
            player_id: syntheticId,
            full_name: name,
            position: "PICK",
            team: "",
            fc_values: { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0 },
            dp_values: { one_qb: 0, superflex: 0 },
            ktc_values: { one_qb: 0, superflex: 0 },
            fn_values: { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0 },
            idp_values: { one_qb: 0, superflex: 0 },
            sources: [source],
            aliases: [name],
          };
        } else if (!finalPlayers[syntheticId].sources.includes(source)) {
          finalPlayers[syntheticId].sources.push(source);
        }

        if (source === "fc") finalPlayers[syntheticId].fc_values = { ...finalPlayers[syntheticId].fc_values, ...values };
        if (source === "dp") finalPlayers[syntheticId].dp_values = { ...finalPlayers[syntheticId].dp_values, ...values };
        if (source === "ktc") finalPlayers[syntheticId].ktc_values = { ...finalPlayers[syntheticId].ktc_values, ...values };
        if (source === "idp")
          finalPlayers[syntheticId].idp_values = {
            ...(finalPlayers[syntheticId].idp_values || { one_qb: 0, superflex: 0 }),
            ...values,
          };
      };

      // ✅ Build normalized FantasyCalc map first (combine all values)
      const normalizedFCMap = {};
      const addFCValue = (name, key, value) => {
        const norm = normalizeName(name);
        if (!normalizedFCMap[norm]) {
          normalizedFCMap[norm] = {
            originalName: name,
            dynasty_sf: 0,
            dynasty_1qb: 0,
            redraft_sf: 0,
            redraft_1qb: 0,
          };
        }
        if (key === "Dynasty_SF") normalizedFCMap[norm].dynasty_sf = value || 0;
        if (key === "Dynasty_1QB") normalizedFCMap[norm].dynasty_1qb = value || 0;
        if (key === "Redraft_SF") normalizedFCMap[norm].redraft_sf = value || 0;
        if (key === "Redraft_1QB") normalizedFCMap[norm].redraft_1qb = value || 0;
      };

      // Collect FC values into one structure
      ["Dynasty_SF", "Dynasty_1QB", "Redraft_SF", "Redraft_1QB"].forEach((key) => {
        (fcData[key] || []).forEach((item) => {
          const name = item.player?.name;
          if (name) addFCValue(name, key, item.value);
        });
      });

      // Add combined FC picks to finalPlayers
      Object.keys(normalizedFCMap).forEach((normName) => {
        const pick = normalizedFCMap[normName];
        const matchedSleeper = Object.values(playersData).some(
          (p) => p.full_name && normalizeName(p.full_name) === normName
        );

        if (!matchedSleeper && /pick|round/.test(normName) && Object.values(pick).some((v) => v > 0)) {
          addDraftPick(pick.originalName, "fc", {
            dynasty_sf: pick.dynasty_sf,
            dynasty_1qb: pick.dynasty_1qb,
            redraft_sf: pick.redraft_sf,
            redraft_1qb: pick.redraft_1qb,
          });
        }
      });

      Object.keys(dpData).forEach((name) => {
        const normName = normalizeName(name);
        const matchedSleeper = Object.values(playersData).some(
          (p) => p.full_name && normalizeName(p.full_name) === normName
        );
        if (!matchedSleeper && /pick|early|mid|late|round/.test(normName)) {
          addDraftPick(name, "dp", { one_qb: dpData[name].one_qb, superflex: dpData[name].superflex });
        }
      });

      Object.keys(normalizedKTCMap).forEach((normName) => {
        const matchedSleeper = Object.values(playersData).some(
          (p) => p.full_name && normalizeName(p.full_name) === normName
        );
        if (!matchedSleeper && /pick|early|mid|late|round/.test(normName)) {
          addDraftPick(normName, "ktc", normalizedKTCMap[normName]);
        }
      });

      Object.keys(normalizedIDPMap).forEach((normName) => {
        const matchedSleeper = Object.values(playersData).some(
          (p) => p.full_name && normalizeName(p.full_name) === normName
        );
        if (!matchedSleeper && /pick|early|mid|late|round/.test(normName)) {
          addDraftPick(normName, "idp", {
            one_qb: normalizedIDPMap[normName].one_qb,
            superflex: normalizedIDPMap[normName].superflex,
          });
        }
      });

      await set(CACHE_KEY, finalPlayers);
      setPlayers(finalPlayers);
      setProgress(100);
    } catch (err) {
      console.error("❌ Player preload error:", err);
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

      const updatedLeagues = leagues.map((lg) =>
        lg.league_id === leagueId ? { ...lg, rosters, users } : lg
      );
      setLeagues(updatedLeagues);
      updateProgress(100);
      console.log(`✅ Loaded rosters for league ${leagueId}`);
    } catch (err) {
      console.error("❌ Roster fetch error:", err);
    } finally {
      setLoading(false);
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
        loading,
        progress,
        error,
      }}
    >
      {children}
    </SleeperContext.Provider>
  );
};
