"use client";
import { useState, useEffect, useMemo } from "react";
import { useSleeper } from "../../context/SleeperContext";
import TradeSide from "../../components/TradeSide";
import SearchBox from "../../components/SearchBox";
import PlayerCard from "../../components/PlayerCard";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";

/** ===== Shared trade prefs (sync Trade Analyzer & Finder on same page) ===== */
const TRADE_PREFS_EVENT = "trade-prefs-change";
const getInitialTradePrefs = () => {
  if (typeof window === "undefined") return { metricMode: "projections", projectionSource: "CSV" };
  const stored = window.__trade_prefs__ || {};
  return {
    metricMode: stored.metricMode || "projections",
    projectionSource: stored.projectionSource || "CSV",
  };
};
const setTradePrefs = (next) => {
  if (typeof window === "undefined") return;
  window.__trade_prefs__ = { ...(window.__trade_prefs__ || {}), ...next };
  window.dispatchEvent(new CustomEvent(TRADE_PREFS_EVENT, { detail: window.__trade_prefs__ }));
};

/** ===== Projections (same mapping as SOS) ===== */
const PROJ_JSON_URL      = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL  = "/projections_cbs_2025.json";

function normNameForMap(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeTeamAbbr(x) {
  const s = String(x || "").toUpperCase().trim();
  const map = { JAX:"JAC", LA:"LAR", STL:"LAR", SD:"LAC", OAK:"LV", WFT:"WAS", WSH:"WAS" };
  return map[s] || s;
}
function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}
function buildProjectionMapFromJSON(json) {
  const rows = Array.isArray(json) ? json : (json?.rows || []);
  const byId = Object.create(null);
  const byName = Object.create(null);
  const byNameTeam = Object.create(null);
  const byNamePos  = Object.create(null);

  rows.forEach((r) => {
    const pid = r.player_id != null ? String(r.player_id) : "";
    const name = r.name || r.player || r.full_name || "";
    const seasonPts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;

    const rawTeam = r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team;
    const team = normalizeTeamAbbr(rawTeam);
    const rawPos = r.pos ?? r.position ?? r.player_position;
    const pos = normalizePos(rawPos);

    if (pid) byId[pid] = seasonPts;
    if (name) {
      const nn = normNameForMap(name);
      byName[nn] = seasonPts;
      byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;
      if (team) byNameTeam[`${nn}|${team}`] = seasonPts;
      if (pos)  byNamePos[`${nn}|${pos}`]   = seasonPts;
    }
  });
  return { byId, byName, byNameTeam, byNamePos };
}
async function fetchProjectionMap(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  return buildProjectionMapFromJSON(json);
}
function getSeasonPointsForPlayer(map, p) {
  if (!map || !p) return 0;
  const hit = map.byId?.[String(p.player_id)];
  if (hit != null) return hit;

  const nn   = normNameForMap(p.full_name || p.search_full_name || `${p.first_name||""} ${p.last_name||""}`);
  const team = normalizeTeamAbbr(p.team);
  const pos  = normalizePos(p.position);
  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos  && map.byNamePos?.[`${nn}|${pos}`]   != null) return map.byNamePos[`${nn}|${pos}`];
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const k2 = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return (k2 && map.byName?.[k2] != null) ? map.byName[k2] : 0;
}

/** ===== Values support (as before) ===== */
const VALUE_SOURCES = {
  FantasyCalc:      { label: "FantasyCalc",      supports: { dynasty: true, redraft: true, qbToggle: true } },
  DynastyProcess:   { label: "DynastyProcess",   supports: { dynasty: true, redraft: false, qbToggle: true } },
  KeepTradeCut:     { label: "KeepTradeCut",     supports: { dynasty: true, redraft: false, qbToggle: true } },
  FantasyNavigator: { label: "FantasyNavigator", supports: { dynasty: true, redraft: true, qbToggle: true } },
  IDynastyP:        { label: "IDynastyP",        supports: { dynasty: true, redraft: false, qbToggle: true } },
  TheFantasyArsenal:{ label: "TheFantasyArsenal",supports: { dynasty: true, redraft: true, qbToggle: true } },
};

export default function TradeAnalyzer() {
  const {
    username, leagues, players, activeLeague, setActiveLeague, fetchLeagueRosters,
    format, qbType, setFormat, setQbType,
  } = useSleeper();

  /** ===== Shared metric prefs (syncs with Trade Finder) ===== */
  const [{ metricMode, projectionSource }, setPrefsState] = useState(getInitialTradePrefs());
  useEffect(() => {
    const onChange = (e) => setPrefsState(getInitialTradePrefs());
    window.addEventListener(TRADE_PREFS_EVENT, onChange);
    return () => window.removeEventListener(TRADE_PREFS_EVENT, onChange);
  }, []);
  const updatePrefs = (patch) => setTradePrefs({ ...getInitialTradePrefs(), ...patch });

  /** ===== Projections loading ===== */
  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjError(""); setProjLoading(true);
      try {
        const [csv, espn, cbs] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
        ]);
        if (!mounted) return;
        const next = { CSV: null, ESPN: null, CBS: null };
        if (csv.status === "fulfilled")  next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled")  next.CBS = cbs.value;
        setProjMaps(next);

        if (metricMode === "projections" && !next.CSV && !next.ESPN && !next.CBS) {
          setProjError("No projections found — using Values instead.");
          updatePrefs({ metricMode: "values" });
        } else {
          // auto-fallback source if current missing
          const src = projectionSource;
          if (src === "CBS"  && !next.CBS)  updatePrefs({ projectionSource: next.ESPN ? "ESPN" : "CSV" });
          if (src === "ESPN" && !next.ESPN) updatePrefs({ projectionSource: next.CSV ? "CSV" : "CBS" });
          if (src === "CSV"  && !next.CSV)  updatePrefs({ projectionSource: next.ESPN ? "ESPN" : "CBS" });
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable — using Values.");
        updatePrefs({ metricMode: "values" });
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Values: source + toggles ===== */
  const [valueSource, setValueSource] = useState("FantasyCalc");
  const supports = VALUE_SOURCES[valueSource].supports;

  /** league + owners */
  const handleLeagueChange = async (leagueId) => {
    setActiveLeague(leagueId);
    setSideA([]); setSideB([]);
    setSelectedOwnerA(""); setSelectedOwnerB("");
    if (leagueId) await fetchLeagueRosters(leagueId);
  };
  const league = leagues.find((lg) => lg.league_id === activeLeague);
  const allOwners = league
    ? (league.rosters || []).map((roster) => ({
        user_id: roster.owner_id,
        display_name: league.users?.find((u) => u.user_id === roster.owner_id)?.display_name || "Unknown",
        team_name:    league.users?.find((u) => u.user_id === roster.owner_id)?.metadata?.team_name || null,
        players: roster.players || [],
      }))
    : [];

  const getSideTitle = (side) => {
    if (side === "A" && selectedOwnerA) {
      const owner = allOwners.find((o) => o.user_id === selectedOwnerA);
      return owner?.team_name || owner?.display_name || "Side A";
    }
    if (side === "B" && selectedOwnerB) {
      const owner = allOwners.find((o) => o.user_id === selectedOwnerB);
      return owner?.team_name || owner?.display_name || "Side B";
    }
    return side === "A" ? "Side A" : "Side B";
  };

  /** ===== Metric functions ===== */
  const getPlayerValue = useMemo(() => {
    return (p) => {
      if (!p) return 0;
      if (valueSource === "FantasyCalc") {
        return format === "dynasty"
          ? qbType === "sf" ? p.fc_values?.dynasty_sf : p.fc_values?.dynasty_1qb
          : qbType === "sf" ? p.fc_values?.redraft_sf : p.fc_values?.redraft_1qb;
      } else if (valueSource === "DynastyProcess") {
        return qbType === "sf" ? (p.dp_values?.superflex || 0) : (p.dp_values?.one_qb || 0);
      } else if (valueSource === "KeepTradeCut") {
        return qbType === "sf" ? (p.ktc_values?.superflex || 0) : (p.ktc_values?.one_qb || 0);
      } else if (valueSource === "FantasyNavigator") {
        return format === "dynasty"
          ? qbType === "sf" ? p.fn_values?.dynasty_sf : p.fn_values?.dynasty_1qb
          : qbType === "sf" ? p.fn_values?.redraft_sf : p.fn_values?.redraft_1qb;
      } else if (valueSource === "IDynastyP") {
        return qbType === "sf" ? (p.idp_values?.superflex || 0) : (p.idp_values?.one_qb || 0);
      } else if (valueSource === "TheFantasyArsenal") {
        return format === "dynasty"
          ? (qbType === "sf" ? (p.sp_values?.dynasty_sf || 0) : (p.sp_values?.dynasty_1qb || 0))
          : (qbType === "sf" ? (p.sp_values?.redraft_sf || 0) : (p.sp_values?.redraft_1qb || 0));
      }
      return 0;
    };
  }, [valueSource, format, qbType]);

  const getMetric = useMemo(() => {
    if (metricMode === "projections") {
      const chosen =
        projectionSource === "ESPN" ? projMaps.ESPN :
        projectionSource === "CBS"  ? projMaps.CBS  :
        projMaps.CSV;
      if (chosen) return (p) => getSeasonPointsForPlayer(chosen, p) || 0;
      return () => 0;
    }
    return (p) => getPlayerValue(p) || 0;
  }, [metricMode, projectionSource, projMaps, getPlayerValue]);

  /** ===== Trade calc state ===== */
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [recommendation, setRecommendation] = useState("");
  const [selectedOwnerA, setSelectedOwnerA] = useState("");
  const [selectedOwnerB, setSelectedOwnerB] = useState("");

  /** totals + recommendation */
  const tradeValueA = sideA.reduce((sum, p) => sum + getMetric(p), 0);
  const tradeValueB = sideB.reduce((sum, p) => sum + getMetric(p), 0);

  useEffect(() => {
    const diff = Math.abs(tradeValueA - tradeValueB);
    if (diff < 50) setRecommendation("✅ Fair Trade");
    else if (tradeValueA > tradeValueB) setRecommendation("🔵 Side A Wins");
    else setRecommendation("🔴 Side B Wins");
  }, [tradeValueA, tradeValueB, metricMode, projectionSource, valueSource, format, qbType]);

  /** add / remove */
  const addPlayer = (side, player) => {
    if (!player) return;
    if ((side === "A" && sideA.includes(player)) || (side === "B" && sideB.includes(player))) return;

    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);

    if (activeLeague) {
      if (ownerA && ownerB) {
        const allowedPlayers = side === "A" ? ownerB.players : ownerA.players;
        if (!allowedPlayers.includes(player.player_id)) return;
      } else if (ownerA && !ownerB && side === "A" && ownerA.players.includes(player.player_id)) {
        return;
      } else if (ownerB && !ownerA && side === "B" && ownerB.players.includes(player.player_id)) {
        return;
      }

      const playerOwner = league?.rosters?.find((r) => r.players.includes(player.player_id));
      if (playerOwner) {
        if (side === "B" && !selectedOwnerA) setSelectedOwnerA(playerOwner.owner_id);
        if (side === "A" && !selectedOwnerB) setSelectedOwnerB(playerOwner.owner_id);
      }
    }

    if (side === "A") setSideA((prev) => [...prev, player]);
    else setSideB((prev) => [...prev, player]);
  };
  const removePlayer = (side, index) => {
    if (side === "A") setSideA((prev) => prev.filter((_, i) => i !== index));
    else setSideB((prev) => prev.filter((_, i) => i !== index));
  };

  /** suggestions */
  const diff = tradeValueA - tradeValueB;
  let recSide = Math.abs(diff) >= 50 ? (diff > 0 ? "B" : "A") : null;
  let candidatePool = Object.values(players || {});
  if (activeLeague) {
    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);
    if (ownerA && ownerB) {
      const source = recSide === "A" ? ownerB : ownerA;
      candidatePool = (source.players || []).map((pid) => players[pid]).filter(Boolean);
    } else if (ownerA || ownerB) {
      const exclude = new Set((ownerA || ownerB)?.players || []);
      candidatePool = candidatePool.filter((p) => !exclude.has(p.player_id));
    }
  }
  const targetValue = Math.abs(diff);
  const recommendedPlayers = recSide
    ? candidatePool
        .filter((p) => getMetric(p) > 0)
        .filter((p) => !sideA.includes(p) && !sideB.includes(p))
        .sort((a, b) => Math.abs(getMetric(a) - targetValue) - Math.abs(getMetric(b) - targetValue))
        .slice(0, 6)
    : [];

  /** filtered search pools */
  const filteredPlayers = (side) => {
    if (!activeLeague) return players;
    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);
    if (ownerA && ownerB) {
      const source = side === "A" ? ownerB : ownerA;
      return (source.players || []).reduce((map, pid) => {
        if (players[pid]) map[pid] = players[pid];
        return map;
      }, {});
    }
    if (ownerA && !ownerB) {
      return side === "B"
        ? (ownerA.players || []).reduce((m, pid) => { if (players[pid]) m[pid] = players[pid]; return m; }, {})
        : Object.fromEntries(Object.entries(players).filter(([pid]) => !(ownerA.players||[]).includes(pid)));
    }
    if (ownerB && !ownerA) {
      return side === "A"
        ? (ownerB.players || []).reduce((m, pid) => { if (players[pid]) m[pid] = players[pid]; return m; }, {})
        : Object.fromEntries(Object.entries(players).filter(([pid]) => !(ownerB.players||[]).includes(pid)));
    }
    return players;
  };

  const topRecommendations = Object.values(players || {})
    .filter((p) => getMetric(p) > 0)
    .sort((a, b) => getMetric(b) - getMetric(a))
    .slice(0, 10);

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Trade Analyzer" />
      <div className="max-w-6xl mx-auto px-4 pt-8 -mt-2">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the{" "}
            <a href="/" className="text-blue-400 underline">homepage</a>{" "}
            to use this tool.
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="mt-0 flex flex-col sm:flex-row justify-center gap-4 mb-6 bg-gray-900 p-4 rounded-lg flex-wrap">
              {/* Metric switch (shared with Trade Finder) */}
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Metric:</span>
                  <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
                    <button
                      className={`px-3 py-1 ${metricMode === "projections" ? "bg-white/10" : "hover:bg-white/5"}`}
                      onClick={() => updatePrefs({ metricMode: "projections" })}
                      disabled={
                        !!projError ||
                        projLoading ||
                        (!projMaps.CSV && !projMaps.ESPN && !projMaps.CBS) // guard when no proj files
                      }
                      title={projError || ""}
                    >
                      Projections{projLoading ? "…" : ""}
                    </button>
                    <button
                      className={`px-3 py-1 ${metricMode === "values" ? "bg-white/10" : "hover:bg-white/5"}`}
                      onClick={() => updatePrefs({ metricMode: "values" })}
                    >
                      Values
                    </button>
                  </div>
                </div>

                {/* --- PROJECTIONS-ONLY CONTROLS --- */}
                {metricMode === "projections" && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Proj Source:</span>
                    <select
                      className="bg-gray-800 text-white p-2 rounded"
                      value={projectionSource}
                      onChange={(e) => updatePrefs({ projectionSource: e.target.value })}
                      disabled={projLoading}
                    >
                      {projMaps.CSV  && <option value="CSV">Fantasy Football Analytics</option>}
                      {projMaps.ESPN && <option value="ESPN">ESPN</option>}
                      {projMaps.CBS  && <option value="CBS">CBS Sports</option>}
                    </select>
                  </div>
                )}

                {/* --- VALUES-ONLY CONTROLS --- */}
                {metricMode === "values" && (
                  <>
                    {/* Value source */}
                    <div className="flex items-center gap-2">
                      <label className="font-semibold">Value Source:</label>
                      <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
                    </div>

                    {/* Format toggle (only if the chosen source supports both dynasty & redraft) */}
                    {VALUE_SOURCES[valueSource]?.supports?.dynasty &&
                      VALUE_SOURCES[valueSource]?.supports?.redraft && (
                        <div className="flex items-center gap-2">
                          <label className="font-semibold">Format:</label>
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
                        </div>
                    )}

                    {/* QB toggle (only if the chosen source supports qbToggle) */}
                    {VALUE_SOURCES[valueSource]?.supports?.qbToggle && (
                      <div className="flex items-center gap-2">
                        <label className="font-semibold">QB:</label>
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
                      </div>
                    )}
                  </>
                )}

            </div>

            {/* Inline Summary */}
            <div className="text-center mb-4 text-lg font-semibold bg-gray-900 py-2 rounded">
              🔵 {getSideTitle("A")}: {Math.round(tradeValueA)} | 🔴 {getSideTitle("B")}: {Math.round(tradeValueB)} | {recommendation}
            </div>

            {/* League Selector */}
            <div className="text-center mb-4 flex justify-center items-center gap-4 flex-wrap">
              <select
                value={activeLeague || ""}
                onChange={(e) => handleLeagueChange(e.target.value)}
                className="bg-gray-800 text-white p-2 rounded"
              >
                <option value="">Choose a League</option>
                {leagues.map((lg) => (
                  <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>
                ))}
              </select>
              {activeLeague && (
                <button
                  onClick={() => {
                    setActiveLeague(null);
                    setSideA([]); setSideB([]);
                    setSelectedOwnerA(""); setSelectedOwnerB("");
                  }}
                  className="bg-gray-700 px-3 py-1 rounded hover:bg-gray-600"
                >
                  Clear League
                </button>
              )}
            </div>

            {/* Trade Sides */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {activeLeague && (
                  <select
                    value={selectedOwnerA}
                    onChange={(e) => setSelectedOwnerA(e.target.value)}
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.user_id} value={owner.user_id}>{owner.display_name}</option>
                    ))}
                  </select>
                )}
                <TradeSide
                  title={getSideTitle("A")}
                  players={sideA}
                  onRemove={(i) => removePlayer("A", i)}
                  getPlayerValue={getMetric}             
                  suggestedPlayers={recSide === "A" ? recommendedPlayers : []}
                  addPlayerToSide={(p) => addPlayer("A", p)}
                  searchBox={
                    <SearchBox
                      players={filteredPlayers("A")}
                      onSelect={(p) => addPlayer("A", p)}
                      getPlayerValue={getMetric}          
                    />
                  }
                />
              </div>

              <div>
                {activeLeague && (
                  <select
                    value={selectedOwnerB}
                    onChange={(e) => setSelectedOwnerB(e.target.value)}
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.user_id} value={owner.user_id}>{owner.display_name}</option>
                    ))}
                  </select>
                )}
                <TradeSide
                  title={getSideTitle("B")}
                  players={sideB}
                  onRemove={(i) => removePlayer("B", i)}
                  getPlayerValue={getMetric}             
                  suggestedPlayers={recSide === "B" ? recommendedPlayers : []}
                  addPlayerToSide={(p) => addPlayer("B", p)}
                  searchBox={
                    <SearchBox
                      players={filteredPlayers("B")}
                      onSelect={(p) => addPlayer("B", p)}
                      getPlayerValue={getMetric}          
                    />
                  }
                />
              </div>
            </div>

            {/* Clear Trade */}
            {(sideA.length > 0 || sideB.length > 0) && (
              <div className="text-center mt-6">
                <button
                  onClick={() => {
                    setSideA([]); setSideB([]);
                    setSelectedOwnerA(""); setSelectedOwnerB("");
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
                >
                  Clear Trade
                </button>
              </div>
            )}

            {/* Top Recommendations */}
            {players && Object.keys(players).length > 0 && (
              <div className="mt-10 bg-gray-900 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4">Top Available Players</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {topRecommendations.map((p) => (
                    <PlayerCard
                      key={p.player_id}
                      player={p}
                      value={getMetric(p)}                 
                      onAddA={() => addPlayer("A", p)}
                      onAddB={() => addPlayer("B", p)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
