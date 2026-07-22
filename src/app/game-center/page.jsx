import GameCenterClient from "./GameCenterClient";

export const metadata = {
  title: "Cross-League Fantasy Game Center | The Fantasy Arsenal",
  description: "Track roots, boos, lineup conflicts, player points, kickoff order, and scores across every Sleeper league.",
  alternates: { canonical: "/game-center" },
};

export default function Page(){return <GameCenterClient/>;}
