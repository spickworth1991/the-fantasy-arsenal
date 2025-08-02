"use client";
import { createContext, useRef, useContext, useState, useEffect } from "react";
import { get, set } from "idb-keyval";

const SleeperContext = createContext();
export const useSleeper = () => useContext(SleeperContext);

export const SleeperProvider = ({ children }) => {
  const [username, setUsername] = useState(localStorage.getItem("username") || null);
  const [year, setYear] = useState(localStorage.getItem("year") || new Date().getFullYear());
  const [players, setPlayers] = useState({});
  const [leagues, setLeagues] = useState([]);
  const [format, setFormat] = useState("dynasty");
  const [qbType, setQbType] = useState("sf");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [activeLeague, setActiveLeague] = useState(localStorage.getItem("activeLeague") || null);
  const preloadCalled = useRef(false);

  useEffect(() => {
    if (activeLeague) {
      localStorage.setItem("activeLeague", activeLeague);
    }
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
      localStorage.setItem("username", uname);
      localStorage.setItem("year", yr);
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
  const CACHE_KEY = "playerDB_v5.08"; // bump version when logic changes

  const preloadPlayers = async () => {
    try {
      setLoading(true);
      setProgress(60);

      // ✅ Try IndexedDB first
      const cachedPlayers = await get(CACHE_KEY);
      if (cachedPlayers) {
        console.log("✅ Loaded player DB from cache:", Object.keys(cachedPlayers).length);
        setPlayers(cachedPlayers);
        setProgress(100);
        return;
      }

      // ✅ Fetch Sleeper players
      const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
      const playersData = await playersRes.json();

      // ✅ Load local trade value sources
      const fcRes = await fetch("/fantasycalc_cache.json");
      const fcData = await fcRes.json();

      const dpRes = await fetch("/dynastyprocess_cache.json");
      const dpData = await dpRes.json();

      const ktcRes = await fetch("/ktc_cache.json");
      const ktcData = await ktcRes.json();

      const fnRes = await fetch("/fantasynav_cache.json");
      const fnData = await fnRes.json();

      // ✅ FantasyCalc mapping
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

      // ✅ Normalize names for matching
      const normalizeName = (name) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
          .replace(/\s+/g, " ")
          .trim();

      // ✅ Build DP lookup
      const normalizedDPMap = {};
      Object.keys(dpData).forEach((name) => {
        const normName = normalizeName(name);
        normalizedDPMap[normName] = dpData[name];
      });

      // ✅ Build KTC lookup
      const normalizedKTCMap = {};
      (ktcData.OneQB || []).forEach((player) => {
        const normName = normalizeName(player.name);
        if (!normalizedKTCMap[normName]) {
          normalizedKTCMap[normName] = { one_qb: player.value, superflex: 0 };
        } else {
          normalizedKTCMap[normName].one_qb = player.value;
        }
      });
      (ktcData.Superflex || []).forEach((player) => {
        const normName = normalizeName(player.name);
        if (!normalizedKTCMap[normName]) {
          normalizedKTCMap[normName] = { one_qb: 0, superflex: player.value };
        } else {
          normalizedKTCMap[normName].superflex = player.value;
        }
      });

      // ✅ Build FantasyNavigator lookup
        const normalizedFNMap = {};
        const addFNGroup = (list, key) => {
          (list || []).forEach((p) => {
            const normName = normalizeName(p.name || "");
            if (!normalizedFNMap[normName]) {
              normalizedFNMap[normName] = {
                dynasty_sf: 0,
                dynasty_1qb: 0,
                redraft_sf: 0,
                redraft_1qb: 0,
                position: (p.position || "").toUpperCase(),
                team: (p.team || "").toUpperCase(),
              };
            }
            normalizedFNMap[normName][key] = p.value || 0;
          });
        };

        addFNGroup(fnData.Dynasty_SF || [], "dynasty_sf");
        addFNGroup(fnData.Dynasty_1QB || [], "dynasty_1qb");
        addFNGroup(fnData.Redraft_SF || [], "redraft_sf");
        addFNGroup(fnData.Redraft_1QB || [], "redraft_1qb");


      console.log("✅ KTC normalized map size:", Object.keys(normalizedKTCMap).length);
      console.log("✅ FantasyNavigator normalized size:", Object.keys(normalizedFNMap).length);

      let dpMatchCount = 0;
      let ktcMatchCount = 0;
      let fnMatchCount = 0;
      const finalPlayers = {};

      Object.keys(playersData).forEach((id) => {
        const p = playersData[id];
        const normName = normalizeName(p.full_name || `${p.first_name || ""} ${p.last_name || ""}`);
        const pos = (p.position || "").toUpperCase();
        const team = (p.team || "").toUpperCase();

        // ✅ FantasyCalc values
        const fc_values = {
          dynasty_sf: dynastySFMap[id] || 0,
          dynasty_1qb: dynasty1QBMap[id] || 0,
          redraft_sf: redraftSFMap[id] || 0,
          redraft_1qb: redraft1QBMap[id] || 0,
        };

        // ✅ DynastyProcess values
        let dp_values = { one_qb: 0, superflex: 0 };
        const dpCandidate = normalizedDPMap[normName];
        if (dpCandidate) {
          const dpPos = (dpCandidate.pos || "").toUpperCase();
          const dpTeam = (dpCandidate.team || "").toUpperCase();
          if (dpPos === pos && (!dpTeam || dpTeam === team)) {
            dp_values = {
              one_qb: dpCandidate.one_qb || 0,
              superflex: dpCandidate.superflex || 0,
            };
            dpMatchCount++;
          }
        }

        // ✅ KeepTradeCut values
        let ktc_values = { one_qb: 0, superflex: 0 };
        const ktcCandidate = normalizedKTCMap[normName];
        if (ktcCandidate && ["QB", "RB", "WR", "TE"].includes(pos)) {
          ktc_values = {
            one_qb: ktcCandidate.one_qb || 0,
            superflex: ktcCandidate.superflex || 0,
          };
          ktcMatchCount++;
        }

       // ✅ FantasyNavigator values with position/team validation
        let fn_values = { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0 };
        const fnCandidate = normalizedFNMap[normName];
        if (
          fnCandidate &&
          fnCandidate.position === pos && // ensure position matches
          (!fnCandidate.team || fnCandidate.team === team) // team check if available
        ) {
          fn_values = {
            dynasty_sf: fnCandidate.dynasty_sf || 0,
            dynasty_1qb: fnCandidate.dynasty_1qb || 0,
            redraft_sf: fnCandidate.redraft_sf || 0,
            redraft_1qb: fnCandidate.redraft_1qb || 0,
          };
          fnMatchCount++;
        }

        // ✅ Include only if any value > 0
        if (
          Object.values(fc_values).some((v) => v > 0) ||
          Object.values(dp_values).some((v) => v > 0) ||
          Object.values(ktc_values).some((v) => v > 0) ||
          Object.values(fn_values).some((v) => v > 0)
        ) {
          finalPlayers[id] = {
            ...p,
            fc_values,
            dp_values,
            ktc_values,
            fn_values,
          };
        }
      });

      console.log(`✅ Player DB built: ${Object.keys(finalPlayers).length}`);
      console.log(`✅ DynastyProcess matched: ${dpMatchCount}`);
      console.log(`✅ KeepTradeCut matched: ${ktcMatchCount}`);
      console.log(`✅ FantasyNavigator matched: ${fnMatchCount}`);

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
    localStorage.clear();
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
