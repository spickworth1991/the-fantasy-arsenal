"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function LeagueSearchSelect({ leagues = [], value = "", onChange, placeholder = "Choose a league", className = "", disabled = false, emptyLabel = "" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const selected = leagues.find((league) => String(league.league_id) === String(value));
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...leagues]
      .filter((league) => !needle || [league.name, league.season, league.league_id].some((field) => String(field || "").toLowerCase().includes(needle)))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [leagues, query]);

  useEffect(() => {
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (leagueId) => {
    onChange?.(String(leagueId || ""));
    setQuery("");
    setOpen(false);
  };

  return <div ref={rootRef} className={`relative ${className}`}>
    <button type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-left text-sm disabled:opacity-45">
      <span className={selected ? "truncate text-white" : "truncate text-white/45"}>{selected?.name || placeholder}</span>
      <span className="shrink-0 text-white/30">⌄</span>
    </button>
    {open ? <div className="absolute z-[80] mt-2 w-full min-w-[260px] overflow-hidden rounded-2xl border border-white/12 bg-slate-950 shadow-2xl">
      <div className="border-b border-white/10 p-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && filtered[0]) choose(filtered[0].league_id); }} placeholder="Search name, season, or ID…" className="w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-cyan-300/30" /></div>
      <div role="listbox" className="max-h-72 overflow-y-auto p-1.5">
        {emptyLabel ? <button type="button" onClick={() => choose("")} className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/50 hover:bg-white/[0.06]">{emptyLabel}</button> : null}
        {filtered.map((league) => <button type="button" role="option" aria-selected={String(league.league_id) === String(value)} key={league.league_id} onClick={() => choose(league.league_id)} className={`block w-full rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.06] ${String(league.league_id) === String(value) ? "bg-cyan-300/[0.07]" : ""}`}><span className="block truncate text-sm font-semibold">{league.name}</span><span className="mt-0.5 block text-[10px] text-white/30">{league.season || "Current"} · {league.total_rosters || "—"} teams</span></button>)}
        {!filtered.length ? <div className="p-4 text-center text-xs text-white/35">No matching leagues</div> : null}
      </div>
    </div> : null}
  </div>;
}
