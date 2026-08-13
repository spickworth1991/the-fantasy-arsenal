"use client";

import { useEffect, useMemo, useState } from "react";
import AvatarImage from "../../components/AvatarImage";
import TradePartnerFinder from "./TradePartnerFinder";

const n = (value) => Number(value || 0);
const playerName = (player, id) => player?.full_name || player?.search_full_name || id;
const position = (player) => String(player?.position || player?.fantasy_positions?.[0] || "—").toUpperCase();
const ownerName = (league, ownerId) => {
  const user = (league?.users || []).find((row) => String(row.user_id) === String(ownerId));
  return user?.metadata?.team_name || user?.display_name || user?.username || `Manager ${String(ownerId || "").slice(-4)}`;
};
const rosterOwner = (league, rosterId) => (league?.rosters || []).find((row) => String(row.roster_id) === String(rosterId))?.owner_id;
const unique = (rows) => [...new Set(rows)];

function Panel({ children, className = "" }) {
  return <div className={`rounded-[26px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</div>;
}

function Stat({ label, value, detail, tone = "cyan" }) {
  const color = tone === "emerald" ? "text-emerald-100" : tone === "amber" ? "text-amber-100" : tone === "rose" ? "text-rose-100" : tone === "violet" ? "text-violet-100" : "text-cyan-100";
  return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/30">{label}</div><div className={`mt-1 break-words text-lg font-black ${color}`}>{value}</div>{detail ? <div className="mt-1 text-[10px] leading-4 text-white/32">{detail}</div> : null}</div>;
}

function PackagePlayers({ title, players, getMetric, tone = "cyan", onInspect }) {
  return <div className="min-w-0"><div className={`text-[9px] font-semibold uppercase tracking-wider ${tone === "violet" ? "text-violet-200/50" : "text-cyan-200/50"}`}>{title}</div><div className="mt-2 space-y-2">{players.map((player) => <button type="button" onClick={() => onInspect?.(player.player_id)} key={player.player_id} className="flex w-full items-center gap-2 rounded-xl bg-black/15 p-2 text-left"><AvatarImage name={playerName(player)} playerId={player.player_id} size={32} className="rounded-lg" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{playerName(player)}</div><div className="text-[9px] text-white/28">{position(player)} · {player.team || "FA"}</div></div><b className="text-[10px]">{Math.round(n(getMetric(player))).toLocaleString()}</b></button>)}</div></div>;
}

export default function TradeWorkspaceSuite({
  league,
  players,
  getMetric,
  getWeeklyMetric,
  metricMode,
  username,
  sideA,
  sideB,
  selectedOwnerA,
  selectedOwnerB,
  sourceKey,
  onLoadPackage,
  initialTab = "finder",
  hideNavigation = false,
}) {
  const [tab, setTab] = useState(initialTab);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState([]);
  const [block, setBlock] = useState([]);
  const [wanted, setWanted] = useState(["WR"]);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadedLeague, setHistoryLoadedLeague] = useState("");
  const [swipeIndex, setSwipeIndex] = useState(0);
  const [packageSize, setPackageSize] = useState(1);
  const [swipeDecisions, setSwipeDecisions] = useState({});
  const [message, setMessage] = useState("");
  const leagueKey = String(league?.league_id || "global");
  const inspect = (id) => window.dispatchEvent(new CustomEvent("tfa:inspect-player", { detail:{ playerId:String(id) } }));
  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    const storageKey = `tfa:trade-workspaces:${leagueKey}`;
    const loadSaved = () => {
      try { setSaved(JSON.parse(localStorage.getItem(storageKey) || "[]")); }
      catch { setSaved([]); }
    };
    try {
      loadSaved();
      setBlock(JSON.parse(localStorage.getItem(`tfa:trade-block:${leagueKey}`) || "[]"));
      setSwipeDecisions(JSON.parse(localStorage.getItem(`tfa:trade-swipes:${leagueKey}`) || "{}"));
    } catch {
      setSaved([]);
      setBlock([]);
      setSwipeDecisions({});
    }
    const onSaved = (event) => {
      if (!event?.detail?.key || event.detail.key === storageKey) loadSaved();
    };
    window.addEventListener("tfa:trade-workspaces-updated", onSaved);
    return () => window.removeEventListener("tfa:trade-workspaces-updated", onSaved);
  }, [leagueKey]);

  useEffect(() => {
    const activeLeagueId = String(league?.league_id || "");
    if (!activeLeagueId || !["history", "market"].includes(tab) || historyLoadedLeague === activeLeagueId) return;
    let active = true;
    setHistoryLoading(true);
    Promise.all(Array.from({ length:19 }, (_, index) => index).map((week) => fetch(`https://api.sleeper.app/v1/league/${activeLeagueId}/transactions/${week}`).then((response) => response.ok ? response.json() : []).catch(() => [])))
      .then((weeks) => {
        if (!active) return;
        const deduped = new Map();
        weeks.flat().forEach((transaction) => {
          const status = String(transaction.status || "").toLowerCase();
          if (transaction.type !== "trade" || (status && !["complete", "completed"].includes(status))) return;
          deduped.set(String(transaction.transaction_id || `${transaction.created}:${JSON.stringify(transaction.adds || {})}`), transaction);
        });
        setHistory([...deduped.values()].sort((a, b) => n(b.created) - n(a.created)));
        setHistoryLoadedLeague(activeLeagueId);
      })
      .finally(() => active && setHistoryLoading(false));
    return () => { active = false; };
  }, [league?.league_id, tab, historyLoadedLeague]);

  const signedInUser = (league?.users || []).find((user) => [user.username, user.display_name].some((value) => String(value || "").toLowerCase() === String(username || "").toLowerCase()));
  const myRoster = (league?.rosters || []).find((roster) => String(roster.owner_id) === String(signedInUser?.user_id));
  const myPlayers = (myRoster?.players || []).map((id) => players?.[id]).filter(Boolean).sort((a, b) => n(getMetric(b)) - n(getMetric(a)));
  const owners = (league?.rosters || []).filter((roster) => String(roster.owner_id) !== String(myRoster?.owner_id));

  const rosterNeeds = (roster) => {
    const counts = (roster?.players || []).reduce((map, id) => {
      const pos = position(players?.[id]);
      map[pos] = (map[pos] || 0) + 1;
      return map;
    }, {});
    const targets = { QB:2, RB:5, WR:7, TE:3 };
    return Object.entries(targets).map(([pos, target]) => ({ pos, gap:target - n(counts[pos]) })).sort((a, b) => b.gap - a.gap);
  };

  const generatedPackages = useMemo(() => {
    if (!myRoster) return [];
    const decisions = swipeDecisions || {};
    return owners.flatMap((partner) => {
      const partnerPlayers = (partner.players || []).map((id) => players?.[id]).filter(Boolean).filter((player) => n(getMetric(player)) > 0).sort((a, b) => n(getMetric(b)) - n(getMetric(a)));
      const theirNeeds = rosterNeeds(partner);
      const myNeeds = rosterNeeds(myRoster);
      const givePool = myPlayers.filter((player) => theirNeeds.slice(0, 2).some((need) => need.pos === position(player))).slice(0, 12);
      const receivePool = partnerPlayers.filter((player) => myNeeds.slice(0, 2).some((need) => need.pos === position(player))).slice(0, 12);
      const packages = [];
      receivePool.slice(0, 5).forEach((target) => {
        const targetValue = n(getMetric(target));
        const give = [...givePool].sort((a, b) => Math.abs(n(getMetric(a)) - targetValue / packageSize) - Math.abs(n(getMetric(b)) - targetValue / packageSize)).slice(0, packageSize);
        const giveValue = give.reduce((sum, player) => sum + n(getMetric(player)), 0);
        if (!give.length || !targetValue) return;
        const key = `${partner.roster_id}:${target.player_id}:${give.map((player) => player.player_id).join("-")}`;
        packages.push({
          key,
          partner,
          give,
          receive:[target],
          giveValue,
          receiveValue:targetValue,
          balance:Math.abs(giveValue - targetValue) / Math.max(giveValue, targetValue),
          partnerNeed:theirNeeds[0]?.pos,
          myNeed:myNeeds[0]?.pos,
          priorDecision:decisions[key],
        });
      });
      return packages;
    }).filter((row) => row.balance <= .4).sort((a, b) => a.balance - b.balance);
  }, [owners, myRoster, myPlayers, players, getMetric, packageSize, swipeDecisions]);
  const swipe = generatedPackages[swipeIndex % Math.max(1, generatedPackages.length)];
  const blockOffers = generatedPackages.filter((offer) => {
    if (!block.length || !offer.give.some((player) => block.includes(String(player.player_id)))) return false;
    return !wanted.length || offer.receive.some((player) => wanted.includes(position(player)));
  }).slice(0, 12);

  const saveWorkspace = () => {
    if (!sideA.length && !sideB.length) {
      setMessage("Build a trade in the manual analyzer before saving a version.");
      return;
    }
    const item = {
      id:crypto.randomUUID?.() || String(Date.now()),
      createdAt:Date.now(),
      ownerA:selectedOwnerA,
      ownerB:selectedOwnerB,
      sideA:sideA.map((player) => String(player.player_id)),
      sideB:sideB.map((player) => String(player.player_id)),
      sideASnapshots:sideA,
      sideBSnapshots:sideB,
      valueA:sideA.reduce((sum, player) => sum + n(getMetric(player)), 0),
      valueB:sideB.reduce((sum, player) => sum + n(getMetric(player)), 0),
      notes,
      sourceKey,
      outcome:"Open",
    };
    const next = [item, ...saved].slice(0, 30);
    setSaved(next);
    localStorage.setItem(`tfa:trade-workspaces:${leagueKey}`, JSON.stringify(next));
    setMessage("Trade version saved locally.");
  };
  const updateSaved = (id, patch) => {
    const next = saved.map((item) => item.id === id ? { ...item, ...patch } : item);
    setSaved(next);
    localStorage.setItem(`tfa:trade-workspaces:${leagueKey}`, JSON.stringify(next));
  };
  const toggleBlock = (id) => {
    const next = block.includes(id) ? block.filter((item) => item !== id) : [...block, id];
    setBlock(next);
    localStorage.setItem(`tfa:trade-block:${leagueKey}`, JSON.stringify(next));
  };
  const swipeAction = (action) => {
    if (!swipe) return;
    const next = { ...swipeDecisions, [swipe.key]:action };
    setSwipeDecisions(next);
    localStorage.setItem(`tfa:trade-swipes:${leagueKey}`, JSON.stringify(next));
    if (action === "interesting" || action === "saved") onLoadPackage?.(swipe.receive, swipe.give, String(myRoster?.owner_id || ""), String(swipe.partner.owner_id || ""));
    setSwipeIndex((index) => index + 1);
  };
  const shareBlock = async () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ league:league?.name, manager:username, players:block.map((id) => ({ id, name:playerName(players?.[id], id) })), wanted }))));
    const url = `${window.location.origin}/trade#board=${payload}`;
    try { await navigator.clipboard.writeText(url); setMessage("Private trade-board link copied."); } catch { setMessage(url); }
  };

  const tradeRows = history.map((transaction) => {
    const rosterIds = unique([...(transaction.roster_ids || []).map(String), ...Object.values(transaction.adds || {}).map(String)]);
    const sides = rosterIds.map((rosterId) => {
      const received = Object.entries(transaction.adds || {}).filter(([, id]) => String(id) === rosterId).map(([id]) => players?.[id]).filter(Boolean);
      const sent = Object.entries(transaction.drops || {}).filter(([, id]) => String(id) === rosterId).map(([id]) => players?.[id]).filter(Boolean);
      const picks = (transaction.draft_picks || []).filter((pick) => String(pick.owner_id) === rosterId);
      return { rosterId, received, sent, picks, value:received.reduce((sum, player) => sum + n(getMetric(player)), 0) };
    });
    return { transaction, sides };
  });
  const positionTrades = {};
  const managerTrades = {};
  const pairTrades = {};
  tradeRows.forEach(({ sides }) => {
    sides.forEach((side) => {
      managerTrades[side.rosterId] = n(managerTrades[side.rosterId]) + 1;
      side.received.forEach((player) => { positionTrades[position(player)] = n(positionTrades[position(player)]) + 1; });
    });
    const pair = sides.map((side) => side.rosterId).sort().join("|");
    if (pair) pairTrades[pair] = n(pairTrades[pair]) + 1;
  });
  const topPosition = Object.entries(positionTrades).sort((a, b) => b[1] - a[1])[0];
  const topManager = Object.entries(managerTrades).sort((a, b) => b[1] - a[1])[0];
  const topPair = Object.entries(pairTrades).sort((a, b) => b[1] - a[1])[0];
  const averagePackage = tradeRows.length ? tradeRows.reduce((sum, row) => sum + row.sides.reduce((sideSum, side) => sideSum + side.received.length + side.picks.length, 0), 0) / tradeRows.length : 0;

  if (!league) return <Panel className="mb-6 p-5 text-sm text-white/40">Choose a league to unlock the consolidated Trade Suite.</Panel>;

  return <Panel className="mb-6 overflow-hidden border-violet-300/15">
    <div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(139,92,246,.15),transparent_40%)] p-4 sm:p-5"><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-200/55">Consolidated trade workflow</div><h2 className="mt-1 text-2xl font-black">Trade Suite</h2><p className="mt-2 text-xs leading-5 text-white/38">Find a mutually useful deal, negotiate versions, publish local interests, evaluate league history, and move through packages without leaving this analyzer.</p></div>
    {!hideNavigation ? <div className="overflow-x-auto border-b border-white/10 p-2"><div className="flex w-max gap-1">{[["finder","Partner Finder"],["workspace","Saved Trades"],["block","Trade Block"],["history","History"],["market","League Market"],["swipe","Swipe Finder"]].map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${tab === key ? "bg-violet-300/10 text-violet-100" : "text-white/40"}`}>{label}</button>)}</div></div> : null}
    <div className="p-3 sm:p-4">
      {message ? <div className="mb-3 rounded-xl bg-cyan-300/[0.05] p-3 text-xs text-cyan-100">{message}</div> : null}
      {tab === "finder" ? <TradePartnerFinder league={league} players={players} getMetric={getMetric} getWeeklyMetric={getWeeklyMetric} metricMode={metricMode} username={username} onLoadPackage={onLoadPackage} /> : null}
      {tab === "workspace" ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]"><div className="space-y-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Side A" value={Math.round(sideA.reduce((sum, player) => sum + n(getMetric(player)), 0)).toLocaleString()} /><Stat label="Side B" value={Math.round(sideB.reduce((sum, player) => sum + n(getMetric(player)), 0)).toLocaleString()} tone="violet" /><Stat label="Roster delta" value={`${sideB.length - sideA.length >= 0 ? "+" : ""}${sideB.length - sideA.length}`} detail="Side A incoming slots" tone="amber" /><Stat label="Saved trades" value={saved.length} detail={league?.name || "No league selected"} tone="emerald" /></div><CardEditor sideA={sideA} sideB={sideB} getMetric={getMetric} inspect={inspect} /><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Negotiation notes, priorities, counters, and manager context…" className="min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950 p-3 text-sm" /><div className="flex flex-wrap gap-2"><button type="button" onClick={saveWorkspace} className="rounded-xl bg-violet-300/10 px-4 py-3 text-xs font-black text-violet-100">Save another version</button><a href={`/playoff-odds?league=${encodeURIComponent(league?.league_id||"")}`} className="rounded-xl bg-cyan-300/10 px-4 py-3 text-xs font-black text-cyan-100">Check playoff impact →</a></div></div><div><h3 className="font-black">Saved Trades</h3><p className="mt-1 text-[10px] text-white/35">Saved for {league?.name || "trades without a selected league"}. Choose Open in Analyzer to restore a package.</p><div className="mt-3 space-y-2">{saved.map((item) => { const savedA=(item.sideA||[]).map((id,index)=>players?.[id]||item.sideASnapshots?.[index]).filter(Boolean); const savedB=(item.sideB||[]).map((id,index)=>players?.[id]||item.sideBSnapshots?.[index]).filter(Boolean); return <div key={item.id} className="rounded-2xl border border-white/[0.07] bg-black/15 p-3"><div className="flex items-center justify-between gap-2"><b className="text-xs">{new Date(item.createdAt).toLocaleString()}</b><select value={item.outcome} onChange={(event) => updateSaved(item.id, { outcome:event.target.value })} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[10px]"><option>Open</option><option>Sent</option><option>Countered</option><option>Accepted</option><option>Rejected</option></select></div><div className="mt-2 text-[10px] leading-4 text-white/50"><b className="text-cyan-100/70">A:</b> {savedA.map((player)=>playerName(player)).join(" + ")||"Empty"}<br/><b className="text-violet-100/70">B:</b> {savedB.map((player)=>playerName(player)).join(" + ")||"Empty"}</div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[9px] text-white/25">{item.notes || item.sourceKey || "Saved trade"}</span><button type="button" onClick={() => onLoadPackage?.(savedA, savedB, item.ownerA, item.ownerB, item.sourceKey)} className="rounded-lg bg-cyan-300/10 px-3 py-2 text-[10px] font-black text-cyan-100">Open in Analyzer →</button></div></div>; })}{!saved.length ? <div className="rounded-2xl border border-dashed border-white/10 p-5 text-xs text-white/35">No saved trades in this context yet. Build one in the Analyzer and select Save trade.</div> : null}</div></div></div> : null}
      {tab === "block" ? <div className="space-y-5"><div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div><h3 className="font-black">Players available for discussion</h3><p className="mt-1 text-xs text-white/35">Choose at least one player. Nothing is written to Sleeper.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{myPlayers.map((player) => <button type="button" key={player.player_id} onClick={() => toggleBlock(String(player.player_id))} className={`flex items-center gap-2 rounded-xl border p-2 text-left ${block.includes(String(player.player_id)) ? "border-violet-300/25 bg-violet-300/[0.07]" : "border-white/[0.07] bg-black/15"}`}><AvatarImage name={playerName(player)} playerId={player.player_id} size={34} className="rounded-lg" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{playerName(player)}</div><div className="text-[9px] text-white/28">{position(player)} · {Math.round(n(getMetric(player))).toLocaleString()}</div></div><span>{block.includes(String(player.player_id)) ? "✓" : "+"}</span></button>)}</div></div><div className="space-y-4"><div><h3 className="font-black">Desired return</h3><div className="mt-3 flex flex-wrap gap-2">{["QB","RB","WR","TE","PICKS"].map((value) => <button type="button" key={value} onClick={() => setWanted((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} className={`rounded-full px-3 py-1.5 text-xs ${wanted.includes(value) ? "bg-cyan-300/10 text-cyan-100" : "bg-white/[0.04] text-white/35"}`}>{value}</button>)}</div></div><button type="button" onClick={shareBlock} disabled={!block.length} className="w-full rounded-xl bg-violet-300/10 px-4 py-3 text-xs font-black text-violet-100 disabled:opacity-40">Copy private board link</button></div></div><Panel className="p-4"><div className="flex items-end justify-between gap-3"><div><h3 className="font-black">Generated offers</h3><p className="mt-1 text-xs text-white/35">Packages matching your selected trade pieces, desired positions, roster needs, and current source.</p></div><span className="text-xs text-violet-100">{blockOffers.length} match{blockOffers.length === 1 ? "" : "es"}</span></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{blockOffers.map((offer) => <button type="button" key={offer.key} onClick={() => onLoadPackage?.(offer.give, offer.receive, String(myRoster?.owner_id || ""), String(offer.partner.owner_id || ""))} className="rounded-2xl border border-white/[0.07] bg-black/15 p-3 text-left hover:border-violet-300/25"><div className="text-xs font-black">{ownerName(league, offer.partner.owner_id)}</div><div className="mt-2 text-xs text-white/45">{offer.give.map(playerName).join(" + ")} <span className="text-white/20">→</span> {offer.receive.map(playerName).join(" + ")}</div><div className="mt-2 text-[10px] text-emerald-100">Load into Analyzer · {Math.round((1 - offer.balance) * 100)}% value alignment</div></button>)}{!block.length ? <div className="text-xs text-white/35">Select a player above to generate offers.</div> : !blockOffers.length ? <div className="text-xs text-white/35">No offer clears the current position and value filters. Add another desired position or change the value source.</div> : null}</div></Panel></div> : null}
      {tab === "history" ? <div><div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Completed trades" value={tradeRows.length} /><Stat label="Tracked-at-time data" value="From Jul 2026" detail="Daily archive coverage" tone="violet" /><Stat label="Current-value lens" value={metricMode === "projections" ? "Projection" : "Market"} detail="Selected source" tone="emerald" /><Stat label="Trade trees" value={tradeRows.filter((row) => row.sides.some((side) => side.picks.length)).length} detail="Deals containing picks" tone="amber" /></div>{historyLoading ? <div className="p-6 text-sm text-white/35">Loading league trade history…</div> : <div className="space-y-3">{tradeRows.map(({ transaction, sides }) => <details key={transaction.transaction_id} className="rounded-2xl border border-white/[0.07] bg-black/15 p-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3"><div><b>Trade · Week {transaction.leg || "—"}</b><div className="mt-1 text-[10px] text-white/30">{new Date(n(transaction.created)).toLocaleDateString()} · {sides.map((side) => ownerName(league, rosterOwner(league, side.rosterId))).join(" ↔ ")}</div></div><span className="text-xs text-cyan-100">Review</span></summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{sides.map((side) => <div key={side.rosterId} className="rounded-xl bg-white/[0.025] p-3"><b className="text-xs">{ownerName(league, rosterOwner(league, side.rosterId))}</b><div className="mt-2 text-xs text-white/45">Received: {side.received.map((player) => playerName(player)).join(", ") || "No players"}{side.picks.length ? ` · ${side.picks.map((pick) => `${pick.season} R${pick.round}`).join(", ")}` : ""}</div><div className="mt-2 text-lg font-black text-cyan-100">{Math.round(side.value).toLocaleString()} <span className="text-[9px] font-normal text-white/25">current value</span></div></div>)}</div><p className="mt-3 text-[10px] leading-4 text-white/28">Fair-at-the-time values appear only when the trade date overlaps the daily archive, which began in July 2026. Current values are never mislabeled as historical values.</p></details>)}{!tradeRows.length ? <div className="p-6 text-sm text-white/35">No completed trades were found in the current league season.</div> : null}</div>}</div> : null}
      {tab === "market" ? <div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Trade volume" value={tradeRows.length} detail="Current season" /><Stat label="Average package" value={averagePackage.toFixed(1)} detail="Players + picks per deal" tone="violet" /><Stat label="Most traded position" value={topPosition?.[0] || "—"} detail={topPosition ? `${topPosition[1]} assets received` : "No sample"} tone="emerald" /><Stat label="Most active manager" value={topManager ? ownerName(league, rosterOwner(league, topManager[0])) : "—"} detail={topManager ? `${topManager[1]} trades` : "No sample"} tone="amber" /></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><Panel className="p-4"><h3 className="font-black">Position market</h3><div className="mt-3 space-y-2">{Object.entries(positionTrades).sort((a, b) => b[1] - a[1]).map(([pos, count]) => <div key={pos}><div className="flex justify-between text-xs"><b>{pos}</b><span>{count}</span></div><div className="mt-1 h-1.5 rounded bg-white/[0.05]"><div className="h-full rounded bg-cyan-300/60" style={{ width:`${Math.min(100, count / Math.max(1, topPosition?.[1]) * 100)}%` }} /></div></div>)}</div></Panel><Panel className="p-4"><h3 className="font-black">Repeated trading relationships</h3><div className="mt-3 space-y-2">{Object.entries(pairTrades).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pair, count]) => { const [a,b]=pair.split("|"); return <div key={pair} className="flex justify-between rounded-xl bg-black/15 p-3 text-xs"><span>{ownerName(league, rosterOwner(league, a))} ↔ {ownerName(league, rosterOwner(league, b))}</span><b className={count >= 3 ? "text-amber-100" : ""}>{count}</b></div>; })}{topPair && topPair[1] >= 3 ? <p className="text-[10px] leading-4 text-amber-100/55">Repeated partners are market context, not evidence of misconduct.</p> : null}</div></Panel></div></div> : null}
      {tab === "swipe" ? <div>{swipe ? <div className="mx-auto max-w-3xl"><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-xl font-black">Package {swipeIndex + 1} of {generatedPackages.length}</h3><p className="mt-1 text-xs text-white/35">Mutual need fit with {ownerName(league, swipe.partner.owner_id)} · {Math.round((1 - swipe.balance) * 100)}% value alignment</p></div><div className="flex gap-2"><button type="button" onClick={() => setPackageSize(Math.max(1, packageSize - 1))} className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs">Smaller</button><button type="button" onClick={() => setPackageSize(Math.min(3, packageSize + 1))} className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs">Larger</button></div></div><div className="grid gap-4 rounded-[28px] border border-violet-300/15 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,.12),transparent_44%),rgba(0,0,0,.18)] p-4 sm:grid-cols-[1fr_auto_1fr]"><PackagePlayers title="You send" players={swipe.give} getMetric={getMetric} onInspect={inspect} /><div className="self-center text-center text-white/20">↔</div><PackagePlayers title="You receive" players={swipe.receive} getMetric={getMetric} tone="violet" onInspect={inspect} /></div><div className="mt-3 rounded-2xl bg-white/[0.025] p-4 text-xs leading-5 text-white/45"><b className="text-white">Why it can work:</b> {ownerName(league, swipe.partner.owner_id)} receives help at {swipe.partnerNeed || position(swipe.give[0])}; your roster addresses {swipe.myNeed || position(swipe.receive[0])}. The package is contextual, not merely equal-valued.</div><div className="mt-4 grid grid-cols-3 gap-2"><button type="button" onClick={() => swipeAction("rejected")} className="min-h-12 rounded-2xl bg-rose-300/10 text-xs font-black text-rose-100">Reject</button><button type="button" onClick={() => swipeAction("saved")} className="min-h-12 rounded-2xl bg-amber-300/10 text-xs font-black text-amber-100">Save</button><button type="button" onClick={() => swipeAction("interesting")} className="min-h-12 rounded-2xl bg-emerald-300/10 text-xs font-black text-emerald-100">Interesting</button></div></div> : <div className="p-8 text-center text-sm text-white/40">No mutually useful package clears the current balance and roster-need filters. Try a different source or package size.</div>}</div> : null}
    </div>
  </Panel>;
}

function CardEditor({ sideA, sideB, getMetric, inspect }) {
  return <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]"><PackagePlayers title="Current Side A" players={sideA} getMetric={getMetric} onInspect={inspect} /><div className="self-center text-center text-white/20">↔</div><PackagePlayers title="Current Side B" players={sideB} getMetric={getMetric} tone="violet" onInspect={inspect} /></div>;
}
