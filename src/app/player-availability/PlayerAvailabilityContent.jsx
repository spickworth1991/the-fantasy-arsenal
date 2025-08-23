"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";

/** Helpers for league avatars (matches Player Stock) */
const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) =>
  avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : DEFAULT_LEAGUE_IMG;

/** One-input inline name picker with disambiguation (JSX version) */
function NameSelect({ nameIndex, onPick, placeholder = "Search a player (e.g., Josh Allen)", className = "" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  const norm = (s = "") =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();

  const suggestions = useMemo(() => {
    const nq = norm(q);
    if (!nq) return [];
    const exact = nameIndex.get(nq) || [];
    if (exact.length) return exact.slice(0, 10);

    const out = [];
    const seen = new Set();
    for (const [key, vals] of nameIndex.entries()) {
      if (key.startsWith(nq) || key.includes(nq)) {
        for (const v of vals) {
          if (!seen.has(v.id)) {
            seen.add(v.id);
            out.push(v);
            if (out.length >= 10) break;
          }
        }
      }
      if (out.length >= 10) break;
    }
    return out;
  }, [q, nameIndex]);

  useEffect(() => {
    const onClickAway = (e) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onClickAway);
    return () => document.removeEventListener("click", onClickAway);
  }, []);

  const choose = (cand) => {
    onPick?.(cand);
    setQ("");
    setOpen(false);
    setHighlight(0);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (suggestions[highlight]) choose(suggestions[highlight]);
          }
          if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-gray-900 border border-gray-800 rounded-xl shadow-lg max-h-64 overflow-auto">
          {suggestions.map((s, idx) => (
            <button
              key={`${s.id}-${idx}`}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => choose(s)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-800 ${idx === highlight ? "bg-gray-800" : ""}`}
            >
              <div className="flex justify-between">
                <span className="text-gray-200">{s.name}</span>
                <span className="text-gray-400">
                  {s.pos}
                  {s.team ? ` • ${s.team}` : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Robustly extract all player IDs from a Sleeper league rosters array */
function extractRosterIds(rosters) {
  const ids = new Set();
  if (!Array.isArray(rosters)) return ids;
  for (const r of rosters) {
    const buckets = [
      Array.isArray(r?.players) ? r.players : [],
      Array.isArray(r?.starters) ? r.starters : [],
      Array.isArray(r?.reserve) ? r.reserve : [], // IR
      Array.isArray(r?.taxi) ? r.taxi : [],
    ];
    for (const arr of buckets) {
      for (const id of arr) if (id != null) ids.add(String(id));
    }
  }
  return ids;
}

export default function PlayerAvailabilityContent() {
  const { username, players, year } = useSleeper();

  // Page init loading (first paint) + Scan loading (live network pass)
  const [initLoading, setInitLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgressPct, setScanProgressPct] = useState(0);
  const [scanProgressText, setScanProgressText] = useState("Preparing…");
  const [error, setError] = useState("");

  // Filters (match Player Stock)
  const [onlyBestBall, setOnlyBestBall] = useState(false);
  const [excludeBestBall, setExcludeBestBall] = useState(false);
  const [includeDrafting, setIncludeDrafting] = useState(true);

  // Players & results
  const [selectedPlayers, setSelectedPlayers] = useState([]); // [{ id, name, pos, team }]
  const [results, setResults] = useState({}); // { [playerId]: { availableLeagues, rosteredLeagues } }

  // Scan state
  const [scanLeagues, setScanLeagues] = useState([]); // [{id,name,avatar,isBestBall,status,roster_positions}]
  const [leagueCount, setLeagueCount] = useState(0);
  const [scanningError, setScanningError] = useState("");
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [showVisibleLeaguesModal, setShowVisibleLeaguesModal] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Per-league roster sets
  const rosterSetsRef = useRef(new Map());

  // Cache key (per user + season)
  const yrStr = String(year || new Date().getFullYear());
  const cacheKey = username ? `pa:${username}:${yrStr}:SCAN` : null;

  // ---------- Name index ----------
  const playersMap = useMemo(() => players || {}, [players]);
  const normalizeName = (s = "") =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();

  const nameIndex = useMemo(() => {
    const idx = new Map();
    for (const [rawId, p] of Object.entries(playersMap)) {
      const id = String(p.player_id ?? rawId);
      const full = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
      if (!full) continue;
      const pos = (p.position || "").toUpperCase();
      const team = (p.team || "").toUpperCase();

      const variants = new Set([full]);
      if (p.first_name && p.last_name) {
        variants.add(`${p.first_name} ${p.last_name}`);
        variants.add(`${p.last_name}, ${p.first_name}`);
      }
      if (Array.isArray(p.aliases)) p.aliases.forEach((n) => n && variants.add(n));

      variants.forEach((n) => {
        const key = normalizeName(n);
        if (!key) return;
        if (!idx.has(key)) idx.set(key, []);
        const arr = idx.get(key);
        if (!arr.some((x) => x.id === id)) arr.push({ id, name: full, pos, team });
      });
    }
    return idx;
  }, [playersMap]);

  // ---------- Initial guard (page boot) ----------
  useEffect(() => {
    setError("");
    setInitLoading(true);
    if (!username) {
      setError("Please log in on the Home page first.");
      setInitLoading(false);
      return;
    }
    if (!playersMap || Object.keys(playersMap).length === 0) {
      setError("Player database not loaded yet. Please wait a moment or re-login.");
      setInitLoading(false);
      return;
    }
    setInitLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, playersMap]);

  // ---------- Scan leagues with cache ----------
  useEffect(() => {
    let cancelled = false;

    const hydrateFromCache = () => {
      if (!cacheKey) return false;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return false;
        const { leagues: cachedLeagues, rosterSets: cachedSets, ts } = JSON.parse(raw) || {};
        if (!Array.isArray(cachedLeagues) || !cachedSets) return false;

        const m = new Map();
        for (const [lid, idsArr] of Object.entries(cachedSets)) {
          if (Array.isArray(idsArr) && idsArr.length > 0) {
            m.set(String(lid), new Set(idsArr.map(String)));
          }
        }
        const kept = (cachedLeagues || []).filter((lg) => m.get(String(lg.id))?.size > 0);
        if (kept.length === 0) return false;

        rosterSetsRef.current = m;
        setScanLeagues(kept);
        setLeagueCount(kept.length);
        setLastUpdated(ts ? new Date(ts) : null);
        return true;
      } catch {
        return false;
      }
    };

    const saveToCache = (leaguesKept, setsMap) => {
      if (!cacheKey) return;
      try {
        const obj = {};
        setsMap.forEach((set, lid) => {
          obj[String(lid)] = Array.from(set);
        });
        const payload = { leagues: leaguesKept, rosterSets: obj, ts: Date.now() };
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));
      } catch {
        /* ignore quota errors */
      }
    };

    const run = async () => {
      if (!username) return;

      // Try cache first; only scan if no cache or Refresh button forces it
      if (hydrateFromCache()) return;

      try {
        setScanningError("");
        setScanLoading(true);
        setScanProgressPct(5);
        setScanProgressText("Looking up user…");

        // 1) user id
        const uRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!uRes.ok) throw new Error("User not found");
        const user = await uRes.json();

        // 2) leagues for season
        setScanProgressText("Fetching leagues…");
        setScanProgressPct(12);
        const lRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yrStr}`);
        const leagues = (await lRes.json()) || [];
        if (cancelled) return;

        // 3) per-league rosters (keep only those with data, and where your roster has players)
        const kept = [];
        const setsMap = new Map();

        for (let i = 0; i < leagues.length; i++) {
          const lg = leagues[i];
          try {
            setScanProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
            setScanProgressPct(12 + Math.round(((i + 1) / Math.max(leagues.length, 1)) * 88));

            const rRes = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);
            const rosters = rRes.ok ? await rRes.json() : [];
            if (!Array.isArray(rosters) || rosters.length === 0) continue;

            const mine = rosters.find((r) => r && String(r.owner_id) === String(user.user_id));
            if (!mine || !Array.isArray(mine.players) || mine.players.length === 0) continue;

            const set = extractRosterIds(rosters);
            if (set.size === 0) continue;

            const lid = String(lg.league_id);
            setsMap.set(lid, set);

            kept.push({
              id: lid,
              name: lg.name || "Unnamed League",
              avatar: lg.avatar || null,
              isBestBall: lg?.settings?.best_ball === 1,
              status: lg?.status || "",
              roster_positions: Array.isArray(lg?.roster_positions) ? lg.roster_positions : [],
            });
          } catch {
            // skip league on error
          }
          if (cancelled) return;
        }

        if (!cancelled) {
          rosterSetsRef.current = setsMap;
          setScanLeagues(kept);
          setLeagueCount(kept.length);
          setLastUpdated(new Date());
          saveToCache(kept, setsMap);
        }
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setScanningError("Failed to scan leagues.");
        }
      } finally {
        if (!cancelled) {
          setScanProgressText("Done!");
          setScanProgressPct(100);
          setTimeout(() => setScanLoading(false), 90);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, yrStr, cacheKey]);

  // ---------- Visible leagues (filters, like Player Stock) ----------
  const visibleLeagueIds = useMemo(() => {
    if (!scanLeagues || scanLeagues.length === 0) return new Set();
    const arr = scanLeagues
      .filter((lg) => {
        if (onlyBestBall && !lg.isBestBall) return false;
        if (excludeBestBall && lg.isBestBall) return false;
        if (!includeDrafting && lg.status === "drafting") return false;
        return true;
      })
      .map((lg) => lg.id);
    return new Set(arr);
  }, [scanLeagues, onlyBestBall, excludeBestBall, includeDrafting]);

  const visibleLeagueCount = visibleLeagueIds.size || 0;
  const visibleLeaguesList = useMemo(
    () => scanLeagues.filter((lg) => visibleLeagueIds.has(lg.id)),
    [scanLeagues, visibleLeagueIds]
  );

  // ---------- Restore last selection ----------
  useEffect(() => {
    const saved = sessionStorage.getItem("availabilitySelectedPlayers");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setSelectedPlayers(parsed);
      } catch {}
    }
  }, []);

  // ---------- Actions ----------
  const addResolved = (t) => {
    if (!t || !t.id || !t.name) return;
    setSelectedPlayers((prev) => {
      if (prev.find((p) => p.id === t.id)) return prev;
      const next = [...prev, t];
      sessionStorage.setItem("availabilitySelectedPlayers", JSON.stringify(next));
      return next;
    });
    setTimeout(() => computeAvailability([t], { merge: true }), 0);
  };

  const removeSelected = (playerId) => {
    setSelectedPlayers((prev) => {
      const next = prev.filter((p) => p.id !== playerId);
      sessionStorage.setItem("availabilitySelectedPlayers", JSON.stringify(next));
      return next;
    });
    setResults((prev) => {
      const copy = { ...prev };
      delete copy[playerId];
      return copy;
    });
  };

  const clearAll = () => {
    setSelectedPlayers([]);
    setResults({});
    sessionStorage.removeItem("availabilitySelectedPlayers");
  };

  const refreshScan = () => {
    // Only this button triggers a rescan: clear cache and run scan effect again
    try {
      if (cacheKey) sessionStorage.removeItem(cacheKey);
    } catch {}
    setResults({});
    // Manually kick the scan effect by toggling a dummy key in cache (or refire by changing lastUpdated)
    // Easiest: write a temp and remove to bump read -> then call scan directly:
    (async () => {
      // Force a rescan path by calling the same logic: fake “no cache” by removing it,
      // then just re-run scan effect by setting a guard state:
      setScanLoading(true);
      setScanProgressPct(0);
      setScanProgressText("Refreshing leagues…");
      // Let the scan run by calling the effect's core via a tiny trick: clear data and call fetch block here.
      try {
        // Re-run the fetching block inline for a deterministic refresh
        const uRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!uRes.ok) throw new Error("User not found");
        const user = await uRes.json();

        setScanProgressText("Fetching leagues…");
        setScanProgressPct(10);
        const lRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yrStr}`);
        const leagues = (await lRes.json()) || [];

        const kept = [];
        const setsMap = new Map();
        for (let i = 0; i < leagues.length; i++) {
          const lg = leagues[i];
          setScanProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
          setScanProgressPct(10 + Math.round(((i + 1) / Math.max(leagues.length, 1)) * 88));

          try {
            const rRes = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);
            const rosters = rRes.ok ? await rRes.json() : [];
            if (!Array.isArray(rosters) || rosters.length === 0) continue;

            const mine = rosters.find((r) => r && String(r.owner_id) === String(user.user_id));
            if (!mine || !Array.isArray(mine.players) || mine.players.length === 0) continue;

            const set = extractRosterIds(rosters);
            if (set.size === 0) continue;

            const lid = String(lg.league_id);
            setsMap.set(lid, set);

            kept.push({
              id: lid,
              name: lg.name || "Unnamed League",
              avatar: lg.avatar || null,
              isBestBall: lg?.settings?.best_ball === 1,
              status: lg?.status || "",
              roster_positions: Array.isArray(lg?.roster_positions) ? lg.roster_positions : [],
            });
          } catch {
            // skip league on error
          }
        }

        rosterSetsRef.current = setsMap;
        setScanLeagues(kept);
        setLeagueCount(kept.length);
        setLastUpdated(new Date());

        // Save fresh cache
        try {
          const obj = {};
          setsMap.forEach((set, lid) => (obj[String(lid)] = Array.from(set)));
          sessionStorage.setItem(cacheKey, JSON.stringify({ leagues: kept, rosterSets: obj, ts: Date.now() }));
        } catch {}

        setScanProgressText("Done!");
        setScanProgressPct(100);
      } catch (e) {
        console.error(e);
        setScanningError("Failed to refresh leagues.");
      } finally {
        setTimeout(() => setScanLoading(false), 90);
        // Recompute with the new sets so the UI updates immediately
        if (selectedPlayers.length) computeAvailability(selectedPlayers, { merge: false });
      }
    })();
  };

  // ---------- Compute availability over *visible* leagues only ----------
  async function computeAvailability(playersToCheck = selectedPlayers, { merge = false } = {}) {
    const list = Array.isArray(playersToCheck) && playersToCheck.length ? playersToCheck : selectedPlayers;
    if (!list || list.length === 0) return;

    const out = {};
    for (const p of list) {
      const availableLeagues = [];
      const rosteredLeagues = [];

      for (const lg of visibleLeaguesList) {
        const set = rosterSetsRef.current.get(lg.id);
        if (!set || set.size === 0) continue; // safety
        if (set.has(String(p.id))) rosteredLeagues.push(lg);
        else availableLeagues.push(lg);
      }
      out[p.id] = { availableLeagues, rosteredLeagues };
    }
    setResults((prev) => (merge ? { ...prev, ...out } : out));
  }

  // Auto-recompute when filters change and we already have scan data
  useEffect(() => {
    if (!selectedPlayers.length) return;
    if (scanLoading) return;
    computeAvailability(selectedPlayers, { merge: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLeagueCount, scanLoading]);

  // Sort leagues by (1) # selected players available desc, (2) name asc
  const anySelected = selectedPlayers.length > 0;
  // Replace your current leaguesAvailableSorted with this:
  const leaguesAvailableSorted = useMemo(() => {
    if (!anySelected) return [];

    // Keep only leagues where at least one selected player is available
    const scored = [];
    for (const lg of visibleLeaguesList) {
      let availableCount = 0;
      for (const p of selectedPlayers) {
        const isAvailableHere = results[p.id]?.availableLeagues?.some((L) => L.id === lg.id);
        if (isAvailableHere) availableCount++;
      }
      if (availableCount > 0) {
        scored.push({ lg, availableCount });
      }
    }

    // Sort by: more available players first, then by league name
    scored.sort((a, b) => {
      if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
      return (a.lg.name || "").localeCompare(b.lg.name || "");
    });

    return scored.map((s) => s.lg);
  }, [anySelected, visibleLeaguesList, selectedPlayers, results]);


  // ---------- Render ----------
  const showLoadingScreen = initLoading || scanLoading;

  return (
    <main className="min-h-screen text-white">
      <Navbar pageTitle="Player Availability" />
      <BackgroundParticles />

      {showLoadingScreen ? (
        <LoadingScreen
          progress={scanLoading ? scanProgressPct : undefined}
          text={scanLoading ? scanProgressText : undefined}
        />
      ) : (
        <div className="max-w-6xl mx-auto px-4 pb-12 pt-20">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Player Availability</h1>
            <p className="text-gray-400">
              Search by name. We reuse your last scan and only rescan if you click Refresh.
            </p>
          </div>

          {/* Scan summary (mimics Player Stock) */}
          <div className="bg-gray-900 rounded-lg border border-white/10 p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-400">
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
              <span>•</span>
              <span>
                Showing{" "}
                <button
                  type="button"
                  className="underline decoration-dotted hover:text-white"
                  onClick={() => setShowVisibleLeaguesModal(true)}
                  title="Leagues currently visible by filters"
                >
                  <span className="text-white font-semibold">{visibleLeagueCount}</span>
                </button>
              </span>
              {lastUpdated && (
                <span className="ml-3 text-xs text-gray-500" suppressHydrationWarning>
                  Last scan: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <span className="ml-auto">
                {scanningError ? <span className="text-red-400">{scanningError}</span> : null}
                <button
                  className="ml-3 text-xs rounded px-2 py-0.5 border border-white/20 hover:bg-white/10"
                  onClick={refreshScan}
                  title="Rescan now"
                >
                  Refresh
                </button>
              </span>
            </div>

            {/* Filters row like Stock */}
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-cyan-400"
                  checked={onlyBestBall}
                  onChange={() => setOnlyBestBall((v) => (excludeBestBall ? true : !v))}
                />
                Only Best Ball
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-cyan-400"
                  checked={excludeBestBall}
                  onChange={() => setExcludeBestBall((v) => (onlyBestBall ? true : !v))}
                />
                Exclude Best Ball
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-cyan-400"
                  checked={includeDrafting}
                  onChange={() => setIncludeDrafting((v) => !v)}
                />
                Include drafting leagues
              </label>
            </div>
          </div>

          {/* Guards */}
          {!username ? (
            <p className="text-red-400">Please log in on the Home page.</p>
          ) : Object.keys(playersMap).length === 0 ? (
            <p className="text-red-400">Player database not ready yet. One moment…</p>
          ) : leagueCount === 0 ? (
            <p className="text-red-400">No leagues matched the scan rules for your account.</p>
          ) : (
            <>
              {/* Controls */}
              <div className="bg-gray-900 rounded-xl p-4 mb-6 border border-gray-800">
                <div className="grid lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Search & Add Player</label>
                    <NameSelect nameIndex={nameIndex} onPick={addResolved} />
                    {selectedPlayers.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedPlayers.map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-2 text-sm bg-gray-800 border border-gray-700 rounded-full px-3 py-1"
                          >
                            {p.name}
                            <span className="text-gray-400">
                              ({p.pos}
                              {p.team ? ` • ${p.team}` : ""})
                            </span>
                            <button
                              className="ml-1 text-red-400 hover:text-red-300"
                              onClick={() => removeSelected(p.id)}
                              title="Remove"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <button onClick={clearAll} className="text-xs underline text-gray-400 hover:text-gray-200 ml-1">
                          Clear all
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mt-3">No players added yet.</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => computeAvailability(selectedPlayers, { merge: false })}
                        className="px-3 py-2 bg-cyan-500 rounded hover:bg-cyan-600 transition"
                        disabled={!anySelected}
                        title={anySelected ? "Re-check all" : "Add a player first"}
                      >
                        Check
                      </button>

                      <button
                        onClick={refreshScan}
                        className="px-3 py-2 bg-gray-800 rounded border border-gray-700 hover:bg-gray-750 transition"
                        title="Rescan all leagues"
                      >
                        Refresh rosters
                      </button>
                    </div>

                    <div className="text-xs text-gray-500">
                      Selected: {selectedPlayers.length} • Visible leagues used:{" "}
                      <span className="font-medium text-gray-200">{visibleLeagueCount}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Ownership Summary */}
              {anySelected && (
                <div className="bg-gray-900 rounded-xl p-4 mb-6 border border-gray-800">
                  <h3 className="text-lg font-semibold mb-3">Ownership Summary</h3>
                  {selectedPlayers.map((p) => {
                    const r = results[p.id];
                    const availCount = r?.availableLeagues?.length ?? 0;
                    const rostCount = r?.rosteredLeagues?.length ?? 0;
                    const denom = availCount + rostCount; // visible leagues only
                    const pctAvail = denom ? Math.round((availCount / denom) * 100) : 0;
                    const pctRostered = denom ? 100 - pctAvail : 0;
                    return (
                      <div key={p.id} className="mb-4">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-200">
                            {p.name}{" "}
                            <span className="text-gray-400">
                              ({p.pos}
                              {p.team ? ` • ${p.team}` : ""})
                            </span>
                          </span>
                          <span className="text-gray-400">
                            Available {availCount}/{denom} ({pctAvail}%)
                          </span>
                        </div>
                        <div className="w-full bg-gray-800 rounded h-3 overflow-hidden">
                          <div
                            className="bg-green-500 h-3"
                            style={{ width: `${pctAvail}%` }}
                            title={`Available: ${pctAvail}%`}
                          />
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Rostered {rostCount}/{denom} ({pctRostered}%)
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Availability Matrix */}
              {anySelected && (
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <h3 className="text-lg font-semibold mb-3">Availability by League</h3>
                  {leaguesAvailableSorted.length === 0 ? (
                    <p className="text-gray-500">No leagues where any selected player is available with these filters.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-1">
                        <thead>
                          <tr>
                            <th className="text-left text-sm text-gray-400 font-medium px-3 py-2 sticky left-0 bg-gray-900 z-10">
                              League
                            </th>
                            {selectedPlayers.map((p) => (
                              <th key={p.id} className="text-sm text-gray-400 font-medium px-3 py-2 whitespace-nowrap">
                                {p.name}
                              </th>
                            ))}
                            <th className="text-sm text-gray-400 font-medium px-3 py-2">Open</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaguesAvailableSorted.map((lg) => (
                            <tr key={lg.id} className="bg-gray-800/40 hover:bg-gray-800/70">
                              <td className="px-3 py-2 sticky left-0 bg-gray-900/90 backdrop-blur z-10">
                                <div className="flex items-center gap-2">
                                  <img
                                    src={leagueAvatarUrl(lg.avatar || undefined)}
                                    alt=""
                                    className="w-5 h-5 rounded object-cover bg-gray-700"
                                    onError={(e) => {
                                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                                    }}
                                  />
                                  <div className="flex flex-col">
                                    <span className="text-gray-100">{lg.name}</span>
                                    <span className="text-xs text-gray-400">
                                      {lg.isBestBall ? "Best Ball" : "Standard"}
                                      {lg.status ? ` • ${lg.status}` : ""}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {selectedPlayers.map((p) => {
                                const r = results[p.id];
                                const rostered = r?.rosteredLeagues?.some((L) => L.id === lg.id);
                                const available = r?.availableLeagues?.some((L) => L.id === lg.id);
                                let cell = "–";
                                if (rostered) cell = "❌";
                                else if (available) cell = "✅";
                                return (
                                  <td key={`${lg.id}-${p.id}`} className="px-3 py-2 text-center">
                                    {cell}
                                  </td>
                                );
                              })}

                              <td className="px-3 py-2 text-center">
                                <a
                                  href={`https://www.sleeper.app/leagues/${lg.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:underline"
                                >
                                  Web
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 text-xs text-gray-400 flex items-center gap-4">
                    <span>Legend:</span>
                    <span>✅ Available</span>
                    <span>❌ Rostered</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Scanned leagues modal (all kept by the scan) */}
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
                  const av = visibleLeagueIds.has(a.id) ? 1 : 0;
                  const bv = visibleLeagueIds.has(b.id) ? 1 : 0;
                  if (av !== bv) return bv - av; // visible first
                  return (a.name || "").localeCompare(b.name || "");
                })
                .map((lg) => (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-3 text-sm px-2 py-1 rounded border ${
                      visibleLeagueIds.has(lg.id) ? "bg-gray-800 border-white/10" : "bg-gray-800/40 border-white/5 opacity-70"
                    }`}
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar || undefined)}
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

      {/* Visible leagues modal (filtered "Showing") */}
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
              {visibleLeaguesList
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((lg) => (
                  <div
                    key={lg.id}
                    className="flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10"
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar || undefined)}
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
              {visibleLeagueCount === 0 && <div className="text-sm text-gray-400">No leagues match the current filters.</div>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
