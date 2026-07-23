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
  "Draft Command Center": "/icons/draft-icon.png",
  "Manager Intelligence": "/icons/league-hub.png",
  "Fantasy Game Center": "/icons/lineup-icon.png",
  "League Hub": "/icons/league-hub.png",
  "League History": "/icons/league-hub.png",
  "Commissioner Dashboard": "/icons/league-hub.png",
  "Playoff Odds": "/icons/playoff-icon.png",
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
      description: "Analyze trades and generate mutually useful, roster-aware packages with Trade Partner Finder 2.0.",
      badge: "UPDATED",
    },
    {
      name: "Player Stock",
      link: "/player-stock/results",
      description: "Track player value changes over time - Now includes drafting leagues for real-time draft momentum!",
      badge: "UPDATED",
    },
    {
      name: "Draft Command Center",
      link: "/draft-helper",
      description: "Draft from a live league-aware board with traded-pick ownership, team needs, and contextual recommendations.",
      badge: "NEW",
    },
    {
      name: "Draft Monitor",
      link: "/draft-pick-tracker",
      description:
        "Track drafting leagues: next pick countdowns, your upcoming picks, and recent draft momentum.",
    },
    {
      name: "Manager Intelligence",
      link: "/manager-intelligence",
      description: "Research public Sleeper manager networks, league history, player exposure, trades, and draft tendencies.",
      badge: "NEW",
    },
    {
      name: "Fantasy Game Center",
      link: "/game-center",
      description: "Follow roots, boos, lineup conflicts, kickoff order, fantasy points, and scores across every league.",
      badge: "DEVELOPING",
    },
    {
      name: "Player Availability",
      link: "/player-availability",
      description: "Find which leagues have a player available",
    },
    {
      name: "League Hub",
      link: "/league-hub",
      description:
        "Your multi-league action center for lineups, waivers, injuries, trades, and opportunities.",
      badge: "UPDATED",
    },
    {
      name: "League History",
      link: "/league-history",
      description: "Relive champions, rivalries, records, season awards, and your league yearbook.",
      badge: "NEW",
    },
    {
      name: "Commissioner Dashboard",
      link: "/commissioner-dashboard",
      description: "Audit league participation, balance, roster quality, settings, and evidence-based review signals.",
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
      description: "Explain start/sit choices with safe, median, and aggressive lineups plus win-impact analysis.",
      badge: "UPDATED",
    },
    {
      name: "Playoff Odds",
      link: "/playoff-odds",
      description: "Predict your team's chances of making the playoffs.",
      badge: "NEW",
    },
    
  ];
  const toolGroups = [
    { title:"Weekly Command", eyebrow:"RUN YOUR SUNDAY", description:"Lineups, live conflicts, player availability, and every league needing attention.", names:["League Hub","Fantasy Game Center","Lineup Optimizer","Player Availability"] },
    { title:"Draft Room", eyebrow:"BUILD THE ROSTER", description:"Prepare picks, follow live boards, and stay ahead across simultaneous drafts.", names:["Draft Command Center","Draft Monitor"] },
    { title:"Market & Trades", eyebrow:"FIND THE EDGE", description:"Understand player markets and build moves that fit real rosters.", names:["Trade Analyzer","Player Stock"] },
    { title:"League Intelligence", eyebrow:"KNOW THE FIELD", description:"Research managers, league strength, schedules, playoff paths, and history.", names:["Manager Intelligence","Power Rankings","Strength of Schedule","Playoff Odds","League History"] },
    { title:"Commissioner Office", eyebrow:"OPERATE THE LEAGUE", description:"Review league health, settings, participation, reports, and action items.", names:["Commissioner Dashboard"] },
  ].map(group=>({...group,tools:group.names.map(name=>tools.find(tool=>tool.name===name)).filter(Boolean)}));

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
          <div className="w-full max-w-6xl space-y-8">
            <section className="overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(34,211,238,.18),transparent_36%),radial-gradient(circle_at_8%_100%,rgba(139,92,246,.14),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))] p-5 sm:p-7">
              <div className="text-[10px] font-semibold uppercase tracking-[.26em] text-cyan-200/55">Your fantasy operating system</div>
              <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-2xl font-black text-white sm:text-4xl">What do you need to do?</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Choose a workspace instead of hunting through a wall of tools. Every section keeps related decisions together.</p></div><Link href="/league-hub" className="rounded-2xl bg-cyan-300/10 px-5 py-3 text-center text-sm font-bold text-cyan-100">Open League Hub →</Link></div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["/league-hub","League Hub","See every league needing attention"],["/draft-pick-tracker","Draft Monitor","Track every live draft in one place"],["/draft-helper","Draft Command Center","Make the next pick with context"],["/manager-intelligence","Manager Intelligence","Research a manager or league"]].map(([link,name,detail])=><Link key={link} href={link} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.065]"><div className="font-bold text-white">{name}</div><div className="mt-1 text-xs text-white/38">{detail}</div></Link>)}</div>
            </section>
            {toolGroups.map((group,index)=><ToolSection key={group.title} group={group} offset={index*4}/>) }

            {/* Extra space below cards so they never feel cramped */}
            <div aria-hidden className="h-10" />

            {/* Footer attribution */}
            <p className="mt-6 text-xs text-gray-500 text-center">
              Created by <span className="text-gray-300 font-semibold">StickyPicky</span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function ToolSection({group,offset=0}) {
  return <section><div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-200/45">{group.eyebrow}</div><h2 className="mt-1 text-2xl font-black text-white">{group.title}</h2></div><p className="max-w-xl text-xs leading-5 text-white/38 sm:text-right">{group.description}</p></div><div className={`grid gap-4 ${group.tools.length===1?"grid-cols-1":"sm:grid-cols-2 lg:grid-cols-3"}`}>{group.tools.map((tool,index)=><ToolCard key={tool.name} {...tool} icon={TOOL_ICONS[tool.name]} delay={(offset+index)*70} featured={group.tools.length===1}/>)}</div></section>;
}

function ToolCard({ name, link, description, comingSoon, badge, delay, disabled, icon, featured=false }) {
  const pill = comingSoon ? "COMING SOON" : badge;

  return comingSoon || disabled ? (
    <div
      className="relative rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-white opacity-50"
      style={{ animationDelay: `${delay}ms` }}
    >
      {icon && (
        <div className="mb-4">
          <img src={icon} alt={`${name} icon`} className="h-11 w-11 drop-shadow-lg" />
        </div>
      )}

      {pill && <Badge text={pill} />}
      <h2 className="text-2xl font-bold mb-2">{name}</h2>
      <p className="text-gray-400">{description}</p>
    </div>
  ) : (
    <Link
      href={link}
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/95 to-slate-950/85 p-5 text-left shadow-[0_24px_70px_-55px_rgba(34,211,238,.65)] transition hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.04] animate-stagger ${featured?"sm:flex sm:items-center sm:gap-5":""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {icon && (
        <div className="mb-4 sm:mb-0">
          <img src={icon} alt={`${name} icon`} className="h-11 w-11 drop-shadow-lg transition group-hover:scale-105" />
        </div>
      )}

      {pill && <Badge text={pill} />}
      <div className="min-w-0 flex-1"><h3 className="text-lg font-black text-white">{name}</h3><p className="mt-2 text-sm leading-5 text-white/40">{description}</p><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-cyan-100/55">Open workspace →</div></div>
    </Link>
  );
}
