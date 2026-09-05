import LeagueHistoryClient from "./LeagueHistoryClient";

export const metadata = {
  title: "League History & Yearbook",
  description: "Explore Sleeper league records, rivalries, champions, season awards, and a share-ready fantasy football yearbook.",
  alternates: { canonical: "/league-history" },
};

export default function LeagueHistoryPage() {
  return <LeagueHistoryClient />;
}
