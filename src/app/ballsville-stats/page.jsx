import BallsvilleStatsClient from "./BallsvilleStatsClient";

export const metadata = {
  title: "Ballsville Draft Stats",
  description: "Search Ballsville draft trends, player popularity, real unique manager counts, game-mode overlap, and returning-player movement.",
  alternates: { canonical: "/ballsville-stats" },
};

export default function Page() {
  return <BallsvilleStatsClient />;
}
