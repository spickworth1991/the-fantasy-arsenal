"use client";

import { useState } from "react";
import { useSleeper } from "../context/SleeperContext";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../components/BackgroundParticles"), { ssr: false });
import Navbar from "../components/Navbar";
import Link from "next/link";

const BADGE_STYLES = {
  NEW: "bg-emerald-400 text-black",
  UPDATED: "bg-purple-400 text-black",
  "COMING SOON": "bg-yellow-500 text-black",
  DEVELOPING:"bg-red-500 text-black"
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
  "Draft Pick Tracker": "/icons/draft-icon.png",
};


export default function HomePage() {
  const { username, year, login, loading, error } = useSleeper();
  const [unameInput, setUnameInput] = useState("");
  const [yearInput, setYearInput] = useState(new Date().getFullYear());

  const handleLogin = async (e) => {
    e.preventDefault();
    await login(unameInput, yearInput);
  };

  const isLoggedIn = !!username;

  // Add `badge: "NEW"` or `badge: "UPDATED"` on any tool.
  const tools = [
    {
      name: "Trade Analyzer",
      link: "/trade",
      description: "Analyze trades using multiple value sources. Select a league for personalized trades.",
      // badge: "UPDATED",
    },
    {
      name: "Player Stock",
      link: "/player-stock",
      description: "Track player value changes over time",
      // badge: "NEW",
    },
    { name: "Player Availability", link: "/player-availability", description: "Find which leagues have a player available", badge: "UPDATED"},
    { name: "Power Rankings", link: "/power-rankings", description: "See where you rank amongst your league." },
    { name: "Strength of Schedule", link: "/sos", description: "Analyze team schedules based on various metrics." },
    { name: "Lineup Optimizer", link: "/lineup", description: "Optimize your weekly lineup for maximum points." },
    { name: "Draft Pick Tracker", link: "/draft-pick-tracker", description: "Track drafting leagues: next pick countdowns, your upcoming picks, and traded future picks.", badge: "DEVELOPING" },

    // { name: "Playoff Odds", link: "/playoff-odds", description: "Calculate your team's odds of making the playoffs.", comingSoon: true },
    // { name: "Draft Kit", link: "/draft-kit", description: "Prepare for your upcoming draft with rankings and cheat sheets.", comingSoon: true },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div aria-hidden className="h-[72px]" />
      <BackgroundParticles />
      <Navbar pageTitle="Home" />

      <main className="flex flex-col items-center px-4 pb-32">
        <h1 className="text-4xl text-white sm:text-6xl font-bold mb-4 text-center animate-fadeIn">
          The Fantasy Arsenal <span className="text-blue-400">by StickyPicky</span>
        </h1>
        <p className="text-gray-400 mb-8 text-center">Your all-in-one fantasy football toolkit</p>

        {!isLoggedIn ? (
          <form onSubmit={handleLogin} className="bg-gray-900 p-6 rounded-xl shadow-lg w-full max-w-md mb-10 animate-fadeIn">
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
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6 w-full max-w-5xl">
            {tools.map((tool, i) => (
              <ToolCard
                key={tool.name}
                {...tool}
                icon={TOOL_ICONS[tool.name]}
                delay={i * 150}
              />
            ))}

          </div>
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
            <img
              src={icon}
              alt={`${name} icon`}
              className="w-14 h-14 drop-shadow-lg"
            />
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
          <img
            src={icon}
            alt={`${name} icon`}
            className="w-14 h-14 drop-shadow-lg"
          />
        </div>
      )}

      {pill && <Badge text={pill} />}
      <h2 className="text-2xl text-white font-bold mb-2">{name}</h2>
      <p className="text-gray-400">{description}</p>
    </Link>
  );
}
