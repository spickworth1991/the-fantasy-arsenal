import TradeClient from "./TradeClient";
import TradeFinder from "./TradeFinder";

export const metadata = {
  title: "Fantasy Football Trade Analyzer for Sleeper | The Fantasy Arsenal",
  description:
    "Analyze fantasy football trades with multiple value sources and league-aware rosters from Sleeper. Compare sides, see value deltas, and find balance options fast.",
  alternates: { canonical: "/trade" },
  openGraph: {
    title: "Fantasy Football Trade Analyzer for Sleeper",
    description:
      "Analyze trades using multiple value sources with Sleeper league context.",
    url: "/trade",
  },
};

export default function Page() {
  return (
    <>
      <TradeClient />
      <TradeFinder />
    </>
  );
}
