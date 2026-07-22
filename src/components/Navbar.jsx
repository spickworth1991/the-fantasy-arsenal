"use client";
import { clearPlayerStockSessionCache } from "../utils/psCache";
import React, { useEffect, useState } from "react"; // <-- add useEffect
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSleeper } from "../context/SleeperContext";

// Put these PNGs in /public/icons/
const ICONS = {
  football: "/icons/football-icon.png",
  home: "/icons/home-icon.png",
  trade: "/icons/trade-icon.png",
  stock: "/icons/stock-icon.png",
  availability: "/icons/availability-icon.png",
  powerrank: "/icons/power-icon.png",
  sos: "/icons/sos-icon.png",
  playoff: "/icons/playoff-icon.png",
  lineup: "/icons/lineup-icon.png",
  draft: "/icons/draft-icon.png",
  ballsville: "/brand/ballsville.png",
  leaguehub: "/icons/league-hub.png",
  history: "/icons/league-hub.png",
  commissioner: "/icons/league-hub.png",
  manager: "/icons/league-hub.png",
  gamecenter: "/icons/lineup-icon.png",
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
  "/manager-intelligence": "NEW",
  "/game-center": "DEVELOPING",
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
      <img src={icon} alt="" className="h-6 w-6 opacity-80 transition group-hover:opacity-100" />
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
  const { username, year, logout } = useSleeper();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);
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

  const handleLogout = () => {
    clearPlayerStockSessionCache();
    logout();
    handleCloseSidebar();
    router.replace("/"); // redirect to homepage
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
          {!hideBallsville && (
            <div className="hidden lg:block">
              <BallsvilleLink />
            </div>
          )}

          {username && (
            <span className="hidden text-white sm:inline text-sm opacity-80">
              {username}
              {year ? ` · ${year}` : ""}
            </span>
          )}

          {username && (
            <button
              onClick={handleLogout}
              className="rounded-lg text-white border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
            >
              Logout
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
              {!hideBallsville && <BallsvilleLink className="w-full justify-between" />}
            </div>

            {/* Navigation Links */}
            <nav className="clear-both min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-3 pr-1 pt-1 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]">
              <SidebarLink href="/" icon={ICONS.home} label="Home" onClick={handleCloseSidebar} badge={NAV_BADGES["/"]} />
              <NavGroup label="Weekly Command" detail="Act across your leagues" defaultOpen><SidebarLink href="/league-hub" icon={ICONS.leaguehub} label="League Hub" onClick={handleCloseSidebar} badge={NAV_BADGES["/league-hub"]} /><SidebarLink href="/game-center" icon={ICONS.gamecenter} label="Fantasy Game Center" onClick={handleCloseSidebar} badge={NAV_BADGES["/game-center"]} /><SidebarLink href="/lineup" icon={ICONS.lineup} label="Lineup Optimizer" onClick={handleCloseSidebar} badge={NAV_BADGES["/lineup"]} /><SidebarLink href="/player-availability" icon={ICONS.availability} label="Player Availability" onClick={handleCloseSidebar} badge={NAV_BADGES["/player-availability"]} /></NavGroup>
              <NavGroup label="Draft Room" detail="Prepare and monitor"><SidebarLink href="/draft-helper" icon={ICONS.draft} label="Draft Helper" onClick={handleCloseSidebar} badge={NAV_BADGES["/draft-helper"]} /><SidebarLink href="/draft-pick-tracker" icon={ICONS.draft} label="Draft Monitor" onClick={handleCloseSidebar} badge={NAV_BADGES["/draft-pick-tracker"]} /></NavGroup>
              <NavGroup label="Market & Trades" detail="Values, exposure, deals"><SidebarLink href="/trade" icon={ICONS.trade} label="Trade Analyzer" onClick={handleCloseSidebar} badge={NAV_BADGES["/trade"]} /><SidebarLink href="/player-stock/results" icon={ICONS.stock} label="Player Stock" onClick={handleCloseSidebar} badge={NAV_BADGES["/player-stock"]} /></NavGroup>
              <NavGroup label="League Intelligence" detail="Research and forecasting"><SidebarLink href="/manager-intelligence" icon={ICONS.manager} label="Manager Intelligence" onClick={handleCloseSidebar} badge={NAV_BADGES["/manager-intelligence"]} /><SidebarLink href="/power-rankings" icon={ICONS.powerrank} label="Power Rankings" onClick={handleCloseSidebar} badge={NAV_BADGES["/power-rankings"]} /><SidebarLink href="/sos" icon={ICONS.sos} label="Strength of Schedule" onClick={handleCloseSidebar} badge={NAV_BADGES["/sos"]} /><SidebarLink href="/playoff-odds" icon={ICONS.playoff} label="Playoff Odds" onClick={handleCloseSidebar} badge={NAV_BADGES["/playoff-odds"]} /><SidebarLink href="/league-history" icon={ICONS.history} label="League History" onClick={handleCloseSidebar} badge={NAV_BADGES["/league-history"]} /></NavGroup>
              <NavGroup label="Commissioner Office" detail="Operate and review"><SidebarLink href="/commissioner-dashboard" icon={ICONS.commissioner} label="Commissioner Dashboard" onClick={handleCloseSidebar} badge={NAV_BADGES["/commissioner-dashboard"]} /></NavGroup>
            </nav>

            <div className="border-t border-white/10 pt-3" />

            {/* User Info + Logout */}
            {username ? (
              <div className="shrink-0 rounded-2xl bg-slate-950/95 pt-1">
                <p className="text-sm text-gray-400 mb-1">
                  Logged in as <span className="font-bold">{username}</span> ({year})
                </p>
                <button
                  onClick={handleLogout}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded transition neon-button"
                >
                  Logout
                </button>
              </div>
            ) : (
              <p className="text-gray-400">Login from the homepage</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
