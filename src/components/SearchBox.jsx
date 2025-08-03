import { useState } from "react";

export default function SearchBox({ players, onSelect, getPlayerValue }) {
  const [search, setSearch] = useState("");
  const [filtered, setFiltered] = useState([]);

  const handleChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (val.length > 1) {
      const results = Object.values(players || {})
        .filter(
          (p) =>
            p &&
            p.full_name &&
            p.full_name.toLowerCase().includes(val.toLowerCase()) &&
            getPlayerValue(p) > 0  // ✅ Only show players/picks with values > 0
        )
        .slice(0, 8);
      setFiltered(results);
    } else {
      setFiltered([]);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={handleChange}
        placeholder="Search players..."
        className="w-full px-3 py-2 rounded text-black"
      />
      {filtered.length > 0 && (
        <ul className="absolute bg-gray-800 text-white w-full mt-1 rounded shadow-lg max-h-48 overflow-y-auto z-50">
          {filtered.map((p) => (
            <li
              key={p.player_id}
              className="px-3 py-2 hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onSelect(p);
                setSearch("");
                setFiltered([]);
              }}
            >
              {p.full_name} <span className="text-gray-400">{p.team}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
