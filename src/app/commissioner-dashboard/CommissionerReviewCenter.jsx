"use client";

import { useEffect, useMemo, useState } from "react";

const number = (value) => Number(value || 0);

function Shell({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/80 shadow-[0_30px_90px_-65px_rgba(0,0,0,1)] ${className}`}>{children}</div>;
}

export default function CommissionerReviewCenter({ league, data, players, valueFor, pickValueFor, sourceLabel }) {
  const [view, setView] = useState("trades");
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState("");
  const storageKey = `commissioner-trade-ledger:v2:${league.league_id}`;
  const [ledger, setLedger] = useState({});
  useEffect(() => { try { setLedger(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch {} }, [storageKey]);
  const updateLedger = (id, patch) => { const next = { ...ledger, [id]: { ...(ledger[id] || {}), ...patch } }; setLedger(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {} };

  useEffect(() => {
    let active = true;
    setDraftLoading(true); setDraftError("");
    (async () => {
      try {
        const response = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const rows = await response.json();
        const enriched = await Promise.all((rows || []).map(async (draft) => {
          const picksResponse = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`, { cache: "no-store" }).catch(() => null);
          return { ...draft, completedPicks: picksResponse?.ok ? await picksResponse.json() : [] };
        }));
        if (active) setDrafts(enriched);
      } catch { if (active) setDraftError("Draft order is unavailable. Picks will show season and round without an invented slot."); }
      finally { if (active) setDraftLoading(false); }
    })();
    return () => { active = false; };
  }, [league.league_id]);

  const managers = useMemo(() => new Map(data.managers.map((manager) => [String(manager.rosterId), manager])), [data.managers]);
  const owner = (rosterId) => managers.get(String(rosterId))?.ownerName || managers.get(String(rosterId))?.name || `Roster ${rosterId}`;
  const playerName = (id) => players?.[id]?.full_name || players?.[id]?.search_full_name || `${players?.[id]?.first_name || ""} ${players?.[id]?.last_name || ""}`.trim() || String(id);
  const teams = number(league.total_rosters) || data.managers.length;

  const resolvePick = (pick) => {
    const draft = drafts.find((row) => String(row.season) === String(pick.season));
    if (!draft) return { label: `${pick.season} Round ${pick.round}`, detail: "Exact slot not set in Sleeper", slot: null, overall: null, exact: false };
    const slotMap = draft.slot_to_roster_id || draft.metadata?.slot_to_roster_id || {};
    let slot = number(Object.entries(slotMap).find(([, rosterId]) => String(rosterId) === String(pick.roster_id))?.[0]);
    if (!slot) {
      const originalManager = managers.get(String(pick.roster_id));
      slot = number(draft.draft_order?.[originalManager?.ownerId]);
    }
    const actual = (draft.completedPicks || []).find((draftPick) => number(draftPick.round) === number(pick.round) && (!slot || number(draftPick.draft_slot) === slot) && (String(draftPick.roster_id) === String(pick.owner_id) || number(draftPick.draft_slot) === slot));
    if (actual) return { label: `${pick.season} ${pick.round}.${String(actual.draft_slot).padStart(2,"0")}`, detail: `Overall pick ${actual.pick_no} · finalized draft slot`, slot: number(actual.draft_slot), overall: number(actual.pick_no), exact: true };
    if (!slot) return { label: `${pick.season} Round ${pick.round}`, detail: "Draft exists, but the exact slot is not assigned", slot: null, overall: null, exact: false };
    const snake = String(draft.type || draft.settings?.type).toLowerCase() === "snake";
    const roundSlot = snake && number(pick.round) % 2 === 0 ? teams - slot + 1 : slot;
    const overall = (number(pick.round) - 1) * teams + roundSlot;
    return { label: `${pick.season} ${pick.round}.${String(slot).padStart(2,"0")}`, detail: `Overall pick ${overall} · from Sleeper draft order`, slot, overall, exact: true };
  };

  const trades = useMemo(() => (data.completedTransactions || []).filter((transaction) => transaction.type === "trade").sort((a,b) => number(b.created)-number(a.created)), [data.completedTransactions]);
  const visibleTrades = trades.filter((trade) => { const status = ledger[String(trade.transaction_id)]?.status || "unreviewed"; return filter === "all" || status === filter; });
  const signalById = new Map((data.tradeSignals || []).map((signal) => [String(signal.id), signal]));

  return <div className="mt-6 space-y-5"><Shell className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(244,63,94,.14),transparent_40%)] p-5 sm:p-6"><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-rose-200/55">Commissioner review center</div><h2 className="mt-1 text-2xl font-black sm:text-3xl">One place for evidence and complete trades</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Owner receipts, player and pick values, draft-slot resolution, review signals, statuses, and private notes.</p></div><div className="flex overflow-x-auto p-2">{[["trades","Trade Center"],["managers","Manager Evidence"]].map(([key,label]) => <button key={key} onClick={() => setView(key)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === key ? "bg-white/10 text-white" : "text-white/42"}`}>{label}</button>)}</div></Shell>

    {view === "trades" ? <><Shell className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-black">{trades.length} completed trade{trades.length === 1 ? "" : "s"}</div><div className="mt-1 text-xs text-white/35">Values use {sourceLabel}. Pick values are labeled estimates.</div></div><div className="flex gap-1">{[["all","All"],["unreviewed","Unreviewed"],["followup","Follow-up"],["cleared","Cleared"]].map(([key,label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${filter === key ? "bg-cyan-300/10 text-cyan-100" : "text-white/40"}`}>{label}</button>)}</div></div>{draftLoading ? <div className="mt-3 text-xs text-cyan-100/60">Resolving Sleeper draft orders…</div> : draftError ? <div className="mt-3 text-xs text-amber-100/65">{draftError}</div> : null}</Shell>
      <div className="space-y-4">{visibleTrades.length ? visibleTrades.map((trade) => {
        const id = String(trade.transaction_id); const note = ledger[id] || {}; const signal = signalById.get(id);
        const rosterIds = [...new Set([...(trade.roster_ids || []), ...Object.values(trade.adds || {}), ...(trade.draft_picks || []).map((pick) => pick.owner_id)].filter((value) => value != null).map(String))];
        const sides = rosterIds.map((rosterId) => {
          const receivedPlayers = Object.entries(trade.adds || {}).filter(([,receiver]) => String(receiver) === rosterId).map(([playerId]) => ({ id:playerId, name:playerName(playerId), pos:players?.[playerId]?.position || "—", from:trade.drops?.[playerId], value:number(valueFor(players?.[playerId])) }));
          const receivedPicks = (trade.draft_picks || []).filter((pick) => String(pick.owner_id) === rosterId).map((pick) => { const resolved=resolvePick(pick); const market=pickValueFor(pick,resolved.slot,teams); return { ...pick, resolved, value:market.value, valueBasis:market.basis }; });
          const total = receivedPlayers.reduce((sum,row)=>sum+row.value,0)+receivedPicks.reduce((sum,row)=>sum+row.value,0);
          return { rosterId, manager:managers.get(rosterId), receivedPlayers, receivedPicks, total };
        });
        return <Shell key={id} className="overflow-hidden"><div className="border-b border-white/10 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-black">Week {trade.leg || "—"} · {rosterIds.map(owner).join(" ↔ ")}</div><div className="mt-1 text-xs text-white/35">{new Date(number(trade.created)).toLocaleDateString()} · {note.status || "Unreviewed"}{signal ? ` · ${Math.round(signal.gapPct*100)}% review gap` : ""}</div></div>{signal ? <span className="rounded-full bg-amber-300/[0.08] px-2.5 py-1 text-[10px] text-amber-100">REVIEW CONTEXT</span> : null}</div></div><div className={`grid gap-3 p-4 ${sides.length >= 3 ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>{sides.map((side) => <div key={side.rosterId} className="rounded-3xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center gap-3">{side.manager?.avatar ? <img src={`https://sleepercdn.com/avatars/thumbs/${side.manager.avatar}`} alt="" className="h-11 w-11 rounded-2xl object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.05] text-xs font-black text-white/35">R{side.rosterId}</div>}<div className="min-w-0 flex-1"><div className="truncate font-black">{side.manager?.ownerName || owner(side.rosterId)}</div><div className="truncate text-xs text-white/35">{side.manager?.name || `Roster ${side.rosterId}`}</div></div><div className="text-right"><div className="text-[9px] uppercase text-white/30">Est. received</div><div className="font-black text-cyan-100">{Math.round(side.total).toLocaleString()}</div></div></div><div className="mt-4 space-y-2">{side.receivedPlayers.map((asset) => <div key={asset.id} className="flex justify-between gap-3 rounded-xl bg-white/[0.035] p-2.5"><div className="min-w-0"><div className="truncate text-sm font-semibold">{asset.name}</div><div className="text-[10px] text-white/30">{asset.pos}{asset.from != null ? ` · from ${owner(asset.from)}` : ""}</div></div><span className="text-xs font-bold text-cyan-100/65">{asset.value ? Math.round(asset.value).toLocaleString() : "No value"}</span></div>)}{side.receivedPicks.map((pick,index) => <div key={`${pick.season}-${pick.round}-${index}`} className="flex justify-between gap-3 rounded-xl border border-amber-300/10 bg-amber-300/[0.04] p-2.5"><div><div className="text-sm font-semibold text-amber-50">{pick.resolved.label}</div><div className="text-[10px] text-white/30">{pick.resolved.detail} · original roster {pick.roster_id}</div></div><div className="text-right"><div className="text-xs font-bold text-amber-100/70">~{pick.value.toLocaleString()}</div><div className="text-[9px] text-white/25">estimate</div></div></div>)}{!side.receivedPlayers.length && !side.receivedPicks.length ? <div className="text-xs text-white/30">No received assets reported.</div> : null}</div></div>)}</div>{signal ? <div className="mx-4 mb-4 rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-3 text-xs leading-5 text-white/45">{signal.detail}</div> : null}<div className="grid gap-3 border-t border-white/10 p-4 sm:grid-cols-[180px_1fr]"><select value={note.status || "unreviewed"} onChange={(event) => updateLedger(id,{status:event.target.value})} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="unreviewed">Unreviewed</option><option value="noted">Context noted</option><option value="cleared">Reviewed / clear</option><option value="followup">Follow-up needed</option></select><textarea rows={2} value={note.note || ""} onChange={(event) => updateLedger(id,{note:event.target.value})} placeholder="Private commissioner context…" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" /></div></Shell>;
      }) : <Shell className="p-8 text-center text-sm text-white/40">No trades match this filter.</Shell>}</div></> : null}

    {view === "managers" ? <div className="grid gap-4 lg:grid-cols-2">{data.managers.map((manager) => <Shell key={manager.rosterId} className="p-5"><div className="flex items-center gap-3">{manager.avatar ? <img src={`https://sleepercdn.com/avatars/thumbs/${manager.avatar}`} alt="" className="h-11 w-11 rounded-2xl" /> : null}<div><div className="font-black">{manager.ownerName || manager.name}</div><div className="text-xs text-white/35">{manager.name} · {manager.wins}-{manager.losses}</div></div></div><div className="mt-4 space-y-2">{manager.reviewSignals.length ? manager.reviewSignals.map((signal) => <div key={signal.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="font-semibold">{signal.label}</div><div className="mt-1 text-xs leading-5 text-white/42">{signal.detail}</div>{signal.label.toLowerCase().includes("empty") && manager.emptyWeeks?.length ? <div className="mt-2 text-[10px] text-amber-100/65">Evidence: {manager.emptyWeeks.map((row) => `Week ${row.week} (${row.emptyCount} empty)`).join(" · ")}</div> : null}</div>) : <div className="text-sm text-emerald-100">No manager-level review signals.</div>}</div></Shell>)}</div> : null}
  </div>;
}
