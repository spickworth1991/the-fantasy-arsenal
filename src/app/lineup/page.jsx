import LineupClient from "./LineupClient";

export const metadata = {
  title: "Fantasy Football Lineup Optimizer | Start/Sit Help for Sleeper | The Fantasy Arsenal",
  description:
    "Optimize your weekly lineup for maximum points. Fast start/sit guidance with a premium dashboard experience.",
  alternates: { canonical: "/lineup" },
  openGraph: {
    title: "Lineup Optimizer | The Fantasy Arsenal",
    description:
      "Weekly lineup optimization and start/sit support for fantasy football (Sleeper).",
    url: "/lineup",
    siteName: "The Fantasy Arsenal",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lineup Optimizer | The Fantasy Arsenal",
    description:
      "Weekly lineup optimization and start/sit support for fantasy football (Sleeper).",
  },
};

export default function Page() {
  return <LineupClient />;
}
