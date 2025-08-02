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
  const CACHE_KEY = "playerDB_v4"; // bump version when logic changes

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

      // ✅ Build DP lookup with normalized names
      const normalizedDPMap = {};
      Object.keys(dpData).forEach((name) => {
        const normName = normalizeName(name);
        normalizedDPMap[normName] = dpData[name];
      });

      let dpMatchCount = 0;
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

        // ✅ Match DynastyProcess: check name + position + optional team
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

        // ✅ Include only if any value > 0
        if (
          Object.values(fc_values).some((v) => v > 0) ||
          Object.values(dp_values).some((v) => v > 0)
        ) {
          finalPlayers[id] = {
            ...p,
            fc_values,
            dp_values,
          };
        }
      });

      console.log(`✅ Player DB built: ${Object.keys(finalPlayers).length}`);
      console.log(`✅ DynastyProcess matched: ${dpMatchCount}`);

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
