"use client";
import { clearPlayerStockSessionCache } from "../utils/psCache";
import React, { useState } from "react";
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
  powerrank:"/icons/power-icon.png",
  sos:"/icons/sos-icon.png",
  playoff:"/icons/playoff-icon.png",
  lineup:"/icons/lineup-icon.png",

};

export default function Navbar({ pageTitle }) {
  const { username, year, logout } = useSleeper();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const router = useRouter();

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
        {/* Left: Logo + Title (menu button) */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="sm:flex items-center gap-2 text-white text-3xl hover:scale-110 transition-transform duration-200"
            aria-label="Open menu"
          >
            {/* match your old size: w-30 h-12 -> use arbitrary width */}
            <img src={ICONS.football} alt="Menu" className="w-[100px] h-12" />
            <span className="text-lg font-bold"></span>
          </button>
        </div>

        {/* Center Page Title */}
        <h1 className="text-lg sm:text-xl font-bold text-center absolute left-1/2 -translate-x-1/2">
          {pageTitle || "Home"}
        </h1>

        {/* Right: User Info */}
        <div className="flex items-center gap-3">
            {username && (
              <span className="hidden text-white sm:inline text-sm opacity-80">
                {username}{year ? ` · ${year}` : ""}
              </span>
            )}
            {username && (
              <button
                onClick={handleLogout} // <- navigate home on logout
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
          className={`fixed inset-0 z-50 flex ${
            sidebarClosing ? "overlay-fadeOut" : "overlay-fadeIn"
          } backdrop-blur-xl`}
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
            <div className="flex justify-center items-center gap-3 mb-6">
              <img src={ICONS.football} alt="Logo" className="w-[120px] h-12" />
            </div>

            {/* Navigation Links */}
            <nav className="flex flex-col gap-4">
              <Link
                href="/"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center gap-3 hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.home} alt="Home" className="w-8 h-8" /> Home
              </Link>

              <Link
                href="/trade"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center gap-3 hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.trade} alt="Trade" className="w-8 h-8" /> Trade Analyzer
              </Link>

              <Link
                href="/player-stock"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center gap-3 hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.stock} alt="Stock" className="w-8 h-8" /> Player Stock
              </Link>

              <Link
                href="/player-availability"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center gap-3 hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.availability} alt="Availability" className="w-8 h-8" /> Player Availability
              </Link>
              <Link
                href="/power-rankings"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center  hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.powerrank} alt="powerrank" className="w-11 h-11" /> Power Rankings
              </Link>
              <Link
                href="/sos"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center  hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.sos} alt="sos" className="w-9 h-9" /> Strength of Schedule
              </Link>
              <Link
                href="/lineup"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center  hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.lineup} alt="lineup" className="w-9 h-9" /> Lineup Optimizer
              </Link>
              {/* <Link
                href="/playoff-odds"
                className="sidebar-link text-cyan-400 hover:text-blue-200 flex items-center  hover:scale-105 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={ICONS.playoff} alt="playoff-odds" className="w-9 h-9" /> Playoff Predicter
              </Link> */}
              {/* Future features */}
              

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
