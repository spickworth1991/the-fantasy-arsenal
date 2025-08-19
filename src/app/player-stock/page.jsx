"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import { useSleeper } from "../../context/SleeperContext";

export default function PlayerStockFilters() {
  const { username, year } = useSleeper();
  const [onlyBestBall, setOnlyBestBall] = useState(false);
  const [excludeBestBall, setExcludeBestBall] = useState(false);
  const [includeDrafting, setIncludeDrafting] = useState(true); // ✅ default ON
  const router = useRouter();

  const resolvedYear = String(year || new Date().getFullYear());

  // Build the same cache key used on the results page
  const cacheKey = useMemo(() => {
    if (!username) return null;
    return `ps:${username}:${resolvedYear}:${onlyBestBall ? "bb1" : ""}:${excludeBestBall ? "nobb1" : ""}:${includeDrafting ? "dr1" : "dr0"}`;
  }, [username, resolvedYear, onlyBestBall, excludeBestBall, includeDrafting]);

  // Check for a cached scan (session-only)
  const cachedPayload = useMemo(() => {
    if (typeof window === "undefined" || !cacheKey) return null;
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        leagueCount: parsed.leagueCount ?? 0,
        ts: parsed.ts ? new Date(parsed.ts) : null,
      };
    } catch {
      return null;
    }
  }, [cacheKey]);

  // Build query string for results route
  const buildQuery = (force = false) => {
    const params = new URLSearchParams();
    params.set("year", resolvedYear);
    if (onlyBestBall) params.set("only_bestball", "1");
    if (excludeBestBall) params.set("exclude_bestball", "1");
    if (!includeDrafting) params.set("include_drafting", "0"); // default is include
    if (force) params.set("force", "1");
    return params.toString();
  };

  const goView = () => router.push(`/player-stock/results?${buildQuery(false)}`);
  const goScanFresh = () => router.push(`/player-stock/results?${buildQuery(true)}`);

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Player Stock" />

      <div className="max-w-6xl mx-auto px-4 pt-14">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the{" "}
            <a href="/" className="text-blue-400 underline">
              homepage
            </a>{" "}
            to use this tool.
          </div>
        ) : (
          <div className="mx-auto max-w-xl bg-gray-900 p-6 rounded-xl shadow-lg">
            <h2 className="text-2xl font-bold text-center mb-4">Player Stock – Scan Options</h2>

            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onlyBestBall}
                      onChange={() => {
                        setOnlyBestBall((v) => !v);
                        if (!onlyBestBall) setExcludeBestBall(false);
                      }}
                    />
                    <span>Only Best Ball</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={excludeBestBall}
                      onChange={() => {
                        setExcludeBestBall((v) => !v);
                        if (!excludeBestBall) setOnlyBestBall(false);
                      }}
                    />
                    <span>Exclude Best Ball</span>
                  </label>
                </div>

                <label className="flex items-center justify-between">
                  <span>Include drafting leagues</span>
                  <input
                    type="checkbox"
                    checked={includeDrafting}
                    onChange={() => setIncludeDrafting((v) => !v)}
                  />
                </label>
              </div>

              <div className="text-xs text-gray-400">
                Season: <span className="text-white">{resolvedYear}</span>
                <br />
                Status filter: <span className="text-white">in_season</span>,{" "}
                <span className="text-white">complete</span>
                {includeDrafting ? (
                  <> and <span className="text-white">drafting</span></>
                ) : null}
              </div>

              {cachedPayload && (
                <div className="mt-2 rounded-lg border border-white/10 bg-gray-800/60 p-3 text-xs text-gray-300">
                  <div>
                    Cached results found for these filters
                    {typeof cachedPayload.leagueCount === "number" ? (
                      <> – {cachedPayload.leagueCount} leagues</>
                    ) : null}
                    .
                  </div>
                  {cachedPayload.ts && (
                    <div className="mt-1 text-gray-400">
                      Last scan: {cachedPayload.ts.toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!cachedPayload ? (
              <button
                onClick={goView}
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded"
              >
                Scan my leagues
              </button>
            ) : (
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={goView}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded"
                >
                  View results
                </button>
                <button
                  onClick={goScanFresh}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 rounded"
                  title="Ignore cache and rescan leagues"
                >
                  Scan again
                </button>
              </div>
            )}

            <p className="mt-3 text-center text-xs text-gray-400">
              We’ll scan your {resolvedYear} leagues and build your player stock. Caching is session-only and clears on logout.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
