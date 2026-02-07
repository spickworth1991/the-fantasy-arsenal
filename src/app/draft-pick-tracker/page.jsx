import DraftPickTrackerPageClient from "./DraftPickTrackerPageClient";

export const metadata = {
  title: "Live Draft Pick Tracker for Sleeper | On-Deck Alerts & ETA | The Fantasy Arsenal",
  description:
    "Track multiple Sleeper drafts at once: live clocks, on-deck/on-clock alerts, realistic ETAs, and recent pick momentum.",
  alternates: { canonical: "/draft-pick-tracker" },
  openGraph: {
    title: "Live Draft Pick Tracker for Sleeper",
    description:
      "Live clocks, on-deck alerts, realistic ETAs, and recent picks across all your leagues.",
    url: "/draft-pick-tracker",
    type: "website",
  },
};

export default function Page() {
  return <DraftPickTrackerPageClient />;
}
