"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function LeagueSearchSelect({ leagues = [], value = "", onChange, placeholder = "Choose a league", className = "", disabled = false, emptyLabel = "" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const selected = leagues.find((league) => String(league.league_id) === String(value));
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...leagues]
      .filter((league) => !needle || [league.name, league.season, league.league_id].some((field) => String(field || "").toLowerCase().includes(needle)))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [leagues, query]);

  const placeMenu = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 8;
    const viewportPadding = 8;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);
    const roomBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const openAbove = roomBelow < 250 && rect.top > roomBelow;
    const maxHeight = Math.max(180, Math.min(360, (openAbove ? rect.top : window.innerHeight - rect.bottom) - gap - viewportPadding));
    setPosition({ left, top:openAbove ? undefined : rect.bottom + gap, bottom:openAbove ? window.innerHeight - rect.top + gap : undefined, width, maxHeight });
  }, []);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const update = () => placeMenu();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, placeMenu]);

  const choose = (leagueId) => {
    onChange?.(String(leagueId || ""));
    setQuery("");
    setOpen(false);
  };

  const menu = open && position ? <div ref={menuRef} className="fixed z-[99999] overflow-hidden rounded-2xl border border-white/12 bg-slate-950 shadow-2xl" style={{left:position.left,top:position.top,bottom:position.bottom,width:position.width,maxHeight:position.maxHeight}}>
    <div className="border-b border-white/10 p-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && filtered[0]) choose(filtered[0].league_id); }} placeholder="Search name, season, or ID…" className="w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-cyan-300/30" /></div>
    <div role="listbox" className="overflow-y-auto p-1.5" style={{maxHeight:Math.max(120,position.maxHeight-58)}}>
      {emptyLabel ? <button type="button" onClick={() => choose("")} className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/50 hover:bg-white/[0.06]">{emptyLabel}</button> : null}
      {filtered.map((league) => <button type="button" role="option" aria-selected={String(league.league_id) === String(value)} key={league.league_id} onClick={() => choose(league.league_id)} className={`block w-full rounded-xl px-3 py-2.5 text-left text-white hover:bg-white/[0.06] ${String(league.league_id) === String(value) ? "bg-cyan-300/[0.07]" : ""}`}><span className="block truncate text-sm font-semibold">{league.name}</span><span className="mt-0.5 block text-[10px] text-white/30">{league.season || "Current"} · {league.total_rosters || "—"} teams</span></button>)}
      {!filtered.length ? <div className="p-4 text-center text-xs text-white/35">No matching leagues</div> : null}
    </div>
  </div> : null;

  return <div ref={rootRef} className={`relative ${className}`}>
    <button type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-left text-sm disabled:opacity-45">
      <span className={selected ? "truncate text-white" : "truncate text-white/45"}>{selected?.name || placeholder}</span>
      <span className="shrink-0 text-white/30">⌄</span>
    </button>
    {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
  </div>;
}
