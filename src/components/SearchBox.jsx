import { useState } from "react";

export default function SearchBox({
  players,
  onSelect,
  getPlayerValue,
  isPlayerRanked = (player) => getPlayerValue(player) > 0,
  sourceLabel = "selected source",
}) {
  const [search, setSearch] = useState("");
  const [filtered, setFiltered] = useState([]);

  const handleChange = (event) => {
    const value = event.target.value;
    setSearch(value);
    if (value.length <= 1) {
      setFiltered([]);
      return;
    }
    const query = value.toLowerCase();
    setFiltered(
      Object.values(players || {})
        .filter(
          (player) =>
            player?.full_name &&
            player.full_name.toLowerCase().includes(query),
        )
        .sort(
          (a, b) =>
            Number(isPlayerRanked(b)) - Number(isPlayerRanked(a)) ||
            getPlayerValue(b) - getPlayerValue(a),
        )
        .slice(0, 8),
    );
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={handleChange}
        placeholder="Search players..."
        className="w-full rounded px-3 py-2 text-black"
      />
      {filtered.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded bg-gray-800 text-white shadow-lg">
          {filtered.map((player) => {
            const ranked = isPlayerRanked(player);
            return (
              <li
                key={player.player_id}
                className="cursor-pointer px-3 py-2 hover:bg-gray-700"
                onClick={() => {
                  onSelect(player);
                  setSearch("");
                  setFiltered([]);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {player.full_name}{" "}
                    <span className="text-gray-400">{player.team}</span>
                  </span>
                  <span
                    className={`shrink-0 text-xs ${ranked ? "text-cyan-200" : "text-amber-200/70"}`}
                  >
                    {ranked
                      ? Number(getPlayerValue(player) || 0).toLocaleString()
                      : `Not ranked by ${sourceLabel}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
