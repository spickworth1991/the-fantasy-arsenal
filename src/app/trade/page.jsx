"use client";

import Navbar from "../../components/Navbar";
import TradeAnalyzer from "./TradeAnalyzer.jsx";
import TradeFinder from "./TradeFinder.jsx";

export default function TradePage() {
  return (
    <>
      <Navbar pageTitle="Trade Analyzer" />
      {/* spacer for fixed navbar height */}
      <div aria-hidden className="h-[50px]" />
      <main>
        <div className="max-w-6xl mx-auto px-4">
          <TradeAnalyzer />
          <TradeFinder />
        </div>
      </main>
    </>
  );
}
