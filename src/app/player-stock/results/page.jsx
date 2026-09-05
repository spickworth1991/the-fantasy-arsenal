// Server file (no "use client")
// Force static, and override any parent edge runtime.
export const dynamic = 'force-static';
export const runtime = 'nodejs';
export const revalidate = false;

export const metadata = {
  title: "Player Stock & Exposure for Sleeper",
  description:
    "Track fantasy football player exposure across Sleeper leagues and drafts, then compare roster shares, ADP, values, projections, and player movement.",
  alternates: { canonical: "/player-stock/results" },
  keywords: ["fantasy football player exposure", "Sleeper player exposure tracker", "fantasy football player stock", "roster exposure", "draft exposure tracker", "fantasy player values"],
  openGraph: {
    title: "Player Stock Results | The Fantasy Arsenal",
    description:
      "See player value results, trends, and sources in a premium dashboard built for Sleeper fantasy leagues.",
    url: "/player-stock/results",
    type: "website",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630, alt: "The Fantasy Arsenal player stock and exposure tracker" }],
  },
  twitter: { card: "summary_large_image", title: "Fantasy Football Player Stock & Exposure Tracker", description: "Track player exposure, roster shares, draft shares, ADP, values, and projections across Sleeper leagues.", images: ["/nfl-loading-bg.webp"] },
};

import { Suspense } from 'react';
import ClientResults from './ClientResults';
import ToolSeoContent from '../../../components/ToolSeoContent';

export default function ResultsPage({ searchParams }) {
  return (
    <>
      <Suspense fallback={null}>
        <ClientResults initialSearchParams={searchParams} />
      </Suspense>
      <ToolSeoContent
        name="Player Stock & Exposure Tracker"
        path="/player-stock/results"
        primaryHeading
        summary="Search a fantasy player to see where you rostered or drafted them across your Sleeper portfolio, alongside draft position, current values, projections, and movement. It turns scattered league shares into one player-level exposure view."
        features={["Track player exposure across Sleeper leagues", "Separate rostered and drafted shares", "Compare player values and projections", "Review ADP and source movement"]}
        faqs={[
          { question: "What is fantasy football player exposure?", answer: "Player exposure is the share of your leagues or drafts in which you roster a player. It helps identify players you are heavily invested in or may be missing entirely." },
          { question: "Does Player Stock include all my Sleeper leagues?", answer: "It uses the Sleeper portfolio and league filters you select, so you can study the full portfolio or narrower game-mode groups." },
        ]}
        related={[{ href: "/draft-pick-tracker", label: "Live Draft Monitor" }, { href: "/trade", label: "Trade Calculator" }]}
      />
    </>
  );
}
