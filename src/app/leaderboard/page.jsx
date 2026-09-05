import LeaderboardClient from "./LeaderboardClient";

export const metadata = {
  title: "Arsenal Leaderboard",
  description: "Verified current-season Sleeper records for Fantasy Arsenal managers.",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardPage(){return <LeaderboardClient/>;}
