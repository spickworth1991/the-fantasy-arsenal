"use client";
import { clearPlayerStockSessionCache } from "../utils/psCache";
import React, { useEffect, useState } from "react"; // <-- add useEffect
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSleeper } from "../context/SleeperContext";
import { accountAvatar, useArsenalAccount } from "../context/ArsenalAccountContext";
import { useEmbeddedMode } from "../context/EmbeddedModeContext";

// Put these PNGs in /public/icons/
const ICONS = {
  football: "/icons/football-icon.webp",
  home: "/icons/home-icon.png",
  trade: "/icons/trade-icon.png",
  stock: "/icons/stock-icon.png",
  availability: "/icons/availability-icon.png",
  powerrank: "/icons/power-icon.webp",
  sos: "/icons/sos-icon.webp",
  playoff: "/icons/playoff-icon.webp",
  lineup: "/icons/lineup-icon.webp",
  draft: "/icons/draft-icon.webp",
  ballsville: "/brand/ballsville.png",
  leaguehub: "/icons/league-hub.webp",
  history: "/icons/league-history-icon.webp",
  commissioner: "/icons/commissioner-dashboard-icon.webp",
  manager: "/icons/manager-intelligence-icon.webp",
  gamecenter: "/icons/fantasy-game-center-icon.webp",
  draftcommand: "/icons/draft-command-center-icon.webp",
  depthcharts: "/icons/lineup-icon.webp",
  intelligence: "/icons/football-icon.webp",
  trust: "/icons/power-icon.webp",
  profile: "/icons/manager-intelligence-icon.webp",
};

// Set badges for sidebar links here (optional).
const NAV_BADGES = {
  "/trade": "UPDATED",
  "/lineup": "UPDATED",
  "/league-hub": "UPDATED",
  "/player-stock": "UPDATED",
  "/playoff-odds": "NEW",
  "/league-history": "NEW",
  "/commissioner-dashboard": "DEVELOPING",
  "/draft-helper": "NEW",
  "/draft-grades": "NEW",
  "/manager-intelligence": "NEW",
  "/game-center": "DEVELOPING",
  "/depth-charts": "NEW",
  "/intelligence": "NEW",
  "/trust-center": "NEW",
};

const BADGE_STYLES = {
  NEW: "bg-emerald-400 text-black",
  UPDATED: "bg-purple-400 text-black",
  DEVELOPING: "bg-red-500 text-black",
};

function NavBadge({ text }) {
  const key = String(text || "").toUpperCase();
  const cls = BADGE_STYLES[key] || "bg-white/20 text-white";
  return (
    <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold tracking-wide ${cls}`}>
      {key}
    </span>
  );
}

function SidebarLink({ href, icon, label, onClick, badge }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm text-white/62 transition hover:bg-white/[0.055] hover:text-cyan-100"
      onClick={onClick}
    >
      <img src={icon} alt="" width="24" height="24" loading="lazy" decoding="async" className="h-6 w-6 opacity-80 transition group-hover:opacity-100" />
      <span className="font-medium">{label}</span>
      {badge ? <NavBadge text={badge} /> : null}
    </Link>
  );
}

function NavGroup({ label, detail, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group rounded-2xl border border-white/[0.07] bg-black/10"><summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-white/58">{label}</div>{detail ? <div className="mt-0.5 text-[9px] text-white/25">{detail}</div> : null}</div><span className="text-xs text-white/25 transition group-open:rotate-180">⌄</span></summary><div className="space-y-0.5 border-t border-white/[0.06] p-1.5">{children}</div></details>;
}

function BallsvilleLink({ className = "" }) {
  return (
    <a
      href="https://theballsvillegame.com"
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "group inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5",
        "text-sm text-gray-200 shadow-lg transition hover:bg-white/5 hover:border-white/20",
        className,
      ].join(" ")}
      title="Check out Ballsville"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 overflow-hidden">
        <img src={ICONS.ballsville} alt="Ballsville" className="h-5 w-5 opacity-90" />
      </span>
      <span className="leading-tight">
        <span className="text-white font-semibold">Check out Ballsville</span>
        <span className="block text-[11px] text-gray-400 -mt-0.5">theballsvillegame.com</span>
      </span>
      <span className="text-gray-400 group-hover:text-gray-200 transition">↗</span>
    </a>
  );
}

export default function Navbar({ pageTitle }) {
  const { username, year, loadPortfolio, clearPortfolio } = useSleeper();
  const { account, isConnected, disconnect } = useArsenalAccount();
  const { embedded, openFullscreen } = useEmbeddedMode();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [portfolioInput, setPortfolioInput] = useState("");
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const router = useRouter();

  // ✅ NEW: hide Ballsville promo when tools are being used via Ballsville
  const [hideBallsville, setHideBallsville] = useState(false);

  useEffect(() => {
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      const path = String(window.location.pathname || "").toLowerCase();

      const isOnBallsvilleDomain =
        host === "theballsvillegame.com" || host.endsWith(".theballsvillegame.com");

      const isBallsvilleMountedArsenal =
        path.startsWith("/tools/app");

      if (isOnBallsvilleDomain || isBallsvilleMountedArsenal) {
        setHideBallsville(true);
      }
    } catch {
      // ignore
    }
  }, []);


  const handleCloseSidebar = () => {
    setSidebarClosing(true);
    setTimeout(() => {
      setSidebarClosing(false);
      setSidebarOpen(false);
    }, 300);
  };

  const viewingAccountPortfolio = !!isConnected && String(username || "").toLowerCase() === String(account?.sleeperUsername || "").toLowerCase();
  const viewingAnotherPortfolio = !!isConnected && !!username && !viewingAccountPortfolio;

  const handleClearPortfolio = () => {
    clearPlayerStockSessionCache();
    clearPortfolio();
    handleCloseSidebar();
    router.replace("/"); // redirect to homepage
  };
  const handleReturnToAccount = async () => {
    if (!account?.sleeperUsername) return;
    setPortfolioLoading(true);
    clearPlayerStockSessionCache();
    try {
      await loadPortfolio(account.sleeperUsername, year || new Date().getFullYear());
      setPortfolioInput("");
    } finally {
      setPortfolioLoading(false);
    }
  };
  const handlePortfolioLookup = async (event) => {
    event.preventDefault();
    const target = portfolioInput.trim();
    if (!target) return;
    setPortfolioLoading(true);
    clearPlayerStockSessionCache();
    try {
      await loadPortfolio(target, year || new Date().getFullYear());
      setPortfolioInput("");
    } finally {
      setPortfolioLoading(false);
    }
  };

  return (
    <>
      {/* Top Bar (full-bleed) */}
      <nav className="fixed top-0 left-0 right-0 w-full bg-gray-900 text-white px-4 sm:px-6 h-14 flex justify-between items-center shadow-lg z-50">
        {/* Left: Menu button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="sm:flex items-center gap-2 text-white text-3xl hover:scale-110 transition-transform duration-200"
            aria-label="Open menu"
          >
            <img src={ICONS.football} alt="Menu" className="w-[100px] h-12" />
            <span className="text-lg font-bold"></span>
          </button>
        </div>

        {/* Center Page Title */}
        <h1 className="text-lg sm:text-xl font-bold text-center absolute left-1/2 -translate-x-1/2">
          {pageTitle || "Home"}
        </h1>

        {/* Right: Ballsville + user */}
        <div className="flex items-center gap-3">
          {/* ✅ hide Ballsville promo if accessed via Ballsville */}
          {!hideBallsville && !embedded && (
            <div className="hidden lg:block">
              <BallsvilleLink />
            </div>
          )}
          {embedded ? <button type="button" onClick={openFullscreen} className="hidden rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-[10px] font-bold text-cyan-100 sm:block" title="Open this tool directly in The Fantasy Arsenal">Full screen ↗</button> : null}

          {username ? <Link href="/account" className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-1.5 pr-2.5 transition hover:bg-white/[0.07]"><span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg bg-slate-950"><img src={isConnected ? accountAvatar(account) : ICONS.profile} alt="" className="h-7 w-7 object-contain" /></span><span className="hidden text-left sm:block"><b className="block max-w-28 truncate text-xs">{account?.displayName || username}</b><small className={`block text-[8px] ${isConnected ? "text-emerald-200/55" : "text-white/30"}`}>{isConnected ? "My Arsenal" : `${year || ""} · Guest`}</small></span></Link> : null}

          {viewingAnotherPortfolio ? <span className="hidden max-w-32 truncate rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-2.5 py-1 text-[10px] font-bold text-amber-100 min-[520px]:inline">Viewing @{username}</span> : null}

          {username && (!isConnected || viewingAnotherPortfolio) && (
            <button
              onClick={viewingAnotherPortfolio ? handleReturnToAccount : handleClearPortfolio}
              className="rounded-lg text-white border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
            >
              {viewingAnotherPortfolio ? "My portfolio" : "Clear view"}
            </button>
          )}
        </div>
      </nav>

      {/* Sidebar Overlay */}
      {(sidebarOpen || sidebarClosing) && (
        <div
          className={`fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] ${sidebarClosing ? "overlay-fadeOut" : "overlay-fadeIn"} backdrop-blur-xl`}
          onClick={handleCloseSidebar}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`flex h-[100dvh] max-h-[100dvh] w-[340px] max-w-[92vw] flex-col overflow-hidden border-r border-white/10 bg-slate-950/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl backdrop-blur-2xl ${
              sidebarClosing ? "animate-slideOut" : "animate-slideIn"
            }`}
          >
            {/* Close Button */}
            <button
              onClick={handleCloseSidebar}
              className="float-right grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-xl text-white/60 transition hover:bg-white/5 hover:text-white"
              aria-label="Close menu"
            >
              ✕
            </button>

            {/* Sidebar Title */}
            <div className="mt-1 flex flex-col items-center gap-2 pb-3">
              <img src={ICONS.football} alt="Logo" className="w-[120px] h-12" />

              {/* ✅ Ballsville promo inside sidebar (hide when in Ballsville context) */}
              {!hideBallsville && !embedded && <BallsvilleLink className="w-full justify-between" />}
              {embedded ? <div className="grid w-full grid-cols-2 gap-2"><a href="https://theballsvillegame.com/tools" target="_top" className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-center text-[10px] font-bold text-white/55">Back to Ballsville</a><button type="button" onClick={openFullscreen} className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-[10px] font-bold text-cyan-100">Full screen ↗</button></div> : null}
            </div>

            {/* Navigation Links */}
            <nav className="clear-both min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-3 pr-1 pt-1 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]">
              <SidebarLink href="/" icon={ICONS.home} label="Home" onClick={handleCloseSidebar} badge={NAV_BADGES["/"]} />
              <SidebarLink href="/intelligence" icon={ICONS.intelligence} label="Arsenal Intelligence" onClick={handleCloseSidebar} badge={NAV_BADGES["/intelligence"]} />
              <NavGroup label="Weekly Command" detail="Act across your leagues" defaultOpen><SidebarLink href="/league-hub" icon={ICONS.leaguehub} label="League Hub" onClick={handleCloseSidebar} badge={NAV_BADGES["/league-hub"]} /><SidebarLink href="/game-center" icon={ICONS.gamecenter} label="Fantasy Game Center" onClick={handleCloseSidebar} badge={NAV_BADGES["/game-center"]} /><SidebarLink href="/lineup" icon={ICONS.lineup} label="Lineup Optimizer" onClick={handleCloseSidebar} badge={NAV_BADGES["/lineup"]} /><SidebarLink href="/player-availability" icon={ICONS.availability} label="Player Availability" onClick={handleCloseSidebar} badge={NAV_BADGES["/player-availability"]} /></NavGroup>
              <NavGroup label="Draft Room" detail="Prepare, monitor, and review"><SidebarLink href="/draft-helper" icon={ICONS.draftcommand} label="Draft Command Center" onClick={handleCloseSidebar} badge={NAV_BADGES["/draft-helper"]} /><SidebarLink href="/draft-pick-tracker" icon={ICONS.draft} label="Draft Monitor" onClick={handleCloseSidebar} badge={NAV_BADGES["/draft-pick-tracker"]} /><SidebarLink href="/draft-grades" icon={ICONS.draftcommand} label="Draft Grade Studio" onClick={handleCloseSidebar} badge={NAV_BADGES["/draft-grades"]} /></NavGroup>
              <NavGroup label="Market & Trades" detail="Values, exposure, deals"><SidebarLink href="/trade" icon={ICONS.trade} label="Trade Analyzer" onClick={handleCloseSidebar} badge={NAV_BADGES["/trade"]} /><SidebarLink href="/player-stock/results" icon={ICONS.stock} label="Player Stock" onClick={handleCloseSidebar} badge={NAV_BADGES["/player-stock"]} /></NavGroup>
              <NavGroup label="League Intelligence" detail="Research and forecasting"><SidebarLink href="/manager-intelligence" icon={ICONS.manager} label="Manager Intelligence" onClick={handleCloseSidebar} badge={NAV_BADGES["/manager-intelligence"]} /><SidebarLink href="/depth-charts" icon={ICONS.depthcharts} label="NFL Depth Charts" onClick={handleCloseSidebar} badge={NAV_BADGES["/depth-charts"]} /><SidebarLink href="/power-rankings" icon={ICONS.powerrank} label="Power Rankings" onClick={handleCloseSidebar} badge={NAV_BADGES["/power-rankings"]} /><SidebarLink href="/sos" icon={ICONS.sos} label="Strength of Schedule" onClick={handleCloseSidebar} badge={NAV_BADGES["/sos"]} /><SidebarLink href="/playoff-odds" icon={ICONS.playoff} label="Playoff Odds" onClick={handleCloseSidebar} badge={NAV_BADGES["/playoff-odds"]} /><SidebarLink href="/league-history" icon={ICONS.history} label="League History" onClick={handleCloseSidebar} badge={NAV_BADGES["/league-history"]} /><SidebarLink href="/trust-center" icon={ICONS.trust} label="Trust & Accuracy Center" onClick={handleCloseSidebar} badge={NAV_BADGES["/trust-center"]} /></NavGroup>
              <NavGroup label="Commissioner Office" detail="Operate and review"><SidebarLink href="/commissioner-dashboard" icon={ICONS.commissioner} label="Commissioner Dashboard" onClick={handleCloseSidebar} badge={NAV_BADGES["/commissioner-dashboard"]} /></NavGroup>
              <NavGroup label="Arsenal Community" detail="Profiles and verified records"><SidebarLink href="/account" icon={ICONS.profile} label="My Arsenal" onClick={handleCloseSidebar} badge="NEW" /><SidebarLink href="/leaderboard" icon={ICONS.profile} label="Manager Leaderboard" onClick={handleCloseSidebar} badge="NEW" /></NavGroup>
            </nav>

            <div className="border-t border-white/10 pt-3" />

            <form onSubmit={handlePortfolioLookup} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <label className="block text-[9px] font-bold uppercase tracking-[.16em] text-white/35">View a Sleeper portfolio</label>
              <div className="mt-2 flex gap-2">
                <input value={portfolioInput} onChange={(event)=>setPortfolioInput(event.target.value)} placeholder="Sleeper username" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/30" />
                <button disabled={!portfolioInput.trim()||portfolioLoading} className="rounded-xl bg-cyan-300/10 px-3 text-xs font-bold text-cyan-100 disabled:opacity-35">{portfolioLoading ? "…" : "View"}</button>
              </div>
              {viewingAnotherPortfolio ? <button type="button" onClick={handleReturnToAccount} disabled={portfolioLoading} className="mt-2 w-full rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-xs font-bold text-amber-100">Return to @{account?.sleeperUsername}</button> : null}
            </form>

            {/* Account identity + viewed portfolio */}
            {username ? (
              <div className="shrink-0 rounded-2xl bg-slate-950/95 pt-1">
                <Link href="/account" onClick={handleCloseSidebar} className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-2.5"><span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-black/20"><img src={isConnected ? accountAvatar(account) : ICONS.profile} alt="" className="h-8 w-8 object-contain" /></span><span className="min-w-0"><b className="block truncate text-sm">{account?.displayName || username}</b><small className={isConnected ? "text-emerald-200/50" : "text-white/30"}>{isConnected ? "Arsenal account synced" : "Optional account available"}</small></span></Link>
                <p className="mb-1 text-sm text-gray-400">
                  Viewing <span className="font-bold">@{username}</span> ({year})
                </p>
                <button
                  onClick={handleClearPortfolio}
                  className={`w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded transition neon-button ${viewingAccountPortfolio ? "hidden" : ""}`}
                >
                  Clear viewed portfolio
                </button>
              </div>
            ) : (
              <p className="text-gray-400">Load a Sleeper portfolio above</p>
            )}
            {isConnected ? <button type="button" onClick={disconnect} className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/45">Sign out of Arsenal</button> : <Link href="/account" onClick={handleCloseSidebar} className="mt-2 block w-full rounded-xl border border-violet-300/15 bg-violet-300/[0.06] px-3 py-2 text-center text-xs font-semibold text-violet-100">Sign in to Arsenal</Link>}
          </div>
        </div>
      )}
    </>
  );
}
