import PowerRankingsClient from "./PowerRankingsClient";

export const metadata = {
  title: "Sleeper Fantasy Football Power Rankings",
  description:
    "Instant power rankings for your Sleeper league with clean visuals and actionable insights. Compare teams and spot risers fast.",
  alternates: { canonical: "/power-rankings" },
  openGraph: {
    title: "Power Rankings | The Fantasy Arsenal",
    description:
      "Instant power rankings for your Sleeper league with premium visuals and insights.",
    url: "/power-rankings",
  },
};

export default function Page() {
  return <PowerRankingsClient />;
}
