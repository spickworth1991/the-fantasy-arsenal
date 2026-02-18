"use client";

import { useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import dynamic from "next/dynamic";
import Navbar from "../../components/Navbar";
import Link from "next/link";

const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), {
  ssr: false,
});

const BADGE_STYLES = {
  NEW: "bg-emerald-400 text-black",
  UPDATED: "bg-purple-400 text-black",
  "COMING SOON": "bg-yellow-500 text-black",
  DEVELOPING: "bg-red-500 text-black",
};

function Badge({ text }) {
  const key = String(text || "").toUpperCase();
  const cls = BADGE_STYLES[key] || "bg-white/20 text-white";
  return (
    <span className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-bold tracking-wide ${cls}`}>
      {key}
    </span>
  );
}

const TOOL_ICONS = {
  "Trade Analyzer": "/icons/trade-icon.png",
  "Player Stock": "/icons/stock-icon.png",
  "Player Availability": "/icons/availability-icon.png",
  "Power Rankings": "/icons/power-icon.png",
  "Strength of Schedule": "/icons/sos-icon.png",
  "Lineup Optimizer": "/icons/lineup-icon.png",
  "Draft Monitor": "/icons/draft-icon.png",
  "League Hub": "/icons/league-hub.png",
};

export default function HomeClient() {
  const { username, login, loading, error } = useSleeper();
  const [unameInput, setUnameInput] = useState("");
  const [yearInput, setYearInput] = useState(new Date().getFullYear());

  const handleLogin = async (e) => {
    e.preventDefault();
    await login(unameInput, yearInput);
  };

  const isLoggedIn = !!username;

  const tools = [
    {
      name: "Trade Analyzer",
      link: "/trade",
      description: "Analyze trades using multiple value sources. Select a league for personalized trades.",
    },
    {
      name: "Player Stock",
      link: "/player-stock/results",
      description: "Track player value changes over time - Now includes drafting leagues for real-time draft momentum!",
      badge: "UPDATED",
    },
    {
      name: "Player Availability",
      link: "/player-availability",
      description: "Find which leagues have a player available",
      badge: "UPDATED",
    },
    {
      name: "League Hub",
      link: "/league-hub",
      description:
        "Multi-league dashboard: recent transactions, top free agents, injury report, and bye conflicts.",
      badge: "DEVELOPING",
    },
    {
      name: "Power Rankings",
      link: "/power-rankings",
      description: "See where you rank amongst your league.",
    },
    {
      name: "Strength of Schedule",
      link: "/sos",
      description: "Analyze team schedules based on various metrics.",
    },
    {
      name: "Lineup Optimizer",
      link: "/lineup",
      description: "Optimize your weekly lineup for maximum points.",
    },
    {
      name: "Draft Monitor",
      link: "/draft-pick-tracker",
      description:
        "Track drafting leagues: next pick countdowns, your upcoming picks, and recent draft momentum.",
      badge: "NEW",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div aria-hidden className="h-[72px]" />
      <BackgroundParticles />
      <Navbar pageTitle="Home" />

      <main className="flex flex-col items-center px-4 pb-24">
        <h1 className="text-4xl text-white sm:text-6xl font-bold mb-4 text-center animate-fadeIn">
          The Fantasy Arsenal
        </h1>

        <p className="text-gray-400 mb-5 text-center max-w-2xl">
          Premium Sleeper fantasy football tools: trade analysis, player value tracking, lineup decisions, and
          draft-day awareness — built for speed and clarity.
        </p>

        {!isLoggedIn ? (
          <>
            <form
              onSubmit={handleLogin}
              className="bg-gray-900 p-6 rounded-xl shadow-lg w-full max-w-md mb-10 animate-fadeIn"
            >
              <label className="block mb-2 font-semibold">Sleeper Username</label>
              <input
                type="text"
                value={unameInput}
                onChange={(e) => setUnameInput(e.target.value)}
                required
                className="w-full mb-4 px-4 py-2 text-black rounded-md"
              />

              <label className="block mb-2 font-semibold">Season Year</label>
              <input
                type="number"
                value={yearInput}
                onChange={(e) => setYearInput(e.target.value)}
                className="w-full mb-4 px-4 py-2 text-black rounded-md"
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition"
              >
                {loading ? "Logging in..." : "Login"}
              </button>

              {error && <p className="text-red-500 mt-4">{String(error)}</p>}

              {/* Premium attribution without polluting SEO/H1 */}
              <p className="mt-4 text-xs text-gray-400 text-center">
                Created by <span className="text-gray-200 font-semibold">StickyPicky</span>
              </p>
            </form>

            {/* SEO content (VISIBLE ONLY WHEN LOGGED OUT) */}
            <section className="max-w-6xl mx-auto px-2 sm:px-6 pb-24 w-full">
              <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
                  <h2 className="text-2xl font-bold text-white">
                    Premium fantasy football tools for Sleeper leagues
                  </h2>
                  <p className="text-gray-300 mt-2">
                    The Fantasy Arsenal is a fast, modern toolkit built specifically for{" "}
                    <span className="text-white font-semibold">Sleeper fantasy football</span>. Log in with your Sleeper
                    username to load your leagues and unlock personalized tools for drafting, trading, and weekly
                    decisions.
                  </p>

                  <ul className="mt-4 space-y-2 text-gray-200">
                    <li>• Trade Analyzer with multiple value sources</li>
                    <li>• Player Stock charts + trend snapshots</li>
                    <li>• Player Availability across your Sleeper leagues</li>
                    <li>• Power Rankings + Strength of Schedule</li>
                    <li>• Lineup Optimizer for weekly start/sit decisions</li>
                    <li>• Draft Pick Tracker: multi-league ETAs, on-deck alerts, recent pick runs</li>
                  </ul>
                </div>

                <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
                  <h2 className="text-2xl font-bold text-white">Why it wins</h2>
                  <p className="text-gray-300 mt-2">
                    Premium UX, minimal clicks, and data you can actually use mid-draft and mid-trade.
                  </p>
                  <div className="mt-4 space-y-3 text-gray-200">
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-white font-semibold">Fast</div>
                      <div className="text-sm text-gray-300">
                        Optimized fetch + caching so you can make moves quickly.
                      </div>
                    </div>
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-white font-semibold">Accurate</div>
                      <div className="text-sm text-gray-300">
                        Uses live Sleeper league + draft data for real-time context.
                      </div>
                    </div>
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-white font-semibold">Practical</div>
                      <div className="text-sm text-gray-300">Designed to answer: “What do I do right now?”</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-10 bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
                <h2 className="text-2xl font-bold text-white">FAQ</h2>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-white font-semibold">Do I need an API key?</h3>
                    <p className="text-gray-300 mt-1">
                      No. The Sleeper API is read-only for public league and draft data.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Is this for redraft or dynasty?</h3>
                    <p className="text-gray-300 mt-1">
                      Both. Tools support common formats, and value sources adapt to your settings.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Does logging in share my password?</h3>
                    <p className="text-gray-300 mt-1">
                      No. You log in with your Sleeper username only (no password).
                    </p>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Why is the draft pick tracker useful?</h3>
                    <p className="text-gray-300 mt-1">
                      It shows multi-league drafting at a glance: on-deck alerts, pace-based ETA, and recent pick runs.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-2 w-full max-w-5xl">
              {tools.map((tool, i) => (
                <ToolCard key={tool.name} {...tool} icon={TOOL_ICONS[tool.name]} delay={i * 150} />
              ))}
            </div>

            {/* Extra space below cards so they never feel cramped */}
            <div aria-hidden className="h-10" />

            {/* Footer attribution */}
            <p className="mt-6 text-xs text-gray-500 text-center">
              Created by <span className="text-gray-300 font-semibold">StickyPicky</span>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function ToolCard({ name, link, description, comingSoon, badge, delay, disabled, icon }) {
  const pill = comingSoon ? "COMING SOON" : badge;

  return comingSoon || disabled ? (
    <div
      className="bg-gray-900 p-6 text-white rounded-xl shadow-lg text-center relative transform transition hover:scale-105 animate-stagger opacity-50 cursor-not-allowed"
      style={{ animationDelay: `${delay}ms` }}
    >
      {icon && (
        <div className="flex justify-center mb-4">
          <img src={icon} alt={`${name} icon`} className="w-14 h-14 drop-shadow-lg" />
        </div>
      )}

      {pill && <Badge text={pill} />}
      <h2 className="text-2xl font-bold mb-2">{name}</h2>
      <p className="text-gray-400">{description}</p>
    </div>
  ) : (
    <Link
      href={link}
      className="bg-gray-900 p-6 rounded-xl shadow-lg text-center relative transform transition hover:scale-105 hover:neon-hover hover:bg-gray-800 animate-stagger"
      style={{ animationDelay: `${delay}ms` }}
    >
      {icon && (
        <div className="flex justify-center mb-4">
          <img src={icon} alt={`${name} icon`} className="w-14 h-14 drop-shadow-lg" />
        </div>
      )}

      {pill && <Badge text={pill} />}
      <h2 className="text-2xl text-white font-bold mb-2">{name}</h2>
      <p className="text-gray-400">{description}</p>
    </Link>
  );
}
