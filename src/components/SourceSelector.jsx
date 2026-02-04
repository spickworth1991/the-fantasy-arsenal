"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Reusable, premium source selector.
 * - Single dropdown for BOTH projections + values
 * - Optional attached toggles for:
 *   - Mode: dynasty / redraft
 *   - QB: sf / 1qb
 * - Uses a Portal so the menu is NEVER trapped behind stacking contexts
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

  // Values (supports mode + qb toggles by default)
  {
    key: "val:fantasycalc",
    type: "value",
    label: "FantasyCalc",
    icon: "FC",
    supports: { dynasty: true, redraft: true, qbToggle: true },
  },
  {
    key: "val:keeptradecut",
    type: "value",
    label: "KeepTradeCut",
    icon: "KTC",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
  {
    key: "val:dynastyprocess",
    type: "value",
    label: "DynastyProcess",
    icon: "DP",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
  {
    key: "val:fantasynav",
    type: "value",
    label: "FantasyNav",
    icon: "FN",
    supports: { dynasty: true, redraft: true, qbToggle: true },
  },
  {
    key: "val:idynastyp",
    type: "value",
    label: "iDynastyP",
    icon: "IDP",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function SegButton({ active, disabled, children, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "px-3 py-2 text-xs rounded-lg transition whitespace-nowrap",
        disabled ? "opacity-40 cursor-not-allowed" : "",
        active
          ? "bg-cyan-500/20 text-cyan-100 border border-cyan-400/30"
          : "text-white/70 hover:text-white hover:bg-white/5",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function InlineToggles({
  selected,
  mode,
  qbType,
  onModeChange,
  onQbTypeChange,
  className = "",
}) {
  const supports = selected?.supports || { dynasty: false, redraft: false, qbToggle: false };

  const showMode = !!supports?.dynasty || !!supports?.redraft;
  const showQB = !!supports?.qbToggle;

  // if a selected value source does NOT support current mode, auto-fix to a valid mode
  useEffect(() => {
    if (!selected || selected.type !== "value") return;
    if (!showMode) return;

    const m = String(mode || "dynasty").toLowerCase();
    if (m === "redraft" && !supports.redraft && supports.dynasty) onModeChange?.("dynasty");
    if (m === "dynasty" && !supports.dynasty && supports.redraft) onModeChange?.("redraft");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key]);

  if (!selected || selected.type !== "value") return null;
  if (!showMode && !showQB) return null;

  const m = String(mode || "dynasty").toLowerCase();
  const qb = String(qbType || "sf").toLowerCase();

  return (
    <div className={["mt-2 rounded-2xl border border-white/10 bg-black/20 p-3", className].join(" ")}>
      <div className="flex flex-wrap items-center gap-2">
        {showMode && (
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/50 mr-1">
              Mode
            </div>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1 backdrop-blur">
              <SegButton
                active={m === "dynasty"}
                disabled={!supports.dynasty}
                onClick={() => onModeChange?.("dynasty")}
              >
                Dynasty
              </SegButton>
              <SegButton
                active={m === "redraft"}
                disabled={!supports.redraft}
                onClick={() => onModeChange?.("redraft")}
              >
                Redraft
              </SegButton>
            </div>
          </div>
        )}

        {showQB && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/50 mr-1">
              QB
            </div>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1 backdrop-blur">
              <SegButton
                active={qb === "sf"}
                onClick={() => onQbTypeChange?.("sf")}
              >
                SF
              </SegButton>
              <SegButton
                active={qb === "1qb"}
                onClick={() => onQbTypeChange?.("1qb")}
              >
                1QB
              </SegButton>
            </div>
          </div>
        )}
      </div>

      {/* small helper line */}
      <div className="mt-2 text-[11px] text-white/45">
        These settings apply to <span className="text-white/70 font-semibold">value-based</span> rankings only.
      </div>
    </div>
  );
}

export default function SourceSelector({
  value,
  onChange,
  sources = DEFAULT_SOURCES,
  className = "",
  label = "Source",

  // NEW: attach mode/qb toggles
  mode = "dynasty", // dynasty | redraft
  qbType = "sf", // sf | 1qb
  onModeChange,
  onQbTypeChange,
  showToggles = true,
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef(null);

  // fixed-position rect for the portal menu
  const [rect, setRect] = useState({ left: 0, top: 0, width: 320 });

  const selected = useMemo(() => {
    const v = typeof value === "string" ? value : value?.key;
    return sources.find((s) => s.key === v) || sources[0];
  }, [sources, value]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const measure = () => {
    const el = btnRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const padding = 12;
    const menuMaxW = 520;

    const width = clamp(r.width, 240, menuMaxW);
    const left = clamp(r.left, padding, window.innerWidth - width - padding);
    const top = r.bottom + 8;

    setRect({ left, top, width });
  };

  useEffect(() => {
    if (!open) return;

    measure();

    const onResize = () => measure();
    const onScroll = () => measure(); // catches scroll containers too
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true); // capture for nested scroll

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // close on escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const menu = open ? (
    <>
      {/* click-away overlay (PORTAL) */}
      <button
        type="button"
        className="fixed inset-0 z-[99998] cursor-default"
        onClick={() => setOpen(false)}
        aria-label="Close source selector"
      />

      {/* menu (PORTAL) */}
      <div
        className="fixed z-[99999] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur-xl"
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
        }}
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
                  active ? "bg-white/10 text-white" : "text-white/85 hover:bg-white/7"
                }`}
                onClick={() => {
                  onChange?.(s.key); // send key string
                  setOpen(false);
                }}
              >
                <BadgeIcon text={s.icon} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{s.label}</div>
                  <div className="text-[11px] text-white/45">
                    {s.type === "projection" ? "Projections" : "Values"}
                  </div>
                </div>
                {active && (
                  <svg className="h-5 w-5 text-white/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
  ) : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          // measure BEFORE opening so first paint is correct
          if (!open) measure();
          setOpen((v) => !v);
        }}
        className="group w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-xl transition hover:border-white/20 hover:bg-white/7"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BadgeIcon text={selected.icon} />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/50">{label}</div>
              <div className="truncate text-sm font-semibold text-white/90">{selected.label}</div>
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

      {/* NEW: attached mode / qb toggles */}
      {showToggles ? (
        <InlineToggles
          selected={selected}
          mode={mode}
          qbType={qbType}
          onModeChange={onModeChange}
          onQbTypeChange={onQbTypeChange}
        />
      ) : null}

      {/* Portal render */}
      {mounted && open ? createPortal(menu, document.body) : null}
    </div>
  );
}
