import StatCentralClient from "./StatCentralClient";

export const metadata = {
  title:"Fantasy Football Stat Central",
  description:"Explore NFL fantasy scoring history, weekly performance, consistency, player comparisons, archetypes, and production trends.",
  alternates: { canonical: "/stat-central" },
};

export default function StatCentralPage() {
  return <StatCentralClient />;
}
