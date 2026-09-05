export const metadata = {
  title: "Sleeper Fantasy Football League Hub",
  description:
    "Manage multiple Sleeper fantasy football leagues from one dashboard with transactions, free-agent opportunities, injuries, and bye-week lineup conflicts.",
  alternates: { canonical: "/league-hub" },
  keywords: ["Sleeper league manager", "fantasy football league dashboard", "Sleeper league hub", "multi league fantasy football manager", "fantasy waiver opportunities"],
  openGraph: { title: "Sleeper Fantasy Football League Hub", description: "One dashboard for Sleeper transactions, free agents, injuries, and lineup conflicts across leagues.", url: "/league-hub", type: "website", images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630, alt: "The Fantasy Arsenal Sleeper league management dashboard" }] },
  twitter: { card: "summary_large_image", title: "Sleeper Fantasy Football League Hub", description: "Manage transactions, free agents, injuries, and lineup conflicts across your Sleeper leagues.", images: ["/nfl-loading-bg.webp"] },
};

import LeagueHubContent from "./LeagueHubContent";
import ToolSeoContent from "../../components/ToolSeoContent";

export default function Page() {
  return <>
    <LeagueHubContent />
    <ToolSeoContent
      name="Sleeper League Hub"
      path="/league-hub"
      summary="Manage a portfolio of Sleeper fantasy football leagues from one place. League Hub organizes recent transactions, free-agent opportunities, player availability, injuries, and upcoming bye-week or lineup conflicts without opening every league separately."
      features={["Review activity across multiple Sleeper leagues", "Find league-specific free-agent opportunities", "Track injuries and player availability", "Spot bye-week and lineup conflicts"]}
      faqs={[
        { question: "What does Sleeper League Hub combine?", answer: "It combines league activity, available players, roster context, injuries, and schedule conflicts across the Sleeper leagues included in your portfolio filters." },
        { question: "Are free-agent opportunities league-specific?", answer: "Yes. Recommendations are evaluated within each league, using that league's available players and roster context rather than treating every league the same." },
      ]}
      related={[{ href: "/player-availability", label: "Player Availability" }, { href: "/lineup", label: "Lineup Optimizer" }, { href: "/trade", label: "Trade Calculator" }]}
    />
  </>;
}
