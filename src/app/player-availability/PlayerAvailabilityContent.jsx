"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../../components/Navbar";
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";

/** One-input inline name picker with disambiguation */
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
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0))); }
          if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter")     { e.preventDefault(); if (suggestions[highlight]) choose(suggestions[highlight]); }
          if (e.key === "Escape")    { setOpen(false); }
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
                <span className="text-gray-400">{s.pos}{s.team ? ` • ${s.team}` : ""}</span>
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
      Array.isArray(r?.reserve) ? r.reserve : [],  // IR in some leagues
      Array.isArray(r?.taxi) ? r.taxi : [],
    ];
    for (const arr of buckets) {
      for (const id of arr) if (id != null) ids.add(String(id));
    }
  }
  return ids;
}

export default function PlayerAvailabilityContent() {
  const {
    username,
    leagues,
    players,
    fetchLeagueRostersSilent, // optional helper
    fetchLeagueRosters,       // existing function
  } = useSleeper();

  // UI state
  const [loading, setLoading] = useState(true);
  const [loadingDone, setLoadingDone] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [onlyBestBall, setOnlyBestBall] = useState(false);
  const [excludeBestBall, setExcludeBestBall] = useState(false);

  // Players & results
  const [selectedPlayers, setSelectedPlayers] = useState([]); // [{id,name,pos,team}]
  const [results, setResults] = useState({});                 // { [id]: { availableLeagues, rosteredLeagues, pctAvailable, pctRostered } }

  // Name index (name -> [{id,name,pos,team}])
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

  // Guards
  useEffect(() => {
    const init = async () => {
      try {
        setError("");
        setLoading(true);
        setLoadingDone(false);
        if (!username) return setError("Please log in on the Home page first.");
        if (!leagues || leagues.length === 0) return setError("No leagues found. After login, make sure your leagues load.");
        if (!playersMap || Object.keys(playersMap).length === 0)
          return setError("Player database not loaded yet. Please wait a moment or re-login.");
      } catch (e) {
        console.error(e);
        setError("Failed to initialize Player Availability.");
      } finally {
        setLoadingDone(true);
        setTimeout(() => setLoading(false), 80);
      }
    };
    init();
  }, [username, leagues, playersMap]);

  // Restore last selection
  useEffect(() => {
    const saved = sessionStorage.getItem("availabilitySelectedPlayers");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setSelectedPlayers(parsed);
      } catch {}
    }
  }, []);

  // League filtering
  const getFilteredLeagues = () =>
    (leagues || []).filter((lg) => {
      const isBestBall = lg?.settings?.best_ball === 1;
      if (onlyBestBall && !isBestBall) return false;
      if (excludeBestBall && isBestBall) return false;
      return !lg?.status || ["in_season", "drafting", "complete"].includes(lg.status);
    });

  const filteredLeagues = getFilteredLeagues();

  // ---------- Cached league sets ----------
  const rosterCacheRef = useRef(new Map()); // league_id -> { set:Set<string>, fetched:boolean, size:number }
  const leagueSetsRef = useRef(null);       // [{league, set}]
  const leagueSetsKeyRef = useRef("");      // filter sig
  const [preparing, setPreparing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0); // force clear + refetch

  const filtersKey = useMemo(
    () => [
      onlyBestBall ? 1 : 0,
      excludeBestBall ? 1 : 0,
      refreshNonce, // if you click Refresh rosters
      // encode visible league ids to catch changes
      ...filteredLeagues.map((l) => l.league_id),
    ].join(":"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onlyBestBall, excludeBestBall, refreshNonce, leagues] // triggers recompute; filteredLeagues is derived
  );

  // Prepare league sets once per filtersKey
  const prepareLeagueSetsOnce = async () => {
    if (leagueSetsRef.current && leagueSetsKeyRef.current === filtersKey) {
      return leagueSetsRef.current;
    }
    try {
      setPreparing(true);

      // Decide which leagues need fetching
      const toFetch = [];
      for (const lg of filteredLeagues) {
        const cached = rosterCacheRef.current.get(lg.league_id);
        if (cached?.set instanceof Set && cached.size > 0) continue;

        if (Array.isArray(lg?.rosters) && lg.rosters.length > 0) {
          const set = extractRosterIds(lg.rosters);
          rosterCacheRef.current.set(lg.league_id, { set, fetched: true, size: set.size });
        } else {
          toFetch.push(lg);
        }
      }

      if (toFetch.length) {
        const results = await Promise.all(
          toFetch.map(async (lg) => {
            try {
              if (typeof fetchLeagueRostersSilent === "function") {
                const { rosters } = await fetchLeagueRostersSilent(lg.league_id);
                return { lg, rosters };
              }
              if (typeof fetchLeagueRosters === "function") {
                await fetchLeagueRosters(lg.league_id);
                const updated = (leagues || []).find((L) => L.league_id === lg.league_id);
                return { lg, rosters: updated?.rosters || [] };
              }
              const res = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);
              const rosters = res.ok ? await res.json() : [];
              return { lg, rosters };
            } catch {
              return { lg, rosters: [] };
            }
          })
        );

        results.forEach(({ lg, rosters }) => {
          const set = extractRosterIds(rosters);
          rosterCacheRef.current.set(lg.league_id, { set, fetched: true, size: set.size });
        });
      }

      const leagueSets = filteredLeagues.map((lg) => {
        const cached = rosterCacheRef.current.get(lg.league_id);
        return { league: lg, set: cached?.set || new Set() };
      });

      leagueSetsRef.current = leagueSets;
      leagueSetsKeyRef.current = filtersKey;
      return leagueSets;
    } finally {
      setPreparing(false);
    }
  };

  // Auto recompute when filters change (if you already selected players)
  useEffect(() => {
    let did = false;
    (async () => {
      if (selectedPlayers.length === 0) return;
      await prepareLeagueSetsOnce();
      did = true;
      // recompute for all selected with cached sets
      await computeAvailability(selectedPlayers, { merge: false, assumePrepared: true });
    })();
    return () => { if (!did) setPreparing(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  // Selection handlers
  const addResolved = (t) => {
    if (!t || !t.id || !t.name) return;
    setSelectedPlayers((prev) => {
      if (prev.find((p) => p.id === t.id)) return prev;
      const next = [...prev, t];
      sessionStorage.setItem("availabilitySelectedPlayers", JSON.stringify(next));
      return next;
    });
    // compute just for this player; merge into results
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

  const refreshRosters = () => {
    rosterCacheRef.current = new Map();
    leagueSetsRef.current = null;
    leagueSetsKeyRef.current = "";
    setResults({});
    setRefreshNonce((n) => n + 1); // triggers filtersKey change
  };

  // Compute availability (reuse cache, merge optionally) — FIXED to exclude empty sets
const computeAvailability = async (
  playersToCheck = selectedPlayers,
  { merge = false, assumePrepared = false } = {}
) => {
  const list = Array.isArray(playersToCheck) && playersToCheck.length ? playersToCheck : selectedPlayers;
  if (!list || list.length === 0) { setError("Add at least one player first."); return; }

  try {
    setError("");
    setLoading(true);
    setLoadingDone(false);

    const leagueSets = assumePrepared ? leagueSetsRef.current : await prepareLeagueSetsOnce();

    const out = {};
    for (const p of list) {
      const availableLeagues = [];
      const rosteredLeagues = [];
      const noDataLeagues = [];

      for (const { league, set } of leagueSets) {
        if (!set || set.size === 0) {           // ← key change: treat empty as no-data
          noDataLeagues.push(league);
          continue;
        }
        if (set.has(String(p.id))) rosteredLeagues.push(league);
        else                       availableLeagues.push(league);
      }

      const considered = availableLeagues.length + rosteredLeagues.length; // exclude no-data
      const pctAvailable = considered ? Math.round((availableLeagues.length / considered) * 100) : 0;
      const pctRostered  = considered ? 100 - pctAvailable : 0;

      out[p.id] = { availableLeagues, rosteredLeagues, noDataLeagues, pctAvailable, pctRostered };
    }

    setResults((prev) => (merge ? { ...prev, ...out } : out));
  } catch (e) {
    console.error(e);
    setError("Failed to check availability. Try again.");
  } finally {
    setLoadingDone(true);
    setTimeout(() => setLoading(false), 60);
  }
};

  // Derived
  const anySelected = selectedPlayers.length > 0;
  const totalFiltered = filteredLeagues.length;

  // Leagues sorted: (1) all players available first, (2) then by # of players available desc, (3) then by name
const leaguesAvailableSorted = useMemo(() => {
  if (!anySelected) return [];

  // playerId -> Set(league_id) where that player is available
  const availMap = Object.fromEntries(
    selectedPlayers.map((p) => [
      p.id,
      new Set((results[p.id]?.availableLeagues || []).map((L) => String(L.league_id))),
    ])
  );

  // score leagues
  const scored = filteredLeagues.map((lg) => {
    const flags = selectedPlayers.map((p) => availMap[p.id]?.has(String(lg.league_id)) || false);
    const availableCount = flags.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    const allAvailable = availableCount === selectedPlayers.length && selectedPlayers.length > 0;
    return { lg, availableCount, allAvailable };
  });

  // keep only leagues where at least one selected player is available
  const eligible = scored.filter((s) => s.availableCount > 0);

  // sort: all-available first, then by count desc, then by name
  eligible.sort((a, b) => {
    if (a.allAvailable !== b.allAvailable) return a.allAvailable ? -1 : 1;
    if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
    const an = (a.lg.name || "").toLowerCase();
    const bn = (b.lg.name || "").toLowerCase();
    return an.localeCompare(bn);
  });

  return eligible.map((s) => s.lg);
}, [anySelected, filteredLeagues, selectedPlayers, results]);


  // Heuristic: warn if most league sets are empty (useful during early off-season or API hiccups)
  const emptySetCount = (leagueSetsRef.current || []).filter(({ set }) => set && set.size === 0).length;
  const shouldWarnEmpty = leagueSetsRef.current && leagueSetsRef.current.length > 0 && emptySetCount > leagueSetsRef.current.length * 0.6;

  return (
    <main className="min-h-screen bg-black text-white">
      <Navbar pageTitle="Player Availability" />

      {loading && !loadingDone ? (
        <LoadingScreen />
      ) : (
        <div className="max-w-6xl mx-auto px-4 pb-12 pt-20">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Player Availability</h1>
            <p className="text-gray-400">
              Search by name. We fetch each league’s rosters once per filter and reuse them for all players.
            </p>
          </div>

          {/* Guards */}
          {!username ? (
            <p className="text-red-400">Please log in on the Home page.</p>
          ) : !leagues || leagues.length === 0 ? (
            <p className="text-red-400">No leagues found for your account.</p>
          ) : !playersMap || Object.keys(playersMap).length === 0 ? (
            <p className="text-red-400">Player database not ready yet. One moment…</p>
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
                              ({p.pos}{p.team ? ` • ${p.team}` : ""})
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
                        <button
                          onClick={clearAll}
                          className="text-xs underline text-gray-400 hover:text-gray-200 ml-1"
                        >
                          Clear all
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mt-3">No players added yet.</p>
                    )}
                  </div>

                  {/* Filters & actions */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-gray-400">Filters</label>
                    <div className="flex items-center gap-3 flex-wrap">
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

                      <button
                        onClick={() => computeAvailability(selectedPlayers, { merge: false })}
                        className="px-3 py-2 bg-cyan-500 rounded hover:bg-cyan-600 transition ml-auto"
                        disabled={!anySelected || preparing}
                        title={preparing ? "Preparing leagues…" : anySelected ? "Re-check all" : "Add a player first"}
                      >
                        {preparing ? "Preparing…" : "Check"}
                      </button>

                      <button
                        onClick={refreshRosters}
                        className="px-3 py-2 bg-gray-800 rounded border border-gray-700 hover:bg-gray-750 transition"
                        title="Force re-download of league rosters"
                      >
                        Refresh rosters
                      </button>
                    </div>

                    <div className="text-xs text-gray-500">
                      Selected: {selectedPlayers.length} • Filtered leagues:{" "}
                      <span className="font-medium text-gray-200">{totalFiltered}</span>{" "}
                      {preparing ? "• preparing leagues…" : ""}
                    </div>

                    {shouldWarnEmpty && (
                      <div className="text-xs text-yellow-300 mt-1">
                        Many leagues returned empty rosters. Try <button onClick={refreshRosters} className="underline">Refresh rosters</button>.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-950/40 border border-red-800 text-red-200 rounded-lg p-3 mb-6">
                  {error}
                </div>
              )}

              {/* Ownership Summary */}
              {anySelected && (
                <div className="bg-gray-900 rounded-xl p-4 mb-6 border border-gray-800">
                  <h3 className="text-lg font-semibold mb-3">Ownership Summary</h3>
                  {selectedPlayers.map((p) => {
                    const r = results[p.id];
                    const pctAvail = r?.pctAvailable ?? 0;
                    const pctRostered = r?.pctRostered ?? 0;
                    const availCount = r?.availableLeagues?.length ?? 0;
                    const rostCount = r?.rosteredLeagues?.length ?? 0;
                    return (
                      <div key={p.id} className="mb-4">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-200">
                            {p.name}{" "}
                            <span className="text-gray-400">
                              ({p.pos}{p.team ? ` • ${p.team}` : ""})
                            </span>
                          </span>
                          <span className="text-gray-400">
                            Available {availCount}/{availCount + rostCount} ({pctAvail}%)
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
                        Rostered {rostCount}/{availCount + rostCount} ({pctRostered}%) • {(results[p.id]?.noDataLeagues?.length || 0)} no-data
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
                    <p className="text-gray-500">No available leagues for your selected players with these filters.</p>
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
                            <tr key={lg.league_id} className="bg-gray-800/40 hover:bg-gray-800/70">
                              <td className="px-3 py-2 sticky left-0 bg-gray-900/90 backdrop-blur z-10">
                                <div className="flex flex-col">
                                  <span className="text-gray-100">{lg.name}</span>
                                  <span className="text-xs text-gray-400">
                                    {lg.settings?.best_ball === 1 ? "Best Ball" : "Standard"}
                                  </span>
                                </div>
                              </td>
                              {selectedPlayers.map((p) => {
                                const r = results[p.id];
                                const lid = String(lg.league_id);

                                const noData   = r?.noDataLeagues?.some((L) => String(L.league_id) === lid);
                                const rostered = r?.rosteredLeagues?.some((L) => String(L.league_id) === lid);
                                const available= r?.availableLeagues?.some((L) => String(L.league_id) === lid);

                                let cell = "–";
                                if (noData) {
                                    cell = "–";
                                } else if (rostered) {
                                    cell = "❌";
                                } else if (available) {
                                    cell = "✅";
                                } else {
                                    cell = "–"; // fallback, but shouldn't happen in sorted list
                                }

                                return (
                                    <td key={`${lg.league_id}-${p.id}`} className="px-3 py-2 text-center">
                                    {cell}
                                    </td>
                                );
                                })}

                              <td className="px-3 py-2 text-center">
                                <div className="flex gap-3 justify-center">
                                
                                  <a
                                    href={`https://www.sleeper.app/leagues/${lg.league_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:underline"
                                  >
                                    Web
                                  </a>
                                </div>
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
                    <span>– No data</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
