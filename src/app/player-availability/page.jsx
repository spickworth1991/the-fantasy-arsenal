import PlayerAvailabilityContent from "./PlayerAvailabilityContent";

export const metadata = {
  title: "Player Availability | Find Which Sleeper Leagues Have a Player | The Fantasy Arsenal",
  description:
    "Search any NFL player and instantly see which of your Sleeper leagues they are available in. Fast, clean, and built for draft season.",
  alternates: { canonical: "/player-availability" },
};

export default function Page() {
  return <PlayerAvailabilityContent />;
}
