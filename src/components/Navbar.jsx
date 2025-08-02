import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSleeper } from "../context/SleeperContext";

// ✅ Import PNG Icons
import FootballIcon from "../assets/icons/football-icon.png";
import HomeIcon from "../assets/icons/home-icon.png";
import TradeIcon from "../assets/icons/trade-icon.png";
import StockIcon from "../assets/icons/stock-icon.png";
import AvailabilityIcon from "../assets/icons/availability-icon.png";

export default function Navbar({ pageTitle }) {
  const { username, year, logout } = useSleeper();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const navigate = useNavigate();

  const handleCloseSidebar = () => {
    setSidebarClosing(true);
    setTimeout(() => {
      setSidebarClosing(false);
      setSidebarOpen(false);
    }, 300);
  };

  const handleLogout = () => {
    logout();
    handleCloseSidebar();
    navigate("/"); // ✅ redirect to homepage
  };

  return (
    <>
      {/* ✅ Top Bar */}
      <nav className="fixed top-0 left-0 w-full bg-gray-900 text-white px-4 sm:px-6 py-4 flex justify-between items-center shadow-lg z-50">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="sm:flex items-center gap-2 text-white text-3xl hover:scale-110 transition-transform duration-200"
          >
            <img src={FootballIcon} alt="Menu" className="w-30 h-12" />
            <span className="text-lg font-bold"></span>
          </button>
        </div>

        {/* ✅ Center Page Title */}
        <h1 className="text-lg sm:text-xl font-bold text-center absolute left-1/2 transform -translate-x-1/2">
          {pageTitle || "Home"}
        </h1>

        {/* ✅ Right: User Info */}
        {username && (
          <span className="sm:inline text-gray-300 text-sm">
            {username} ({year})
          </span>
        )}
      </nav>

      {/* ✅ Sidebar Overlay */}
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
            >
              ✕
            </button>

            {/* Sidebar Title */}
            <div className="flex justify-center items-center gap-3 mb-6">
              <img src={FootballIcon} alt="Logo" className="w-30 h-12" />
          
            </div>

            {/* ✅ Navigation Links */}
            <nav className="flex flex-col gap-4">
              <Link
                to="/"
                className="sidebar-link flex items-center gap-3 hover:scale-105 hover:text-blue-400 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={HomeIcon} alt="Home" className="w-8 h-8" /> Home
              </Link>
              <Link
                to="/trade"
                className="sidebar-link flex items-center gap-3 hover:scale-105 hover:text-blue-400 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={TradeIcon} alt="Trade" className="w-8 h-8" /> Trade Analyzer
              </Link>
              <Link
                to="/player-stock"
                className="sidebar-link flex items-center gap-3 hover:scale-105 hover:text-blue-400 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={StockIcon} alt="Stock" className="w-8 h-8" /> Player Stock
              </Link>
              <Link
                to="/player-availability"
                className="sidebar-link flex items-center gap-3 hover:scale-105 hover:text-blue-400 transition-transform duration-200"
                onClick={handleCloseSidebar}
              >
                <img src={AvailabilityIcon} alt="Availability" className="w-8 h-8" /> Player Availability
              </Link>
            </nav>

            <div className="border-t border-gray-700 my-4"></div>

            {/* ✅ User Info + Logout */}
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
