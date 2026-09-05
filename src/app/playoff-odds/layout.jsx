export const metadata = {
  title: "Fantasy Football Playoff Odds",
  description: "Estimate Sleeper fantasy football playoff odds with schedule-aware simulations, standings context, matchup probabilities, and scenario analysis.",
  alternates: { canonical: "/playoff-odds" },
  openGraph: {
    title: "Fantasy Football Playoff Odds & Scenario Simulator",
    description: "Schedule-aware playoff simulations and scenario analysis for Sleeper fantasy football leagues.",
    url: "/playoff-odds",
    type: "website",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630, alt: "The Fantasy Arsenal playoff odds simulator" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fantasy Football Playoff Odds",
    description: "Schedule-aware playoff simulations and scenario analysis for Sleeper leagues.",
    images: ["/nfl-loading-bg.webp"],
  },
};

export default function PlayoffOddsLayout({ children }) {
  return (
    <>
      <h1 className="sr-only">Fantasy Football Playoff Odds and Scenario Simulator</h1>
      {children}
    </>
  );
}
