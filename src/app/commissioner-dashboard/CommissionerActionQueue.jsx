"use client";

import { useEffect, useMemo, useState } from "react";

const number = (value) => Number(value || 0);

export default function CommissionerActionQueue({ league, data }) {
  const storageKey = `commissioner-operations:v1:${league.league_id}`;
  const [local, setLocal] = useState({ actions: {}, dues: {}, deadlines: [], constitution: "" });
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => { try { setLocal((current) => ({ ...current, ...JSON.parse(localStorage.getItem(storageKey) || "{}") })); } catch {} }, [storageKey]);
  const save = (next) => { setLocal(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {} };
  const actions = useMemo(() => {
    const rows = [];
    data.managers.forEach((manager) => manager.reviewSignals.forEach((signal, index) => rows.push({ id:`manager:${manager.rosterId}:${index}:${signal.label}`, priority:signal.label.toLowerCase().includes("empty") || manager.orphan ? 1 : signal.type === "fact" ? 2 : 3, category:manager.orphan ? "Roster" : "Manager", title:`${manager.ownerName || manager.name}: ${signal.label}`, detail:signal.detail })));
    const deadline = number(league?.settings?.trade_deadline);
    if (deadline) rows.push({ id:"league:trade-deadline", priority:data.throughWeek >= deadline - 1 ? 1 : 3, category:"Deadline", title:`Trade deadline: Week ${deadline}`, detail:data.throughWeek >= deadline ? "The configured trade deadline has arrived or passed." : `${Math.max(0, deadline-data.throughWeek)} week(s) remain based on completed-week data.` });
    return rows.sort((a,b) => a.priority-b.priority || a.title.localeCompare(b.title));
  }, [data, league]);
  const update = (id, patch) => save({ ...local, actions:{ ...local.actions, [id]:{ ...(local.actions[id] || {}), ...patch } } });
  const visible = actions.filter((action) => showClosed || !["resolved","dismissed"].includes(local.actions[action.id]?.status));
  const openCount = actions.filter((action) => !["resolved","dismissed"].includes(local.actions[action.id]?.status)).length;
  return <section className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/80"><div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-amber-200/50">Commissioner workflow</div><h3 className="mt-1 text-xl font-black">Prioritized action queue</h3><p className="mt-1 text-xs text-white/38">Private notes and status changes stay in this browser and never change Sleeper.</p></div><button onClick={() => setShowClosed((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/55">{showClosed ? "Hide closed" : `Show closed · ${actions.length-openCount}`}</button></div><div className="divide-y divide-white/[0.06]">{visible.map((action) => { const state=local.actions[action.id] || {}; return <details key={action.id} className={`p-4 ${["resolved","dismissed"].includes(state.status) ? "opacity-50" : ""}`}><summary className="flex cursor-pointer list-none items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${action.priority===1?"bg-rose-400":action.priority===2?"bg-amber-300":"bg-cyan-300"}`}/><div className="min-w-0 flex-1"><div className="font-semibold">{action.title}</div><div className="mt-1 text-xs text-white/35">{action.category} · {state.status || "Open"}</div></div><span className="text-white/25">⌄</span></summary><div className="mt-4 pl-5"><p className="text-xs leading-5 text-white/48">{action.detail}</p><textarea value={state.note || ""} onChange={(event) => update(action.id,{note:event.target.value})} rows={2} placeholder="Private commissioner note…" className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-sm"/><div className="mt-2 flex flex-wrap gap-2">{["acknowledged","resolved","dismissed","open"].map((status) => <button key={status} onClick={() => update(action.id,{status:status==="open"?"":status})} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold capitalize ${state.status===status?"border-cyan-300/25 bg-cyan-300/10 text-cyan-100":"border-white/10 text-white/45"}`}>{status}</button>)}</div></div></details>; })}{!visible.length?<div className="p-8 text-center text-sm text-emerald-100">No open actions.</div>:null}</div></section>;
}
