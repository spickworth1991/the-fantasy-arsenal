"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Navbar = dynamic(() => import("../../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(
  () => import("../../../components/BackgroundParticles"),
  { ssr: false }
);

import LoadingScreen from "../../../components/LoadingScreen";
import SourceSelector from "../../../components/SourceSelector";
import { useSleeper } from "../../../context/SleeperContext";
import AvatarImage from "../../../components/AvatarImage";

const safeNum = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  if (typeof v === "string") {
    const cleaned = v.replace(/[$,%\s]/g, "").replace(/,/g, "");
    const x = Number(cleaned);
    return Number.isFinite(x) ? x : 0;
  }

  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// League avatar helpers
const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) =>
  avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : DEFAULT_LEAGUE_IMG;

const TRENDING_LIMIT = 50;

export default function ClientResults({ initialSearchParams = {} }) {
  const {
    username,
    year,
    players,
    format,
    qbType,
    setFormat,
    setQbType,

    // unified source selection (values OR projections)
    selectedSource,
    sourceKey,
    setSourceKey,

    metricType,
    getPlayerValueForSelectedSource,
  } = useSleeper();

  // Support either "selectedSource" or "sourceKey" naming, depending on your context
  const effectiveSourceKey = sourceKey ?? selectedSource ?? "";
  const setEffectiveSourceKey = setSourceKey ?? (() => {});

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

  const mt = String(metricType || "").toLowerCase();
  const isProj =
    mt === "projection" ||
    mt === "projections" ||
    mt === "proj" ||
    mt.includes("proj");

  const valueOrProjLabel = isProj ? "Proj (avg)" : "Value";
  const valueOrProjSortKey = isProj ? "proj" : "value";

  const [query, setQuery] = useState("");
  const [highlightStarters, setHighlightStarters] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Scan data
  const [leagueCount, setLeagueCount] = useState(0);
  const [scanLeagues, setScanLeagues] = useState([]);
  const [rows, setRows] = useState([]);

  // Modals
  const [openPid, setOpenPid] = useState(null);
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [showVisibleLeaguesModal, setShowVisibleLeaguesModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  // Sorting
  const [sortKey, setSortKey] = useState("count"); // name | team | pos | count | value | proj
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

  // Manual league selection
  const [manualLeagueSelect, setManualLeagueSelect] = useState(false);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState(() => new Set());

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
          (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []).map((it) => [
            String(it.player_id),
            it.count || 0,
          ])
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
          (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []).map((it) => [
            String(it.player_id),
            it.count || 0,
          ])
        );
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingDropMap(m);
      } catch {
        setTrendingDropMap(new Map());
      }
    })();
  }, [trendingHours]);

  // === Unified metric helper ===
  const getMetricRaw = (p) => safeNum(getPlayerValueForSelectedSource?.(p));

  const withLocalPlayerData = (row) => {
    const p = players?.[row.player_id];
    const base = {
      ...row,
      _name:
        row.name ||
        p?.full_name ||
        `${p?.first_name || ""} ${p?.last_name || ""}`.trim() ||
        "Unknown",
      _pos: (row.position || p?.position || "").toUpperCase(),
      _team: (row.team || p?.team || "").toUpperCase(),
    };

    const raw = p ? getMetricRaw(p) : 0;

    if (isProj) {
      base._projAvg = raw;
      base._projSeason = 0;
      base._value = 0;
    } else {
      base._value = raw;
      base._projSeason = 0;
      base._projAvg = 0;
    }

    return base;
  };

  // "Draft-like" for UI filtering only (pre_draft OR drafting)
  const isDraftLike = (status) => {
    const s = String(status || "").toLowerCase();
    return s.includes("pre_draft") || s.includes("drafting") || s === "draft";
  };

  // ✅ Only true when the league is ACTUALLY drafting (this is the ONLY time we fetch picks)
  const isActivelyDrafting = (status) => {
    const s = String(status || "").toLowerCase();
    return s.includes("drafting") || s === "drafting";
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
          const { rows: cachedRows, leagueCount: cachedLeagues, leagues: cachedList, ts } =
            JSON.parse(cached);

          if (!cancel) {
            setRows(cachedRows || []);
            setLeagueCount(cachedLeagues ?? 0);
            setScanLeagues(cachedList || []);
            setLastUpdated(ts ? new Date(ts) : new Date());

            setSelectedLeagueIds((prev) => {
              if (prev && prev.size > 0) return prev;
              return new Set((cachedList || []).map((l) => String(l.id)));
            });

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

        if (cancel) return;

        if (!Array.isArray(leagues) || leagues.length === 0) {
          setRows([]);
          setLeagueCount(0);
          setScanLeagues([]);
          setProgressPct(100);
          setProgressText("No leagues found.");
          setLoading(false);
          return;
        }

        // 3) iterate:
        // - if drafting => picks only
        // - else => rosters only
        const playerCounts = {};
        const playerLeagues = {};
        const includedLeagues = [];

        const fetchJson = async (url) => {
          const r = await fetch(url);
          if (!r.ok) return null;
          try {
            return await r.json();
          } catch {
            return null;
          }
        };

        // prefer league.draft_id; otherwise fetch most recent draft for league (ONLY when drafting)
        const getMostRecentDraftIdForLeague = async (leagueId, fallbackDraftId) => {
          if (fallbackDraftId) return String(fallbackDraftId);
          const drafts = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
          if (Array.isArray(drafts) && drafts.length > 0)
            return drafts[0]?.draft_id ? String(drafts[0].draft_id) : null;
          return null;
        };

        const getMyDraftPickedPlayerIds = async (leagueId, userId, fallbackDraftId) => {
          const draftId = await getMostRecentDraftIdForLeague(leagueId, fallbackDraftId);
          if (!draftId) return [];

          const picks = await fetchJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
          if (!Array.isArray(picks) || picks.length === 0) return [];

          const mine = [];
          for (const p of picks) {
            const pickedByMe = p?.picked_by != null && String(p.picked_by) === String(userId);
            if (pickedByMe) {
              const pid = p?.player_id != null ? String(p.player_id) : "";
              if (pid) mine.push(pid);
            }
          }
          return mine;
        };

        for (let i = 0; i < leagues.length; i++) {
          const lg = leagues[i];

          setProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
          setProgressPct(Math.round(((i + 1) / leagues.length) * 100 * 0.92) + 8);

          if (cancel) return;

          const draftingNow = isActivelyDrafting(lg.status);

          let rosterPlayers = [];
          let startersSet = new Set();
          let draftPlayers = [];

          if (draftingNow) {
            // ✅ Draft picks ONLY when actively drafting
            draftPlayers = await getMyDraftPickedPlayerIds(
              lg.league_id,
              userId,
              lg.draft_id || null
            );

            if (draftPlayers.length === 0) continue; // not your draft / no picks yet

          } else {
            // ✅ Rosters ONLY when NOT actively drafting
            const rosters = await fetchJson(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);

            const mineRoster = Array.isArray(rosters)
              ? rosters.find((r) => String(r?.owner_id) === String(userId))
              : null;

            rosterPlayers = Array.isArray(mineRoster?.players) ? mineRoster.players.map(String) : [];
            startersSet = new Set(Array.isArray(mineRoster?.starters) ? mineRoster.starters.map(String) : []);

            if (rosterPlayers.length === 0) continue; // ignore empty/non-owned leagues
          }

          const leagueInfo = {
            id: lg.league_id,
            name: lg.name,
            avatar: lg.avatar || null,
            roster_positions: lg.roster_positions || [],
            status: lg.status || "",
            isBestBall: lg?.settings?.best_ball === 1,

            // ✅ used by "Include drafting leagues" filter:
            // treat roster leagues as true; drafting-only leagues as false
            hasRoster: rosterPlayers.length > 0,
          };

          includedLeagues.push(leagueInfo);

          const mergedPids = new Set([...rosterPlayers, ...draftPlayers]);

          for (const pid of mergedPids) {
            playerCounts[pid] = (playerCounts[pid] || 0) + 1;

            if (!playerLeagues[pid]) playerLeagues[pid] = [];
            playerLeagues[pid].push({
              id: leagueInfo.id,
              name: leagueInfo.name,
              avatar: leagueInfo.avatar,
              status: leagueInfo.status,
              isBestBall: leagueInfo.isBestBall,
              hasRoster: leagueInfo.hasRoster,
              isStarter: startersSet.has(pid), // drafting leagues => false for all
            });
          }

          if (cancel) return;
        }

        if (includedLeagues.length === 0) {
          setRows([]);
          setLeagueCount(0);
          setScanLeagues([]);
          setLastUpdated(new Date());
          setProgressPct(100);
          setProgressText("No leagues found for this user.");
          setLoading(false);
          return;
        }

        // 4) shape rows (use already-loaded players map; avoid /players/nfl)
        const built = Object.entries(playerCounts)
          .map(([pid, count]) => {
            const base = players?.[pid] || {};
            const team = String(base.team || "").toUpperCase();
            const pos = String(base.position || "").toUpperCase();

            const name =
              base.full_name ||
              `${base.first_name || ""} ${base.last_name || ""}`.trim() ||
              (team && team.length <= 4 ? team : "") ||
              String(pid);

            return {
              player_id: String(pid),
              name,
              team,
              position: pos,
              count,
              leagues: playerLeagues[pid] || [],
            };
          })
          .sort((a, b) => b.count - a.count);

        if (cancel) return;

        const payload = {
          rows: built,
          leagueCount: includedLeagues.length,
          leagues: includedLeagues,
          ts: Date.now(),
        };
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));

        setRows(built);
        setLeagueCount(includedLeagues.length);
        setScanLeagues(includedLeagues);

        setSelectedLeagueIds((prev) => {
          if (prev && prev.size > 0) return prev;
          return new Set(includedLeagues.map((l) => String(l.id)));
        });

        setLastUpdated(new Date());
        setProgressPct(100);
        setProgressText("Done!");
      } catch (e) {
        setError(e?.message || "Scan failed");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [username, year, paramsKey, forceScanNonce]);

  // Enriched rows (metric from context)
  const enriched = useMemo(
    () => rows.map(withLocalPlayerData),
    [rows, players, isProj, metricType, effectiveSourceKey]
  );

  // Visible league IDs after display filters
  const visibleLeagueIds = useMemo(() => {
    if (!scanLeagues || scanLeagues.length === 0) return new Set();
    const arr = scanLeagues
      .filter((lg) => {
        if (onlyBestBall && !lg.isBestBall) return false;
        if (excludeBestBall && lg.isBestBall) return false;

        // If "Include drafting" is OFF, hide draft-like leagues ONLY when they do NOT have rosters.
        // (Drafting-only leagues have hasRoster=false; offseason dynasty leagues with rosters stay visible.)
        if (!includeDrafting && isDraftLike(lg.status) && !lg.hasRoster) return false;

        return true;
      })
      .map((lg) => String(lg.id));
    return new Set(arr);
  }, [scanLeagues, onlyBestBall, excludeBestBall, includeDrafting]);

  // Apply manual league selection (if enabled) ON TOP of visible filters
  const activeLeagueIds = useMemo(() => {
    if (!manualLeagueSelect) return visibleLeagueIds;
    const out = new Set();
    for (const id of selectedLeagueIds) {
      if (visibleLeagueIds.has(String(id))) out.add(String(id));
    }
    return out;
  }, [manualLeagueSelect, selectedLeagueIds, visibleLeagueIds]);

  const visibleLeagueCount = activeLeagueIds.size || 0;

  // Project rows to active leagues, drop zeroes
  const projectedRows = useMemo(() => {
    if (!activeLeagueIds) return enriched;
    return enriched
      .map((row) => {
        const leagues = (row.leagues || []).filter((lg) =>
          activeLeagueIds.has(String(lg.id))
        );
        return { ...row, leagues, count: leagues.length };
      })
      .filter((r) => r.count > 0);
  }, [enriched, activeLeagueIds]);

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
        (r) =>
          r._name.toLowerCase().includes(q) ||
          r._team.toLowerCase().includes(q) ||
          r._pos.toLowerCase().includes(q)
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

    const getMetricVal = (r) => (isProj ? (r._projAvg || 0) : (r._value || 0));

    if (trendingMode !== "all") {
      const getTrend = (r) =>
        trendingMode === "adds"
          ? (trendingAddMap.get(r.player_id) || 0)
          : (trendingDropMap.get(r.player_id) || 0);

      return [...filteredRows].sort((a, b) => {
        const tDiff = getTrend(b) - getTrend(a);
        if (tDiff !== 0) return tDiff;
        if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
        if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
        if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
        if (sortKey === "value" || sortKey === "proj") return (getMetricVal(a) - getMetricVal(b)) * dir;
        return ((a.count || 0) - (b.count || 0)) * dir;
      });
    }

    return [...filteredRows].sort((a, b) => {
      if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
      if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
      if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
      if (sortKey === "value" || sortKey === "proj") {
        const av = isProj ? (a._projAvg || 0) : (a._value || 0);
        const bv = isProj ? (b._projAvg || 0) : (b._value || 0);
        return (av - bv) * dir;
      }
      return ((a.count || 0) - (b.count || 0)) * dir;
    });
  }, [filteredRows, sortKey, sortDir, trendingMode, trendingAddMap, trendingDropMap, isProj]);

  // Paging
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

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

  // Helpers for manual selection UI
  const toggleLeagueSelected = (id) => {
    const sid = String(id);
    setSelectedLeagueIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedLeagueIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleLeagueIds) next.add(String(id));
      return next;
    });
  };

  const clearAllVisible = () => {
    setSelectedLeagueIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleLeagueIds) next.delete(String(id));
      return next;
    });
  };

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
            <div className="bg-gray-900 rounded-lg border border-white/10 p-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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

                    <SourceSelector
                      value={effectiveSourceKey}
                      onChange={setEffectiveSourceKey}
                      mode={format}
                      qbType={qbType}
                      onModeChange={setFormat}
                      onQbTypeChange={setQbType}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="relative rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                      onClick={() => setShowFiltersModal(true)}
                      title="Filters & options"
                    >
                      Filters
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
                            title="Leagues currently visible by filters/selection"
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
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="text-center text-gray-400 py-10">
                {loading ? "Working…" : trendingMode !== "all" ? "No matching trending players." : "No players found."}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg shadow ring-1 ring-white/10 mt-3">
                <table className="min-w-full bg-gray-900">
                  <thead className="bg-gray-800/60">
                    <tr>
                      <th className="text-left px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("name")}>
                        Player <span className="ml-1 inline-block">{sortIndicator("name")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("count")}>
                        Leagues <span className="ml-1 inline-block">{sortIndicator("count")}</span>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer select-none"
                        onClick={() => toggleSort(valueOrProjSortKey)}
                      >
                        {valueOrProjLabel} <span className="ml-1 inline-block">{sortIndicator(valueOrProjSortKey)}</span>
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

                      const metricVal = isProj ? (r._projAvg || 0) : (r._value || 0);

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
                          <td className="px-4 py-2 text-left">
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
                          <td className="px-4 py-2 text-right">{Math.round(metricVal)}</td>

                          <td className="px-4 py-2 hidden md:table-cell">
                            <div className="flex -space-x-2">
                              {(r.leagues || []).slice(0, 7).map((lg) => (
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
                                <span className="text-xs text-gray-400 pl-2">+{(r.leagues || []).length - 7}</span>
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

      {/* Filters modal (SMALLER) */}
      {showFiltersModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowFiltersModal(false)}
        >
          <div
            className="w-full max-w-xl max-h-[80vh] overflow-y-auto bg-gray-900 rounded-xl shadow-xl p-4 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="text-lg font-bold">Filters & Options</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowFiltersModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                <div className="mt-2">
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

                <div className="mt-3">
                  <div className="text-sm text-gray-400 mb-2">Metric & Source</div>
                  <SourceSelector
                    value={effectiveSourceKey}
                    onChange={setEffectiveSourceKey}
                    mode={format}
                    qbType={qbType}
                    onModeChange={setFormat}
                    onQbTypeChange={setQbType}
                  />
                </div>

                <div className="mt-4">
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

                {/* Manual league selection */}
                <div className="mt-4 border-t border-white/10 pt-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm">Manually select leagues</span>
                    <input
                      type="checkbox"
                      checked={manualLeagueSelect}
                      onChange={() => setManualLeagueSelect((v) => !v)}
                    />
                  </label>

                  {manualLeagueSelect && (
                    <>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                          onClick={selectAllVisible}
                        >
                          Select all visible
                        </button>
                        <button
                          type="button"
                          className="text-xs rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                          onClick={clearAllVisible}
                        >
                          Clear
                        </button>
                        <span className="ml-auto text-xs text-gray-500">
                          {visibleLeagueCount} showing
                        </span>
                      </div>

                      <div className="mt-2 max-h-52 overflow-y-auto pr-1 space-y-1">
                        {scanLeagues
                          .filter((lg) => visibleLeagueIds.has(String(lg.id)))
                          .slice()
                          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                          .map((lg) => {
                            const id = String(lg.id);
                            const checked = selectedLeagueIds.has(id);
                            return (
                              <label
                                key={id}
                                className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-gray-800/60 border border-white/10"
                                title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}${
                                  lg.hasRoster ? " • rosters" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleLeagueSelected(id)}
                                />
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
                                  {lg.hasRoster ? " • roster" : ""}
                                </span>
                              </label>
                            );
                          })}
                      </div>

                      <div className="mt-2 text-xs text-gray-500">
                        Selection stacks on top of Best Ball / Drafting filters.
                      </div>
                    </>
                  )}
                </div>

                <div className="pt-3">
                  <button
                    type="button"
                    className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                    onClick={doRefresh}
                    title="Rescan now (ignores cache)"
                  >
                    Refresh scan
                  </button>
                </div>
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
                  const av = activeLeagueIds.has(String(a.id)) ? 1 : 0;
                  const bv = activeLeagueIds.has(String(b.id)) ? 1 : 0;
                  if (av !== bv) return bv - av;
                  return (a.name || "").localeCompare(b.name || "");
                })
                .map((lg) => (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-3 text-sm px-2 py-1 rounded border ${
                      activeLeagueIds.has(String(lg.id))
                        ? "bg-gray-800 border-white/10"
                        : "bg-gray-800/40 border-white/5 opacity-70"
                    }`}
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}${
                      lg.hasRoster ? " • rosters" : ""
                    }`}
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
                      {lg.hasRoster ? " • roster" : ""}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Visible leagues modal */}
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
                .filter((lg) => activeLeagueIds.has(String(lg.id)))
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((lg) => (
                  <div
                    key={lg.id}
                    className="flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10"
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}${
                      lg.hasRoster ? " • rosters" : ""
                    }`}
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
                      {lg.hasRoster ? " • roster" : ""}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </span>
                  </div>
                ))}
              {visibleLeagueCount === 0 && (
                <div className="text-sm text-gray-400">No leagues match the current filters/selection.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player detail modal */}
      {openPid &&
        (() => {
          const openRow = enriched.find((r) => r.player_id === openPid) || null;
          if (!openRow) return null;

          const visibleLeaguesForRow = (openRow.leagues || []).filter((lg) =>
            activeLeagueIds.has(String(lg.id))
          );

          const metricVal = isProj ? Math.round(openRow._projAvg || 0) : Math.round(openRow._value || 0);

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
                        {openRow._pos || "—"} • {openRow._team || "FA"}
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
                    <div className="text-xs text-gray-400">{valueOrProjLabel}</div>
                    <div className="text-2xl font-bold">{metricVal}</div>
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
