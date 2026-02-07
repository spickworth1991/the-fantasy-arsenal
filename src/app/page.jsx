import HomeClient from "./home/HomeClient";

export const metadata = {
  title: "The Fantasy Arsenal by StickyPicky | Premium Sleeper Fantasy Football Tools",
  description:
    "A premium toolkit for Sleeper fantasy football: trade analyzer, player stock, availability, power rankings, strength of schedule, lineup optimizer, and live draft pick tracker.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "The Fantasy Arsenal by StickyPicky",
    description:
      "Premium Sleeper fantasy football tools: trade analyzer, player values, availability, rankings, SOS, lineup optimizer, and a live multi-league draft dashboard.",
    url: "/",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Fantasy Arsenal by StickyPicky",
    description:
      "Premium Sleeper fantasy football tools: trade analyzer, player values, availability, rankings, SOS, lineup optimizer, and a live multi-league draft dashboard.",
    images: ["/nfl-loading-bg.webp"],
  },
};

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "The Fantasy Arsenal by StickyPicky",
    url: "https://thefantasyarsenal.com/",
    description:
      "A premium toolkit for Sleeper fantasy football: trade analyzer, player stock, availability, power rankings, strength of schedule, lineup optimizer, and live draft pick tracker.",
    isPartOf: {
      "@type": "WebSite",
      name: "The Fantasy Arsenal",
      url: "https://thefantasyarsenal.com/",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // JSON-LD must be a string in a script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Client app (login + tool cards) */}
      <HomeClient />

      {/* SEO content (visible, premium, and useful even before login) */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="mt-14 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
            <h2 className="text-2xl font-bold text-white">Built for Sleeper leagues</h2>
            <p className="text-gray-300 mt-2">
              The Fantasy Arsenal is a fast, modern set of fantasy football tools designed around the Sleeper platform.
              Log in with your Sleeper username to load your leagues and unlock personalized insights.
            </p>
            <ul className="mt-4 space-y-2 text-gray-200">
              <li>• Trade Analyzer with multiple value sources</li>
              <li>• Player Stock charts + trend snapshots</li>
              <li>• Player Availability across your leagues</li>
              <li>• Power Rankings + Strength of Schedule</li>
              <li>• Lineup Optimizer for weekly decisions</li>
              <li>• Draft Pick Tracker for multi-league drafts (ETA, on-deck alerts, recent picks)</li>
            </ul>
          </div>

          <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
            <h2 className="text-2xl font-bold text-white">Why it wins</h2>
            <p className="text-gray-300 mt-2">
              Premium UX, minimal clicks, and data you can actually use mid-draft and mid-trade.
            </p>
            <div className="mt-4 space-y-3 text-gray-200">
              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-white font-semibold">Fast</div>
                <div className="text-sm text-gray-300">Optimized fetch + caching so you can make moves quickly.</div>
              </div>
              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-white font-semibold">Accurate</div>
                <div className="text-sm text-gray-300">Uses live Sleeper league + draft data for real-time context.</div>
              </div>
              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-white font-semibold">Practical</div>
                <div className="text-sm text-gray-300">Designed to answer: “What do I do right now?”</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
          <h2 className="text-2xl font-bold text-white">FAQ</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-white font-semibold">Do I need an API key?</h3>
              <p className="text-gray-300 mt-1">No. The Sleeper API is read-only for public league data.</p>
            </div>
            <div>
              <h3 className="text-white font-semibold">Is this redraft or dynasty?</h3>
              <p className="text-gray-300 mt-1">
                Both. Tools support common formats, and value sources adapt to your settings.
              </p>
            </div>
            <div>
              <h3 className="text-white font-semibold">Does logging in share my password?</h3>
              <p className="text-gray-300 mt-1">
                No. You log in with your Sleeper username only (no password).
              </p>
            </div>
            <div>
              <h3 className="text-white font-semibold">Why is the draft tracker useful?</h3>
              <p className="text-gray-300 mt-1">
                It shows multi-league drafting at a glance: on-deck alerts, pace-based ETA, and recent pick runs.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
