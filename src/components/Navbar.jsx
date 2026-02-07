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
};

// Set badges for sidebar links here (optional).
const NAV_BADGES = {
  "/player-availability": "UPDATED",
  "/draft-pick-tracker": "DEVELOPING",
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
      className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center gap-3 hover:scale-105 transition-transform duration-200"
      onClick={onClick}
    >
      <img src={icon} alt={label} className="w-8 h-8" />
      <span>{label}</span>
      {badge ? <NavBadge text={badge} /> : null}
    </Link>
  );
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
          className={`fixed inset-0 z-50 flex ${sidebarClosing ? "overlay-fadeOut" : "overlay-fadeIn"} backdrop-blur-xl`}
          onClick={handleCloseSidebar}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`bg-gray-900/90 w-72 h-full p-6 flex flex-col gap-6 shadow-xl neon-glow ${
              sidebarClosing ? "animate-slideOut" : "animate-slideIn"
            }`}
          >
            {/* Close Button */}
            <button
              onClick={handleCloseSidebar}
              className="text-white text-3xl self-end mb-6 hover:scale-110 transition-transform duration-200"
              aria-label="Close menu"
            >
              ✕
            </button>

            {/* Sidebar Title */}
            <div className="flex flex-col items-center gap-3 mb-2">
              <img src={ICONS.football} alt="Logo" className="w-[120px] h-12" />

              {/* ✅ Ballsville promo inside sidebar (hide when in Ballsville context) */}
              {!hideBallsville && <BallsvilleLink className="w-full justify-between" />}
            </div>

            {/* Navigation Links */}
            <nav className="flex flex-col gap-4">
              <SidebarLink href="/" icon={ICONS.home} label="Home" onClick={handleCloseSidebar} badge={NAV_BADGES["/"]} />
              <SidebarLink href="/trade" icon={ICONS.trade} label="Trade Analyzer" onClick={handleCloseSidebar} badge={NAV_BADGES["/trade"]} />
              <SidebarLink href="/player-stock/results" icon={ICONS.stock} label="Player Stock" onClick={handleCloseSidebar} badge={NAV_BADGES["/player-stock"]} />
              <SidebarLink href="/player-availability" icon={ICONS.availability} label="Player Availability" onClick={handleCloseSidebar} badge={NAV_BADGES["/player-availability"]} />
              <SidebarLink href="/power-rankings" icon={ICONS.powerrank} label="Power Rankings" onClick={handleCloseSidebar} badge={NAV_BADGES["/power-rankings"]} />
              <SidebarLink href="/sos" icon={ICONS.sos} label="Strength of Schedule" onClick={handleCloseSidebar} badge={NAV_BADGES["/sos"]} />
              <SidebarLink href="/lineup" icon={ICONS.lineup} label="Lineup Optimizer" onClick={handleCloseSidebar} badge={NAV_BADGES["/lineup"]} />
              <SidebarLink href="/draft-pick-tracker" icon={ICONS.draft} label="Draft Monitor" onClick={handleCloseSidebar} badge={NAV_BADGES["/draft-pick-tracker"]} />
            </nav>

            <div className="border-t border-gray-700 my-4" />

            {/* User Info + Logout */}
            {username ? (
              <div className="mt-auto">
                <p className="text-sm text-gray-400 mb-2">
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
