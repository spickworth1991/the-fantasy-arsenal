// src/components/SourceSelector.jsx
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
 *
 * Updated:
 * - Logo-first UI (no big name row beside it)
 * - "Projections" / "Values" sits UNDER the logo block
 * - SHOW_TEXT behavior restored for logos that need it (renders like part of the logo)
 * - Dropdown width auto-sizes to the widest option needed
 */

/** ========== Logos ========== */
const ICONS = {
  FantasyCalc: "/icons/fantasycalc-logo.png",
  DynastyProcess: "/icons/dp-logo.png",
  KeepTradeCut: "/icons/ktc-logo.png",
  FantasyNavigator: "/icons/fantasynav-logo.png",
  IDynastyP: "/icons/idp-logo.png",

  FFA: "/icons/ffa-logo.jpg",
  ESPN: "/icons/espn-logo.png",
  CBS: "/icons/cbs-logo.png",
};

const LABELS = {
  FantasyCalc: "FantasyCalc",
  DynastyProcess: "DynastyProcess",
  KeepTradeCut: "KeepTradeCut",
  FantasyNavigator: "FantasyNavigator",
  IDynastyP: "IDynastyP",

  FFA: "FFA Projections",
  ESPN: "ESPN Projections",
  CBS: "CBS Projections",
};

// Per-brand sizes: "button" = closed control; "menu" = options in dropdown
const ICON_SIZES = {
  button: {
    FantasyCalc: { w: 112, h: 28 },
    DynastyProcess: { w: 164, h: 28 },
    KeepTradeCut: { w: 136, h: 28 },
    FantasyNavigator: { w: 48, h: 20 }, // square
    IDynastyP: { w: 60, h: 20 },

    ESPN: { w: 112, h: 28 },
    CBS: { w: 112, h: 28 },
    FFA: { w: 48, h: 24 },
  },
  menu: {
    FantasyCalc: { w: 112, h: 21 },
    DynastyProcess: { w: 128, h: 21 },
    KeepTradeCut: { w: 136, h: 21 },
    FantasyNavigator: { w: 48, h: 21 }, // square
    IDynastyP: { w: 140, h: 28 },

    ESPN: { w: 112, h: 24 },
    CBS: { w: 112, h: 28 },
    FFA: { w: 112, h: 24 },
  },
};

// Only some logos need visible text; render it like part of the logo/wordmark
const SHOW_TEXT = (key) => key === "FantasyNavigator";

/** ========== Defaults ========== */
export const DEFAULT_SOURCES = [
  

  {
    key: "val:fantasycalc",
    type: "value",
    label: "FantasyCalc",
    logoKey: "FantasyCalc",
    supports: { dynasty: true, redraft: true, qbToggle: true },
  },
  {
    key: "val:keeptradecut",
    type: "value",
    label: "KeepTradeCut",
    logoKey: "KeepTradeCut",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
  {
    key: "val:dynastyprocess",
    type: "value",
    label: "DynastyProcess",
    logoKey: "DynastyProcess",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },
  {
    key: "val:fantasynav",
    type: "value",
    label: "FantasyNav",
    logoKey: "FantasyNavigator",
    supports: { dynasty: true, redraft: true, qbToggle: true },
  },
  {
    key: "val:idynastyp",
    type: "value",
    label: "IDynastyP",
    logoKey: "IDynastyP",
    supports: { dynasty: true, redraft: false, qbToggle: true },
  },

  { key: "proj:espn", type: "projection", label: "ESPN Projections", logoKey: "ESPN" },
  { key: "proj:cbs", type: "projection", label: "CBS Projections", logoKey: "CBS" },
  { key: "proj:ffa", type: "projection", label: "FFA Projections", logoKey: "FFA" },
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
  const supports = selected?.supports || {
    dynasty: false,
    redraft: false,
    qbToggle: false,
  };

  const showMode = !!supports?.dynasty || !!supports?.redraft;
  const showQB = !!supports?.qbToggle;

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
              <SegButton active={qb === "sf"} onClick={() => onQbTypeChange?.("sf")}>
                SF
              </SegButton>
              <SegButton active={qb === "1qb"} onClick={() => onQbTypeChange?.("1qb")}>
                1QB
              </SegButton>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 text-[11px] text-white/45">
        These settings apply to{" "}
        <span className="text-white/70 font-semibold">value-based</span> rankings only.
      </div>
    </div>
  );
}

/**
 * Logo block:
 * - renders logo
 * - optional "wordmark text" that feels attached to the logo
 * - SR-only label for accessibility
 */
function LogoOnly({ source, variant }) {
  const logoKey = source?.logoKey;
  const src = logoKey ? ICONS[logoKey] : null;

  const size =
    (variant === "menu" ? ICON_SIZES.menu[logoKey] : ICON_SIZES.button[logoKey]) || {
      w: 90,
      h: 24,
    };

  const showText = !!logoKey && SHOW_TEXT(logoKey);

  return (
    <div className="flex items-center justify-center gap-2">
      {src ? (
        <img
          src={src}
          alt={`${LABELS[logoKey] || source?.label || "Source"} logo`}
          width={size.w}
          height={size.h}
          className="object-contain shrink-0"
          loading="lazy"
        />
      ) : null}

      {/* "part-of-logo" wordmark text */}
      {showText ? (
        <span className="text-sm font-semibold tracking-wide text-white/85 leading-none">
          {LABELS[logoKey] || source?.label}
        </span>
      ) : (
        <span className="sr-only">{LABELS[logoKey] || source?.label}</span>
      )}
    </div>
  );
}

function getLogoBlockWidthPx(sources, variant) {
  // Base overhead: left padding inside the row + tiny breathing room
  // Also include checkmark area on the right of the row
  const ROW_SIDE_PADDING = 24; // px (px-3)
  const CHECKMARK_SPACE = 28; // px
  const GAP_BETWEEN_LOGO_AND_CHECK = 12; // px

  // Extra width if SHOW_TEXT is enabled (approx; makes menu snug but safe)
  const SHOW_TEXT_EXTRA = 92; // px (wordmark width-ish for "FantasyNavigator")

  let maxLogo = 0;

  for (const s of sources || []) {
    const k = s?.logoKey;
    if (!k) continue;

    const sz =
      (variant === "menu" ? ICON_SIZES.menu[k] : ICON_SIZES.button[k]) || { w: 90, h: 24 };

    const w = sz.w + (SHOW_TEXT(k) ? SHOW_TEXT_EXTRA : 0);
    if (w > maxLogo) maxLogo = w;
  }

  // add a bit to cover the "Values/Projections" line and layout
  const STACK_PADDING = 10;

  return Math.ceil(maxLogo + STACK_PADDING + ROW_SIDE_PADDING + GAP_BETWEEN_LOGO_AND_CHECK + CHECKMARK_SPACE);
}

export default function SourceSelector({
  value,
  onChange,
  sources = DEFAULT_SOURCES,
  className = "",
  label = "Source",

  mode = "dynasty",
  qbType = "sf",
  onModeChange,
  onQbTypeChange,
  showToggles = true,
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef(null);

  const [rect, setRect] = useState({ left: 0, top: 0, width: 320 });

  const selected = useMemo(() => {
    const v = typeof value === "string" ? value : value?.key;
    return sources.find((s) => s.key === v) || sources[0];
  }, [sources, value]);

  useEffect(() => setMounted(true), []);

  const measure = () => {
    const el = btnRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const padding = 12;

    // auto-size: only as wide as the widest logo block needed
    const neededMenuW = getLogoBlockWidthPx(sources, "menu");

    // keep it sane on small screens
    const maxW = Math.min(560, window.innerWidth - padding * 2);
    const width = clamp(neededMenuW, 220, maxW);

    const left = clamp(r.left, padding, window.innerWidth - width - padding);
    const top = r.bottom + 8;

    setRect({ left, top, width });
  };

  useEffect(() => {
    if (!open) return;

    measure();

    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sources]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const menu = open ? (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[99998] cursor-default"
        onClick={() => setOpen(false)}
        aria-label="Close source selector"
      />

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
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                  active ? "bg-white/10 text-white" : "text-white/85 hover:bg-white/7"
                }`}
                onClick={() => {
                  onChange?.(s.key);
                  setOpen(false);
                }}
              >
                <div className="flex items-center gap-3">
                  {/* logo stacked with type */}
                  <div className="flex flex-col items-center justify-center">
                    <LogoOnly source={s} variant="menu" />
                    <div className="mt-1 text-center text-[11px] text-white/45">
                      {s.type === "projection" ? "Projections" : "Values"}
                    </div>
                  </div>

                  {/* keep label hidden but accessible */}
                  <span className="sr-only">{s.label}</span>
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
  ) : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open) measure();
          setOpen((v) => !v);
        }}
        className="group w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-xl transition hover:border-white/20 hover:bg-white/7"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* logo stacked with type */}
            <div className="flex flex-col items-center justify-center">
              <LogoOnly source={selected} variant="button" />
              <div className="mt-1 text-center text-[11px] text-white/45">
                {selected.type === "projection" ? "Projections" : "Values"}
              </div>
            </div>

            {/* keep label hidden but accessible */}
            <div className="sr-only">
              <div>{label}</div>
              <div>{selected.label}</div>
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

      {showToggles ? (
        <InlineToggles
          selected={selected}
          mode={mode}
          qbType={qbType}
          onModeChange={onModeChange}
          onQbTypeChange={onQbTypeChange}
        />
      ) : null}

      {mounted && open ? createPortal(menu, document.body) : null}
    </div>
  );
}
