import TradeClient from "./TradeClient";
import ToolSeoContent from "../../components/ToolSeoContent";

export const metadata = {
  title: "Fantasy Trade Calculator for Sleeper",
  description:
    "Analyze fantasy football trades with multiple value sources and league-aware rosters from Sleeper. Compare sides, see value deltas, and find balance options fast.",
  alternates: { canonical: "/trade" },
  keywords: ["fantasy football trade calculator", "fantasy football trade analyzer", "Sleeper trade calculator", "dynasty trade calculator", "redraft trade analyzer"],
  openGraph: {
    title: "Fantasy Football Trade Analyzer for Sleeper",
    description:
      "Analyze trades using multiple value sources with Sleeper league context.",
    url: "/trade",
    type: "website",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630, alt: "The Fantasy Arsenal fantasy football trade calculator" }],
  },
  twitter: { card: "summary_large_image", title: "Fantasy Football Trade Calculator & Analyzer", description: "Compare fantasy football trades with multiple value sources and your Sleeper league context.", images: ["/nfl-loading-bg.webp"] },
};

export default function Page() {
  return (
    <>
      <TradeClient />
      <ToolSeoContent
        name="Fantasy Football Trade Calculator"
        path="/trade"
        summary="Compare both sides of a dynasty or redraft trade with multiple value sources, then apply your Sleeper league's format, scoring, rosters, and lineup needs. The analyzer explains the result instead of returning only one number."
        features={["Analyze dynasty and redraft trades", "Use Sleeper league and roster context", "Compare multiple value and projection sources", "Find trade partners and balanced alternatives"]}
        faqs={[
          { question: "Does the trade calculator work with Sleeper leagues?", answer: "Yes. Select a Sleeper league to evaluate trades with that league's format, scoring settings, rosters, and positional needs." },
          { question: "Can I use it without connecting a league?", answer: "Yes. You can compare players and picks with your chosen format and value source, although league context makes the analysis more specific." },
        ]}
        related={[{ href: "/player-stock/results", label: "Player Stock & Exposure" }, { href: "/league-hub", label: "Sleeper League Hub" }]}
      />
    </>
  );
}
