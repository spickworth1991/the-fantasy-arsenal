"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import { useArsenalAccount } from "../../context/ArsenalAccountContext";
import TradeSide from "../../components/TradeSide";
import SearchBox from "../../components/SearchBox";
import PlayerCard from "../../components/PlayerCard";
import TradeWorkspaceSuite from "./TradeWorkspaceSuite";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { makeGetPlayerValue } from "../../lib/values";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

import { PROJ_ARSENAL_JSON_URL, PROJ_CBS_JSON_URL, PROJ_DRAFTSHARKS_JSON_URL, PROJ_ESPN_JSON_URL, PROJ_FANTASYSHARKS_JSON_URL, PROJ_JSON_URL, PROJ_SLEEPER_JSON_URL } from "../../lib/projectionSeason";

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
  const { isConnected, syncNow } = useArsenalAccount();
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

  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null, SLEEPER: null, FANTASYSHARKS: null, DRAFTSHARKS: null, ARSENAL: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [recommendation, setRecommendation] = useState("");
  const [selectedOwnerA, setSelectedOwnerA] = useState("");
  const [selectedOwnerB, setSelectedOwnerB] = useState("");
  const [tradeTab, setTradeTab] = useState("analyzer");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjError("");
      setProjLoading(true);
      try {
        const [csv, espn, cbs, sleeper, fantasySharks, draftSharks, arsenal] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
          fetchProjectionMap(PROJ_SLEEPER_JSON_URL),
          fetchProjectionMap(PROJ_FANTASYSHARKS_JSON_URL),
          fetchProjectionMap(PROJ_DRAFTSHARKS_JSON_URL),
          fetchProjectionMap(PROJ_ARSENAL_JSON_URL),
        ]);
        if (!mounted) return;

        const next = { CSV: null, ESPN: null, CBS: null, SLEEPER: null, FANTASYSHARKS: null, DRAFTSHARKS: null, ARSENAL: null };
        if (csv.status === "fulfilled") next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled") next.CBS = cbs.value;
        if (sleeper.status === "fulfilled") next.SLEEPER = sleeper.value;
        if (fantasySharks.status === "fulfilled") next.FANTASYSHARKS = fantasySharks.value;
        if (draftSharks.status === "fulfilled") next.DRAFTSHARKS = draftSharks.value;
        if (arsenal.status === "fulfilled") next.ARSENAL = arsenal.value;
        setProjMaps(next);

        const fallbackKey = next.ARSENAL ? "proj:thefantasyarsenal" : next.FANTASYSHARKS ? "proj:fantasysharks" : next.DRAFTSHARKS ? "proj:draftsharks" : next.ESPN ? "proj:espn" : next.CBS ? "proj:cbs" : next.SLEEPER ? "proj:sleeper" : next.CSV ? "proj:ffa" : null;
        if (metricMode === "projections" && !fallbackKey) {
          setProjError("No projections found. Using values instead.");
          setSourceKey("val:thefantasyarsenal");
          return;
        }
        if (String(sourceKey || "").startsWith("proj:")) {
          if (projectionSource === "CBS" && !next.CBS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ESPN" && !next.ESPN && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "CSV" && !next.CSV && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "SLEEPER" && !next.SLEEPER && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "FANTASYSHARKS" && !next.FANTASYSHARKS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "DRAFTSHARKS" && !next.DRAFTSHARKS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ARSENAL" && !next.ARSENAL && fallbackKey) setSourceKey(fallbackKey);
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable. Using values.");
        setSourceKey("val:thefantasyarsenal");
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
        projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projectionSource === "SLEEPER" ? projMaps.SLEEPER : projectionSource === "FANTASYSHARKS" ? projMaps.FANTASYSHARKS : projectionSource === "DRAFTSHARKS" ? projMaps.DRAFTSHARKS : projectionSource === "ARSENAL" ? projMaps.ARSENAL : projMaps.CSV;
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

  // Keep the current package available to league-aware tools. This is a local
  // handoff only; it never writes anything to Sleeper.
  useEffect(() => {
    if (!activeLeague || (!sideA.length && !sideB.length)) return;
    const payload = {
      leagueId: String(activeLeague),
      ownerA: String(selectedOwnerA || ""),
      ownerB: String(selectedOwnerB || ""),
      sideA: sideA.map((player) => String(player.player_id)),
      sideB: sideB.map((player) => String(player.player_id)),
      sourceKey,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(`tfa:trade-handoff:${activeLeague}`, JSON.stringify(payload));
      localStorage.setItem("tfa:trade-handoff:latest", JSON.stringify(payload));
    } catch {}
  }, [activeLeague, selectedOwnerA, selectedOwnerB, sideA, sideB, sourceKey]);

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
  const saveCurrentTrade = async () => {
    if (!isConnected) {
      setSaveMessage("Sign in to an Arsenal account to save trades across devices.");
      return;
    }
    if (!sideA.length && !sideB.length) {
      setSaveMessage("Add at least one asset before saving.");
      return;
    }
    const key = `tfa:trade-workspaces:${String(activeLeague || "global")}`;
    let current = [];
    try { current = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
    const item = {
      id:crypto.randomUUID?.() || String(Date.now()),
      createdAt:Date.now(),
      ownerA:selectedOwnerA,
      ownerB:selectedOwnerB,
      sideA:sideA.map((player) => String(player.player_id)),
      sideB:sideB.map((player) => String(player.player_id)),
      valueA:tradeValueA,
      valueB:tradeValueB,
      sourceKey,
      outcome:"Open",
    };
    localStorage.setItem(key, JSON.stringify([item, ...current].slice(0, 30)));
    await syncNow({ quiet:true }).catch(() => {});
    setSaveMessage("Trade saved to your Arsenal account.");
  };

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
              <details className="premium-disclosure">
                <summary>Model Settings <span className="ml-auto text-xs font-normal text-white/45">{metricMode === "projections" ? "Projections" : "Values"}</span></summary>
              <div className="mt-3 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 p-4">
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
              </details>

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

            <div className="mb-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-2"><div className="flex w-max gap-1">{[["analyzer","Analyzer"],["finder","Partner Finder"],["block","Trade Block"],["history","Trade History"],["market","League Market"]].map(([key,label])=><button type="button" key={key} onClick={()=>setTradeTab(key)} className={`min-h-11 rounded-xl px-5 text-sm font-black ${tradeTab===key?"bg-cyan-300/10 text-cyan-100":"text-white/40"}`}>{label}</button>)}</div></div>

            <div className={tradeTab !== "analyzer" ? "block" : "hidden"}><TradeWorkspaceSuite
              league={league}
              players={players}
              getMetric={getMetric}
              metricMode={metricMode}
              username={username}
              sideA={sideA}
              sideB={sideB}
              selectedOwnerA={selectedOwnerA}
              selectedOwnerB={selectedOwnerB}
              onLoadPackage={(nextA, nextB, ownerA, ownerB) => {
                setSideA(nextA || []);
                setSideB(nextB || []);
                setSelectedOwnerA(ownerA || "");
                setSelectedOwnerB(ownerB || "");
                setTradeTab("analyzer");
              }}
              initialTab={tradeTab === "analyzer" ? "finder" : tradeTab}
              hideNavigation
            /></div>

            <div className={tradeTab === "analyzer" ? "block" : "hidden"}><div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-gray-900 p-4 md:grid-cols-3">
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
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={saveCurrentTrade} className="rounded-xl bg-cyan-300/10 px-4 py-2.5 text-xs font-black text-cyan-100">Save trade</button>
              <button type="button" onClick={() => window.print()} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-black text-white/65">Print / save PDF</button>
              {saveMessage ? <span className="text-xs text-white/45">{saveMessage}</span> : null}
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
            ) : null}</div>
          </>
        )}
      </div>
    </>
  );
}
