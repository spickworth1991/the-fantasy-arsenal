"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HINTS = {
  "neutral week": "The season projection divided across active, non-bye weeks before this opponent and game environment are applied.",
  "neutral baseline": "The expected weekly score before opponent and game-specific adjustments are applied.",
  "weekly outcome": "The model's description of this week's simulated range, based on unusually high and low outcome probabilities.",
  "matchup change": "Fantasy points added to or removed from the neutral-week estimate by this matchup and game environment.",
  confidence: "How complete and internally consistent the model evidence is. It is not the probability that the exact projection will occur.",
  "vs externalsource consensus": "The Arsenal season projection minus the average from compatible outside publishers. Positive means Arsenal is higher.",
  "historical regression": "How strongly prior results inform the estimate after small samples are pulled toward a broader baseline.",
  "historical player blend": "The share of the player estimate informed by prior observed games after recent-role and small-sample safeguards are applied.",
  "correlated game simulation": "A simulation where teammates and opponents move together with the same game environment instead of being modeled independently.",
  "offensive index": "Team production relative to league average. A score of 100 is average; 110 is about 10% above it.",
  "defense index": "Points allowed relative to league average for the position. Higher is generally a more favorable fantasy matchup.",
  "floor  ceiling": "The 10th- and 90th-percentile outcomes—not guaranteed minimum and maximum scores.",
  volatility: "How widely weekly results move around the player's average. Higher means a less predictable range.",
  consistency: "A stability score based on weekly variation relative to average production. Higher is steadier, not necessarily better.",
  mae: "Mean Absolute Error: the average absolute distance between projection and result. Lower is better.",
  rmse: "Root Mean Squared Error: an accuracy measure that penalizes large misses more heavily than MAE. Lower is better.",
  p10: "The 10th-percentile simulation: about 10% of modeled outcomes finish below this number and 90% above it.",
  median: "The 50th-percentile simulation: half of modeled outcomes finish above it and half below it.",
  p90: "The 90th-percentile simulation: about 10% of modeled outcomes finish above this number.",
  epa: "Expected Points Added estimates how much a play changes an NFL team's expected scoring. It is not fantasy points.",
  "role confidence": "Reliability of the projected workload allocation based on usage, depth-chart, and team-volume evidence.",
  "opponent adjustment": "A bounded change built from positional volume, efficiency, touchdowns, turnovers, and opponent history.",
  "workload prior": "The starting expectation for a player's share of team opportunities before newer role evidence adjusts it.",
};

const keyOf = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export default function DelayedStatHint({ term, hint, children }) {
  const text = hint || HINTS[keyOf(term)];
  const id = useId();
  const anchorRef = useRef(null);
  const timerRef = useRef(null);
  const [tip, setTip] = useState(null);
  const close = () => { clearTimeout(timerRef.current); setTip(null); };
  const open = (delay) => {
    if (!text) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.max(
        12,
        Math.min(
          window.innerWidth - width - 12,
          rect.left + rect.width / 2 - width / 2,
        ),
      );
      const openAbove = rect.bottom + 150 > window.innerHeight && rect.top > 150;
      setTip(
        openAbove
          ? { width, left, bottom: window.innerHeight - rect.top + 10, placement: "above" }
          : { width, left, top: rect.bottom + 10, placement: "below" },
      );
    }, delay);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);
  if (!text) return children;
  const tooltip = tip && typeof document !== "undefined"
    ? createPortal(
        <span
          id={id}
          role="tooltip"
          data-placement={tip.placement}
          className="pointer-events-none fixed z-[9999] rounded-xl border border-cyan-200/20 bg-slate-900 px-3 py-2.5 text-left text-[11px] font-medium normal-case leading-5 tracking-normal text-white/80 shadow-[0_18px_55px_rgba(0,0,0,.75)]"
          style={{ width:tip.width, left:tip.left, top:tip.top, bottom:tip.bottom }}
        >
          {text}
        </span>,
        document.body,
      )
    : null;
  return <span className="inline-flex items-center gap-1"><span ref={anchorRef} tabIndex={0} aria-describedby={tip ? id : undefined} onPointerEnter={() => open(700)} onPointerLeave={close} onFocus={() => open(350)} onBlur={close} className="cursor-help underline decoration-dotted decoration-white/30 underline-offset-2 outline-none focus:text-cyan-100">{children}</span><span aria-hidden className="text-[8px] font-black normal-case tracking-normal text-cyan-200/45">?</span>{tooltip}</span>;
}
