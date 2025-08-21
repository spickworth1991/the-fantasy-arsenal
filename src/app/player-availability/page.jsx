"use client";

import { Suspense } from "react";
import PlayerAvailabilityContent from "./PlayerAvailabilityContent";

export default function PlayerAvailabilityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen text-white bg-black">
          <p className="text-xl">Loading Player Availability...</p>
        </div>
      }
    >
      <PlayerAvailabilityContent />
    </Suspense>
  );
}
