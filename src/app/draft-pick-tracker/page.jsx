import DraftPickTrackerPageClient from "./DraftPickTrackerPageClient";
import ToolSeoContent from "../../components/ToolSeoContent";

export const metadata = {
  title: "Live Sleeper Draft Monitor",
  description:
    "Track multiple Sleeper drafts at once: live clocks, on-deck/on-clock alerts, realistic ETAs, and recent pick momentum.",
  alternates: { canonical: "/draft-pick-tracker" },
  keywords: ["Sleeper draft monitor", "fantasy football draft tracker", "live fantasy draft monitor", "multi draft tracker", "Sleeper draft alerts"],
  openGraph: {
    title: "Live Draft Monitor for Sleeper",
    description:
      "Live clocks, on-deck and on-clock alerts, and recent picks across all your leagues.",
    url: "/draft-pick-tracker",
    type: "website",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630, alt: "The Fantasy Arsenal live Sleeper draft monitor" }],
  },
  twitter: { card: "summary_large_image", title: "Live Sleeper Draft Monitor", description: "Monitor active Sleeper drafts, on-clock and on-deck alerts, recent picks, and next-pick estimates.", images: ["/nfl-loading-bg.webp"] },
};

export default function Page() {
  return <>
    <DraftPickTrackerPageClient />
    <ToolSeoContent
      name="Live Sleeper Draft Monitor"
      path="/draft-pick-tracker"
      summary="Monitor every active Sleeper fantasy football draft from one screen. See who is on the clock, which leagues put you on deck, recent picks, pick momentum, and estimated time until your next selection."
      features={["Monitor multiple Sleeper drafts together", "See on-clock and on-deck alerts", "Estimate time until your next pick", "Follow recent picks and live draft movement"]}
      faqs={[
        { question: "Can I monitor more than one Sleeper draft?", answer: "Yes. Draft Monitor combines the active drafts in your loaded Sleeper portfolio into one live command view." },
        { question: "How is the next-pick time estimated?", answer: "The monitor uses the current draft state and recent pick pace to estimate when your selection is approaching. It is an estimate, not a guaranteed draft time." },
      ]}
      related={[{ href: "/player-stock/results", label: "Player Stock & Exposure" }, { href: "/draft-helper", label: "Draft Command Center" }]}
    />
  </>;
}
