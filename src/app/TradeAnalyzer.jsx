"use client";
import { useState, useEffect } from "react";
import { useSleeper } from "../context/SleeperContext";
import TradeSide from "../components/TradeSide";
import SearchBox from "../components/SearchBox";
import PlayerCard from "../components/PlayerCard";
import Navbar from "../components/Navbar";
import BackgroundParticles from "../components/BackgroundParticles";
import ValueSourceDropdown from "../components/ValueSourceDropdown";
const VALUE_SOURCES = {
  FantasyCalc: {
    label: "FantasyCalc",
    supports: { dynasty: true, redraft: true, qbToggle: true },
  },
  DynastyProcess: {
    label: "DynastyProcess",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
  KeepTradeCut: {
    label: "KeepTradeCut",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
  FantasyNavigator: {
    label: "FantasyNavigator",
    supports: { dynasty: true, redraft: true, qbToggle: true },
  },
  IDynastyP: {
  label: "IDynastyP",
  supports: { dynasty: true, redraft: false, qbToggle: true },
  },

};



export default function TradeAnalyzer() {
  const {
    username,
    leagues,
    players,
    activeLeague,
    setActiveLeague,
    fetchLeagueRosters,
    format,
    qbType,
    setFormat,
    setQbType,
  } = useSleeper();

  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [recommendation, setRecommendation] = useState("");
  const [selectedOwnerA, setSelectedOwnerA] = useState("");
  const [selectedOwnerB, setSelectedOwnerB] = useState("");
  const [valueSource, setValueSource] = useState("FantasyCalc");

  const supports = VALUE_SOURCES[valueSource].supports;

  /** ✅ League Change → Reset */
  const handleLeagueChange = async (leagueId) => {
    setActiveLeague(leagueId);
    setSideA([]);
    setSideB([]);
    setSelectedOwnerA("");
    setSelectedOwnerB("");
    if (leagueId) await fetchLeagueRosters(leagueId);
  };

  /** ✅ Current League + Owners */
  const league = leagues.find((lg) => lg.league_id === activeLeague);
  const allOwners = league
    ? (league.rosters || []).map((roster) => ({
        user_id: roster.owner_id,
        display_name:
          league.users?.find((u) => u.user_id === roster.owner_id)?.display_name || "Unknown",
        team_name:
          league.users?.find((u) => u.user_id === roster.owner_id)?.metadata?.team_name || null,
        players: roster.players || [],
      }))
    : [];

  /** ✅ Dynamic titles */
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


// ✅ Update getPlayerValue:
const getPlayerValue = (p) => {
  if (!p) return 0;

  if (valueSource === "FantasyCalc") {
    return format === "dynasty"
      ? qbType === "sf" ? p.fc_values.dynasty_sf : p.fc_values.dynasty_1qb
      : qbType === "sf" ? p.fc_values.redraft_sf : p.fc_values.redraft_1qb;
  } else if (valueSource === "DynastyProcess") {
    return qbType === "sf" ? (p.dp_values?.superflex || 0) : (p.dp_values?.one_qb || 0);
  } else if (valueSource === "KeepTradeCut") {
    return qbType === "sf" ? (p.ktc_values?.superflex || 0) : (p.ktc_values?.one_qb || 0);
  } else if (valueSource === "FantasyNavigator") {
    return format === "dynasty"
      ? qbType === "sf" ? p.fn_values?.dynasty_sf : p.fn_values?.dynasty_1qb
      : qbType === "sf" ? p.fn_values?.redraft_sf : p.fn_values?.redraft_1qb;
  }
    else if (valueSource === "IDynastyP") {
    return qbType === "sf" ? (p.idp_values?.superflex || 0) : (p.idp_values?.one_qb || 0);
  }

  return 0;
};



  /** ✅ Totals + Recommendation */
  const tradeValueA = sideA.reduce((sum, p) => sum + getPlayerValue(p), 0);
  const tradeValueB = sideB.reduce((sum, p) => sum + getPlayerValue(p), 0);

  useEffect(() => {
    const diff = Math.abs(tradeValueA - tradeValueB);
    if (diff < 50) setRecommendation("✅ Fair Trade");
    else if (tradeValueA > tradeValueB) setRecommendation("🔵 Side A Wins");
    else setRecommendation("🔴 Side B Wins");
  }, [tradeValueA, tradeValueB, format, qbType, valueSource]);

  /** ✅ Add Player */
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

  /** ✅ Suggestions */
  const diff = tradeValueA - tradeValueB;
  let recSide = Math.abs(diff) >= 50 ? (diff > 0 ? "B" : "A") : null;
  let candidatePool = Object.values(players);

  if (activeLeague) {
    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);
    if (ownerA && ownerB) {
      const source = recSide === "A" ? ownerB : ownerA;
      candidatePool = source.players.map((pid) => players[pid]).filter(Boolean);
    } else if (ownerA || ownerB) {
      const exclude = new Set((ownerA || ownerB).players);
      candidatePool = candidatePool.filter((p) => !exclude.has(p.player_id));
    }
  }

  const targetValue = Math.abs(diff);
  const recommendedPlayers = recSide
    ? candidatePool
        .filter((p) => getPlayerValue(p) > 0)
        .filter((p) => !sideA.includes(p) && !sideB.includes(p))
        .sort((a, b) => Math.abs(getPlayerValue(a) - targetValue) - Math.abs(getPlayerValue(b) - targetValue))
        .slice(0, 6)
    : [];

  /** ✅ Filtered Players */
  const filteredPlayers = (side) => {
    if (!activeLeague) return players;
    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);
    if (ownerA && ownerB) {
      const source = side === "A" ? ownerB : ownerA;
      return source.players.reduce((map, pid) => {
        if (players[pid]) map[pid] = players[pid];
        return map;
      }, {});
    }
    if (ownerA && !ownerB) {
      return side === "B"
        ? ownerA.players.reduce((map, pid) => {
            if (players[pid]) map[pid] = players[pid];
            return map;
          }, {})
        : Object.fromEntries(Object.entries(players).filter(([pid]) => !ownerA.players.includes(pid)));
    }
    if (ownerB && !ownerA) {
      return side === "A"
        ? ownerB.players.reduce((map, pid) => {
            if (players[pid]) map[pid] = players[pid];
            return map;
          }, {})
        : Object.fromEntries(Object.entries(players).filter(([pid]) => !ownerB.players.includes(pid)));
    }
    return players;
  };

  const topRecommendations = Object.values(players)
    .filter((p) => getPlayerValue(p) > 0)
    .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
    .slice(0, 10);

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Trade Analyzer" />
      <div className="max-w-6xl mx-auto px-4 pt-14 -mt-2">
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
            {/* ✅ Control Panel */}
            <div className="mt-0 flex flex-col sm:flex-row justify-center gap-4 mb-6 bg-gray-900 p-4 rounded-lg">
              {/* Value Source */}
              <div className="flex flex-col items-center sm:flex-row gap-2">
                <label className="font-semibold">Value Source:</label>
                <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
              </div>




              {/* Format Toggle */}
              {supports.dynasty && supports.redraft && (
                <div className="flex justify-center items-center  gap-2">
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

              {/* QB Toggle */}
              {supports.qbToggle && (
                <div className="flex justify-center items-center gap-2">
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
            </div>

            {/* ✅ Inline Summary */}
            <div className="text-center mb-4 text-lg font-semibold bg-gray-900 py-2 rounded">
              🔵 {getSideTitle("A")}: {tradeValueA} | 🔴 {getSideTitle("B")}: {tradeValueB} | {recommendation}
            </div>

            {/* ✅ League Selector */}
            <div className="text-center mb-4 flex justify-center items-center gap-4 flex-wrap">
              <select
                value={activeLeague || ""}
                onChange={(e) => handleLeagueChange(e.target.value)}
                className="bg-gray-800 text-white p-2 rounded"
              >
                <option value="">Choose a League</option>
                {leagues.map((lg) => (
                  <option key={lg.league_id} value={lg.league_id}>
                    {lg.name}
                  </option>
                ))}
              </select>
              {activeLeague && (
                <button
                  onClick={() => {
                    setActiveLeague(null);
                    setSideA([]);
                    setSideB([]);
                    setSelectedOwnerA("");
                    setSelectedOwnerB("");
                  }}
                  className="bg-gray-700 px-3 py-1 rounded hover:bg-gray-600"
                >
                  Clear League
                </button>
              )}
            </div>

            {/* ✅ Trade Sides */}
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
                      <option key={owner.user_id} value={owner.user_id}>
                        {owner.display_name}
                      </option>
                    ))}
                  </select>
                )}
                <TradeSide
                  title={getSideTitle("A")}
                  players={sideA}
                  onRemove={(i) => removePlayer("A", i)}
                  getPlayerValue={getPlayerValue}
                  suggestedPlayers={recSide === "A" ? recommendedPlayers : []}
                  addPlayerToSide={(p) => addPlayer("A", p)}
                  searchBox={
                    <SearchBox
                      players={filteredPlayers("A")}
                      onSelect={(p) => addPlayer("A", p)}
                      getPlayerValue={getPlayerValue} // ✅ clearly pass getPlayerValue
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
                      <option key={owner.user_id} value={owner.user_id}>
                        {owner.display_name}
                      </option>
                    ))}
                  </select>
                )}
                <TradeSide
                  title={getSideTitle("B")}
                  players={sideB}
                  onRemove={(i) => removePlayer("B", i)}
                  getPlayerValue={getPlayerValue}
                  suggestedPlayers={recSide === "B" ? recommendedPlayers : []}
                  addPlayerToSide={(p) => addPlayer("B", p)}
                  searchBox={
                    <SearchBox
                      players={filteredPlayers("B")}
                      onSelect={(p) => addPlayer("B", p)}
                      getPlayerValue={getPlayerValue} // ✅ clearly pass getPlayerValue
                    />
                  }

                />
              </div>
            </div>

            {/* ✅ Clear Trade Button */}
            {(sideA.length > 0 || sideB.length > 0) && (
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
            )}

            {/* ✅ Top Recommendations */}
            {players && Object.keys(players).length > 0 && (
              <div className="mt-10 bg-gray-900 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4">Top Available Players</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {topRecommendations.map((p) => (
                    <PlayerCard
                      key={p.player_id}
                      player={p}
                      value={getPlayerValue(p)}
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
