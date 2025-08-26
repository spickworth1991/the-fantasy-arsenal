"use client";
import { useState } from "react";
import { useSleeper } from "../context/SleeperContext";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../components/BackgroundParticles"), { ssr: false });
import Navbar from "../components/Navbar";
import Link from "next/link";

export default function HomePage() {
  const { username, year, login, loading, error } = useSleeper();
  const [unameInput, setUnameInput] = useState("");
  const [yearInput, setYearInput] = useState(new Date().getFullYear());

  const handleLogin = async (e) => {
    e.preventDefault();
    await login(unameInput, yearInput);
  };

  const isLoggedIn = !!username;

  const tools = [
    { name: "Trade Analyzer", link: "/trade", description: "Analyze trades using differnet value sources. Select a league for personalized trades." },
    { name: "Player Stock", link: "/player-stock", description: "Track player value changes over time" },
    { name: "Player Availability", link: "/player-availability", description: "Find which leagues have a player available" },
    { name: "Power Rankings", link: "/power-rankings", description: "See where you rank amongst your league." },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4">
        <div aria-hidden className="h-[72px]" />
      <BackgroundParticles />
      <Navbar pageTitle="Home" />
      <main className="flex flex-col items-center px-4">
        <h1 className="text-4xl text-white sm:text-6xl font-bold mb-4 text-center animate-fadeIn">
          The Fantasy Arsenal <span className="text-blue-400">by StickyPicky</span>
        </h1>
        <p className="text-gray-400 mb-8 text-center">
          Your all-in-one fantasy football toolkit
        </p>

        {!isLoggedIn ? (
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
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6 w-full max-w-5xl">
            {tools.map((tool, i) => (
              <ToolCard key={tool.name} {...tool} delay={i * 150} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ToolCard({ name, link, description, comingSoon, delay, disabled }) {
  return comingSoon || disabled ? (
    <div
      className="bg-gray-900 p-6 text-white rounded-xl shadow-lg text-center relative transform transition hover:scale-105 animate-stagger opacity-50 cursor-not-allowed"
      style={{ animationDelay: `${delay}ms` }}
    >
      {comingSoon && (
        <span className="absolute top-2 right-2 bg-yellow-500 text-black px-2 py-1 rounded text-xs">
          Coming Soon
        </span>
      )}
      <h2 className="text-2xl font-bold mb-2">{name}</h2>
      <p className="text-gray-400">{description}</p>
    </div>
  ) : (
    <Link
      href={link}
      className="bg-gray-900 p-6 rounded-xl shadow-lg text-center relative transform transition hover:scale-105 hover:neon-hover hover:bg-gray-800 animate-stagger"
      style={{ animationDelay: `${delay}ms` }}
    >
      <h2 className="text-2xl text-white font-bold mb-2">{name}</h2>
      <p className="text-gray-400">{description}</p>
    </Link>
  );
}
