"use client";

import { useMemo } from "react";

const number = (value) => Number(value || 0);

export default function CommissionerTradeRelationships({ data }) {
  const managers = useMemo(() => new Map((data.managers || []).map((manager) => [String(manager.rosterId), manager])), [data.managers]);
  const relationships = useMemo(() => {
    const groups = new Map();
    (data.completedTransactions || []).filter((transaction) => transaction.type === "trade").forEach((trade) => {
      const rosterIds=[...new Set([...(trade.roster_ids || []),...Object.values(trade.adds || {}),...(trade.draft_picks || []).map((pick)=>pick.owner_id)].filter((value)=>value!=null).map(String))].sort();
      if (rosterIds.length < 2) return;
      const key=rosterIds.join("|");
      if (!groups.has(key)) groups.set(key,{key,rosterIds,trades:[]});
      groups.get(key).trades.push(trade);
    });
    return [...groups.values()].filter((group)=>group.trades.length>=2).sort((a,b)=>b.trades.length-a.trades.length || a.key.localeCompare(b.key));
  }, [data.completedTransactions]);
  const owner = (rosterId) => managers.get(String(rosterId))?.ownerName || managers.get(String(rosterId))?.name || `Roster ${rosterId}`;
  if (!relationships.length) return null;
  return <section className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/80"><div className="flex flex-col gap-3 border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(245,158,11,.13),transparent_42%)] p-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-amber-200/55">Trade relationship review</div><h3 className="mt-1 text-xl font-black">Repeated trading partners</h3><p className="mt-1 text-xs leading-5 text-white/40">Frequency is context for review, never evidence of misconduct by itself. Open a relationship to see every included trade.</p></div><div className="rounded-2xl border border-amber-300/12 bg-amber-300/[0.05] px-4 py-3 text-center"><div className="text-2xl font-black text-amber-100">{relationships.length}</div><div className="text-[9px] uppercase tracking-wider text-white/35">Repeat groups</div></div></div><div className="divide-y divide-white/[0.06]">{relationships.map((group) => { const names=group.rosterIds.map(owner); const elevated=group.trades.length>=4; return <details key={group.key} className="group p-4 open:bg-white/[0.018]"><summary className="flex cursor-pointer list-none items-center gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black ${elevated?"bg-amber-300/[0.1] text-amber-100":"bg-cyan-300/[0.07] text-cyan-100"}`}>{group.trades.length}×</div><div className="min-w-0 flex-1"><div className="font-semibold">{names.join(" ↔ ")}</div><div className="mt-1 text-xs text-white/35">{group.trades.length} completed trades in the scanned season{group.rosterIds.length>2?` · ${group.rosterIds.length}-team group`:""}</div></div>{elevated?<span className="rounded-full bg-amber-300/[0.08] px-2.5 py-1 text-[10px] font-semibold text-amber-100">REVIEW CONTEXT</span>:null}<span className="text-white/25 transition group-open:rotate-180">⌄</span></summary><div className="mt-4 grid gap-2 sm:grid-cols-2">{[...group.trades].sort((a,b)=>number(b.created)-number(a.created)).map((trade,index)=><div key={trade.transaction_id || index} className="rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold">Week {trade.leg || "—"}</div><div className="text-[10px] text-white/30">{trade.created?new Date(number(trade.created)).toLocaleDateString():"Date unavailable"}</div></div><div className="mt-1 text-xs text-white/38">{Object.keys(trade.adds || {}).length} players · {(trade.draft_picks || []).length} picks</div></div>)}</div><div className="mt-3 text-[11px] leading-5 text-white/35">Review the complete assets and market values in the Trade Center above. Consider rebuilding cycles, negotiated multi-deal sequences, and league activity before drawing conclusions.</div></details>;})}</div></section>;
}
