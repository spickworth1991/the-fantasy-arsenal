"use client";
import { useState } from "react";

const ICONS = {
  FantasyCalc: "/icons/fantasycalc-logo.png",
  DynastyProcess: "/icons/dp-logo.png",
  KeepTradeCut: "/icons/ktc-logo.png",
  FantasyNavigator: "/icons/fantasynav-logo.png",
  IDynastyP: "/icons/idp-logo.png", // if present; otherwise remove this line
};

const LABELS = {
  FantasyCalc: "FantasyCalc",
  DynastyProcess: "DynastyProcess",
  KeepTradeCut: "KeepTradeCut",
  FantasyNavigator: "FantasyNavigator",
  IDynastyP: "IDynastyP",
};

export default function ValueSourceDropdown({ valueSource, setValueSource }) {
  const [open, setOpen] = useState(false);

  const options = Object.keys(LABELS);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg"
      >
        {ICONS[valueSource] && (
          <img src={ICONS[valueSource]} alt="" className="h-5 w-5 rounded-sm" />
        )}
        <span>{LABELS[valueSource]}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" className="opacity-70">
          <path fill="currentColor" d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-20 mt-2 w-56 rounded-lg border border-white/10 bg-[#0b0b0b] shadow-lg p-1"
          onMouseLeave={() => setOpen(false)}
        >
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                setValueSource(opt);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-white/10 ${
                opt === valueSource ? "bg-white/10" : ""
              }`}
            >
              {ICONS[opt] && <img src={ICONS[opt]} alt="" className="h-5 w-5 rounded-sm" />}
              <span>{LABELS[opt]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
