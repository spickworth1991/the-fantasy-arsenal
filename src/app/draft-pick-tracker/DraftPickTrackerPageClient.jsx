"use client";

import dynamic from "next/dynamic";
import Navbar from "../../components/Navbar";
import { useSleeper } from "../../context/SleeperContext";
import DraftPickTrackerClient from "./tracker.client";
import PushAlerts from "./PushAlerts.client";

const BackgroundParticles = dynamic(
  () => import("../../components/BackgroundParticles"),
  { ssr: false }
);

export default function DraftPickTrackerPage() {
  const { username, leagues } = useSleeper();

  const draftIds = Array.isArray(leagues)
    ? leagues
        .map((l) => l?.draft_id)
        .filter(Boolean)
        // de-dupe
        .filter((id, i, arr) => arr.indexOf(id) === i)
    : [];

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div aria-hidden className="h-[72px]" />

      <PushAlerts username={username} selectedDraftIds={draftIds} />

      <BackgroundParticles />
      <Navbar pageTitle="Draft Monitor" />

      <main className="px-4 pb-16">
        {!username ? (
          <div className="mt-10 bg-gray-900/80 border border-white/10 rounded-2xl p-8 shadow-xl">
            <h2 className="text-2xl font-bold text-white mb-2">Login required</h2>
            <p className="text-gray-300">
              Log in with your Sleeper username on the homepage to load your drafting leagues.
            </p>
          </div>
        ) : (
          <DraftPickTrackerClient />
        )}
      </main>
    </div>
  );
}
