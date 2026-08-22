import BallsvilleStatsClient from "./BallsvilleStatsClient";

export const metadata = {
  title: "Ballsville Draft Stats | The Fantasy Arsenal",
  description: "Search Ballsville draft trends, player popularity, real unique manager counts, game-mode overlap, and returning-player movement.",
};

export default function Page() {
  return <BallsvilleStatsClient />;
}
