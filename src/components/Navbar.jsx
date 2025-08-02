import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useSleeper } from "../context/SleeperContext";

export default function Navbar({ pageTitle }) {
  const { username, year, logout } = useSleeper();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);

  const handleCloseSidebar = () => {
    setSidebarClosing(true);
    setTimeout(() => {
      setSidebarClosing(false);
      setSidebarOpen(false);
    }, 300);
  };

  return (
    <>
      {/* Top Bar */}
      <nav className="fixed top-0 left-0 w-full bg-gray-900 text-white px-4 sm:px-6 py-4 flex justify-between items-center shadow-lg z-50">
        {/* Left side: Menu */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-white text-3xl"
          >
            ☰
          </button>
        </div>

        {/* Center: Dynamic Page Title */}
        <h1 className="text-xl sm:text-2xl font-bold text-center absolute left-1/2 transform -translate-x-1/2">
          {pageTitle || "The Fantasy Arsenal"}
        </h1>

        {/* Right: Logged-in info */}
        {username && (
          <span className="hidden sm:inline text-gray-300 text-sm">
            {username} ({year})
          </span>
        )}
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
            className={`bg-gray-900/85 w-72 h-full p-6 flex flex-col gap-6 shadow-xl neon-glow ${
              sidebarClosing ? "animate-slideOut" : "animate-slideIn"
            }`}
          >
            {/* Close Button */}
            <button
              onClick={handleCloseSidebar}
              className="text-white text-3xl self-end mb-6"
            >
              ✕
            </button>

            {/* Sidebar Title */}
            <h2 className="text-2xl font-bold mb-6 text-center text-blue-400">
              The Fantasy Arsenal
            </h2>

            {/* Navigation Links */}
            <nav className="flex flex-col gap-4">
              <Link to="/" className="sidebar-link" onClick={handleCloseSidebar}>
                Home
              </Link>
              <Link to="/trade" className="sidebar-link" onClick={handleCloseSidebar}>
                Trade Analyzer
              </Link>
              <Link to="/player-stock" className="sidebar-link" onClick={handleCloseSidebar}>
                Player Stock
              </Link>
              <Link to="/player-availability" className="sidebar-link" onClick={handleCloseSidebar}>
                Player Availability
              </Link>
            </nav>

            <div className="border-t border-gray-700 my-4"></div>

            {/* User Info + Logout */}
            {username ? (
              <div className="mt-auto">
                <p className="text-sm text-gray-400 mb-2">
                  Logged in as <span className="font-bold">{username}</span> ({year})
                </p>
                <button
                  onClick={logout}
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
