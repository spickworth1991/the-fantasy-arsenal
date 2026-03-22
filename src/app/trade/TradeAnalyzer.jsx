"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import TradeSide from "../../components/TradeSide";
import SearchBox from "../../components/SearchBox";
import PlayerCard from "../../components/PlayerCard";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { makeGetPlayerValue } from "../../lib/values";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

const PROJ_JSON_URL = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL = "/projections_cbs_2025.json";

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
  const map = { JAX: "JAC", LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV", WFT: "WAS", WSH: "WAS" };
  return map[s] || s;
}

function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}

function buildProjectionMapFromJSON(json) {
  const rows = Array.isArray(json) ? json : json?.rows || [];
  const byId = Object.create(null);
  const byName = Object.create(null);
  const byNameTeam = Object.create(null);
  const byNamePos = Object.create(null);

  rows.forEach((r) => {
    const pid = r.player_id != null ? String(r.player_id) : "";
    const name = r.name || r.player || r.full_name || "";
    const seasonPts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;
    const team = normalizeTeamAbbr(r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team);
    const pos = normalizePos(r.pos ?? r.position ?? r.player_position);

    if (pid) byId[pid] = seasonPts;
    if (!name) return;

    const nn = normNameForMap(name);
    byName[nn] = seasonPts;
    byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;
    if (team) byNameTeam[`${nn}|${team}`] = seasonPts;
    if (pos) byNamePos[`${nn}|${pos}`] = seasonPts;
  });

  return { byId, byName, byNameTeam, byNamePos };
}

async function fetchProjectionMap(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return buildProjectionMapFromJSON(await res.json());
}

function getSeasonPointsForPlayer(map, p) {
  if (!map || !p) return 0;

  const hit = map.byId?.[String(p.player_id)];
  if (hit != null) return hit;

  const nn = normNameForMap(p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`);
  const team = normalizeTeamAbbr(p.team);
  const pos = normalizePos(p.position);

  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos && map.byNamePos?.[`${nn}|${pos}`] != null) return map.byNamePos[`${nn}|${pos}`];
  if (team || pos) return 0;
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const compact = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return compact && map.byName?.[compact] != null ? map.byName[compact] : 0;
}

export default function TradeAnalyzer() {
  const {
    username,
    leagues,
    players,
    activeLeague,
    setActiveLeague,
    fetchLeagueRostersSilent,
    format,
    qbType,
    setFormat,
    setQbType,
    sourceKey,
    setSourceKey,
  } = useSleeper();

  const metricMode = metricModeFromSourceKey(sourceKey);
  const projectionSource = projectionSourceFromKey(sourceKey);
  const valueSource = valueSourceFromKey(sourceKey);

  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [recommendation, setRecommendation] = useState("");
  const [selectedOwnerA, setSelectedOwnerA] = useState("");
  const [selectedOwnerB, setSelectedOwnerB] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjError("");
      setProjLoading(true);
      try {
        const [csv, espn, cbs] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
        ]);
        if (!mounted) return;

        const next = { CSV: null, ESPN: null, CBS: null };
        if (csv.status === "fulfilled") next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled") next.CBS = cbs.value;
        setProjMaps(next);

        const fallbackKey = next.ESPN ? "proj:espn" : next.CBS ? "proj:cbs" : next.CSV ? "proj:ffa" : null;
        if (metricMode === "projections" && !fallbackKey) {
          setProjError("No projections found. Using values instead.");
          setSourceKey("val:fantasycalc");
          return;
        }
        if (String(sourceKey || "").startsWith("proj:")) {
          if (projectionSource === "CBS" && !next.CBS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ESPN" && !next.ESPN && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "CSV" && !next.CSV && fallbackKey) setSourceKey(fallbackKey);
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable. Using values.");
        setSourceKey("val:fantasycalc");
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeagueChange = async (leagueId) => {
    setActiveLeague(leagueId);
    setSideA([]);
    setSideB([]);
    setSelectedOwnerA("");
    setSelectedOwnerB("");
    if (leagueId) await fetchLeagueRostersSilent(leagueId);
  };

  const league = leagues.find((lg) => lg.league_id === activeLeague);
  const allOwners = league
    ? (league.rosters || []).map((roster) => ({
        user_id: roster.owner_id,
        display_name: league.users?.find((u) => u.user_id === roster.owner_id)?.display_name || "Unknown",
        team_name: league.users?.find((u) => u.user_id === roster.owner_id)?.metadata?.team_name || null,
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

  const getPlayerValue = useMemo(() => makeGetPlayerValue(valueSource, format, qbType), [valueSource, format, qbType]);

  const getMetric = useMemo(() => {
    if (metricMode === "projections") {
      const chosen =
        projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projMaps.CSV;
      if (chosen) return (p) => getSeasonPointsForPlayer(chosen, p) || 0;
      return () => 0;
    }
    return (p) => getPlayerValue(p) || 0;
  }, [metricMode, projectionSource, projMaps, getPlayerValue]);

  const tradeValueA = sideA.reduce((sum, p) => sum + getMetric(p), 0);
  const tradeValueB = sideB.reduce((sum, p) => sum + getMetric(p), 0);

  useEffect(() => {
    const diff = Math.abs(tradeValueA - tradeValueB);
    if (diff < 50) setRecommendation("Fair Trade");
    else if (tradeValueA > tradeValueB) setRecommendation("Side A Wins");
    else setRecommendation("Side B Wins");
  }, [tradeValueA, tradeValueB]);

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

  const diff = tradeValueA - tradeValueB;
  const recSide = Math.abs(diff) >= 50 ? (diff > 0 ? "B" : "A") : null;

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
        ? (ownerA.players || []).reduce((m, pid) => {
            if (players[pid]) m[pid] = players[pid];
            return m;
          }, {})
        : Object.fromEntries(Object.entries(players).filter(([pid]) => !(ownerA.players || []).includes(pid)));
    }
    if (ownerB && !ownerA) {
      return side === "A"
        ? (ownerB.players || []).reduce((m, pid) => {
            if (players[pid]) m[pid] = players[pid];
            return m;
          }, {})
        : Object.fromEntries(Object.entries(players).filter(([pid]) => !(ownerB.players || []).includes(pid)));
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
      <div className="max-w-6xl mx-auto px-4 pt-20 -mt-2">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the <a href="/" className="text-blue-400 underline">homepage</a> to use this tool.
          </div>
        ) : (
          <>
            <div className="mb-6 space-y-4">
              <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/60">Trade Lens</div>
                <div className="mt-3">
                  <SourceSelector
                    sources={DEFAULT_SOURCES}
                    value={sourceKey}
                    onChange={setSourceKey}
                    className="w-full"
                    mode={format}
                    qbType={qbType}
                    onModeChange={setFormat}
                    onQbTypeChange={setQbType}
                    layout="inline"
                  />
                </div>
                <div className="mt-2 text-xs text-white/60">
                  {projError && metricMode === "projections"
                    ? projError
                    : projLoading && metricMode === "projections"
                    ? "Loading projection inputs..."
                    : metricMode === "projections"
                    ? "Comparing sides with season projection totals."
                    : "Comparing sides with the selected trade market."}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-gray-900 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">League Context</div>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs text-white/55">Choose a league for roster-aware trading</label>
                    <select
                      value={activeLeague || ""}
                      onChange={(e) => handleLeagueChange(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
                    >
                      <option value="">Choose a League</option>
                      {leagues.map((lg) => (
                        <option key={lg.league_id} value={lg.league_id}>
                          {lg.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {activeLeague ? (
                    <button
                      onClick={() => {
                        setActiveLeague(null);
                        setSideA([]);
                        setSideB([]);
                        setSelectedOwnerA("");
                        setSelectedOwnerB("");
                      }}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                    >
                      Clear League
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-gray-900 p-4 md:grid-cols-3">
              <div className="rounded-xl bg-[#0f2134] px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-blue-200/60">Side A</div>
                <div className="mt-1 text-2xl font-semibold text-white">{Math.round(tradeValueA).toLocaleString()}</div>
              </div>
              <div className="rounded-xl bg-[#2b1518] px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-rose-200/60">Side B</div>
                <div className="mt-1 text-2xl font-semibold text-white">{Math.round(tradeValueB).toLocaleString()}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-white/45">Verdict</div>
                <div className="mt-1 text-lg font-semibold text-white">{recommendation}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {activeLeague ? (
                  <select
                    value={selectedOwnerA}
                    onChange={(e) => setSelectedOwnerA(e.target.value)}
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.user_id} value={owner.user_id}>
                        {owner.display_name}
                      </option>
                    ))}
                  </select>
                ) : null}
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
                {activeLeague ? (
                  <select
                    value={selectedOwnerB}
                    onChange={(e) => setSelectedOwnerB(e.target.value)}
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.user_id} value={owner.user_id}>
                        {owner.display_name}
                      </option>
                    ))}
                  </select>
                ) : null}
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

            {sideA.length > 0 || sideB.length > 0 ? (
              <div className="text-center mt-6">
                <button
                  onClick={() => {
                    setSideA([]);
                    setSideB([]);
                    setSelectedOwnerA("");
                    setSelectedOwnerB("");
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
                >
                  Clear Trade
                </button>
              </div>
            ) : null}

            {players && Object.keys(players).length > 0 ? (
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
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
