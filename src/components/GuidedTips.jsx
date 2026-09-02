"use client";

import { useEffect, useRef, useState } from "react";

export default function GuidedTips({ steps = [], storageKey, label = "Tips" }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [arrow, setArrow] = useState(null);
  const [targetVersion, setTargetVersion] = useState(0);
  const panelRef = useRef(null);
  const current = steps[step];
  const findCurrentTarget = () => {
    const selector = current?.selector || `[data-guide-tip="${current?.target}"]`;
    const matches = [...document.querySelectorAll(selector)];
    return matches.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || matches[0] || null;
  };

  useEffect(() => {
    try {
      const enabled = localStorage.getItem(`${storageKey}:enabled`) !== "false";
      const seen = localStorage.getItem(`${storageKey}:seen`) === "true";
      if (enabled && !seen && steps.length) setOpen(true);
    } catch {}
  }, [steps.length, storageKey]);

  useEffect(() => {
    if (!open) return;
    const cleanup = current?.onEnter?.();
    const timer = setTimeout(() => setTargetVersion((value) => value + 1), 80);
    return () => {
      clearTimeout(timer);
      if (typeof cleanup === "function") cleanup();
    };
  }, [open, step]);

  useEffect(() => {
    if (!open || (!current?.target && !current?.selector)) return;
    const target = findCurrentTarget();
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("relative", "z-[93]", "rounded-2xl", "ring-2", "ring-cyan-300", "ring-offset-4", "ring-offset-slate-950");
    return () => target.classList.remove("relative", "z-[93]", "rounded-2xl", "ring-2", "ring-cyan-300", "ring-offset-4", "ring-offset-slate-950");
  }, [current?.selector, current?.target, open, targetVersion]);

  useEffect(() => {
    if (!open || (!current?.target && !current?.selector)) return;
    let timer;
    const measure = () => {
      const target = findCurrentTarget();
      const panel = panelRef.current;
      if (!target || !panel) return setArrow(null);
      const targetRect = target.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      setArrow({
        fromX: panelRect.left + panelRect.width / 2,
        fromY: panelRect.top - 8,
        toX: Math.max(24, Math.min(window.innerWidth - 24, targetRect.left + Math.min(targetRect.width / 2, 220))),
        toY: Math.max(24, Math.min(panelRect.top - 44, targetRect.top + Math.min(targetRect.height / 2, 70))),
        targetX: Math.max(0, targetRect.left - 8),
        targetY: Math.max(0, targetRect.top - 8),
        targetWidth: Math.min(window.innerWidth, targetRect.width + 16),
        targetHeight: Math.min(window.innerHeight, targetRect.height + 16),
      });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(measure, 80); };
    measure();
    timer = setTimeout(measure, 500);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule); };
  }, [current?.selector, current?.target, open, targetVersion]);

  const close = (disable = false) => {
    setOpen(false);
    setStep(0);
    try {
      localStorage.setItem(`${storageKey}:seen`, "true");
      if (disable) localStorage.setItem(`${storageKey}:enabled`, "false");
    } catch {}
  };

  if (!steps.length) return null;
  const markerId = `guide-arrow-${String(storageKey).replace(/[^a-z0-9]/gi, "-")}`;
  const maskId = `${markerId}-mask`;

  return (
    <>
      <button type="button" onClick={() => { setStep(0); setOpen(true); }} className="fixed bottom-5 right-5 z-[70] rounded-full border border-cyan-300/25 bg-slate-950/95 px-4 py-3 text-xs font-black text-cyan-100 shadow-2xl backdrop-blur hover:bg-cyan-300/10" aria-label={`Open ${label.toLowerCase()}`}>
        ? {label}
      </button>
      {open ? <>
        <svg className="pointer-events-none fixed inset-0 z-[80] h-full w-full" aria-hidden>
          <defs><mask id={maskId}><rect width="100%" height="100%" fill="white" />{arrow ? <rect x={arrow.targetX} y={arrow.targetY} width={arrow.targetWidth} height={arrow.targetHeight} rx="18" fill="black" /> : null}</mask></defs>
          <rect width="100%" height="100%" fill="rgba(2,6,23,.62)" mask={`url(#${maskId})`} />
        </svg>
        {arrow ? <svg className="pointer-events-none fixed inset-0 z-[105] h-full w-full" aria-hidden><defs><marker id={markerId} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="rgb(103 232 249)" /></marker></defs><path d={`M ${arrow.fromX} ${arrow.fromY} Q ${(arrow.fromX + arrow.toX) / 2 + 36} ${(arrow.fromY + arrow.toY) / 2} ${arrow.toX} ${arrow.toY}`} fill="none" stroke="rgba(103,232,249,.9)" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 7" markerEnd={`url(#${markerId})`} className="animate-pulse" /></svg> : null}
        <div ref={panelRef} className="fixed inset-x-4 bottom-32 z-[110] mx-auto max-w-lg rounded-[26px] border border-cyan-100/45 bg-[#26364f] p-5 shadow-[0_30px_100px_rgba(0,0,0,.9),0_0_40px_rgba(34,211,238,.18)] sm:bottom-16 sm:p-6" role="dialog" aria-modal="true" aria-label={label}>
          <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-100/75">{label} · {step + 1} of {steps.length}</div><h2 className="mt-1 text-xl font-black text-white">{current.title}</h2></div><button type="button" onClick={() => close(false)} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75 hover:bg-white/[0.09]">Close</button></div>
          <p className="mt-3 text-sm leading-6 text-white/75">{current.detail}</p>
          <div className="mt-5 flex items-center gap-2"><button type="button" disabled={!step} onClick={() => setStep((value) => Math.max(0, value - 1))} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/65 disabled:opacity-25">Back</button><button type="button" onClick={() => step === steps.length - 1 ? close(false) : setStep((value) => value + 1)} className="flex-1 rounded-xl bg-cyan-300/15 px-4 py-2.5 text-xs font-black text-cyan-100 hover:bg-cyan-300/20">{step === steps.length - 1 ? "Done" : "Next tip"}</button><button type="button" onClick={() => close(true)} className="rounded-xl px-3 py-2.5 text-[10px] font-bold text-white/40 hover:text-white/70">Turn tips off</button></div>
        </div>
      </> : null}
    </>
  );
}
