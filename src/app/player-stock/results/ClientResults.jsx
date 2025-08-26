"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
const Navbar = dynamic(() => import("../../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(() => import("../../../components/BackgroundParticles"), { ssr: false });
import LoadingScreen from "../../../components/LoadingScreen";
import ValueSourceDropdown from "../../../components/ValueSourceDropdown";
import { useSleeper } from "../../../context/SleeperContext";
import AvatarImage from "../../../components/AvatarImage";
import { getTeamByeWeek } from "../../../utils/nflByeWeeks";

import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  ReferenceLine,
  LabelList,
} from "recharts";

// Value sources (unchanged)
const VALUE_SOURCES = {
  FantasyCalc: { label: "FantasyCalc", supports: { dynasty: true, redraft: true, qbToggle: true } },
  DynastyProcess: { label: "DynastyProcess", supports: { dynasty: true, redraft: false, qbToggle: true } },
  KeepTradeCut: { label: "KeepTradeCut", supports: { dynasty: true, redraft: false, qbToggle: true } },
  FantasyNavigator: { label: "FantasyNavigator", supports: { dynasty: true, redraft: true, qbToggle: true } },
  IDynastyP: { label: "IDynastyP", supports: { dynasty: true, redraft: false, qbToggle: true } },
  TheFantasyArsenal: { label: "TheFantasyArsenal", supports: { dynasty: true, redraft: true, qbToggle: true } },

};

// League avatar helpers
const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) =>
  avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : DEFAULT_LEAGUE_IMG;

const TRENDING_LIMIT = 50;

export default function ClientResults({ initialSearchParams = {} }) {
  const { username, year, players, format, qbType, setFormat, setQbType } = useSleeper();

  const getParam = (k) => {
    const v = initialSearchParams?.[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };
  const paramsKey = JSON.stringify({ year: getParam("year"), force: getParam("force") });

  // UI state
  const [loading, setLoading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState("Preparing scan…");
  const [error, setError] = useState("");

  const [valueSource, setValueSource] = useState("FantasyCalc");
  const supports = VALUE_SOURCES[valueSource].supports;

  const [query, setQuery] = useState("");
  const [highlightStarters, setHighlightStarters] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    try { mq.addEventListener("change", handler); } catch { mq.addListener(handler); }
    return () => {
      try { mq.removeEventListener("change", handler); } catch { mq.removeListener(handler); }
    };
  }, []);


  // Scan data
  const [leagueCount, setLeagueCount] = useState(0);
  const [scanLeagues, setScanLeagues] = useState([]); // [{id,name,avatar,roster_positions,status,isBestBall}]
  const [rows, setRows] = useState([]); // {player_id,name,position,team,bye,count,leagues:[{id,name,isStarter,avatar,status,isBestBall}]}
  const [leagueRosters, setLeagueRosters] = useState({}); // { [leagueId]: { id, name, roster_positions, players:[{pid,pos,team,bye,isStarter}] } }

  // Modals
  const [openPid, setOpenPid] = useState(null);
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [showVisibleLeaguesModal, setShowVisibleLeaguesModal] = useState(false);
  const [showByeModal, setShowByeModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showChart, setShowChart] = useState(false);

  // Sorting
  const [sortKey, setSortKey] = useState("count"); // name | team | pos | count | value
  const [sortDir, setSortDir] = useState("desc"); // asc | desc

  // Pagination
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Exposure guardrails (and persistence)
  const guardKey = username ? `ps:guard:${username}` : null;
  const [maxExposurePct, setMaxExposurePct] = useState(() => {
    if (typeof window === "undefined" || !guardKey) return 35;
    const raw = localStorage.getItem(guardKey);
    return raw ? Number(raw) : 35;
  });
  const initialExposureRef = useRef(maxExposurePct);
  useEffect(() => {
    if (guardKey) localStorage.setItem(guardKey, String(maxExposurePct));
  }, [guardKey, maxExposurePct]);

  // 🔥/🧊 Trending
  const [trendingHours, setTrendingHours] = useState(24);
  const [trendingMode, setTrendingMode] = useState("all"); // all | adds | drops
  const [trendingAddMap, setTrendingAddMap] = useState(() => new Map());
  const [trendingDropMap, setTrendingDropMap] = useState(() => new Map());

  // Display-side league filters
  const [onlyBestBall, setOnlyBestBall] = useState(false);
  const [excludeBestBall, setExcludeBestBall] = useState(false);
  const [includeDrafting, setIncludeDrafting] = useState(true);

  // Force rescan w/o nav
  const [forceScanNonce, setForceScanNonce] = useState(0);

  // Load trending adds
  useEffect(() => {
    const key = `ps:trending:add:${trendingHours}:L${TRENDING_LIMIT}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      setTrendingAddMap(new Map(Object.entries(JSON.parse(cached))));
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=${trendingHours}&limit=${TRENDING_LIMIT}`
        );
        const arr = await res.json();
        const m = new Map(
          (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []).map((it) => [String(it.player_id), it.count || 0])
        );
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingAddMap(m);
      } catch {
        setTrendingAddMap(new Map());
      }
    })();
  }, [trendingHours]);

  // Load trending drops
  useEffect(() => {
    const key = `ps:trending:drop:${trendingHours}:L${TRENDING_LIMIT}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      setTrendingDropMap(new Map(Object.entries(JSON.parse(cached))));
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=${trendingHours}&limit=${TRENDING_LIMIT}`
        );
        const arr = await res.json();
        const m = new Map(
          (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []).map((it) => [String(it.player_id), it.count || 0])
        );
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingDropMap(m);
      } catch {
        setTrendingDropMap(new Map());
      }
    })();
  }, [trendingHours]);

  // Value helper (matches your Trade Analyzer)
  const getPlayerValue = (p) => {
    if (!p) return 0;
    if (valueSource === "FantasyCalc") {
      return format === "dynasty"
        ? qbType === "sf"
          ? p.fc_values?.dynasty_sf || 0
          : p.fc_values?.dynasty_1qb || 0
        : qbType === "sf"
        ? p.fc_values?.redraft_sf || 0
        : p.fc_values?.redraft_1qb || 0;
    } else if (valueSource === "DynastyProcess") {
      return qbType === "sf" ? p.dp_values?.superflex || 0 : p.dp_values?.one_qb || 0;
    } else if (valueSource === "KeepTradeCut") {
      return qbType === "sf" ? p.ktc_values?.superflex || 0 : p.ktc_values?.one_qb || 0;
    } else if (valueSource === "FantasyNavigator") {
      return format === "dynasty"
        ? qbType === "sf"
          ? p.fn_values?.dynasty_sf || 0
          : p.fn_values?.dynasty_1qb || 0
        : qbType === "sf"
        ? p.fn_values?.redraft_sf || 0
        : p.fn_values?.redraft_1qb || 0;
    } else if (valueSource === "IDynastyP") {
      return qbType === "sf" ? p.idp_values?.superflex || 0 : p.idp_values?.one_qb || 0;
    
    } else if (valueSource === "TheFantasyArsenal") {
      return format === "dynasty"
        ? (qbType === "sf" ? (p.sp_values?.dynasty_sf || 0) : (p.sp_values?.dynasty_1qb || 0))
        : (qbType === "sf" ? (p.sp_values?.redraft_sf || 0) : (p.sp_values?.redraft_1qb || 0));
    }
    return 0;
  };

  // Enrich row with local data
  const withLocalPlayerData = (row) => {
    const p = players?.[row.player_id];
    return {
      ...row,
      _value: getPlayerValue(p),
      _name: row.name || p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`.trim() || "Unknown",
      _pos: (row.position || p?.position || "").toUpperCase(),
      _team: (row.team || p?.team || "").toUpperCase(),
    };
  };

  // One-time scan (always all leagues; filters are display-side)
  useEffect(() => {
    if (!username) return;

    const yr = getParam("year") || String(year || new Date().getFullYear());
    const forceParam = getParam("force") === "1";
    const force = forceParam || forceScanNonce > 0;

    const cacheKey = `ps:${username}:${yr}:ALL`;
    let cancel = false;

    (async () => {
      try {
        setError("");
        setLoading(true);
        setProgressPct(3);
        setProgressText("Looking up user…");

        const cached = !force ? sessionStorage.getItem(cacheKey) : null;
        if (cached) {
          const {
            rows: cachedRows,
            leagueCount: cachedLeagues,
            leagues: cachedList,
            leagueRosters: cachedRosters,
            ts,
          } = JSON.parse(cached);
          if (!cancel) {
            setRows(cachedRows);
            setLeagueCount(cachedLeagues ?? 0);
            setScanLeagues(cachedList || []);
            setLeagueRosters(cachedRosters || {});
            setLastUpdated(ts ? new Date(ts) : new Date());
            setProgressPct(100);
            setProgressText("Loaded from cache");
            setLoading(false);
          }
          return;
        }

        // 1) user id
        const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!userRes.ok) throw new Error("User not found");
        const user = await userRes.json();
        const userId = user.user_id;

        setProgressText("Fetching leagues…");
        setProgressPct(8);

        // 2) leagues (no filtering here)
          const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${yr}`);
          const leagues = await leaguesRes.json();

          if (cancel) return;

          if (leagues.length === 0) {
            setRows([]);
            setLeagueRosters({});
            setLeagueCount(0);
            setScanLeagues([]);
            setProgressPct(100);
            setProgressText("No leagues found.");
            setLoading(false);
            return;
          }

          // 3) iterate rosters with live progress — include only leagues where you actually have a roster with players
          const playerCounts = {};
          const playerLeagues = {};
          const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
          const catalog = await playersRes.json();

          const nextLeagueRosters = {};
          const includedLeagues = [];

          for (let i = 0; i < leagues.length; i++) {
            const lg = leagues[i];
            setProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
            setProgressPct(Math.round(((i + 1) / leagues.length) * 100 * 0.92) + 8);

            const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);
            const rosters = await rostersRes.json();
            const mine = rosters.find((r) => r.owner_id === userId);

            // ⛔ Skip this league if you don't have a roster or it's empty
            if (!mine?.players || mine.players.length === 0) {
              if (cancel) return;
              continue;
            }

            // ✅ Track this league as included
            includedLeagues.push({
              id: lg.league_id,
              name: lg.name,
              avatar: lg.avatar || null,
              roster_positions: lg.roster_positions || [],
              status: lg.status || "",
              isBestBall: lg?.settings?.best_ball === 1,
            });

            const starters = new Set(mine.starters || []);

            // per-league roster build (for bye availability math)
            const leaguePlayers = [];
            for (const pid of mine.players) {
              const base = catalog?.[pid] || {};
              const team = (base.team || "").toUpperCase();
              const pos = (base.position || "").toUpperCase();
              const bye = getTeamByeWeek(team, Number(yr) || new Date().getFullYear());

              // global aggregates
              playerCounts[pid] = (playerCounts[pid] || 0) + 1;
              if (!playerLeagues[pid]) playerLeagues[pid] = [];
              playerLeagues[pid].push({
                id: lg.league_id,
                name: lg.name,
                isStarter: starters.has(pid),
                avatar: lg.avatar || null,
                status: lg.status || "",
                isBestBall: lg?.settings?.best_ball === 1,
              });

              // per-league roster entry
              leaguePlayers.push({
                pid: String(pid),
                pos,
                team,
                bye,
                isStarter: starters.has(pid),
              });
            }

            nextLeagueRosters[lg.league_id] = {
              id: lg.league_id,
              name: lg.name,
              roster_positions: lg.roster_positions || [],
              players: leaguePlayers,
            };

            if (cancel) return;
          }

          // If none of the leagues had your roster, exit gracefully
          if (includedLeagues.length === 0) {
            setRows([]);
            setLeagueRosters({});
            setLeagueCount(0);
            setScanLeagues([]);
            setLastUpdated(new Date());
            setProgressPct(100);
            setProgressText("No leagues with a roster found.");
            setLoading(false);
            return;
          }

          // 4) shape rows (from included leagues only)
          const seasonNumber = Number(yr) || new Date().getFullYear();
          const built = Object.entries(playerCounts)
            .map(([pid, count]) => {
              const base = catalog?.[pid] || {};
              const team = (base.team || "").toUpperCase();
              const name =
                base.full_name ||
                `${base.first_name || ""} ${base.last_name || ""}`.trim() ||
                "Unknown";

              const bye = getTeamByeWeek(team, seasonNumber);

              return {
                player_id: pid,
                name,
                team,
                position: (base.position || "").toUpperCase(),
                bye,
                count,
                leagues: playerLeagues[pid] || [],
              };
            })
            .sort((a, b) => b.count - a.count);

          if (cancel) return;

          // 🆕 Save only included leagues to cache/state
          const payload = {
            rows: built,
            leagueCount: includedLeagues.length,
            leagues: includedLeagues,
            leagueRosters: nextLeagueRosters,
            ts: Date.now(),
          };
          sessionStorage.setItem(cacheKey, JSON.stringify(payload));

          setRows(built);
          setLeagueRosters(nextLeagueRosters);
          setLeagueCount(includedLeagues.length);
          setScanLeagues(includedLeagues);
          setLastUpdated(new Date());
          setProgressPct(100);
          setProgressText("Done!");

      } catch (e) {
        if (!cancel) {
          setError(e?.message || "Scan failed");
          setLoading(false);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [username, year, paramsKey, forceScanNonce]);

  // Enriched rows (use everywhere for accurate team/pos/value)
  const enriched = useMemo(() => rows.map(withLocalPlayerData), [rows, valueSource, players, format, qbType]);

  // Visible league IDs after display filters
  const visibleLeagueIds = useMemo(() => {
    if (!scanLeagues || scanLeagues.length === 0) return new Set();
    const arr = scanLeagues
      .filter((lg) => {
        if (onlyBestBall && !lg.isBestBall) return false;
        if (excludeBestBall && lg.isBestBall) return false;
        if (!includeDrafting && lg.status === "drafting") return false;
        return true;
      })
      .map((lg) => String(lg.id));
    return new Set(arr);
  }, [scanLeagues, onlyBestBall, excludeBestBall, includeDrafting]);
  const visibleLeagueCount = visibleLeagueIds.size || 0;

  // Project rows to visible leagues, drop zeroes
  const projectedRows = useMemo(() => {
    if (!visibleLeagueIds) return enriched;
    return enriched
      .map((row) => {
        const leagues = (row.leagues || []).filter((lg) => visibleLeagueIds.has(String(lg.id)));
        return { ...row, leagues, count: leagues.length };
      })
      .filter((r) => r.count > 0);
  }, [enriched, visibleLeagueIds]);

  // Starter PID set (for highlight toggle)
  const starterPidSet = useMemo(() => {
    const s = new Set();
    projectedRows.forEach((r) => {
      if (r.leagues?.some((lg) => lg.isStarter)) s.add(r.player_id);
    });
    return s;
  }, [projectedRows]);

  // Search + trending filter
  const filteredRows = useMemo(() => {
    let list = projectedRows;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (r) => r._name.toLowerCase().includes(q) || r._team.toLowerCase().includes(q) || r._pos.toLowerCase().includes(q)
      );
    }
    if (trendingMode === "adds") list = list.filter((r) => trendingAddMap.has(r.player_id));
    else if (trendingMode === "drops") list = list.filter((r) => trendingDropMap.has(r.player_id));
    return list;
  }, [projectedRows, query, trendingMode, trendingAddMap, trendingDropMap]);

  // Sort
  const toggleSort = (key) => {
    setCurrentPage(1);
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "team" || key === "pos" ? "asc" : "desc");
    }
  };
  const sortIndicator = (key) =>
    sortKey !== key ? <span className="opacity-40">↕</span> : sortDir === "asc" ? <span>▲</span> : <span>▼</span>;
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;

    // If user selected "Only trending adds/drops", sort by that signal first.
    if (trendingMode !== "all") {
      const getTrend = (r) =>
        trendingMode === "adds"
          ? (trendingAddMap.get(r.player_id) || 0)
          : (trendingDropMap.get(r.player_id) || 0);

      return [...filteredRows].sort((a, b) => {
        const tDiff = getTrend(b) - getTrend(a);
        if (tDiff !== 0) return tDiff; // highest trend first
        // secondary: respect current sort choice (value/count/name/etc.)
        if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
        if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
        if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
        if (sortKey === "value") return ((a._value || 0) - (b._value || 0)) * dir;
        return ((a.count || 0) - (b.count || 0)) * dir;
      });
    }

    // Normal sorting when not in trending-only modes
    return [...filteredRows].sort((a, b) => {
      if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
      if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
      if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
      if (sortKey === "value") return ((a._value || 0) - (b._value || 0)) * dir;
      return ((a.count || 0) - (b.count || 0)) * dir;
    });
  }, [filteredRows, sortKey, sortDir, trendingMode, trendingAddMap, trendingDropMap]);


  // Paging
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  // Filters modal "dirty" + reset
  const defaultFilterState = {
    onlyBestBall: false,
    excludeBestBall: false,
    includeDrafting: true,
    highlightStarters: false,
    query: "",
    maxExposurePct: initialExposureRef.current ?? 25,
    trendingMode: "all",
    trendingHours: 24,
  };
  const filtersDirty =
    onlyBestBall !== defaultFilterState.onlyBestBall ||
    excludeBestBall !== defaultFilterState.excludeBestBall ||
    includeDrafting !== defaultFilterState.includeDrafting ||
    highlightStarters !== defaultFilterState.highlightStarters ||
    query !== defaultFilterState.query ||
    maxExposurePct !== defaultFilterState.maxExposurePct ||
    trendingMode !== defaultFilterState.trendingMode ||
    trendingHours !== defaultFilterState.trendingHours;

  const resetFilters = () => {
    setOnlyBestBall(false);
    setExcludeBestBall(false);
    setIncludeDrafting(true);
    setHighlightStarters(false);
    setQuery("");
    setMaxExposurePct(initialExposureRef.current ?? 25);
    setTrendingMode("all");
    setTrendingHours(24);
  };

  const doRefresh = () => {
    const yr = getParam("year") || String(year || new Date().getFullYear());
    const cacheKey = `ps:${username}:${yr}:ALL`;
    try {
      sessionStorage.removeItem(cacheKey);
    } catch {}
    setForceScanNonce((n) => n + 1);
  };

  /* =======================
     Player Stock Chart data
     ======================= */
  const [chartMetric, setChartMetric] = useState("exposure"); // exposure | count | value
  const [chartTopN, setChartTopN] = useState(20);

  const chartTopNInitRef = useRef(false);
  useEffect(() => {
    if (showChart && isMobile && !chartTopNInitRef.current) {
      setChartTopN(10);
      chartTopNInitRef.current = true;
    }
  }, [showChart, isMobile]);


  const chartData = useMemo(() => {
    const base = [...sorted].slice(0, Math.max(chartTopN, 1));
    const data = base.map((r) => ({
      name: r._name,
      short: r._name.length > 18 ? r._name.replace(/(.{17}).*/, "$1…") : r._name,
      exposure: visibleLeagueCount ? Math.round((r.count / visibleLeagueCount) * 100) : 0,
      count: r.count || 0,
      value: r._value || 0,
    }));
    data.sort((a, b) => (b[chartMetric] ?? 0) - (a[chartMetric] ?? 0));
    return data.slice(0, chartTopN);
  }, [sorted, chartTopN, chartMetric, visibleLeagueCount]);

  const chartYAxisDomain = chartMetric === "exposure" ? [0, 100] : ["auto", "auto"];
  const chartValueFormatter = (v) => (chartMetric === "exposure" ? `${v}%` : v);

  /* =======================
     Bye-week helpers + state
     ======================= */
  const scanLeaguesMap = useMemo(() => {
    const m = {};
    for (const lg of scanLeagues) m[lg.id] = lg;
    return m;
  }, [scanLeagues]);

  const [byeTotalCap, setByeTotalCap] = useState(4);
  const [byeStarterCap, setByeStarterCap] = useState(3);
  const [byeShowOnlyIssues, setByeShowOnlyIssues] = useState(true);

  const START_SLOTS = new Set(["QB", "RB", "WR", "TE", "FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX"]);
  const SLOT_ELIGIBILITY = {
    FLEX: new Set(["RB", "WR", "TE"]),
    WRRB_FLEX: new Set(["RB", "WR"]),
    REC_FLEX: new Set(["WR", "TE"]),
    SUPER_FLEX: new Set(["QB", "RB", "WR", "TE"]),
  };

  function countRosterSlots(roster_positions = []) {
    const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, WRRB_FLEX: 0, REC_FLEX: 0, SUPER_FLEX: 0 };
    roster_positions.forEach((slot) => {
      if (START_SLOTS.has(slot)) slots[slot] = (slots[slot] || 0) + 1;
    });
    return slots;
  }
  function totalStarterSlots(slots) {
    return Object.values(slots).reduce((a, b) => a + (b || 0), 0);
  }
  function flexCapacityFor(pos, slots) {
    let cap = 0;
    if (pos === "QB") cap += slots.SUPER_FLEX || 0;
    if (pos === "RB") cap += (slots.FLEX || 0) + (slots.WRRB_FLEX || 0) + (slots.SUPER_FLEX || 0);
    if (pos === "WR") cap += (slots.FLEX || 0) + (slots.WRRB_FLEX || 0) + (slots.REC_FLEX || 0) + (slots.SUPER_FLEX || 0);
    if (pos === "TE") cap += (slots.FLEX || 0) + (slots.REC_FLEX || 0) + (slots.SUPER_FLEX || 0);
    return cap;
  }
  function capacityText(pos, slots) {
    const base = slots[pos] || 0;
    const flex = flexCapacityFor(pos, slots);
    if (base > 0 && flex > 0) return `${base} starters + ${flex} via flex`;
    if (base > 0 && flex === 0) return `${base} starters`;
    if (base === 0 && flex > 0) return `${flex} via flex only`;
    return `no eligible slots`;
  }
  function eligibleOtherPositionsFor(pos, slots) {
    const presentSlotTypes = Object.keys(slots).filter((k) => slots[k] > 0 && SLOT_ELIGIBILITY[k]);
    const union = new Set();
    presentSlotTypes.forEach((slotType) => {
      const set = SLOT_ELIGIBILITY[slotType];
      if (set && set.has(pos)) set.forEach((p) => union.add(p));
    });
    union.delete(pos);
    return Array.from(union).sort();
  }
  function activeCountsByPos(leagueRoster, week) {
    const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
    if (!leagueRoster?.players) return counts;
    leagueRoster.players.forEach((pl) => {
      const pos = (pl.pos || "UNK").toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(counts, pos)) return;
      const isOnBye = Number.isFinite(pl.bye) && Number(pl.bye) === Number(week);
      if (!isOnBye) counts[pos] += 1;
    });
    return counts;
  }

  // Aggregate bye counts by league/week
  const byeByLeague = useMemo(() => {
    const map = {};
    projectedRows.forEach((r) => {
      const wk = r.bye || null;
      if (!wk) return;
      const pos = (players?.[r.player_id]?.position || r.position || "UNK").toUpperCase();
      (r.leagues || []).forEach((lg) => {
        if (!map[lg.id]) map[lg.id] = { id: lg.id, name: lg.name, weeks: {} };
        const bucket = (map[lg.id].weeks[wk] ||= { total: 0, starters: 0, pos: {} });
        bucket.total += 1;
        if (lg.isStarter) bucket.starters += 1;
        bucket.pos[pos] = (bucket.pos[pos] || 0) + 1;
      });
    });
    return map;
  }, [projectedRows, players]);

  // Identify problem weeks per league
  const byeIssuesByLeague = useMemo(() => {
    const issues = {};
    Object.entries(byeByLeague).forEach(([lid, league]) => {
      const rp = scanLeaguesMap[lid]?.roster_positions || [];
      const slots = countRosterSlots(rp);
      const startersTotal = totalStarterSlots(slots);

      const wkIssues = {};
      Object.entries(league.weeks).forEach(([wk, stats]) => {
        const hasProblem = stats.total >= byeTotalCap || stats.starters >= byeStarterCap || stats.total >= startersTotal;

        if (hasProblem || !byeShowOnlyIssues) {
          wkIssues[wk] = { ...stats, startersTotal, slots };
        }
      });

      if (Object.keys(wkIssues).length) {
        issues[lid] = { id: league.id, name: league.name, weeks: wkIssues, slots, startersTotal };
      }
    });
    return issues;
  }, [byeByLeague, scanLeaguesMap, byeTotalCap, byeStarterCap, byeShowOnlyIssues]);

  // UI
  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Player Stock" />
      {loading && <LoadingScreen progress={progressPct} text={progressText} />}

      <div className="max-w-6xl mx-auto px-4 pt-20">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the{" "}
            <a href="/" className="text-blue-400 underline">
              homepage
            </a>{" "}
            to use this tool.
          </div>
        ) : (
          <div className="mb-4">
            {/* Controls container */}
            <div className="bg-gray-900 rounded-lg border border-white/10 p-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  {/* Left: search + BIG value source */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search name/team/pos"
                      className="bg-gray-800 border border-white/10 rounded px-3 py-1.5 text-sm w-full md:w-64"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">Source:</span>
                      <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
                    </div>
                  </div>

                  {/* Right: Filters + scan summary */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="relative rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                      onClick={() => setShowFiltersModal(true)}
                      title="Filters & options"
                    >
                      Filters
                      {filtersDirty && (
                        <span className="absolute -top-1 -right-1 inline-block w-3 h-3 rounded-full bg-blue-500 ring-2 ring-gray-900" />
                      )}
                    </button>

                    <div className="text-sm text-gray-400">
                      {leagueCount > 0 && (
                        <span>
                          Scanned{" "}
                          <button
                            type="button"
                            className="underline decoration-dotted hover:text-white"
                            onClick={() => setShowLeaguesModal(true)}
                            title="All leagues included in this scan"
                          >
                            <span className="text-white font-semibold">{leagueCount}</span>
                          </button>{" "}
                          leagues
                        </span>
                      )}
                      {visibleLeagueCount > 0 && (
                        <span className="ml-2">
                          • Showing{" "}
                          <button
                            type="button"
                            className="underline decoration-dotted hover:text-white"
                            onClick={() => setShowVisibleLeaguesModal(true)}
                            title="Leagues currently visible by filters"
                          >
                            <span className="text-white font-semibold">{visibleLeagueCount}</span>
                          </button>
                        </span>
                      )}
                      {lastUpdated && (
                        <span className="ml-3 text-xs text-gray-500" suppressHydrationWarning>
                          Last scan: {lastUpdated.toLocaleTimeString()}
                        </span>
                      )}
                      <button
                        className="ml-3 text-xs rounded px-2 py-0.5 border border-white/20 hover:bg-white/10"
                        onClick={doRefresh}
                        title="Rescan now (ignores cache)"
                      >
                        Refresh
                      </button>
                      {error && <span className="text-red-400 ml-3">{error}</span>}
                    </div>
                  </div>
                </div>

                {/* row: chart toggle (left) + bye-week (right) */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <button
                    className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                    onClick={() => setShowChart((v) => !v)}
                    title="Toggle player stock chart"
                  >
                    {showChart ? "Hide Player Stock Chart" : "Show Player Stock Chart"}
                  </button>

                  <button
                    className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                    onClick={() => setShowByeModal(true)}
                    title="See per-league bye-week risk"
                  >
                    Bye-week conflicts
                  </button>
                </div>
              </div>
            </div>

            {/* Player Stock Chart (toggled) */}
            {showChart && (
              <div className="mt-4 bg-gray-900 rounded-lg border border-white/10 p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-lg font-semibold">Player Stock (Top {chartTopN})</div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-sm">
                      <span>Metric</span>
                      <select
                        value={chartMetric}
                        onChange={(e) => setChartMetric(e.target.value)}
                        className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                      >
                        <option value="exposure">Exposure %</option>
                        <option value="count">Leagues</option>
                        <option value="value">Value</option>
                      </select>
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <span>Top</span>
                      <select
                        value={chartTopN}
                        onChange={(e) => setChartTopN(Number(e.target.value))}
                        className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                      >
                        {[10, 20, 30, 50].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>

                    {isMobile && chartTopN > 10 && (
                      <span className="text-xs text-yellow-300">
                        Tip: 10 is recommended on mobile.
                      </span>
                    )}
                  </div>

                </div>

                <div className="mt-3 h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
                      <XAxis
                        dataKey="short"
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                        height={60}
                        tick={{ fill: "#cbd5e1", fontSize: 12 }}
                      />
                      <YAxis domain={chartYAxisDomain} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
                        formatter={(value, name) => [chartValueFormatter(value), name]}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.name ?? label}
                      />
                      <Bar dataKey={chartMetric} fill="#60a5fa">
                        <LabelList
                          dataKey={chartMetric}
                          position="top"
                          formatter={chartValueFormatter}
                          style={{ fill: "#e5e7eb", fontSize: 11 }}
                        />
                      </Bar>
                      {chartMetric === "exposure" && (
                        <ReferenceLine
                          y={maxExposurePct}
                          stroke="#ef4444"
                          strokeDasharray="4 4"
                          label={{
                            value: `Cap ${maxExposurePct}%`,
                            position: "right",
                            fill: "#fca5a5",
                            fontSize: 12,
                          }}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 text-xs text-gray-500">
                  Based on your visible leagues ({visibleLeagueCount}). Exposure = leagues rostered / visible leagues.
                </div>
              </div>
            )}

            {/* Table */}
            {sorted.length === 0 ? (
              <div className="text-center text-gray-400 py-10">
                {loading ? "Working…" : trendingMode !== "all" ? "No matching trending players." : "No players found."}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg shadow ring-1 ring-white/10 mt-3">
                <table className="min-w-full bg-gray-900">
                  <thead className="bg-gray-800/60">
                    <tr>
                      <th
                        className="text-left px-4 py-2 cursor-pointer select-none"
                        onClick={() => toggleSort("name")}
                      >
                        Player <span className="ml-1 inline-block">{sortIndicator("name")}</span>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer select-none"
                        onClick={() => toggleSort("count")}
                      >
                        Leagues <span className="ml-1 inline-block">{sortIndicator("count")}</span>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer select-none"
                        onClick={() => toggleSort("value")}
                      >
                        Value <span className="ml-1 inline-block">{sortIndicator("value")}</span>
                      </th>
                      <th className="text-left px-4 py-2 hidden md:table-cell">Teams</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const exposure = visibleLeagueCount ? Math.round((r.count / visibleLeagueCount) * 100) : 0;
                      const overCap = exposure > maxExposurePct;
                      const isStarterSomewhere = starterPidSet.has(r.player_id);
                      const addCount = trendingAddMap.get(r.player_id);
                      const dropCount = trendingDropMap.get(r.player_id);

                      const titleBits = [];
                      if (overCap) titleBits.push(`Exposure ${exposure}% exceeds ${maxExposurePct}%`);
                      if (addCount) titleBits.push(`Trending adds: ${addCount}`);
                      if (dropCount) titleBits.push(`Trending drops: ${dropCount}`);

                      return (
                        <tr
                          key={r.player_id}
                          className="border-b border-white/5 hover:bg-white/5"
                          title={titleBits.join(" • ")}
                        >
                          <td className="px-4 py-2">
                            <button className="text-left w-full" onClick={() => setOpenPid(r.player_id)}>
                              <div className="flex items-center gap-1">
                                <AvatarImage
                                  name={r._name}
                                  width={28}
                                  height={28}
                                  className="w-7 h-7 rounded-full border object-cover bg-gray-800"
                                />
                                <span
                                  className={
                                    overCap
                                      ? "text-red-400 font-semibold"
                                      : highlightStarters && isStarterSomewhere
                                      ? "text-blue-400 font-semibold"
                                      : ""
                                  }
                                >
                                  {r._name}
                                </span>
                                {Number.isFinite(r.bye) && (
                                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70">
                                    Bye W{r.bye}
                                  </span>
                                )}
                                {addCount ? (
                                  <span
                                    className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70"
                                    title={`Trending adds: ${addCount}`}
                                  >
                                    🔥 {addCount}
                                  </span>
                                ) : null}
                                {dropCount ? (
                                  <span
                                    className="ml-1 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70"
                                    title={`Trending drops: ${dropCount}`}
                                  >
                                    🧊 {dropCount}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-gray-400 ml-10">
                                {r._pos || "—"} • {r._team || "FA"}
                                {visibleLeagueCount ? ` • ${exposure}% exp.` : ""}
                              </div>
                            </button>
                          </td>
                          <td className="px-4 py-2 text-right">{r.count}</td>
                          <td className="px-4 py-2 text-right">
                            {players?.[r.player_id] ? getPlayerValue(players[r.player_id]) : 0}
                          </td>
                          <td className="px-4 py-2 hidden md:table-cell">
                            <div className="flex -space-x-2">
                              {(r.leagues || [])
                                .slice(0, 7)
                                .map((lg) => (
                                  <img
                                    key={lg.id}
                                    src={leagueAvatarUrl(lg.avatar)}
                                    alt=""
                                    className={`w-6 h-6 rounded ring-1 ring-black object-cover ${
                                      highlightStarters && lg.isStarter ? "ring-blue-500" : ""
                                    }`}
                                    onError={(e) => {
                                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                                    }}
                                    title={`${lg.name}${lg.isStarter ? " • starter" : ""}`}
                                  />
                                ))}
                              {(r.leagues || []).length > 7 ? (
                                <span className="text-xs text-gray-400 pl-2">
                                  +{(r.leagues || []).length - 7}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* footer: paging + page size */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  className="rounded px-2 py-1 border border-white/20 disabled:opacity-30"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  ◀
                </button>
                <span className="text-sm text-gray-400">
                  Page <span className="text-white">{currentPage}</span> / {totalPages}
                </span>
                <button
                  className="rounded px-2 py-1 border border-white/20 disabled:opacity-30"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  ▶
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filters modal */}
      {showFiltersModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowFiltersModal(false)}
        >
          <div
            className="w-full max-w-3xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="text-xl font-bold">Filters & Options</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowFiltersModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Search & row options */}
              <div className="space-y-3">
                <div className="text-sm text-gray-400">Search</div>
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search name/team/pos"
                  className="w-full bg-gray-800 border border-white/10 rounded px-3 py-2 text-sm"
                />

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={highlightStarters}
                    onChange={() => setHighlightStarters((v) => !v)}
                  />
                  Highlight starters
                </label>

                {/* Exposure cap */}
                <div className="mt-4">
                  <div className="text-sm text-gray-400 mb-1">Max Exposure %</div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={maxExposurePct}
                    onChange={(e) => setMaxExposurePct(Number(e.target.value || 0))}
                    className="w-28 bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                    title="Rows over this % (count / visible leagues) are flagged"
                  />
                </div>

                {/* Value source + Format/QB inside modal only */}
                <div className="text-sm text-gray-400 mt-4">Value Source</div>
                <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
                <div className="mt-2 flex gap-3 items-center">
                  {supports.dynasty && supports.redraft && (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={format === "dynasty"}
                        onChange={() => setFormat(format === "dynasty" ? "redraft" : "dynasty")}
                        className="sr-only peer"
                      />
                      <div className="w-14 h-7 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all peer-checked:after:translate-x-7"></div>
                      <span className="ml-3 text-sm">{format === "dynasty" ? "Dynasty" : "Redraft"}</span>
                    </label>
                  )}
                  {supports.qbToggle && (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qbType === "sf"}
                        onChange={() => setQbType(qbType === "sf" ? "1qb" : "sf")}
                        className="sr-only peer"
                      />
                      <div className="w-14 h-7 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all peer-checked:after:translate-x-7"></div>
                      <span className="ml-3 text-sm">{qbType === "sf" ? "Superflex" : "1QB"}</span>
                    </label>
                  )}
                </div>

                {/* Trending options */}
                  <div className="mt-6">
                    <div className="text-sm text-gray-400 mb-2">Trending players</div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="trending-mode"
                          value="all"
                          checked={trendingMode === "all"}
                          onChange={() => setTrendingMode("all")}
                        />
                        All players
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="trending-mode"
                          value="adds"
                          checked={trendingMode === "adds"}
                          onChange={() => setTrendingMode("adds")}
                        />
                        Only trending adds
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="trending-mode"
                          value="drops"
                          checked={trendingMode === "drops"}
                          onChange={() => setTrendingMode("drops")}
                        />
                        Only trending drops
                      </label>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-sm text-gray-400">Lookback</span>
                      <select
                        value={trendingHours}
                        onChange={(e) => setTrendingHours(Number(e.target.value))}
                        className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                        title="How far back to consider for trending adds/drops"
                      >
                        <option value={6}>6h</option>
                        <option value={12}>12h</option>
                        <option value={24}>24h</option>
                        <option value={48}>48h</option>
                        <option value={72}>72h</option>
                        <option value={168}>7d</option>
                      </select>
                      <span className="text-xs text-gray-500">Sleeper top 50 per window</span>
                    </div>
                  </div>
              </div>

              {/* League filters (display-side) */}
              <div className="space-y-3">
                <div className="text-sm text-gray-400">League filters (display only)</div>
                <label className="flex items-center justify-between">
                  <span>Only Best Ball</span>
                  <input
                    type="checkbox"
                    checked={onlyBestBall}
                    onChange={() => {
                      setOnlyBestBall((v) => {
                        const next = !v;
                        if (next) setExcludeBestBall(false);
                        return next;
                      });
                      setCurrentPage(1);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Exclude Best Ball</span>
                  <input
                    type="checkbox"
                    checked={excludeBestBall}
                    onChange={() => {
                      setExcludeBestBall((v) => {
                        const next = !v;
                        if (next) setOnlyBestBall(false);
                        return next;
                      });
                      setCurrentPage(1);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Include drafting leagues</span>
                  <input
                    type="checkbox"
                    checked={includeDrafting}
                    onChange={() => {
                      setIncludeDrafting((v) => !v);
                      setCurrentPage(1);
                    }}
                  />
                </label>

              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                onClick={resetFilters}
                title="Reset to defaults"
              >
                Reset
              </button>
              <button
                type="button"
                className="text-sm rounded px-3 py-1 border border-blue-500 text-blue-300 hover:bg-blue-500/10"
                onClick={() => setShowFiltersModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan leagues modal */}
      {showLeaguesModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowLeaguesModal(false)}
        >
          <div
            className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues in this scan</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowLeaguesModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {scanLeagues
                .slice()
                .sort((a, b) => {
                  const av = visibleLeagueIds.has(String(a.id)) ? 1 : 0;
                  const bv = visibleLeagueIds.has(String(b.id)) ? 1 : 0;
                  if (av !== bv) return bv - av; // visible first
                  return (a.name || "").localeCompare(b.name || "");
                })
                .map((lg) => (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-3 text-sm px-2 py-1 rounded border ${
                      visibleLeagueIds.has(String(lg.id))
                        ? "bg-gray-800 border-white/10"
                        : "bg-gray-800/40 border-white/5 opacity-70"
                    }`}
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar)}
                      alt=""
                      className="w-5 h-5 rounded object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <span className="truncate">{lg.name}</span>
                    <span className="ml-auto text-[10px] text-gray-400">
                      {lg.isBestBall ? "BB" : "STD"}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Visible leagues (filtered "Showing") modal */}
      {showVisibleLeaguesModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowVisibleLeaguesModal(false)}
        >
          <div
            className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues being shown</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowVisibleLeaguesModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {scanLeagues
                .filter((lg) => visibleLeagueIds.has(String(lg.id)))
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((lg) => (
                  <div
                    key={lg.id}
                    className="flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10"
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar)}
                      alt=""
                      className="w-5 h-5 rounded object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <span className="truncate">{lg.name}</span>
                    <span className="ml-auto text-[10px] text-gray-400">
                      {lg.isBestBall ? "BB" : "STD"}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </span>
                  </div>
                ))}
              {visibleLeagueCount === 0 && (
                <div className="text-sm text-gray-400">No leagues match the current filters.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bye-week conflicts modal */}
      {showByeModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowByeModal(false)}
        >
          <div
            className="w-full max-w-3xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="text-xl font-bold">Bye-week conflicts (by league)</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowByeModal(false)}
              >
                ✕
              </button>
            </div>

            {/* Controls */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm" title="Flag weeks if TOTAL players on bye ≥ this number">
                <span>Flag if total on bye ≥</span>
                <input
                  type="number"
                  min={1}
                  value={byeTotalCap}
                  onChange={(e) => setByeTotalCap(Number(e.target.value || 0))}
                  className="w-16 bg-gray-800 border border-white/10 rounded px-2 py-1"
                />
              </label>

              <label
                className="flex items-center gap-2 text-sm"
                title="Flag if CURRENT STARTERS on bye ≥ this number"
              >
                <span>Flag if starters on bye ≥</span>
                <input
                  type="number"
                  min={1}
                  value={byeStarterCap}
                  onChange={(e) => setByeStarterCap(Number(e.target.value || 0))}
                  className="w-16 bg-gray-800 border border-white/10 rounded px-2 py-1"
                />
              </label>

              <label className="flex items-center gap-2 text-sm ml-auto">
                <input
                  type="checkbox"
                  checked={byeShowOnlyIssues}
                  onChange={() => setByeShowOnlyIssues((v) => !v)}
                />
                <span>Show only weeks with issues</span>
              </label>
            </div>

            {/* Content */}
            <div className="max-h-[65vh] overflow-y-auto pr-1">
              {Object.keys(byeIssuesByLeague).length === 0 ? (
                <div className="text-gray-400">
                  {projectedRows.some((r) => r.bye)
                    ? "No conflicts found with current thresholds."
                    : "No bye-week data configured. Add team bye weeks in utils/nflByeWeeks.js."}
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.values(byeIssuesByLeague).map((lg) => {
                    const leagueRoster = leagueRosters[lg.id];
                    const rp = scanLeaguesMap[lg.id]?.roster_positions || [];
                    const slots = countRosterSlots(rp);
                    const startersTotal = totalStarterSlots(slots);

                    return (
                      <div key={lg.id} className="rounded-lg border border-white/10 bg-gray-800/50">
                        <div className="px-3 py-2 border-b border-white/10 font-semibold">{lg.name}</div>
                        <div className="p-3 grid gap-2">
                          {Object.entries(lg.weeks)
                            .sort((a, b) => Number(a[0]) - Number(b[0]))
                            .map(([wk, stats]) => {
                              const posEntries = Object.entries(stats.pos);
                              const warnings = [];

                              if (stats.total >= startersTotal) {
                                warnings.push(
                                  `You have ${stats.total} total players on bye in Week ${wk}; this lineup has ${startersTotal} starter slots.`
                                );
                              } else if (stats.total >= byeTotalCap) {
                                warnings.push(`High bye volume in Week ${wk}: ${stats.total} players on bye.`);
                              }
                              if (stats.starters >= byeStarterCap) {
                                warnings.push(`${stats.starters} of your current starters are on bye in Week ${wk}.`);
                              }

                              const activeByPos = activeCountsByPos(leagueRoster, wk);

                              posEntries.forEach(([pos, n]) => {
                                const base = slots[pos] || 0;
                                const flexSlots = flexCapacityFor(pos, slots);
                                const totalCap = base + flexSlots;

                                const sameExtra = Math.max(0, (activeByPos[pos] || 0) - base);

                                const otherPositions = eligibleOtherPositionsFor(pos, slots);
                                let crossExtra = 0;
                                otherPositions.forEach((op) => {
                                  crossExtra += Math.max(0, (activeByPos[op] || 0) - (slots[op] || 0));
                                });

                                const othersLabel = otherPositions.length ? otherPositions.join("/") : "—";
                                const needFlex = Math.max(0, n - base);

                                if (totalCap === 0 && n > 0) {
                                  warnings.push(`${pos}: ${n} on bye, but this league has ${capacityText(pos, slots)}.`);
                                } else if (n > totalCap) {
                                  warnings.push(
                                    `${pos}: ${n} on bye, capacity is ${capacityText(pos, slots)}. ` +
                                      `Available this week — same-pos extras: ${sameExtra}; cross-pos flex candidates: ${crossExtra} (${othersLabel}).`
                                  );
                                } else if (n > base) {
                                  warnings.push(
                                    `${pos}: ${n} on bye — needs ${needFlex} flex slot${needFlex > 1 ? "s" : ""}. ` +
                                      `You have ${sameExtra} extra ${pos} and ${crossExtra} cross-pos candidates (${othersLabel}); ` +
                                      `flex slots allowing ${pos}: ${flexSlots}.`
                                  );
                                }
                              });

                              const danger =
                                stats.total >= byeTotalCap || stats.starters >= byeStarterCap || warnings.length > 0;

                              return (
                                <div
                                  key={wk}
                                  className={`rounded p-3 bg-gray-900/60 border ${
                                    danger ? "border-red-500" : "border-white/10"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="text-sm">
                                      <span className="text-gray-400 mr-2">Week</span>
                                      <span className="font-semibold">{wk}</span>
                                    </div>
                                    <div className="text-sm">
                                      <span className="text-gray-400 mr-2">Total</span>
                                      <span className="font-semibold">{stats.total}</span>
                                      <span className="text-gray-400 mx-2">|</span>
                                      <span className="text-gray-400 mr-2">Starters</span>
                                      <span className="font-semibold">{stats.starters}</span>
                                    </div>
                                  </div>

                                  {warnings.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-sm text-red-300">
                                      {warnings.map((w, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                          <span aria-hidden>⚠</span>
                                          <span>{w}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}

                                  {/* position breakdown */}
                                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                    {posEntries
                                      .sort((a, b) => a[0].localeCompare(b[0]))
                                      .map(([pos, n]) => {
                                        const base = slots[pos] || 0;
                                        const flex = flexCapacityFor(pos, slots);
                                        const active = (leagueRoster ? activeCountsByPos(leagueRoster, wk)[pos] : 0) || 0;
                                        const needsFlex = n > base;
                                        const overCap = n > base + flex && base + flex > 0;
                                        return (
                                          <span
                                            key={pos}
                                            className={`px-2 py-1 rounded border ${
                                              overCap
                                                ? "border-red-400 text-red-300"
                                                : needsFlex
                                                ? "border-yellow-400 text-yellow-300"
                                                : "border-white/10 text-gray-300"
                                            }`}
                                            title={`On bye: ${n} • Active (not on bye): ${active} • Capacity: ${capacityText(
                                              pos,
                                              slots
                                            )}`}
                                          >
                                            {pos}: {n}
                                          </span>
                                        );
                                      })}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player detail modal */}
      {openPid &&
        (() => {
          // Pull from ENRICHED list so team/pos/value are accurate
          const openRow = enriched.find((r) => r.player_id === openPid) || null;
          if (!openRow) return null;
          const visibleLeaguesForRow = (openRow.leagues || []).filter((lg) => visibleLeagueIds.has(String(lg.id)));
          return (
            <div
              className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
              onClick={() => setOpenPid(null)}
            >
              <div
                className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <AvatarImage
                      name={openRow._name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-full border object-cover bg-gray-800"
                    />
                    <div>
                      <div className="text-xl font-bold">{openRow._name}</div>
                      <div className="text-xs text-gray-400">
                        {openRow._pos || "—"} • {openRow._team || "FA"}{" "}
                        {Number.isFinite(openRow.bye) ? `• Bye W${openRow.bye}` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                    onClick={() => setOpenPid(null)}
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">Leagues Rostered (visible)</div>
                    <div className="text-2xl font-bold">{visibleLeaguesForRow.length}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">Value ({VALUE_SOURCES[valueSource].label})</div>
                    <div className="text-2xl font-bold">
                      {players?.[openRow.player_id] ? getPlayerValue(players[openRow.player_id]) : 0}
                    </div>
                  </div>
                </div>

                {visibleLeaguesForRow.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs text-gray-400 mb-2">Leagues (• indicates starter)</div>
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                      {visibleLeaguesForRow.map((lg) => (
                        <div
                          key={lg.id}
                          className={`flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10 ${
                            lg.isStarter ? "ring-1 ring-blue-500" : ""
                          }`}
                          title={lg.name}
                        >
                          <img
                            src={leagueAvatarUrl(lg.avatar)}
                            alt=""
                            className="w-5 h-5 rounded object-cover bg-gray-700"
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                            }}
                          />
                          <span className="truncate">{lg.name}</span>
                          {lg.isStarter ? <span className="ml-auto text-[10px] text-blue-300">• starter</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </>
  );
}
