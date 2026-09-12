"use client";

import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";
import StatProjectionLab from "../stat-central/StatProjectionLab";

function Panel({ children, className = "" }) {
  return (
    <section
      className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}
    >
      {children}
    </section>
  );
}

export default function ProjectionCenterClient() {
  const { leagues = [], activeLeague } = useSleeper();
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scoringLeagueId, setScoringLeagueId] = useState("");

  useEffect(() => {
    if (!leagues.length || scoringLeagueId) return;
    const preferredId =
      typeof activeLeague === "object"
        ? activeLeague?.league_id
        : activeLeague;
    const preferred = leagues.find(
      (league) => String(league.league_id) === String(preferredId || ""),
    );
    setScoringLeagueId(
      String(preferred?.league_id || leagues[0]?.league_id || ""),
    );
  }, [activeLeague, leagues, scoringLeagueId]);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/stats/projections/manifest.json", {
      cache: "no-cache",
      signal: controller.signal,
    })
      .then(async (manifestResponse) => {
        const manifest = manifestResponse.ok
          ? await manifestResponse.json()
          : null;
        const modelPath =
          manifest?.model_path ||
          `/stats/projections/${new Date().getUTCFullYear()}/current.json`;
        const response = await fetch(modelPath, {
          cache: "no-cache",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            `The ${manifest?.current_season || "current-season"} projection model has not been generated yet.`,
          );
        const payload = await response.json();
        if (
          !payload?.players?.length &&
          Array.isArray(payload?.player_shards) &&
          payload.player_shards.length
        ) {
          const shards = await Promise.all(
            payload.player_shards.map(async (shard) => {
              const shardResponse = await fetch(shard.path, {
                cache: "no-cache",
                signal: controller.signal,
              });
              if (!shardResponse.ok)
                throw new Error(
                  `Projection Center could not load the ${shard.position || "player"} model data.`,
                );
              return shardResponse.json();
            }),
          );
          payload.players = shards.flatMap((shard) =>
            Array.isArray(shard?.players) ? shard.players : [],
          );
        }
        return payload;
      })
      .then((payload) => {
        if (live) setModel(payload);
      })
      .catch((failure) => {
        if (live && failure?.name !== "AbortError")
          setError(failure?.message || "Projection Center could not load.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, []);

  return (
    <main className="min-h-screen max-w-full overflow-x-clip text-white">
      <BackgroundParticles />
      <Navbar pageTitle="Projection Center" />
      <div className="mx-auto w-full min-w-0 max-w-7xl px-3 pb-24 pt-20 sm:px-5">
        <header className="overflow-hidden rounded-[34px] border border-emerald-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(16,185,129,.2),transparent_38%),radial-gradient(circle_at_4%_100%,rgba(34,211,238,.16),transparent_35%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-8">
          <div className="text-[10px] font-black uppercase tracking-[.28em] text-emerald-200/60">
            Weekly ranks · player forecasts · measured accuracy
          </div>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">
            Projection Center
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/48">
            Use The Fantasy Arsenal projection model as its own workspace:
            inspect one player, rank the weekly slate, review projected stat
            DNA, and audit frozen accuracy without crowding historical Stat
            Central research.
          </p>
        </header>
        <div className="mt-4">
          {loading ? (
            <LoadingScreen text="Loading the current projection model..." />
          ) : error ? (
            <Panel className="p-6 text-rose-100">{error}</Panel>
          ) : (
            <StatProjectionLab
              model={model}
              leagues={leagues}
              scoringLeagueId={scoringLeagueId}
              onScoringLeagueChange={setScoringLeagueId}
            />
          )}
        </div>
      </div>
    </main>
  );
}
