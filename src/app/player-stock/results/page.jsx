// app/player-stock/results/page.jsx
import { Suspense } from "react";
import LoadingScreen from "../../../components/LoadingScreen";

// Tell Next this route is dynamic (prevents SSG/export attempts)
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Server component wrapper
export default function ResultsPage() {
  return (
    <Suspense fallback={<LoadingScreen progress={10} text="Loading Player Stock…" />}>
      <ClientResults />
    </Suspense>
  );
}





import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "../../../components/Navbar";
import BackgroundParticles from "../../../components/BackgroundParticles";
import LoadingScreen from "../../../components/LoadingScreen";
import ValueSourceDropdown from "../../../components/ValueSourceDropdown";
import { useSleeper } from "../../../context/SleeperContext";
import AvatarImage from "../../../components/AvatarImage";
import { getTeamByeWeek } from "../../../utils/nflByeWeeks";



// value sources
const VALUE_SOURCES = {
  FantasyCalc: { label: "FantasyCalc", supports: { dynasty: true, redraft: true, qbToggle: true } },
  DynastyProcess: { label: "DynastyProcess", supports: { dynasty: true, redraft: false, qbToggle: true } },
  KeepTradeCut: { label: "KeepTradeCut", supports: { dynasty: true, redraft: false, qbToggle: true } },
  FantasyNavigator: { label: "FantasyNavigator", supports: { dynasty: true, redraft: true, qbToggle: true } },
  IDynastyP: { label: "IDynastyP", supports: { dynasty: true, redraft: false, qbToggle: true } },
};

// league avatar helpers
const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) =>
  avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : DEFAULT_LEAGUE_IMG;

// trending config
const TRENDING_LIMIT = 50;
const LOOKBACK_OPTS = [1, 6, 12, 24, 48, 72, 168]; // hours

// --- Everything below is your existing page code, moved into a client component ---
function ClientResults() {
  "use client";
  const { username, year, players, format, qbType, setFormat, setQbType } = useSleeper();
  const params = useSearchParams();

  // ui state
  const [loading, setLoading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState("Preparing scan…");
  const [error, setError] = useState("");

  const [valueSource, setValueSource] = useState("FantasyCalc");
  const [query, setQuery] = useState("");
  const [highlightStarters, setHighlightStarters] = useState(false);

  const [lastUpdated, setLastUpdated] = useState(null);

  // scan data
  const [leagueCount, setLeagueCount] = useState(0);
  // [{id,name,avatar,roster_positions}]
  const [scanLeagues, setScanLeagues] = useState([]);
  // rows: {player_id, name, position, team, bye, count, leagues:[{id,name,isStarter,avatar}]}
  const [rows, setRows] = useState([]);
  // per-league roster we own: { [leagueId]: { id, name, roster_positions, players:[{pid,pos,team,bye,isStarter}] } }
  const [leagueRosters, setLeagueRosters] = useState({});

  // modals
  const [openPid, setOpenPid] = useState(null);
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [showByeModal, setShowByeModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  // sorting
  const [sortKey, setSortKey] = useState("count"); // name | team | pos | count | value
  const [sortDir, setSortDir] = useState("desc");  // asc | desc

  // pagination
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // exposure guardrails
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

  // 🔥/🧊 Trending adds & drops
  const [trendingHours, setTrendingHours] = useState(24);
  const [trendingMode, setTrendingMode] = useState("all"); // all | adds | drops
  const [trendingAddMap, setTrendingAddMap] = useState(() => new Map());   // pid -> add count
  const [trendingDropMap, setTrendingDropMap] = useState(() => new Map()); // pid -> drop count

  // load trending adds (session-cached by lookback window)
  useEffect(() => {
    const key = `ps:trending:add:${trendingHours}:L${TRENDING_LIMIT}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const obj = JSON.parse(cached);
      setTrendingAddMap(new Map(Object.entries(obj)));
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=${trendingHours}&limit=${TRENDING_LIMIT}`
        );
        const arr = await res.json();
        const top = (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []);
        const m = new Map(top.map(it => [String(it.player_id), it.count || 0]));
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingAddMap(m);
      } catch {
        setTrendingAddMap(new Map());
      }
    })();
  }, [trendingHours]);

  // load trending drops (session-cached by lookback window)
  useEffect(() => {
    const key = `ps:trending:drop:${trendingHours}:L${TRENDING_LIMIT}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const obj = JSON.parse(cached);
      setTrendingDropMap(new Map(Object.entries(obj)));
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=${trendingHours}&limit=${TRENDING_LIMIT}`
        );
        const arr = await res.json();
        const top = (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []);
        const m = new Map(top.map(it => [String(it.player_id), it.count || 0]));
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingDropMap(m);
      } catch {
        setTrendingDropMap(new Map());
      }
    })();
  }, [trendingHours]);

  const supports = VALUE_SOURCES[valueSource].supports;

  // value helper (match Trade Analyzer)
  const getPlayerValue = (p) => {
    if (!p) return 0;
    if (valueSource === "FantasyCalc") {
      return format === "dynasty"
        ? qbType === "sf" ? p.fc_values?.dynasty_sf || 0 : p.fc_values?.dynasty_1qb || 0
        : qbType === "sf" ? p.fc_values?.redraft_sf || 0 : p.fc_values?.redraft_1qb || 0;
    } else if (valueSource === "DynastyProcess") {
      return qbType === "sf" ? (p.dp_values?.superflex || 0) : (p.dp_values?.one_qb || 0);
    } else if (valueSource === "KeepTradeCut") {
      return qbType === "sf" ? (p.ktc_values?.superflex || 0) : (p.ktc_values?.one_qb || 0);
    } else if (valueSource === "FantasyNavigator") {
      return format === "dynasty"
        ? qbType === "sf" ? p.fn_values?.dynasty_sf || 0 : p.fn_values?.dynasty_1qb || 0
        : qbType === "sf" ? p.fn_values?.redraft_sf || 0 : p.fn_values?.redraft_1qb || 0;
    } else if (valueSource === "IDynastyP") {
      return qbType === "sf" ? (p.idp_values?.superflex || 0) : (p.idp_values?.one_qb || 0);
    }
    return 0;
  };

  // add team/pos/value safely
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

  // scan (session-cached)
  useEffect(() => {
    if (!username) return;

    const yr = params.get("year") || String(year || new Date().getFullYear());
    const onlyBB = params.get("only_bestball") === "1";
    const excludeBB = params.get("exclude_bestball") === "1";
    const includeDrafting = params.get("include_drafting") !== "0"; // default include
    const force = params.get("force") === "1";
    const cacheKey = `ps:${username}:${yr}:${onlyBB ? "bb1" : ""}:${excludeBB ? "nobb1" : ""}:${includeDrafting ? "dr1" : "dr0"}`;
    let cancel = false;

    async function scan() {
      try {
        setError("");
        setLoading(true);
        setProgressPct(3);
        setProgressText("Looking up user…");

        const cached = !force ? sessionStorage.getItem(cacheKey) : null;
        if (cached) {
          const { rows: cachedRows, leagueCount: cachedLeagues, leagues: cachedList, leagueRosters: cachedRosters, ts } = JSON.parse(cached);
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

        // 2) leagues
        const leaguesRes = await fetch(
          `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${yr}`
        );
        const leagues = await leaguesRes.json();

        // filter statuses
        const statusSet = new Set(["in_season", "complete"]);
        if (includeDrafting) statusSet.add("drafting");

        const filtered = leagues.filter((lg) => {
          const isBestBall = lg?.settings?.best_ball === 1;
          if (onlyBB && !isBestBall) return false;
          if (excludeBB && isBestBall) return false;
          return statusSet.has(lg.status);
        });

        if (cancel) return;

        setLeagueCount(filtered.length);
        setScanLeagues(
          filtered.map((lg) => ({
            id: lg.league_id,
            name: lg.name,
            avatar: lg.avatar || null,
            roster_positions: lg.roster_positions || [],
          }))
        );
        if (filtered.length === 0) {
          setRows([]);
          setLeagueRosters({});
          setProgressPct(100);
          setProgressText("No leagues matched filters.");
          setLoading(false);
          return;
        }

        // 3) iterate rosters with live progress
        const playerCounts = {};
        const playerLeagues = {};
        const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
        const catalog = await playersRes.json();

        const nextLeagueRosters = {};

        for (let i = 0; i < filtered.length; i++) {
          const lg = filtered[i];
          setProgressText(`Scanning leagues… (${i + 1}/${filtered.length})`);
          setProgressPct(Math.round(((i + 1) / filtered.length) * 100 * 0.92) + 8);

          const rostersRes = await fetch(
            `https://api.sleeper.app/v1/league/${lg.league_id}/rosters`
          );
          const rosters = await rostersRes.json();
          const mine = rosters.find((r) => r.owner_id === userId);
          if (!mine?.players) continue;

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

        // 4) shape rows (bye from util, per team/year)
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

        const payload = {
          rows: built,
          leagueCount: filtered.length,
          leagues: filtered.map((lg) => ({
            id: lg.league_id,
            name: lg.name,
            avatar: lg.avatar || null,
            roster_positions: lg.roster_positions || [],
          })),
          leagueRosters: nextLeagueRosters,
          ts: Date.now(),
        };
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));

        setRows(built);
        setLeagueRosters(nextLeagueRosters);
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
    }

    scan();
    return () => { cancel = true; };
  }, [username, year, params]);

  // enrich with value/team/pos etc.
  const enriched = useMemo(() => rows.map(withLocalPlayerData), [rows, valueSource, players, format, qbType]);

  // search + optional trending filter
  const filteredRows = useMemo(() => {
    let list = enriched;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((r) =>
        r._name.toLowerCase().includes(q) ||
        r._team.toLowerCase().includes(q) ||
        r._pos.toLowerCase().includes(q)
      );
    }
    if (trendingMode === "adds") {
      list = list.filter((r) => trendingAddMap.has(r.player_id));
    } else if (trendingMode === "drops") {
      list = list.filter((r) => trendingDropMap.has(r.player_id));
    }
    return list;
  }, [enriched, query, trendingMode, trendingAddMap, trendingDropMap]);

  // sort
  const toggleSort = (key) => {
    setCurrentPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "team" || key === "pos" ? "asc" : "desc");
    }
  };
  const sortIndicator = (key) => {
    if (sortKey !== key) return <span className="opacity-40">↕</span>;
    return sortDir === "asc" ? <span>▲</span> : <span>▼</span>;
  };
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
      if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
      if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
      if (sortKey === "value") return ((a._value || 0) - (b._value || 0)) * dir;
      return ((a.count || 0) - (b.count || 0)) * dir;
    });
  }, [filteredRows, sortKey, sortDir]);

  // pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(currentPage, totalPages);
  const start = (current - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  const starterPidSet = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => {
      if (r.leagues?.some((lg) => lg.isStarter)) s.add(r.player_id);
    });
    return s;
  }, [rows]);

  const openRow = enriched.find((r) => r.player_id === openPid);

  /* ======== Bye-week conflict helpers (unchanged core) ======== */
  const scanLeaguesMap = useMemo(() => {
    const m = {};
    for (const lg of scanLeagues) m[lg.id] = lg;
    return m;
  }, [scanLeagues]);

  const [byeTotalCap, setByeTotalCap] = useState(4);
  const [byeStarterCap, setByeStarterCap] = useState(3);
  const [byeShowOnlyIssues, setByeShowOnlyIssues] = useState(true);

  const START_SLOTS = new Set([
    "QB", "RB", "WR", "TE",
    "FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX",
  ]);

  const SLOT_ELIGIBILITY = {
    FLEX: new Set(["RB", "WR", "TE"]),
    WRRB_FLEX: new Set(["RB", "WR"]),
    REC_FLEX: new Set(["WR", "TE"]),
    SUPER_FLEX: new Set(["QB", "RB", "WR", "TE"]),
  };

  function countRosterSlots(roster_positions = []) {
    const slots = {
      QB: 0, RB: 0, WR: 0, TE: 0,
      FLEX: 0, WRRB_FLEX: 0, REC_FLEX: 0, SUPER_FLEX: 0,
    };
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
    if (pos === "QB") cap += (slots.SUPER_FLEX || 0);
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
      if (set && set.has(pos)) {
        set.forEach((p) => union.add(p));
      }
    });
    union.delete(pos);
    return Array.from(union).sort();
  }
  function activeCountsByPos(leagueRoster, week) {
    const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
    if (!leagueRoster?.players) return counts;
    leagueRoster.players.forEach((pl) => {
      const pos = (pl.pos || "UNK").toUpperCase();
      if (!counts.hasOwnProperty(pos)) return;
      const isOnBye = Number.isFinite(pl.bye) && Number(pl.bye) === Number(week);
      if (!isOnBye) counts[pos] += 1;
    });
    return counts;
  }

  const byeByLeague = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
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
  }, [rows, players]);

  const byeIssuesByLeague = useMemo(() => {
    const issues = {};
    Object.entries(byeByLeague).forEach(([lid, league]) => {
      const rp = scanLeaguesMap[lid]?.roster_positions || [];
      const slots = countRosterSlots(rp);
      const startersTotal = totalStarterSlots(slots);

      const wkIssues = {};
      Object.entries(league.weeks).forEach(([wk, stats]) => {
        const hasProblem =
          stats.total >= byeTotalCap ||
          stats.starters >= byeStarterCap ||
          stats.total >= startersTotal;

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

  /* ============================================================ */

  // Filters "dirty" indicator (tiny dot if anything differs from defaults)
  const filtersDirty =
    valueSource !== "FantasyCalc" ||
    (supports.dynasty && supports.redraft && format !== "dynasty") || // default assume dynasty as previously selected
    (supports.qbToggle && qbType !== "sf") || // default assume SF as previously set in your app; tweak if needed
    highlightStarters !== false ||
    trendingMode !== "all" ||
    trendingHours !== 24 ||
    pageSize !== 25 ||
    maxExposurePct !== initialExposureRef.current;

  const resetFilters = () => {
    setValueSource("FantasyCalc");
    // keep format/qbType if you want global defaults; otherwise uncomment to force:
    // setFormat("dynasty");
    // setQbType("sf");
    setHighlightStarters(false);
    setTrendingMode("all");
    setTrendingHours(24);
    setPageSize(25);
    setMaxExposurePct(initialExposureRef.current ?? 35);
  };

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Player Stock" />

      {loading && <LoadingScreen progress={progressPct} text={progressText} />}

      <div className="max-w-6xl mx-auto px-4 pt-14">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the{" "}
            <a href="/" className="text-blue-400 underline">
              homepage
            </a>{" "}
            to use this tool.
          </div>
        ) : (
          <>
            {/* Top bar: Search | Filters | Summary */}
            <div className="bg-gray-900 rounded-lg p-4 mb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {/* left: search */}
                <div className="flex items-center gap-3">
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
                    placeholder="Search name, team, position…"
                    className="w-full sm:w-80 px-3 py-2 rounded bg-gray-800 text-white placeholder-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFiltersModal(true)}
                    className="relative rounded px-3 py-2 border border-white/20 hover:bg-white/10"
                    title="Show filters and options"
                  >
                    Filters
                    {filtersDirty && (
                      <span
                        className="absolute -top-1 -right-1 inline-block w-3 h-3 rounded-full bg-blue-500 ring-2 ring-gray-900"
                        aria-hidden
                      />
                    )}
                  </button>
                </div>

                {/* right: scan summary */}
                <div className="text-sm text-gray-400">
                  {leagueCount > 0 && (
                    <button
                      type="button"
                      className="underline decoration-dotted hover:text-white"
                      onClick={() => setShowLeaguesModal(true)}
                      title="Show all leagues included in this scan"
                    >
                      Scanned <span className="text-white font-semibold">{leagueCount}</span> leagues
                    </button>
                  )}
                  {lastUpdated && (
                    <span className="ml-3 text-xs text-gray-500">Last scan: {lastUpdated.toLocaleTimeString()}</span>
                  )}
                  {error && <span className="text-red-400 ml-3">{error}</span>}
                </div>
              </div>

              {/* second row: bye-week button only (decluttered) */}
              <div className="mt-3 flex items-center justify-end">
                <button
                  className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                  onClick={() => setShowByeModal(true)}
                  title="See per-league bye-week risk"
                >
                  Bye-week conflicts
                </button>
              </div>
            </div>

            {/* Table */}
            {sorted.length === 0 ? (
              <div className="text-center text-gray-400 py-10">
                {loading ? "Working…" : (trendingMode !== "all" ? "No matching trending players." : "No players found.")}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg shadow ring-1 ring-white/10">
                <table className="min-w-full bg-gray-900">
                  <thead className="bg-gray-800/60">
                    <tr>
                      <th className="text-left px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("name")}>
                        Player <span className="ml-1 inline-block">{sortIndicator("name")}</span>
                      </th>
                      <th className="text-left px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("team")}>
                        Team <span className="ml-1 inline-block">{sortIndicator("team")}</span>
                      </th>
                      <th className="text-left px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("pos")}>
                        Pos <span className="ml-1 inline-block">{sortIndicator("pos")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("count")}>
                        Leagues <span className="ml-1 inline-block">{sortIndicator("count")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("value")}>
                        Value <span className="ml-1 inline-block">{sortIndicator("value")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const isStarter = starterPidSet.has(r.player_id);
                      const exposure = leagueCount ? Math.round((r.count / leagueCount) * 100) : 0;
                      const overCap = exposure > maxExposurePct;
                      const addCount = trendingAddMap.get(r.player_id);
                      const dropCount = trendingDropMap.get(r.player_id);

                      const titleBits = [];
                      if (overCap) titleBits.push(`Exposure ${exposure}% exceeds ${maxExposurePct}%`);
                      if (addCount) titleBits.push(`Trending adds: ${addCount}`);
                      if (dropCount) titleBits.push(`Trending drops: ${dropCount}`);

                      return (
                        <tr
                          key={r.player_id}
                          className="border-t border-white/10 hover:bg-gray-800 cursor-pointer"
                          onClick={() => setOpenPid(r.player_id)}
                          title={titleBits.join(" • ")}
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-3">
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
                                    : (highlightStarters && isStarter ? "text-blue-400 font-semibold" : "")
                                }
                              >
                                {r._name}
                              </span>
                              {Number.isFinite(r.bye) && (
                                <span className="ml-2 text-xs text-gray-400">W{r.bye}</span>
                              )}
                              {addCount ? (
                                <span
                                  className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70"
                                  aria-label="Trending adds"
                                  title={`Trending adds: ${addCount}`}
                                >
                                  🔥 {addCount}
                                </span>
                              ) : null}
                              {dropCount ? (
                                <span
                                  className="ml-1 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70"
                                  aria-label="Trending drops"
                                  title={`Trending drops: ${dropCount}`}
                                >
                                  🧊 {dropCount}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-gray-300">{r._team || "—"}</td>
                          <td className="px-4 py-2 text-gray-300">{r._pos || "—"}</td>
                          <td className="px-4 py-2 text-right">{r.count}</td>
                          <td className="px-4 py-2 text-right">{r._value}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination controls */}
            {sorted.length > 0 && (
              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded bg-gray-800 text-gray-200 border border-white/10 disabled:opacity-40"
                  disabled={current <= 1}
                >
                  Prev
                </button>
                {Array.from({ length: totalPages }).slice(0, 10).map((_, i) => {
                  const page = i + 1;
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 rounded border ${
                        page === current
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-gray-800 text-gray-200 border-white/10 hover:bg-gray-700"
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
                {totalPages > 10 && <span className="text-gray-400 px-2">…</span>}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded bg-gray-800 text-gray-200 border border-white/10 disabled:opacity-40"
                  disabled={current >= totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Player modal */}
      {openRow && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setOpenPid(null)}
        >
          <div
            className="w-full max-w-2xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
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
                  <div className="text-sm text-gray-400">
                    {openRow._pos || "—"} • {openRow._team || "FA"} {Number.isFinite(openRow.bye) ? `• Bye W${openRow.bye}` : ""}
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
                <div className="text-xs text-gray-400">Leagues Rostered</div>
                <div className="text-2xl font-bold">{openRow.count}</div>
              </div>
              <div className="bg-gray-800/60 rounded p-3">
                <div className="text-xs text-gray-400">
                  Value ({VALUE_SOURCES[valueSource].label})
                </div>
                <div className="text-2xl font-bold">
                  {players?.[openRow.player_id] ? getPlayerValue(players[openRow.player_id]) : 0}
                </div>
              </div>
            </div>

            {/* trending pills in modal too */}
            <div className="mt-3 text-sm text-gray-300 flex items-center gap-2">
              {trendingAddMap.get(openRow.player_id) ? (
                <span className="text-[12px] px-2 py-0.5 rounded border border-white/10 bg-gray-800/70">
                  🔥 {trendingAddMap.get(openRow.player_id)} adds
                </span>
              ) : null}
              {trendingDropMap.get(openRow.player_id) ? (
                <span className="text-[12px] px-2 py-0.5 rounded border border-white/10 bg-gray-800/70">
                  🧊 {trendingDropMap.get(openRow.player_id)} drops
                </span>
              ) : null}
            </div>

            {openRow.leagues?.length > 0 && (
              <div className="mt-5">
                <div className="text-xs text-gray-400 mb-2">Leagues (• indicates starter)</div>
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {openRow.leagues.map((lg) => (
                    <div
                      key={lg.id}
                      className={`flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10 ${lg.isStarter ? "ring-1 ring-blue-500" : ""}`}
                      title={lg.name}
                    >
                      <img
                        src={leagueAvatarUrl(lg.avatar)}
                        alt=""
                        className="w-5 h-5 rounded object-cover bg-gray-700"
                        onError={(e) => { e.currentTarget.src = DEFAULT_LEAGUE_IMG; }}
                      />
                      <span className="truncate">{lg.name}</span>
                      {lg.isStarter && <span className="ml-auto text-xs opacity-80">• Starter</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters modal */}
      {showFiltersModal && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowFiltersModal(false)}>
          <div className="w-full max-w-3xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="text-xl font-bold">Filters & Options</div>
              <button className="rounded px-2 py-1 border border-white/20 hover:bg-white/10" onClick={() => setShowFiltersModal(false)}>✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Values */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Value Source</div>
                <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
              </div>

              {/* Exposure */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Max Exposure %</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={maxExposurePct}
                  onChange={(e) => setMaxExposurePct(Number(e.target.value || 0))}
                  className="w-28 bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                  title="Rows over this % (count / scanned leagues) are flagged"
                />
              </div>

              {/* Trending */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/10">
                <div className="text-xs text-gray-400 mb-2">Trending Window & Mode</div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Lookback</span>
                    <select
                      value={trendingHours}
                      onChange={(e) => setTrendingHours(Number(e.target.value))}
                      className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                      title="Lookback window (hours) for trending adds/drops"
                    >
                      {LOOKBACK_OPTS.map(h => <option key={h} value={h}>{h}h</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Mode</span>
                    <select
                      value={trendingMode}
                      onChange={(e) => setTrendingMode(e.target.value)}
                      className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                      title="Filter rows to trending"
                    >
                      <option value="all">All</option>
                      <option value="adds">Adds only</option>
                      <option value="drops">Drops only</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Format & QB */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/10">
                <div className="text-xs text-gray-400 mb-2">Format & Lineup</div>
                <div className="flex flex-wrap items-center gap-4">
                  {supports.dynasty && supports.redraft && (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={format === "dynasty"}
                        onChange={() => setFormat(format === "dynasty" ? "redraft" : "dynasty")}
                        className="sr-only peer"
                      />
                      <div className="w-14 h-7 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all peer-checked:after:translate-x-7"></div>
                      <span className="ml-3">{format === "dynasty" ? "Dynasty" : "Redraft"}</span>
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
                      <span className="ml-3">{qbType === "sf" ? "Superflex" : "1QB"}</span>
                    </label>
                  )}

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={highlightStarters}
                      onChange={() => setHighlightStarters((v) => !v)}
                    />
                    <span>Highlight starters</span>
                  </label>
                </div>
              </div>

              {/* Rows per page */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Rows per page</div>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                >
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
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
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowLeaguesModal(false)}>
          <div className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues in this scan</div>
              <button className="rounded px-2 py-1 border border-white/20 hover:bg-white/10" onClick={() => setShowLeaguesModal(false)}>✕</button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {scanLeagues.map((lg) => (
                <div key={lg.id} className="flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10">
                  <img
                    src={leagueAvatarUrl(lg.avatar)}
                    alt=""
                    className="w-5 h-5 rounded object-cover bg-gray-700"
                    onError={(e) => { e.currentTarget.src = DEFAULT_LEAGUE_IMG; }}
                  />
                  <span className="truncate">{lg.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bye-week conflicts modal */}
      {showByeModal && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowByeModal(false)}>
          <div className="w-full max-w-3xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="text-xl font-bold">Bye-week conflicts (by league)</div>
              <button className="rounded px-2 py-1 border border-white/20 hover:bg-white/10" onClick={() => setShowByeModal(false)}>✕</button>
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

              <label className="flex items-center gap-2 text-sm" title="Flag weeks if CURRENT STARTERS on bye ≥ this number">
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
                  onChange={() => setByeShowOnlyIssues(v => !v)}
                />
                <span>Show only weeks with issues</span>
              </label>
            </div>

            {/* Content */}
            <div className="max-h-[65vh] overflow-y-auto pr-1">
              {Object.keys(byeIssuesByLeague).length === 0 ? (
                <div className="text-gray-400">
                  {rows.some(r => r.bye) ? "No conflicts found with current thresholds." : "No bye-week data configured. Add team bye weeks in utils/nflByeWeeks.js."}
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
                        <div className="px-3 py-2 border-b border-white/10 font-semibold">
                          {lg.name}
                        </div>
                        <div className="p-3 grid gap-2">
                          {Object.entries(lg.weeks)
                            .sort((a, b) => Number(a[0]) - Number(b[0]))
                            .map(([wk, stats]) => {
                              const posEntries = Object.entries(stats.pos);
                              const warnings = [];

                              if (stats.total >= startersTotal) {
                                warnings.push(`You have ${stats.total} total players on bye in Week ${wk}; this lineup has ${startersTotal} starter slots.`);
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
                                stats.total >= byeTotalCap ||
                                stats.starters >= byeStarterCap ||
                                warnings.length > 0;

                              return (
                                <div
                                  key={wk}
                                  className={`rounded p-3 bg-gray-900/60 border ${danger ? "border-red-500" : "border-white/10"}`}
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
                                        const overCap = n > (base + flex) && (base + flex) > 0;
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
                                            title={`On bye: ${n} • Active (not on bye): ${active} • Capacity: ${capacityText(pos, slots)}`}
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
    </>
  );
}

