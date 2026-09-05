import HomeClient from "./home/HomeClient";

export const metadata = {
  title: "The Fantasy Arsenal | Premium Sleeper Fantasy Football Tools",
  description:
    "Premium Sleeper fantasy football tools for trades, player exposure, live drafts, league management, lineups, waivers, rankings, and research.",
  alternates: { canonical: "https://thefantasyarsenal.com/" },
  openGraph: {
    title: "The Fantasy Arsenal | Sleeper Fantasy Football Tools",
    description:
      "Premium fantasy football tools for Sleeper: trade analyzer, player values, availability, rankings, SOS, lineup optimizer, and a live multi-league draft dashboard.",
    url: "https://thefantasyarsenal.com/",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Fantasy Arsenal | Sleeper Fantasy Football Tools",
    description:
      "Premium fantasy football tools for Sleeper: trade analyzer, player values, availability, rankings, SOS, lineup optimizer, and a live multi-league draft dashboard.",
    images: ["/nfl-loading-bg.webp"],
  },
};

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: "The Fantasy Arsenal",
        url: "https://thefantasyarsenal.com/",
        description: "Premium fantasy football tools for Sleeper leagues: trade calculator, player exposure tracker, live draft monitor, league dashboard, power rankings, and lineup tools.",
        isPartOf: { "@id": "https://thefantasyarsenal.com/#website" },
        about: { "@type": "Thing", name: "Sleeper fantasy football tools" },
        mainEntity: { "@id": "https://thefantasyarsenal.com/#primary-tools" },
      },
      {
        "@type": "ItemList",
        "@id": "https://thefantasyarsenal.com/#primary-tools",
        name: "The Fantasy Arsenal primary fantasy football tools",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Fantasy Football Trade Calculator", url: "https://thefantasyarsenal.com/trade" },
          { "@type": "ListItem", position: 2, name: "Player Stock and Exposure Tracker", url: "https://thefantasyarsenal.com/player-stock/results" },
          { "@type": "ListItem", position: 3, name: "Live Sleeper Draft Monitor", url: "https://thefantasyarsenal.com/draft-pick-tracker" },
          { "@type": "ListItem", position: 4, name: "Sleeper League Hub", url: "https://thefantasyarsenal.com/league-hub" },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomeClient />
    </>
  );
}
