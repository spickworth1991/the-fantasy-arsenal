"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../../components/Navbar";
import { useArsenalAccount } from "../../context/ArsenalAccountContext";

const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
const SNAPSHOT_MAX_AGE = 30 * 60 * 1000;
const MARKETS = {
  player_pass_yds: "Passing yards", player_pass_tds: "Passing TDs", player_pass_completions: "Completions",
  player_rush_yds: "Rushing yards", player_rush_attempts: "Rush attempts", player_receptions: "Receptions", player_reception_yds: "Receiving yards",
};
const n = (value) => Number(value || 0);
const pct = (value) => value == null ? "Unscored" : value < .001 ? "<0.1%" : `${(value * 100).toFixed(value < .01 ? 2 : 1)}%`;
const profit = (odds, stake) => odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds || -100);
const lineText = (leg) => leg.direction === "over" && Number(leg.line) % 1 === .5 ? `${Math.floor(Number(leg.line)) + 1}+` : `${leg.direction === "over" ? "Over" : "Under"} ${leg.line}`;

function Panel({ children, className = "" }) { return <section className={`rounded-3xl border border-white/10 bg-slate-950/80 ${className}`}>{children}</section>; }
function Toggle({ active, children, onClick }) { return <button type="button" onClick={onClick} className={`rounded-lg border px-3 py-1.5 text-xs ${active ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-white/35"}`}>{children}</button>; }
function Evidence({ leg }) {
  const tone = leg.evidenceLabel === "Strong" ? "bg-emerald-300/10 text-emerald-200" : leg.evidenceLabel === "Moderate" ? "bg-cyan-300/10 text-cyan-200" : "bg-amber-300/10 text-amber-200";
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${tone}`}>{leg.evidenceLabel} · n={leg.historicalSample}</span>;
}

function TicketCard({ ticket, index, stale, trackingAvailable, stake, odds, setOdds, locked, toggleLock, replace, remove, copy, save, busy, tracked }) {
  const groups = new Map();
  ticket.legs.forEach((leg) => { if (!groups.has(leg.gameKey)) groups.set(leg.gameKey, []); groups.get(leg.gameKey).push(leg); });
  const weakest = [...ticket.legs].sort((a, b) => a.probability - b.probability).slice(0, 3);
  const enteredOdds = Number(odds);
  const returns = enteredOdds ? stake + profit(enteredOdds, stake) : null;
  return <Panel className="overflow-hidden">
    <div className="border-b border-white/[.07] bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.12),transparent_38%)] p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200/55">Ticket {index + 1} · {ticket.legCount} legs</div><h2 className="mt-1 text-xl font-black">{pct(ticket.probability)} estimated chance</h2><p className="mt-1 text-xs text-white/40">{groups.size} games · up to {ticket.maxLegsInGame} legs in one game</p></div><div className="rounded-xl bg-black/20 px-3 py-2 text-right"><b>{Math.round(ticket.evidenceScore * 100)}%</b><small className="block text-[9px] text-white/35">Evidence</small></div></div>
      {ticket.maxLegsInGame > 1 ? <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-2 text-[10px] text-amber-100/65">Same-game props included. Confirm the combination and final price in DraftKings.</p> : null}
    </div>
    <div className="space-y-4 p-4">{[...groups.entries()].map(([gameKey, legs]) => <div key={gameKey}>
      <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/35"><span>{legs[0].team} vs {legs[0].opponent}</span><span>{new Date(legs[0].kickoff).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></div>
      <div className="space-y-2">{legs.map((leg) => <div key={leg.id} className="rounded-xl border border-white/[.07] bg-white/[.025] p-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{leg.playerName}</b><Evidence leg={leg} /></div><div className="mt-1 text-xs text-white/50">{lineText(leg)} {leg.statLabel} · projection {leg.projection} · {pct(leg.probability)}</div><div className="mt-1 text-[10px] text-white/30">{leg.roleConcern || `${leg.position} role stable`} · updated {new Date(leg.offerUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => toggleLock(leg.id)} className={`rounded-lg px-2 py-1 text-[10px] font-bold ${locked.has(leg.id) ? "bg-cyan-300/15 text-cyan-100" : "bg-white/[.05] text-white/45"}`}>{locked.has(leg.id) ? "Locked" : "Lock"}</button><button type="button" onClick={() => remove(leg.id)} className="rounded-lg bg-white/[.05] px-2 py-1 text-[10px] text-white/45">Remove</button><button type="button" onClick={() => replace(leg.id, ticket)} className="rounded-lg bg-rose-300/[.08] px-2 py-1 text-[10px] font-bold text-rose-100/70">Replace</button></div></div></div>)}</div>
    </div>)}
      <div className="rounded-xl bg-white/[.03] p-3 text-xs text-white/45"><b className="text-white/70">Weakest:</b> {weakest.map((leg) => `${leg.playerName} ${pct(leg.probability)}`).join(" · ")}</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><label className="text-[10px] uppercase tracking-wider text-white/35">Actual ticket odds<input value={odds} onChange={(event) => setOdds(event.target.value)} placeholder="Example: +2500" type="number" className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" /></label><button type="button" onClick={() => copy(ticket)} className="self-end rounded-xl bg-white/[.06] px-4 py-2 text-sm font-bold text-white/70">Copy legs</button><button type="button" disabled={busy || stale || tracked || !enteredOdds || !trackingAvailable} onClick={() => save(ticket)} className="self-end rounded-xl bg-amber-300/15 px-4 py-2 text-sm font-bold text-amber-100 disabled:opacity-35">{tracked ? "Tracked" : !trackingAvailable ? "Preview only" : stale ? "Refresh first" : "I took this bet"}</button></div>
      {returns != null ? <p className="text-xs text-emerald-200/65">${stake.toFixed(2)} would return ${returns.toFixed(2)} at the entered odds.</p> : null}
    </div>
  </Panel>;
}

export default function PropLabClient() {
  const { isConnected, ready, accountRequest } = useArsenalAccount();
  const [board, setBoard] = useState(null), [accuracy, setAccuracy] = useState(null), [tickets, setTickets] = useState([]);
  const [saved, setSaved] = useState([]), [legacy, setLegacy] = useState([]), [selectedGames, setSelectedGames] = useState(new Set());
  const [enabledMarkets, setEnabledMarkets] = useState(new Set(Object.keys(MARKETS))), [locked, setLocked] = useState(new Set()), [excluded, setExcluded] = useState(new Set());
  const [minLegs, setMinLegs] = useState(15), [maxLegs, setMaxLegs] = useState(20), [stake, setStake] = useState(10);
  const [minimumProbability, setMinimumProbability] = useState(80), [minimumEvidence, setMinimumEvidence] = useState(55);
  const [actualOdds, setActualOdds] = useState({}), [building, setBuilding] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [buildMeta, setBuildMeta] = useState(null), [now, setNow] = useState(() => Date.now());
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const workerRef = useRef(null), recordedRef = useRef("");

  const loadHistory = useCallback(async () => {
    if (!isConnected) return;
    try { const result = await accountRequest("/api/arsenal/prop-bets"); setLegacy(result.bets || []); setSaved(result.tickets || []); }
    catch (error) {
      if (process.env.NODE_ENV === "development" && /ARSENAL_DB|PUSH_DB|D1 binding/i.test(String(error?.message || error))) {
        setDbUnavailable(true);
        setMessage("Local preview mode: ticket building works, but account tracking needs a Cloudflare D1 connection.");
      } else setMessage(error?.message || "Tracked bets could not be loaded.");
    }
  }, [accountRequest, isConnected]);

  useEffect(() => {
    Promise.all([fetch("/data/odds/nfl-prop-board.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error("Run npm run bets:update to build the Prop Lab board."))), fetch("/data/odds/prop-lab-accuracy.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null)])
      .then(([nextBoard, nextAccuracy]) => { setBoard(nextBoard); setAccuracy(nextAccuracy); }).catch((error) => setMessage(error.message));
    const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const games = useMemo(() => {
    const map = new Map();
    (board?.predictions || []).forEach((row) => { if (!map.has(row.gameKey)) map.set(row.gameKey, { key: row.gameKey, team: row.team, opponent: row.opponent, kickoff: row.kickoff }); });
    return [...map.values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  }, [board]);
  useEffect(() => setSelectedGames(new Set(games.filter((game) => Date.parse(game.kickoff) > Date.now()).map((game) => game.key))), [games]);

  useEffect(() => {
    const worker = new Worker(new URL("./propTicketWorker.js", import.meta.url));
    worker.onmessage = ({ data }) => { setTickets(data.tickets || []); setBuildMeta(data); setBuilding(false); };
    worker.onerror = () => { setMessage("Ticket builder failed. Reload and try again."); setBuilding(false); };
    workerRef.current = worker; return () => { worker.terminate(); workerRef.current = null; };
  }, []);
  useEffect(() => {
    if (!board || !workerRef.current) return;
    setBuilding(true); workerRef.current.postMessage({ predictions: board.predictions || [], selectedGames: [...selectedGames], enabledMarkets: [...enabledMarkets], minimumProbability: minimumProbability / 100, minimumEvidence: minimumEvidence / 100, minLegs, maxLegs, lockedIds: [...locked], excludedIds: [...excluded], dependencyModel: board.dependencyModel, seed: `${board.capturedAt}:${board.modelBuildId}` });
  }, [board, enabledMarkets, excluded, locked, maxLegs, minLegs, minimumEvidence, minimumProbability, selectedGames]);
  useEffect(() => {
    if (!isConnected || dbUnavailable || !board || !tickets.length) return;
    const key = tickets.map((ticket) => ticket.recommendationId).join("|"); if (recordedRef.current === key) return; recordedRef.current = key;
    accountRequest("/api/arsenal/prop-recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshotId: board.capturedAt, tickets }) }).catch(() => {});
  }, [accountRequest, board, dbUnavailable, isConnected, tickets]);

  const toggle = (setter, key) => setter((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const remove = (id) => { setExcluded((current) => new Set([...current, id])); setLocked((current) => { const next = new Set(current); next.delete(id); return next; }); };
  const replace = (id, ticket) => { setExcluded((current) => new Set([...current, id])); setLocked(new Set(ticket.legs.filter((leg) => leg.id !== id).map((leg) => leg.id))); };
  const copy = async (ticket) => { await navigator.clipboard.writeText(ticket.legs.map((leg, index) => `${index + 1}. ${leg.playerName} — ${lineText(leg)} ${leg.statLabel}`).join("\n")); setMessage("Ticket copied for DraftKings."); };
  const save = async (ticket) => {
    setBusy(true); setMessage("");
    try { await accountRequest("/api/arsenal/prop-bets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ticket, season: board.season, week: ticket.legs[0]?.week, sportsbook: "DraftKings", stake, actualTicketOdds: Number(actualOdds[ticket.id]), capturedAt: board.capturedAt, modelVersion: board.modelVersion }) }); await loadHistory(); }
    catch (error) { setMessage(error?.message || "Ticket could not be saved."); } finally { setBusy(false); }
  };
  const update = async (ticket, result) => { setBusy(true); try { await accountRequest("/api/arsenal/prop-bets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: ticket.ticket_id, result }) }); await loadHistory(); } catch (error) { setMessage(error?.message); } finally { setBusy(false); } };

  const snapshotTime = Date.parse(board?.capturedAt || "");
  const actionable = Number.isFinite(snapshotTime) && now - snapshotTime >= 0 && now - snapshotTime <= SNAPSHOT_MAX_AGE && Date.parse(board?.modelGeneratedAt || "") <= snapshotTime;
  const localPreview = process.env.NODE_ENV === "development" && (!isConnected || dbUnavailable);
  const trackingAvailable = isConnected && !dbUnavailable;
  const tracked = new Set(saved.map((ticket) => ticket.recommendation_id).filter(Boolean));
  const settled = saved.filter((ticket) => ["won", "lost"].includes(ticket.result)), wins = settled.filter((ticket) => ticket.result === "won").length;
  const net = saved.reduce((sum, ticket) => ticket.result === "lost" ? sum - n(ticket.stake) : ticket.result === "won" ? sum + profit(n(ticket.sportsbook_odds), n(ticket.stake)) : sum, 0);
  const ticketBreakdown = (keyOf) => [...new Set(settled.map(keyOf))].sort().map((key) => {
    const rows = settled.filter((ticket) => keyOf(ticket) === key);
    return { key, count: rows.length, hitRate: rows.filter((ticket) => ticket.result === "won").length / rows.length };
  });
  const concentrationKey = (ticket) => {
    const counts = (ticket.legs || []).reduce((rows, leg) => ({ ...rows, [leg.event_id || leg.kickoff]: (rows[leg.event_id || leg.kickoff] || 0) + 1 }), {});
    const maximum = Math.max(1, ...Object.values(counts));
    return maximum === 1 ? "One per game" : maximum === 2 ? "Up to 2/game" : "3+ in a game";
  };

  return <><div aria-hidden className="h-[35px]" /><Navbar pageTitle="Prop Lab" /><BackgroundParticles /><div aria-hidden className="h-[50px]" /><main className="mx-auto max-w-7xl px-4 pb-14">
    <div className="mb-6 rounded-[2rem] border border-amber-300/15 bg-[radial-gradient(circle_at_85%_0%,rgba(251,191,36,.16),transparent_38%),rgba(2,6,23,.9)] p-6 sm:p-8"><div className="text-[11px] font-bold uppercase tracking-[.28em] text-amber-200/60">Arsenal high-chance ticket builder</div><h1 className="mt-2 text-3xl font-black sm:text-5xl">Prop Lab</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Build large, low-stake DraftKings tickets from strong player props. Ticket probability includes historically measured relationships between props in the same game.</p>{board ? <div className={`mt-4 rounded-xl border p-3 text-xs ${actionable ? "border-emerald-300/20 bg-emerald-300/[.06] text-emerald-100/75" : "border-amber-300/25 bg-amber-300/[.07] text-amber-100/80"}`}><b className="block text-white">{actionable ? "Sportsbook data recently captured" : "Draft only — refresh sportsbook data"}</b>Odds captured {new Date(board.capturedAt).toLocaleString()} · model {board.modelVersion}. {actionable ? "Confirm every offer and the final combined price in DraftKings." : "Run npm run bets:update before placing a ticket."}</div> : null}</div>
    {!ready ? <Panel className="p-6 text-white/50">Checking Arsenal account…</Panel> : !isConnected && !localPreview ? <Panel className="p-6"><h2 className="text-xl font-black">Arsenal account required</h2><p className="mt-2 text-sm text-white/50">Sign in from My Arsenal to build and track tickets.</p><a href="/account" className="mt-4 inline-block rounded-xl bg-amber-300/15 px-4 py-2 text-sm font-bold text-amber-100">Open My Arsenal</a></Panel> : <>
      {localPreview ? <div className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] p-3 text-sm text-cyan-100/75"><b className="text-white">Local preview mode.</b> Building, filters, locking, replacement, and copying work locally. Saving tickets is disabled until the account API has a D1 connection.</div> : null}
      <Panel className="p-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-white/50">Minimum legs<input type="number" min="1" max="25" value={minLegs} onChange={(e) => { const value = Math.max(1, Math.min(25, Number(e.target.value))); setMinLegs(value); setMaxLegs((x) => Math.max(x, value)); }} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-xs text-white/50">Maximum legs<input type="number" min="1" max="25" value={maxLegs} onChange={(e) => { const value = Math.max(1, Math.min(25, Number(e.target.value))); setMaxLegs(value); setMinLegs((x) => Math.min(x, value)); }} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-xs text-white/50">Stake ($)<input type="number" min=".01" value={stake} onChange={(e) => setStake(Math.max(.01, Number(e.target.value)))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-xs text-white/50">Minimum leg chance<input type="number" min="50" max="99" value={minimumProbability} onChange={(e) => setMinimumProbability(Math.max(50, Math.min(99, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-xs text-white/50">Minimum evidence<input type="number" min="0" max="100" value={minimumEvidence} onChange={(e) => setMinimumEvidence(Math.max(0, Math.min(100, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
      </div><div className="mt-5"><div className="mb-2 text-xs font-bold uppercase tracking-wider text-white/40">Allowed markets</div><div className="flex flex-wrap gap-2">{Object.entries(MARKETS).map(([key, label]) => <Toggle key={key} active={enabledMarkets.has(key)} onClick={() => toggle(setEnabledMarkets, key)}>{label}</Toggle>)}</div></div>
      <div className="mt-5"><div className="mb-2 flex justify-between"><span className="text-xs font-bold uppercase tracking-wider text-white/40">Games</span><button type="button" onClick={() => setSelectedGames(new Set(selectedGames.size === games.length ? [] : games.map((game) => game.key)))} className="text-xs font-bold text-cyan-200">{selectedGames.size === games.length ? "Clear all" : "Select all"}</button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{games.map((game) => <label key={game.key} className={`flex items-center gap-3 rounded-xl border p-3 ${selectedGames.has(game.key) ? "border-cyan-300/25 bg-cyan-300/[.06]" : "border-white/10"}`}><input type="checkbox" checked={selectedGames.has(game.key)} onChange={() => toggle(setSelectedGames, game.key)} /><span><b className="text-sm">{game.team} vs {game.opponent}</b><small className="block text-[10px] text-white/35">{new Date(game.kickoff).toLocaleString()}</small></span></label>)}</div></div>
      {(locked.size || excluded.size) ? <div className="mt-4 text-xs text-white/45">{locked.size} locked · {excluded.size} excluded <button type="button" onClick={() => { setLocked(new Set()); setExcluded(new Set()); }} className="ml-3 font-bold text-amber-200">Reset edits</button></div> : null}</Panel>
      {message ? <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[.08] p-3 text-sm text-amber-100">{message}</div> : null}
      <div className="mt-6 flex justify-between"><div><div className="text-[11px] font-bold uppercase tracking-[.2em] text-cyan-200/55">Optimized comparisons</div><h2 className="mt-1 text-2xl font-black">Best available tickets</h2></div><div className="text-xs text-white/40">{building ? "Building…" : `${buildMeta?.eligibleCount || 0} eligible legs`}</div></div>
      {buildMeta?.shortfalls?.length ? <Panel className="mt-4 border-amber-300/20 p-4 text-sm text-amber-100/70">Not enough qualifying props for {buildMeta.shortfalls.join(", ")} legs. Adjust a filter or shorten the ticket.</Panel> : null}
      <div className="mt-4 grid gap-5 xl:grid-cols-2">{tickets.map((ticket, index) => <TicketCard key={ticket.id} ticket={ticket} index={index} stale={!actionable} trackingAvailable={trackingAvailable} stake={stake} odds={actualOdds[ticket.id] || ""} setOdds={(value) => setActualOdds((current) => ({ ...current, [ticket.id]: value }))} locked={locked} toggleLock={(id) => toggle(setLocked, id)} replace={replace} remove={remove} copy={copy} save={save} busy={busy} tracked={tracked.has(ticket.recommendationId)} />)}</div>
      {!building && !tickets.length ? <Panel className="mt-4 p-6 text-sm text-white/50">No fully supported ticket fits these settings. Prop Lab will not weaken filters or invent confidence for unsupported same-game combinations.</Panel> : null}
      <div className="mt-10 grid gap-5 lg:grid-cols-2"><Panel className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-200/55">Measured accuracy</div><h2 className="mt-1 text-xl font-black">Do high-chance props deliver?</h2>{accuracy?.highEstimatedChance?.settled ? <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white/[.04] p-3"><b className="block text-xl">{Math.round(accuracy.highEstimatedChance.hitRate * 100)}%</b><small className="text-white/35">Actual</small></div><div className="rounded-xl bg-white/[.04] p-3"><b className="block text-xl">{Math.round(accuracy.highEstimatedChance.averagePredicted * 100)}%</b><small className="text-white/35">Predicted</small></div><div className="rounded-xl bg-white/[.04] p-3"><b className="block text-xl">{accuracy.highEstimatedChance.groups}</b><small className="text-white/35">Groups</small></div></div> : <p className="mt-3 text-sm text-white/45">Run npm run bets:evaluate after final stats arrive to build this record.</p>}</Panel><Panel className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-200/55">Your results</div><h2 className="mt-1 text-xl font-black">Tracked tickets</h2><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white/[.04] p-3"><b className="block text-xl">{saved.length}</b><small className="text-white/35">Saved</small></div><div className="rounded-xl bg-white/[.04] p-3"><b className="block text-xl">{settled.length ? Math.round(wins / settled.length * 100) : 0}%</b><small className="text-white/35">Hit rate</small></div><div className="rounded-xl bg-white/[.04] p-3"><b className={`block text-xl ${net >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{net >= 0 ? "+" : ""}${net.toFixed(2)}</b><small className="text-white/35">Net</small></div></div></Panel></div>
      {accuracy?.overall?.settled ? <Panel className="mt-5 p-5"><h3 className="font-black">Calibration detail</h3><div className="mt-3 grid gap-5 md:grid-cols-2"><div><div className="mb-2 text-[10px] font-bold uppercase text-white/35">Probability bands</div>{Object.entries(accuracy.probabilityBands || {}).map(([key, row]) => <div key={key} className="flex justify-between border-t border-white/[.06] py-2 text-xs"><span>{key} · {row.groups} groups</span><span>{Math.round(row.hitRate * 100)}% actual / {Math.round(row.averagePredicted * 100)}% model</span></div>)}</div><div><div className="mb-2 text-[10px] font-bold uppercase text-white/35">Markets</div>{Object.entries(accuracy.markets || {}).map(([key, row]) => <div key={key} className="flex justify-between border-t border-white/[.06] py-2 text-xs"><span>{MARKETS[key] || key}</span><span>{Math.round(row.hitRate * 100)}% · n={row.groups}</span></div>)}</div></div></Panel> : null}
      {settled.length ? <Panel className="mt-5 p-5"><h3 className="font-black">Ticket results by construction</h3><div className="mt-3 grid gap-5 md:grid-cols-2"><div><div className="mb-2 text-[10px] font-bold uppercase text-white/35">Leg count</div>{ticketBreakdown((ticket) => `${ticket.leg_count} legs`).map((row) => <div key={row.key} className="flex justify-between border-t border-white/[.06] py-2 text-xs"><span>{row.key} · {row.count} tickets</span><span>{Math.round(row.hitRate * 100)}%</span></div>)}</div><div><div className="mb-2 text-[10px] font-bold uppercase text-white/35">Same-game concentration</div>{ticketBreakdown(concentrationKey).map((row) => <div key={row.key} className="flex justify-between border-t border-white/[.06] py-2 text-xs"><span>{row.key} · {row.count} tickets</span><span>{Math.round(row.hitRate * 100)}%</span></div>)}</div></div></Panel> : null}
      <Panel className="mt-5 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-white/[.04] text-left text-[10px] uppercase text-white/35"><tr><th className="p-3">Ticket</th><th className="p-3">Chance</th><th className="p-3">Odds</th><th className="p-3">Stake</th><th className="p-3">Result</th></tr></thead><tbody>{saved.map((ticket) => <tr key={ticket.ticket_id} className="border-t border-white/[.06]"><td className="p-3"><b>{ticket.leg_count}-leg DraftKings</b><div className="text-xs text-white/35">Week {ticket.week} · {ticket.legs?.length || 0} legs</div></td><td className="p-3">{pct(ticket.model_probability)}</td><td className="p-3">{ticket.sportsbook_odds > 0 ? "+" : ""}{ticket.sportsbook_odds || "—"}</td><td className="p-3">${n(ticket.stake).toFixed(2)}</td><td className="p-3"><select value={ticket.result} disabled={busy} onChange={(e) => update(ticket, e.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1"><option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="push">Push</option><option value="void">Void</option></select></td></tr>)}</tbody></table></div>{!saved.length ? <div className="p-6 text-center text-sm text-white/40">No structured tickets yet.{legacy.length ? ` ${legacy.length} legacy prop record${legacy.length === 1 ? " is" : "s are"} preserved.` : ""}</div> : null}</Panel>
    </>}</main></>;
}
