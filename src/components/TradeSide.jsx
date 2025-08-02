import { toSlug } from "../utils/slugify";

export default function TradeSide({
  title,
  players,
  onRemove,
  searchBox,
  getPlayerValue,
  suggestedPlayers,
  addPlayerToSide,
}) {
  return (
    <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      <ul className="mb-4">
        {players.length === 0 ? (
          <li className="text-gray-400 text-center mb-4">No players added yet.</li>
        ) : (
          players.map((p, i) => {
            const avatar = `/avatars/${toSlug(p.full_name)}.webp`;
            return (
              <li
                key={i}
                className="flex items-center justify-between mb-2 bg-gray-800 p-2 rounded"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={avatar}
                    onError={(e) => (e.target.src = "/avatars/default.webp")}
                    alt={p.full_name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div>
                    <span className="font-semibold">{p.full_name}</span>
                    <span className="block text-gray-400 text-sm">
                      {p.position} | {p.team} | {getPlayerValue(p)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onRemove(i)}
                  className="text-red-400 hover:text-red-500 font-bold"
                >
                  ✕
                </button>
              </li>
            );
          })
        )}
      </ul>

      {/* Search input */}
      {searchBox}

      {/* Suggested Adds */}
      {suggestedPlayers && suggestedPlayers.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold mb-2">Suggested Adds</h3>
          <div className="grid grid-cols-2 gap-2">
            {suggestedPlayers.map((p) => {
              const avatar = `/avatars/${toSlug(p.full_name)}.webp`;
              return (
                <div
                  key={p.player_id}
                  className="bg-gray-800 p-2 rounded flex items-center justify-between"
                >
                  <img
                    src={avatar}
                    onError={(e) => (e.target.src = "/avatars/default.webp")}
                    alt={p.full_name}
                    className="w-8 h-8 rounded-full"
                  />
                  <div className="ml-2 flex-1">
                    <p className="text-sm font-semibold">{p.full_name}</p>
                    <p className="text-gray-400 text-xs">{getPlayerValue(p)}</p>
                  </div>
                  <button
                    onClick={() => addPlayerToSide(p)}
                    className="bg-blue-600 hover:bg-blue-700 text-xs px-2 py-1 rounded"
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
