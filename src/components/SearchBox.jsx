import { useEffect, useState } from "react";

export default function SearchBox({
  players,
  onSelect,
  getPlayerValue,
  isPlayerRanked = (player) => getPlayerValue(player) > 0,
  sourceLabel = "selected source",
  browseLabel = "Eligible players",
  focusLimit = 30,
  browseOnFocus = true,
  focusHint = "",
}) {
  const [search, setSearch] = useState("");
  const [filtered, setFiltered] = useState([]);
  const [open, setOpen] = useState(false);

  const findMatches = (value) => {
    const query = value.toLowerCase().trim();
    if (!query && !browseOnFocus) return [];
    return Object.values(players || {})
      .filter((player) => {
        const names = [
          player?.full_name,
          player?.search_full_name,
          `${player?.first_name || ""} ${player?.last_name || ""}`.trim(),
        ]
          .filter(Boolean)
          .map((name) => String(name).toLowerCase());
        return !query || names.some((name) => name.includes(query));
      })
      .sort(
        (a, b) =>
          Number(isPlayerRanked(b)) - Number(isPlayerRanked(a)) ||
          getPlayerValue(b) - getPlayerValue(a),
      )
      .slice(0, query ? 12 : focusLimit);
  };

  useEffect(() => {
    if (open) setFiltered(findMatches(search));
    // Re-run an active search when an asynchronously loaded league changes the eligible pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, open]);

  const handleChange = (event) => {
    const value = event.target.value;
    setSearch(value);
    setOpen(true);
    setFiltered(findMatches(value));
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={handleChange}
        onFocus={() => {
          setOpen(true);
          setFiltered(findMatches(search));
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="Search players..."
        className="w-full rounded px-3 py-2 text-black"
      />
      {open && filtered.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded bg-gray-800 text-white shadow-lg">
          {!search.trim() ? (
            <li className="sticky top-0 border-b border-white/10 bg-gray-800 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white/40">
              {browseLabel} · {Object.keys(players || {}).length}
            </li>
          ) : null}
          {filtered.map((player) => {
            const ranked = isPlayerRanked(player);
            return (
              <li
                key={player.player_id}
                className="cursor-pointer px-3 py-2 hover:bg-gray-700"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(player);
                  setSearch("");
                  setFiltered([]);
                  setOpen(false);
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
                      ? Number(getPlayerValue(player) || 0).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : `Not ranked by ${sourceLabel}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : open && !search.trim() && focusHint ? (
        <div className="absolute z-50 mt-1 w-full rounded border border-cyan-300/15 bg-slate-900 px-3 py-3 text-xs leading-5 text-cyan-50/70 shadow-lg">
          {focusHint}
        </div>
      ) : open && search.trim() ? (
        <div className="absolute z-50 mt-1 w-full rounded border border-white/10 bg-gray-800 px-3 py-3 text-xs text-white/55 shadow-lg">
          No eligible players match this search. With league context active, each side only shows players that side can legally contribute.
        </div>
      ) : null}
    </div>
  );
}
