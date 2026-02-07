// Server file (no "use client")
// Force static, and override any parent edge runtime.
export const dynamic = 'force-static';
export const runtime = 'nodejs';
export const revalidate = false;

export const metadata = {
  title: "Player Stock Results | Fantasy Football Values & Trends | The Fantasy Arsenal",
  description:
    "Deep-dive player stock results: value sources, movement over time, and premium player profiles. Built for Sleeper.",
  alternates: { canonical: "/player-stock/results" },
  openGraph: {
    title: "Player Stock Results | The Fantasy Arsenal",
    description:
      "See player value results, trends, and sources in a premium dashboard built for Sleeper fantasy leagues.",
    url: "/player-stock/results",
  },
};

import { Suspense } from 'react';
import ClientResults from './ClientResults';

export default function ResultsPage({ searchParams }) {
  return (
    <Suspense fallback={null}>
      <ClientResults initialSearchParams={searchParams} />
    </Suspense>
  );
}
