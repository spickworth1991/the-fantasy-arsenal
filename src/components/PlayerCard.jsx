import { toSlug } from "../utils/slugify";

export default function PlayerCard({ player, onAddA, onAddB, value }) {
  const avatar = `/avatars/${toSlug(player.full_name)}.webp`;

  return (
    <div className="bg-gray-800 rounded-lg p-4 text-center shadow hover:scale-105 transition hover:neon-hover">
      <img
        src={avatar}
        alt={player.full_name}
        className="w-16 h-16 rounded-full mx-auto mb-2 object-cover"
        onError={(e) => (e.target.src = "/avatars/default.webp")}
      />
      <h3 className="font-bold">{player.full_name}</h3>
      <p className="text-gray-400">
        {player.position} | {player.team}
      </p>
      <p className="text-blue-400 font-semibold mt-2">{value}</p>
      <div className="flex justify-center gap-2 mt-3">
        <button
          onClick={onAddA}
          className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded"
        >
          + Side A
        </button>
        <button
          onClick={onAddB}
          className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded"
        >
          + Side B
        </button>
      </div>
    </div>
  );
}
