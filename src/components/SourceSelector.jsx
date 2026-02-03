"use client";

import React, { useMemo, useState } from "react";

/**
 * Reusable, premium source selector.
 * - Single dropdown for BOTH projections + values
 * - Built-in tiny "icon" badges (no image assets required)
 */

function BadgeIcon({ text }) {
  return (
    <span
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] font-extrabold tracking-wide text-white/80"
      aria-hidden
    >
      {text}
    </span>
  );
}

export const DEFAULT_SOURCES = [
  // Projections
  { key: "proj:espn", type: "projection", label: "ESPN Projections", icon: "ESPN" },
  { key: "proj:cbs", type: "projection", label: "CBS Projections", icon: "CBS" },
  { key: "proj:ffa", type: "projection", label: "FFA Projections", icon: "FFA" },
  // Values
  { key: "val:fantasycalc", type: "value", label: "FantasyCalc", icon: "FC" },
  { key: "val:keeptradecut", type: "value", label: "KeepTradeCut", icon: "KTC" },
  { key: "val:dynastyprocess", type: "value", label: "DynastyProcess", icon: "DP" },
  { key: "val:fantasynav", type: "value", label: "FantasyNav", icon: "FN" },
];

export default function SourceSelector({
  value,
  onChange,
  sources = DEFAULT_SOURCES,
  className = "",
  label = "Source",
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => sources.find((s) => s.key === value) || sources[0],
    [sources, value]
  );

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-xl transition hover:border-white/20 hover:bg-white/7"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BadgeIcon text={selected.icon} />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                {label}
              </div>
              <div className="truncate text-sm font-semibold text-white/90">
                {selected.label}
              </div>
            </div>
          </div>
          <svg
            className={`h-5 w-5 text-white/60 transition ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close source selector"
          />
          <div
            className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur-xl"
            role="listbox"
          >
            <div className="max-h-80 overflow-auto p-2">
              {sources.map((s) => {
                const active = s.key === selected.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/85 hover:bg-white/7"
                    }`}
                    onClick={() => {
                      onChange?.(s);
                      setOpen(false);
                    }}
                  >
                    <BadgeIcon text={s.icon} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {s.label}
                      </div>
                      <div className="text-[11px] text-white/45">
                        {s.type === "projection" ? "Projections" : "Values"}
                      </div>
                    </div>
                    {active && (
                      <svg
                        className="h-5 w-5 text-white/70"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 5.29a1 1 0 010 1.414l-7.778 7.778a1 1 0 01-1.414 0L3.296 10.27a1 1 0 011.414-1.414l3.095 3.095 7.07-7.07a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

