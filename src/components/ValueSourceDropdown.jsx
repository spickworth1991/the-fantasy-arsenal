// Valusesourcedropdown.jsx

"use client";
import { useEffect, useRef, useState } from "react";

const ICONS = {
  TheFantasyArsenal: "/icons/TFA.png",
  FantasyCalc: "/icons/fantasycalc-logo.png",
  DynastyProcess: "/icons/dp-logo.png",
  KeepTradeCut: "/icons/ktc-logo.png",
  FantasyNavigator: "/icons/fantasynav-logo.png", // square
  IDynastyP: "/icons/idp-logo.png",
};

const LABELS = {
  TheFantasyArsenal: "The Fantasy Arsenal",
  FantasyCalc: "FantasyCalc",
  DynastyProcess: "DynastyProcess",
  KeepTradeCut: "KeepTradeCut",
  FantasyNavigator: "FantasyNavigator",
  IDynastyP: "IDynastyP",
};

// Per-brand sizes: "button" = closed control; "menu" = options in dropdown
const ICON_SIZES = {
  button: {
    TheFantasyArsenal:{ w: 100, h: 10 }, 
    FantasyCalc:      { w: 64, h: 28 },
    DynastyProcess:   { w: 84, h: 28 },
    KeepTradeCut:     { w: 95, h: 28 },
    FantasyNavigator: { w: 20,  h: 20 }, // square
    IDynastyP:        { w: 60, h: 20 },
  },
  menu: {
    TheFantasyArsenal:{ w: 75, h: 20 },
    FantasyCalc:      { w: 75,  h: 21 },
    DynastyProcess:   { w: 120,  h: 21 },
    KeepTradeCut:     { w: 120,  h: 21 },
    FantasyNavigator: { w: 21,  h: 21 }, // square
    IDynastyP:        { w: 82,  h: 21 },
  },
};

function useClickAway(ref, onAway) {
  useEffect(() => {
    const handler = (e) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) onAway?.();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onAway]);
}

const SHOW_TEXT = (key) => key === "FantasyNavigator";

export default function ValueSourceDropdown({ valueSource, setValueSource }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useClickAway(wrapRef, () => setOpen(false));

  const btnSize = ICON_SIZES.button[valueSource] ?? { w: 100, h: 28 };

  return (
    <div ref={wrapRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg border border-white/10"
      >
        {/* Selected logo */}
        {ICONS[valueSource] && (
          <img
            src={ICONS[valueSource]}
            alt={`${LABELS[valueSource]} logo`}
            width={btnSize.w}
            height={btnSize.h}
            className="object-contain"
            loading="lazy"
          />
        )}
        {/* Only FantasyNavigator shows visible text */}
        {SHOW_TEXT(valueSource) ? (
          <span className="ml-2 whitespace-nowrap">{LABELS[valueSource]}</span>
        ) : (
          <span className="sr-only">{LABELS[valueSource]}</span>
        )}
        <svg width="16" height="16" viewBox="0 0 24 24" className="ml-2 opacity-70">
          <path fill="currentColor" d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-20 mt-2 w-64 rounded-lg border border-white/10 bg-opacity-95 bg-[#0e304e] shadow-lg p-1"
        >
          {Object.keys(LABELS).map((opt) => {
            const size = ICON_SIZES.menu[opt] ?? { w: 80, h: 20 };
            return (
              <button
                key={opt}
                role="option"
                aria-selected={opt === valueSource}
                onClick={() => {
                  setValueSource(opt);
                  setOpen(false);
                }}
                className={`w-full flex items-center px-3 py-2 rounded-md hover:bg-white/10 ${
                  opt === valueSource ? "bg-white/10" : ""
                }`}
              >
                <img
                  src={ICONS[opt]}
                  alt={`${LABELS[opt]} logo`}
                  width={size.w}
                  height={size.h}
                  className="object-contain shrink-0"
                  loading="lazy"
                />
                {/* Only FantasyNavigator shows visible text in the menu */}
                {SHOW_TEXT(opt) ? (
                  <span className="ml-3 text-sm">{LABELS[opt]}</span>
                ) : (
                  <span className="sr-only">{LABELS[opt]}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
