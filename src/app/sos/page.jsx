import SosClient from "./SosClient";

export const metadata = {
  title: "Fantasy Football SOS Analyzer",
  description:
    "Analyze fantasy football strength of schedule with premium charts and quick comparisons. Built for Sleeper leagues.",
  alternates: { canonical: "/sos" },
  openGraph: {
    title: "Strength of Schedule – The Fantasy Arsenal",
    description:
      "See which teams have the easiest and hardest paths ahead with SOS tools built for Sleeper.",
    url: "/sos",
    images: [{ url: "/nfl-loading-bg.webp", width: 1200, height: 630 }],
  },
};

export default function Page() {
  return <SosClient />;
}
