"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import dynamic from "next/dynamic";
import Navbar from "../../components/Navbar";
import Link from "next/link";
import { useArsenalAccount } from "../../context/ArsenalAccountContext";

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
  "Arsenal Intelligence": "/icons/football-icon.webp",
  "Trade Analyzer": "/icons/trade-icon.png",
  "Player Stock": "/icons/stock-icon.png",
  "Player Availability": "/icons/availability-icon.png",
  "Power Rankings": "/icons/power-icon.webp",
  "Strength of Schedule": "/icons/sos-icon.webp",
  "Lineup Optimizer": "/icons/lineup-icon.webp",
  "Draft Monitor": "/icons/draft-icon.webp",
  "Draft Command Center": "/icons/draft-command-center-icon.webp",
  "Draft Grade Studio": "/icons/draft-command-center-icon.webp",
  "Manager Intelligence": "/icons/manager-intelligence-icon.webp",
  "Fantasy Game Center": "/icons/fantasy-game-center-icon.webp",
  "League Hub": "/icons/league-hub.webp",
  "League History": "/icons/league-history-icon.webp",
  "Commissioner Dashboard": "/icons/commissioner-dashboard-icon.webp",
  "Playoff Odds": "/icons/playoff-icon.webp",
  "NFL Depth Charts": "/icons/lineup-icon.webp",
  "Trust & Accuracy Center": "/icons/power-icon.webp",
  "Stat Central": "/icons/power-icon.webp",
  "My Arsenal": "/icons/manager-intelligence-icon.webp",
  "Arsenal Leaderboard": "/icons/manager-intelligence-icon.webp",
  "Ballsville Stats": "/icons/power-icon.webp",
};

export default function HomeClient() {
  const { username, loadPortfolio, loading, error } = useSleeper();
  const { account, isConnected, loginAccount } = useArsenalAccount();
  const [unameInput, setUnameInput] = useState("");
  const [yearInput, setYearInput] = useState(new Date().getFullYear());
  const [accessMode, setAccessMode] = useState("portfolio");
  const [accountName, setAccountName] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [tipStep, setTipStep] = useState(0);
  const [tipArrow, setTipArrow] = useState(null);
  const tipPanelRef = useRef(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    await loadPortfolio(unameInput, yearInput);
  };
  const handleAccountLogin = async (event) => {
    event.preventDefault();
    if (!accountName.trim() || !accountPassword) return;
    setAccountLoading(true);
    setAccountMessage("");
    try {
      await loginAccount(accountName.trim(), accountPassword);
      setAccountPassword("");
    } catch (failure) {
      setAccountMessage(failure?.message || "Arsenal sign-in failed.");
    } finally {
      setAccountLoading(false);
    }
  };

  const isLoggedIn = !!username;
  const tips = useMemo(
    () =>
      isLoggedIn
        ? [
            { title: "Start with what you need", detail: "These shortcuts take you straight to the most common jobs: managing this week, preparing for a draft, or researching a move.", target: "start" },
            { title: "Fan Favorites", detail: "The most-used Arsenal tools live together here: Player Stock, Draft Monitor, Power Rankings, and Ballsville Stats.", target: "favorites" },
            { title: "Weekly Team Management", detail: "Use these tools during the season to find urgent league actions, follow live matchups, set lineups, and locate available players.", target: "weekly" },
            { title: "Draft Day & Review", detail: "Draft Command Center helps while picks are live. Draft Grade Studio evaluates the picks and roster builds after the draft.", target: "draft" },
            { title: "Trades & Player Research", detail: "Start here when evaluating a move: build a trade, study production, check depth-chart opportunity, or compare upcoming schedules.", target: "players" },
            { title: "League & Manager Research", detail: "Understand the competition through prioritized intelligence, manager tendencies, verified records, league history, and playoff scenarios.", target: "league-research" },
            { title: "Commissioner Tools", detail: "Commissioners can audit settings, participation, competitive balance, and roster quality from one focused workspace.", target: "commissioner" },
            { title: "Account & Data Trust", detail: "Manage saved Arsenal work and preferences, then inspect the freshness, coverage, and accuracy of the data behind the tools.", target: "account-trust" },
            { title: "Open tools or switch leagues", detail: "The menu contains the complete grouped tool library. Its Active league selector changes the league used by league-aware tools without sending you to another page.", target: "menu" },
            { title: "Open or change a portfolio", detail: "Use the profile control in the top right to manage your Arsenal account, return to your connected portfolio, or search and temporarily view another Sleeper manager's public profile.", target: "portfolio" },
          ]
        : [
            { title: "Load a Sleeper portfolio", detail: "Enter any public Sleeper username. No Sleeper password is needed—the Arsenal only reads public league and draft data.", target: "access" },
            { title: "Portfolio or Arsenal account?", detail: "Loading a portfolio is the quickest start. An optional Arsenal account adds cross-device preferences and saved work.", target: "access" },
            { title: "Explore the toolkit", detail: "After a portfolio loads, the homepage changes into goal-based shortcuts and clearly grouped tool collections.", target: "about" },
            { title: "Open tips anytime", detail: "The Tips button stays in the corner. Turn automatic tips off now and reopen them only when you want a reminder.", target: "menu" },
            { title: "Search Sleeper profiles", detail: "The control in the top right opens account and portfolio access. Use it to load your own portfolio or search another Sleeper manager's public profile.", target: "portfolio" },
          ],
    [isLoggedIn],
  );

  useEffect(() => {
    try {
      const enabled = localStorage.getItem("tfa:home-tips-enabled") !== "false";
      const seen = localStorage.getItem("tfa:home-tips-seen") === "true";
      if (enabled && !seen) setTipsOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!tipsOpen) return;
    const target = document.querySelector(`[data-home-tip="${tips[tipStep]?.target}"]`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [tipStep, tips, tipsOpen]);

  useEffect(() => {
    if (!tipsOpen) return;
    let timer;
    const measure = () => {
      const target = document.querySelector(`[data-home-tip="${tips[tipStep]?.target}"]`);
      const panel = tipPanelRef.current;
      if (!target || !panel) return setTipArrow(null);
      const targetRect = target.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      setTipArrow({
        fromX: panelRect.left + panelRect.width / 2,
        fromY: panelRect.top - 8,
        toX: Math.max(24, Math.min(window.innerWidth - 24, targetRect.left + Math.min(targetRect.width / 2, 180))),
        toY: Math.max(24, Math.min(panelRect.top - 44, targetRect.top + Math.min(targetRect.height / 2, 70))),
      });
    };
    const scheduleMeasure = () => { clearTimeout(timer); timer = setTimeout(measure, 80); };
    measure();
    timer = setTimeout(measure, 500);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure);
    };
  }, [tipStep, tips, tipsOpen]);

  const closeTips = (disable = false) => {
    setTipsOpen(false);
    setTipStep(0);
    try {
      localStorage.setItem("tfa:home-tips-seen", "true");
      if (disable) localStorage.setItem("tfa:home-tips-enabled", "false");
    } catch {}
  };

  const tipClass = (target) =>
    tipsOpen && tips[tipStep]?.target === target
      ? "relative z-[92] ring-2 ring-cyan-300 ring-offset-4 ring-offset-slate-950 shadow-[0_0_55px_rgba(34,211,238,.3)]"
      : "";

  const tools = [
    {
      name: "Arsenal Intelligence",
      link: "/intelligence",
      description: "Turn lineup, waiver, trade, draft, playoff, portfolio, and commissioner signals into one prioritized action list.",
      badge: "NEW",
    },
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
      name: "Draft Grade Studio",
      link: "/draft-grades",
      description: "Grade every team and selection with source-aware value, roster fit, construction, awards, and a printable league report.",
      badge: "NEW",
    },
    {
      name: "Trust & Accuracy Center",
      link: "/trust-center",
      description: "Audit source freshness, coverage, disagreement, projection accuracy, confidence, and the evidence behind every calculation.",
      badge: "NEW",
    },
    {
      name: "Stat Central",
      link: "/stat-central",
      description: "Explore historical fantasy scoring, weekly game logs, floor and ceiling, consistency, player archetypes, raw stats, career trends, and start/sit comparisons.",
      badge: "DEVELOPING",
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
      description: "Search once to see every loaded league where a player is available to add.",
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
      name: "NFL Depth Charts",
      link: "/depth-charts",
      description: "Explore NFL position trees with values, projections, injuries, handcuffs, contracts, rookies, and portfolio exposure.",
      badge: "NEW",
    },
    {
      name: "Power Rankings",
      link: "/power-rankings",
      description: "Compare every roster in a league using team strength, depth, and positional rankings.",
    },
    {
      name: "Strength of Schedule",
      link: "/sos",
      description: "Compare regular-season and playoff schedules, difficult weeks, and position-specific matchups.",
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
      description: "Estimate playoff chances and test how future wins, losses, and league results change the path.",
      badge: "NEW",
    },
    {
      name: "My Arsenal",
      link: "/account",
      description:
        "Manage your Arsenal profile, connected Sleeper portfolio, preferences, saved work, digest, achievements, and privacy.",
      badge: "NEW",
    },
    {
      name: "Arsenal Leaderboard",
      link: "/leaderboard",
      description:
        "Compare verified Sleeper portfolio records and discover public Arsenal manager profiles.",
      badge: "NEW",
    },
    {
      name: "Ballsville Stats",
      link: "/ballsville-stats",
      description: "Explore Ballsville draft frequency, mode-specific ADP, top drafters, and player draft patterns.",
      badge: "NEW",
    },
    
  ];
  const toolGroups = [
    { title:"Fan Favorites", tipTarget:"favorites", eyebrow:"MOST POPULAR", description:"The four most-visited tools: follow player value, monitor live drafts, compare league rosters, and explore Ballsville draft trends.", names:["Player Stock","Draft Monitor","Power Rankings","Ballsville Stats"], favorite:true },
    { title:"Weekly Team Management", tipTarget:"weekly", eyebrow:"MANAGE MY TEAMS", description:"See what needs attention across your leagues, follow matchups, make lineup decisions, and find available players.", names:["League Hub","Fantasy Game Center","Lineup Optimizer","Player Availability"] },
    { title:"Draft Day & Review", tipTarget:"draft", eyebrow:"DRAFT", description:"Use a live, league-aware board while drafting, then grade the picks, roster construction, and every team afterward.", names:["Draft Command Center","Draft Grade Studio"] },
    { title:"Trades & Player Research", tipTarget:"players", eyebrow:"EVALUATE PLAYERS", description:"Build trades, study player production, understand depth-chart opportunity, and compare regular-season or playoff schedules.", names:["Trade Analyzer","Stat Central","NFL Depth Charts","Strength of Schedule"] },
    { title:"League & Manager Research", tipTarget:"league-research", eyebrow:"KNOW THE COMPETITION", description:"Review prioritized intelligence, research manager behavior and records, explore league history, and model the playoff race.", names:["Arsenal Intelligence","Manager Intelligence","Arsenal Leaderboard","League History","Playoff Odds"] },
    { title:"Commissioner Tools", tipTarget:"commissioner", eyebrow:"RUN THE LEAGUE", description:"Audit settings, participation, competitive balance, and roster quality—then turn the findings into commissioner actions.", names:["Commissioner Dashboard"] },
    { title:"Account & Data Trust", tipTarget:"account-trust", eyebrow:"MY ARSENAL", description:"Manage your Arsenal profile and saved work, then inspect the freshness and accuracy behind Arsenal data.", names:["My Arsenal","Trust & Accuracy Center"] },
  ].map(group=>({...group,tools:group.names.map(name=>tools.find(tool=>tool.name===name)).filter(Boolean)}));

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div aria-hidden className="h-[72px]" />
      <BackgroundParticles />
      <Navbar pageTitle="Home" highlightMenu={tipsOpen && tips[tipStep]?.target === "menu"} highlightPortfolio={tipsOpen && tips[tipStep]?.target === "portfolio"} />

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
            <section data-home-tip="access" className={`mb-10 w-full max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/95 shadow-2xl animate-fadeIn ${tipClass("access")}`}>
              <div className="grid grid-cols-2 gap-2 border-b border-white/10 bg-black/15 p-2">
                <button type="button" onClick={() => { setAccessMode("portfolio"); setAccountMessage(""); }} className={`min-h-12 rounded-xl px-2 text-xs font-black transition sm:text-sm ${accessMode === "portfolio" ? "bg-cyan-300/12 text-cyan-100 ring-1 ring-cyan-300/15" : "text-white/40 hover:bg-white/[0.04]"}`}>Load Sleeper Portfolio</button>
                <button type="button" onClick={() => { setAccessMode("account"); setAccountMessage(""); }} className={`min-h-12 rounded-xl px-2 text-xs font-black transition sm:text-sm ${accessMode === "account" ? "bg-violet-300/12 text-violet-100 ring-1 ring-violet-300/15" : "text-white/40 hover:bg-white/[0.04]"}`}>Arsenal Account</button>
              </div>
              <div className="p-5 sm:p-7">
                {accessMode === "portfolio" ? (
                  <form onSubmit={handleLogin}>
                    <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/55">Free · public · read only</div>
                    <h2 className="mt-1 text-2xl font-black text-white">Open any Sleeper portfolio</h2>
                    <p className="mt-2 text-xs leading-5 text-white/40">No Sleeper password and no Arsenal account required. This loads public leagues and tools for the manager you enter.</p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
                      <label className="text-[10px] font-bold text-white/42">Sleeper username<input type="text" value={unameInput} onChange={(event) => setUnameInput(event.target.value)} required autoFocus className="mt-1.5 min-h-12 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 text-sm text-white outline-none focus:border-cyan-300/35" /></label>
                      <label className="text-[10px] font-bold text-white/42">Season<input type="number" value={yearInput} onChange={(event) => setYearInput(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 text-sm text-white outline-none focus:border-cyan-300/35" /></label>
                    </div>
                    <button type="submit" disabled={loading || !unameInput.trim()} className="mt-3 min-h-12 w-full rounded-2xl bg-cyan-300/12 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/18 disabled:opacity-35">{loading ? "Loading portfolio…" : "Load Sleeper portfolio"}</button>
                    {error ? <p className="mt-3 rounded-xl border border-rose-300/12 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{String(error)}</p> : null}
                  </form>
                ) : isConnected ? (
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-100/55">Arsenal account connected</div>
                    <h2 className="mt-1 text-2xl font-black text-white">Welcome back, {account?.displayName}</h2>
                    <p className="mt-2 text-xs leading-5 text-white/40">Your private settings and saved work are restored. Your connected portfolio @{account?.sleeperUsername} is loading automatically.</p>
                    <Link href="/account" className="mt-5 block min-h-12 rounded-2xl bg-violet-300/12 px-4 py-3 text-center text-sm font-black text-violet-100">Open My Arsenal</Link>
                  </div>
                ) : (
                  <form onSubmit={handleAccountLogin}>
                    <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-100/55">Optional cross-device account</div>
                    <h2 className="mt-1 text-2xl font-black text-white">Sign in to your Arsenal</h2>
                    <p className="mt-2 text-xs leading-5 text-white/40">One sign-in restores your connected Sleeper portfolio, preferences, watchlists, saved decisions, and profile.</p>
                    <label className="mt-5 block text-[10px] font-bold text-white/42">Arsenal account name<input autoComplete="username" value={accountName} onChange={(event) => setAccountName(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 text-sm text-white outline-none focus:border-violet-300/35" /></label>
                    <label className="mt-3 block text-[10px] font-bold text-white/42">Password<span className="relative mt-1.5 block"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} className="min-h-12 w-full rounded-2xl border border-white/10 bg-slate-950 py-3 pl-4 pr-20 text-sm text-white outline-none focus:border-violet-300/35"/><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute inset-y-1 right-1 rounded-xl px-3 text-[10px] font-black text-violet-100/65 hover:bg-white/[0.04]">{showPassword ? "Hide" : "Show"}</button></span></label>
                    <button disabled={accountLoading || !accountName.trim() || !accountPassword} className="mt-3 min-h-12 w-full rounded-2xl bg-violet-300/12 text-sm font-black text-violet-100 transition hover:bg-violet-300/18 disabled:opacity-35">{accountLoading ? "Signing in…" : "Sign in and load my portfolio"}</button>
                    {accountMessage ? <p className="mt-3 rounded-xl border border-rose-300/12 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{accountMessage}</p> : null}
                    <Link href="/account?mode=create" className="mt-3 block rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] px-3 py-3 text-center text-xs font-black text-cyan-100">Create an account</Link>
                  </form>
                )}
                <p className="mt-5 border-t border-white/[0.07] pt-4 text-center text-xs text-white/30">Created by <span className="font-semibold text-white/55">StickyPicky</span></p>
              </div>
            </section>

            {/* SEO content (VISIBLE ONLY WHEN LOGGED OUT) */}
            <section data-home-tip="about" className={`max-w-6xl mx-auto px-2 sm:px-6 pb-24 w-full ${tipClass("about")}`}>
              <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-gray-900/70 border border-white/10 rounded-2xl p-6 shadow-xl">
                  <h2 className="text-2xl font-bold text-white">
                    Premium fantasy football tools for Sleeper leagues
                  </h2>
                  <p className="text-gray-300 mt-2">
                    The Fantasy Arsenal is a fast, modern toolkit built specifically for{" "}
                    <span className="text-white font-semibold">Sleeper fantasy football</span>. Load any public Sleeper
                    portfolio by username to open its leagues and unlock contextual tools for drafting, trading, and weekly
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
                    <h3 className="text-white font-semibold">Does loading a portfolio require a Sleeper password?</h3>
                    <p className="text-gray-300 mt-1">
                      No. Sleeper portfolios use public, read-only data. An optional Arsenal account is the separate secure sign-in for cloud saves and your profile.
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
            <section data-home-tip="start" className={`overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(34,211,238,.18),transparent_36%),radial-gradient(circle_at_8%_100%,rgba(139,92,246,.14),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))] p-5 sm:p-7 ${tipClass("start")}`}>
              <div className="text-[10px] font-semibold uppercase tracking-[.26em] text-cyan-200/55">New here?</div>
              <div className="mt-2"><h2 className="text-2xl font-black text-white sm:text-4xl">What do you need to do?</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Start with your goal. The full tool library below is organized into clear groups when you need something more specific.</p></div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">{[["/league-hub","Manage this week","Open League Hub for lineup, waiver, injury, and trade priorities"],["/draft-helper","Prepare for a draft","Use Draft Command Center for a live, league-aware draft board"],["/trade","Research a move","Start in Trade Analyzer to compare value and roster fit"]].map(([link,name,detail])=><Link key={link} href={link} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.065]"><div className="font-bold text-white">{name}</div><div className="mt-1 text-xs leading-5 text-white/38">{detail}</div></Link>)}</div>
            </section>
            <div className="space-y-8">
              {toolGroups.map((group,index)=><ToolSection key={group.title} group={group} offset={index*4} tipActive={tipsOpen && tips[tipStep]?.target === group.tipTarget}/>) }
            </div>

            {/* Extra space below cards so they never feel cramped */}
            <div aria-hidden className="h-10" />

            {/* Footer attribution */}
            <p className="mt-6 text-xs text-gray-500 text-center">
              Created by <span className="text-gray-300 font-semibold">StickyPicky</span>
            </p>
          </div>
        )}
      </main>
      <button type="button" onClick={() => { setTipStep(0); setTipsOpen(true); }} className="fixed bottom-5 right-5 z-[70] rounded-full border border-cyan-300/25 bg-slate-950/95 px-4 py-3 text-xs font-black text-cyan-100 shadow-2xl backdrop-blur hover:bg-cyan-300/10" aria-label="Open homepage tips">
        ? Tips
      </button>
      {tipsOpen ? (
        <>
          <div className="fixed inset-0 z-[80] bg-slate-950/55 backdrop-blur-[1px]" aria-hidden />
          {tipArrow ? (
            <svg className="pointer-events-none fixed inset-0 z-[105] h-full w-full" aria-hidden>
              <defs><marker id="home-tip-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="rgb(103 232 249)" /></marker></defs>
              <path d={`M ${tipArrow.fromX} ${tipArrow.fromY} Q ${(tipArrow.fromX + tipArrow.toX) / 2 + 36} ${(tipArrow.fromY + tipArrow.toY) / 2} ${tipArrow.toX} ${tipArrow.toY}`} fill="none" stroke="rgba(103,232,249,.9)" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 7" markerEnd="url(#home-tip-arrow)" className="animate-pulse" />
            </svg>
          ) : null}
          <div ref={tipPanelRef} className="fixed inset-x-4 bottom-32 z-[110] mx-auto max-w-lg rounded-[26px] border border-cyan-100/45 bg-[#26364f] p-5 shadow-[0_30px_100px_rgba(0,0,0,.9),0_0_40px_rgba(34,211,238,.18)] sm:bottom-16 sm:p-6" role="dialog" aria-modal="true" aria-label="Homepage tips">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-100/75">Homepage tip {tipStep + 1} of {tips.length}</div><h2 className="mt-1 text-xl font-black text-white">{tips[tipStep].title}</h2></div>
              <button type="button" onClick={() => closeTips(false)} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75 hover:bg-white/[0.09]" aria-label="Close tips">Close</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/75">{tips[tipStep].detail}</p>
            <div className="mt-5 flex items-center gap-2">
              <button type="button" disabled={tipStep === 0} onClick={() => setTipStep((step) => Math.max(0, step - 1))} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/55 disabled:opacity-25">Back</button>
              <button type="button" onClick={() => tipStep === tips.length - 1 ? closeTips(false) : setTipStep((step) => step + 1)} className="flex-1 rounded-xl bg-cyan-300/15 px-4 py-2.5 text-xs font-black text-cyan-100 hover:bg-cyan-300/20">{tipStep === tips.length - 1 ? "Done" : "Next tip"}</button>
              <button type="button" onClick={() => closeTips(true)} className="rounded-xl px-3 py-2.5 text-[10px] font-bold text-white/35 hover:text-white/60">Turn tips off</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ToolSection({group,offset=0,tipActive=false}) {
  return <section data-home-tip={group.tipTarget} className={`${group.favorite?"rounded-[28px] border border-amber-300/15 bg-amber-300/[0.025] p-5 sm:p-6":""} ${tipActive?"relative z-[93] rounded-[28px] ring-2 ring-amber-300 ring-offset-4 ring-offset-slate-950 shadow-[0_0_55px_rgba(252,211,77,.24)]":""}`}><div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><div className={`text-[10px] font-semibold uppercase tracking-[.22em] ${group.favorite?"text-amber-200/60":"text-cyan-200/45"}`}>{group.eyebrow}</div><h2 className="mt-1 text-2xl font-black text-white">{group.title}</h2></div><p className="max-w-xl text-xs leading-5 text-white/38 sm:text-right">{group.description}</p></div><div className={`grid gap-4 ${group.tools.length===1?"grid-cols-1":group.favorite?"sm:grid-cols-2 xl:grid-cols-4":"sm:grid-cols-2 lg:grid-cols-3"}`}>{group.tools.map((tool,index)=><ToolCard key={tool.name} {...tool} icon={TOOL_ICONS[tool.name]} delay={(offset+index)*70} featured={group.tools.length===1}/>)}</div></section>;
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
          <img src={icon} alt={`${name} icon`} width="44" height="44" loading="lazy" decoding="async" className="h-11 w-11 drop-shadow-lg" />
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
          <img src={icon} alt={`${name} icon`} width="44" height="44" loading="lazy" decoding="async" className="h-11 w-11 drop-shadow-lg transition group-hover:scale-105" />
        </div>
      )}

      {pill && <Badge text={pill} />}
      <div className="min-w-0 flex-1"><h3 className="text-lg font-black text-white">{name}</h3><p className="mt-2 text-sm leading-5 text-white/40">{description}</p><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-cyan-100/55">Open workspace →</div></div>
    </Link>
  );
}
