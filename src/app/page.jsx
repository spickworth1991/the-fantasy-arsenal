import HomeClient from "./home/HomeClient";

export const metadata = {
  title: "The Fantasy Arsenal | Premium Sleeper Fantasy Football Tools",
  description:
    "Premium fantasy football tools for Sleeper leagues: trade analyzer, player stock, player availability, power rankings, strength of schedule, lineup optimizer, and a live multi-league draft pick tracker.",
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
    "@type": "WebPage",
    name: "The Fantasy Arsenal",
    url: "https://thefantasyarsenal.com/",
    description:
      "Premium fantasy football tools for Sleeper leagues: trade analyzer, player stock, availability, power rankings, strength of schedule, lineup optimizer, and live draft pick tracker.",
    isPartOf: {
      "@type": "WebSite",
      name: "The Fantasy Arsenal",
      url: "https://thefantasyarsenal.com/",
    },
    about: {
      "@type": "Thing",
      name: "Sleeper Fantasy Football Tools",
    },
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
