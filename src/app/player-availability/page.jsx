import PlayerAvailabilityContent from "./PlayerAvailabilityContent";

export const metadata = {
  title: "Find Players Across Sleeper Leagues",
  description:
    "Search any NFL player and instantly see which of your Sleeper leagues they are available in. Fast, clean, and built for draft season.",
  alternates: { canonical: "/player-availability" },
};

export default function Page() {
  return <PlayerAvailabilityContent />;
}
