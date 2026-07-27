"use client";

import dynamic from "next/dynamic";
import Navbar from "../../components/Navbar";
import { useSleeper } from "../../context/SleeperContext";
import DraftPickTrackerClient from "./tracker.client";

const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });

export default function DraftPickTrackerPage() {
  const { username } = useSleeper();

  return (
    <div className="min-h-screen">
      <BackgroundParticles />
      <Navbar pageTitle="Draft Monitor" />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-24">
        {!username ? (
          <div className="mt-10 bg-gray-900/80 border border-white/10 rounded-2xl p-8 shadow-xl">
            <h2 className="text-2xl font-bold text-white mb-2">Sleeper portfolio required</h2>
            <p className="text-gray-300">
              Load a Sleeper portfolio from the homepage or navigation menu to open its drafting leagues.
            </p>
          </div>
        ) : (
          <DraftPickTrackerClient />
        )}
      </main>
    </div>
  );
}
