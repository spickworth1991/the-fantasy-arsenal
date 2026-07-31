import StatCentralClient from "./StatCentralClient";

export const metadata = {
  title:"Stat Central | The Fantasy Arsenal",
  description:"Explore NFL fantasy scoring history, weekly performance, consistency, player comparisons, archetypes, and production trends.",
};

export default function StatCentralPage() {
  return <StatCentralClient />;
}
