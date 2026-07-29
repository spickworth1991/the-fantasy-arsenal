"use client";

import { useMemo, useState } from "react";
import AvatarImage from "../../components/AvatarImage";

const n = (value) => Number(value || 0);
const pos = (player) => String(player?.position || player?.fantasy_positions?.[0] || "—").toUpperCase();
const name = (player, id) => player?.full_name || player?.search_full_name || id;

function Card({ children, className = "" }) {
  return <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.025] ${className}`}>{children}</div>;
}

function Metric({ label, value, detail, tone = "cyan" }) {
  const color = tone === "emerald" ? "text-emerald-100" : tone === "amber" ? "text-amber-100" : tone === "rose" ? "text-rose-100" : tone === "violet" ? "text-violet-100" : "text-cyan-100";
  return <Card className="p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/30">{label}</div><div className={`mt-1 text-xl font-black ${color}`}>{value}</div>{detail ? <div className="mt-1 text-[10px] leading-4 text-white/32">{detail}</div> : null}</Card>;
}

function survivalProbability(rank, picksAway, pressure = 0) {
  if (picksAway == null) return null;
  return Math.max(2, Math.min(98, Math.round(100 / (1 + Math.exp(-(rank - picksAway - 1 - pressure) / 2.8)))));
}

export default function DraftStrategySuite({
  ranked,
  picks,
  picksAway,
  nextMyPick,
  players,
  rosters,
  focusRosterId,
  draftedByRoster,
  rosterMap,
  userMap,
  getPlayerValue,
  teams,
  rounds,
  draft,
  byeWeeks = {},
  onInspect,
}) {
  const [view, setView] = useState("simulator");
  const [targetId, setTargetId] = useState(ranked[0]?.id || "");
  const [budget, setBudget] = useState(200);
  const [nomination, setNomination] = useState("value");
  const target = ranked.find((row) => row.id === targetId) || ranked[0];
  const recent = picks.slice(-12).map((pick) => pos(players?.[pick.player_id]));
  const runCounts = recent.reduce((map, position) => ({ ...map, [position]:(map[position] || 0) + 1 }), {});
  const activeRun = Object.entries(runCounts).sort((a, b) => b[1] - a[1])[0];
  const positionPressure = target ? n(runCounts[target.pos]) : 0;
  const targetRank = Math.max(1, ranked.findIndex((row) => row.id === target?.id) + 1);
  const returnChance = survivalProbability(targetRank, picksAway, positionPressure * .55);
  const tier = target ? ranked.filter((row) => row.value >= target.value * .9) : [];
  const tierSurvival = picksAway == null ? null : Math.max(1, Math.min(99, Math.round(100 * (1 - Math.pow(Math.min(.92, Math.max(.08, tier.length / Math.max(1, picksAway + tier.length))), Math.max(1, picksAway))))));
  const opportunity = target && ranked[0] ? Math.max(0, Math.round(ranked[0].value - target.value)) : 0;
  const simulated = useMemo(() => {
    if (picksAway == null) return [];
    const pressurePositions = new Set(recent.slice(-5));
    return ranked.slice(0, Math.min(30, Math.max(1, picksAway))).map((row, index) => ({
      ...row,
      simulatedPick:index + 1,
      threat:pressurePositions.has(row.pos) ? "Run pressure" : index < picksAway / 2 ? "Likely selected" : "Board edge",
    }));
  }, [ranked, picksAway, recent]);

  const auctionPicks = picks.filter((pick) => n(pick.metadata?.amount ?? pick.metadata?.price ?? pick.amount) > 0);
  const spentByRoster = new Map();
  auctionPicks.forEach((pick) => {
    const rosterId = String(pick.roster_id || "");
    spentByRoster.set(rosterId, n(spentByRoster.get(rosterId)) + n(pick.metadata?.amount ?? pick.metadata?.price ?? pick.amount));
  });
  const remainingBudgets = rosters.map((roster) => {
    const spent = n(spentByRoster.get(String(roster.roster_id)));
    return { roster, spent, remaining:Math.max(0, budget - spent), slotsLeft:Math.max(0, rounds - (draftedByRoster.get(String(roster.roster_id)) || []).length) };
  }).sort((a, b) => b.remaining - a.remaining);
  const totalKnownSpend = auctionPicks.reduce((sum, pick) => sum + n(pick.metadata?.amount ?? pick.metadata?.price ?? pick.amount), 0);
  const draftedValue = auctionPicks.reduce((sum, pick) => sum + n(getPlayerValue(players?.[pick.player_id])), 0);
  const availableValue = ranked.slice(0, Math.max(1, remainingBudgets.reduce((sum, row) => sum + row.slotsLeft, 0))).reduce((sum, row) => sum + row.value, 0);
  const availableDollars = remainingBudgets.reduce((sum, row) => sum + Math.max(0, row.remaining - Math.max(0, row.slotsLeft - 1)), 0);
  const inflation = draftedValue && totalKnownSpend ? Math.max(.5, Math.min(2.5, (availableDollars / Math.max(1, availableValue)) / (totalKnownSpend / draftedValue))) : 1;
  const maxBid = (item, rosterId = focusRosterId) => {
    const account = remainingBudgets.find((row) => String(row.roster.roster_id) === String(rosterId));
    if (!item || !account) return 0;
    const valueShare = item.value / Math.max(1, availableValue);
    return Math.max(1, Math.min(account.remaining - Math.max(0, account.slotsLeft - 1), Math.round(availableDollars * valueShare * inflation)));
  };

  const upcomingThreats = rosters.map((roster) => {
    const drafted = draftedByRoster.get(String(roster.roster_id)) || [];
    const counts = drafted.reduce((map, id) => ({ ...map, [pos(players?.[id])]:(map[pos(players?.[id])] || 0) + 1 }), {});
    const lowest = ["QB","RB","WR","TE"].sort((a, b) => n(counts[a]) - n(counts[b]))[0];
    const user = userMap.get(String(roster.owner_id));
    return { rosterId:String(roster.roster_id), manager:user?.metadata?.team_name || user?.display_name || `Roster ${roster.roster_id}`, likely:lowest, count:n(counts[lowest]) };
  });
  const targetThreats = upcomingThreats.filter((row) => row.likely === target?.pos).slice(0, 6);
  const byeRosterIds = [...new Set([...(rosterMap.get(String(focusRosterId))?.players || []).map(String), ...(draftedByRoster.get(String(focusRosterId)) || []).map(String)])];
  const byeCounts = byeRosterIds.reduce((map, id) => {
    const team = String(players?.[id]?.team || "").toUpperCase();
    const week = n(byeWeeks[team] || players?.[id]?.bye_week);
    if (week) map[week] = (map[week] || 0) + 1;
    return map;
  }, {});
  const heavyBye = Object.entries(byeCounts).sort((a, b) => b[1] - a[1])[0];

  const myPicks = picks.filter((pick) => String(pick.roster_id) === String(focusRosterId));
  const valueRanks = useMemo(() => {
    const pool = Object.entries(players || {}).map(([id, player]) => ({ id, player, value:n(getPlayerValue(player)) })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
    return new Map(pool.map((row, index) => [row.id, index + 1]));
  }, [players, getPlayerValue]);
  const reportRows = myPicks.map((pick) => {
    const player = players?.[pick.player_id];
    const marketRank = valueRanks.get(String(pick.player_id)) || 999;
    const delta = n(pick.pick_no) - marketRank;
    return { pick, player, marketRank, delta, label:delta >= 12 ? "Value" : delta <= -12 ? "Reach" : "On market" };
  });
  const reportScore = reportRows.length ? Math.max(40, Math.min(99, Math.round(82 + reportRows.reduce((sum, row) => sum + Math.max(-15, Math.min(15, row.delta)) * .35, 0) / reportRows.length))) : 0;
  const grade = reportScore >= 93 ? "A" : reportScore >= 85 ? "B+" : reportScore >= 76 ? "B" : reportScore >= 66 ? "C" : "D";
  const positionCounts = myPicks.reduce((map, pick) => ({ ...map, [pos(players?.[pick.player_id])]:(map[pos(players?.[pick.player_id])] || 0) + 1 }), {});
  const strengths = Object.entries(positionCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const needs = ["QB","RB","WR","TE"].filter((position) => !positionCounts[position] || positionCounts[position] < 2);

  return <div className="mt-5 space-y-4">
    <div className="overflow-x-auto rounded-2xl border border-violet-300/15 bg-slate-950/95 p-2"><div className="flex w-max gap-1">{[["simulator","Outcome Simulator"],["auction","Auction Assistant"],["intelligence","Room Intelligence"],["report","Post-Draft Report"]].map(([key, label]) => <button type="button" key={key} onClick={() => setView(key)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${view === key ? "bg-violet-300/10 text-violet-100" : "text-white/40"}`}>{label}</button>)}</div></div>

    {view === "simulator" ? <>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Target return chance" value={returnChance == null ? "—" : `${returnChance}%`} detail={`Modeled through pick #${nextMyPick || "—"}`} tone={returnChance >= 65 ? "emerald" : returnChance >= 35 ? "amber" : "rose"} /><Metric label="Tier survival" value={tierSurvival == null ? "—" : `${tierSurvival}%`} detail={`${tier.length} comparable players`} tone="violet" /><Metric label="Position-run risk" value={positionPressure >= 4 ? "High" : positionPressure >= 2 ? "Moderate" : "Low"} detail={`${positionPressure} ${target?.pos || ""} in last 12`} tone={positionPressure >= 4 ? "rose" : "amber"} /><Metric label="Opportunity cost" value={opportunity.toLocaleString()} detail="Value passed versus current BPA" /></div>
      <Card className="overflow-hidden"><div className="border-b border-white/10 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-xl font-black">Before your next pick</h3><p className="mt-1 text-xs text-white/35">A probability model based on board rank, picks away, tier depth, and active position pressure.</p></div><select value={target?.id || ""} onChange={(event) => setTargetId(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm">{ranked.slice(0, 80).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.pos}</option>)}</select></div></div><div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]"><div><h4 className="font-black">Simulated selections before #{nextMyPick || "—"}</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">{simulated.slice(0, 12).map((row) => <button type="button" onClick={() => onInspect?.(row)} key={row.id} className="flex items-center gap-3 rounded-xl bg-black/15 p-2 text-left"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-[10px] font-black">{row.simulatedPick}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{row.name}</div><div className="text-[9px] text-white/28">{row.pos} · {row.threat}</div></div></button>)}</div></div><Card className="p-4"><h4 className="font-black text-violet-100">Take now versus wait</h4><p className="mt-2 text-xs leading-5 text-white/45">{returnChance == null ? "No future owned pick is available for a wait calculation." : returnChance < 35 ? `${target?.name} is unlikely to return. Take now if the player clears your current BPA by team fit.` : returnChance > 70 ? `${target?.name} has a strong chance to survive. Passing preserves access to ${ranked[0]?.name || "the current BPA"} now.` : `${target?.name} sits in the decision zone. The ${target?.pos} run and ${tier.length}-player tier make the next few picks decisive.`}</p></Card></div></Card>
    </> : null}

    {view === "auction" ? <>
      <Card className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-xl font-black">Auction economy</h3><p className="mt-1 text-xs text-white/35">{auctionPicks.length ? `${auctionPicks.length} priced selections detected from Sleeper metadata.` : "No auction prices are exposed for this draft yet. Set the league budget to prepare nomination and endgame plans."}</p></div><label className="text-[10px] uppercase text-white/35">Starting budget<input type="number" min="1" value={budget} onChange={(event) => setBudget(Math.max(1, n(event.target.value)))} className="ml-2 w-24 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" /></label></div></Card>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Market inflation" value={`${inflation.toFixed(2)}×`} detail="Remaining dollars per value unit" tone={inflation > 1.12 ? "rose" : inflation < .9 ? "emerald" : "cyan"} /><Metric label="Your budget" value={`$${remainingBudgets.find((row) => String(row.roster.roster_id) === String(focusRosterId))?.remaining ?? budget}`} detail="Observed remaining" tone="emerald" /><Metric label="Max bid · BPA" value={`$${maxBid(ranked[0])}`} detail={ranked[0]?.name || "No player"} tone="amber" /><Metric label="Nomination mode" value={nomination === "value" ? "Buy target" : nomination === "drain" ? "Drain rivals" : "Endgame"} detail="Local strategy control" tone="violet" /></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><Card className="overflow-hidden"><div className="border-b border-white/10 p-4"><h3 className="font-black">Budgets and roster pressure</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead className="text-left text-white/30"><tr><th className="p-3">Manager</th><th className="p-3">Spent</th><th className="p-3">Remaining</th><th className="p-3">Slots left</th><th className="p-3">Max one-player bid</th></tr></thead><tbody>{remainingBudgets.map((row) => { const user=userMap.get(String(row.roster.owner_id)); return <tr key={row.roster.roster_id} className="border-t border-white/[0.06]"><td className="p-3 font-semibold">{user?.metadata?.team_name || user?.display_name || `Roster ${row.roster.roster_id}`}</td><td className="p-3">${row.spent}</td><td className="p-3 text-emerald-100">${row.remaining}</td><td className="p-3">{row.slotsLeft}</td><td className="p-3">${Math.max(0, row.remaining - Math.max(0, row.slotsLeft - 1))}</td></tr>; })}</tbody></table></div></Card><Card className="p-4"><h3 className="font-black">Nomination strategy</h3><div className="mt-3 flex flex-wrap gap-2">{[["value","Buy target"],["drain","Drain rivals"],["endgame","Protect endgame"]].map(([key, label]) => <button type="button" key={key} onClick={() => setNomination(key)} className={`rounded-full px-3 py-1.5 text-xs ${nomination === key ? "bg-violet-300/10 text-violet-100" : "bg-white/[0.04] text-white/40"}`}>{label}</button>)}</div><p className="mt-3 text-xs leading-5 text-white/42">{nomination === "value" ? `Nominate ${ranked[0]?.name || "your top target"} while your modeled max bid is $${maxBid(ranked[0])}.` : nomination === "drain" ? `Nominate a high-value player outside your priority positions. ${remainingBudgets[0]?.remaining || budget} is the largest rival budget.` : "Nominate low-cost starters and preserve at least $1 for every remaining slot."}</p></Card></div>
    </> : null}

    {view === "intelligence" ? <>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active run" value={activeRun ? activeRun[0] : "None"} detail={activeRun ? `${activeRun[1]} of last ${recent.length}` : "Waiting for picks"} tone="amber" /><Metric label="Target threats" value={targetThreats.length} detail={`Managers needing ${target?.pos || "target position"}`} tone="rose" /><Metric label="Bye concentration" value={heavyBye ? `Week ${heavyBye[0]}` : "Clear"} detail={heavyBye ? `${heavyBye[1]} rostered players` : "No bye data"} tone="violet" /><Metric label="Lineup completion" value={`${Object.values(positionCounts).reduce((sum, count) => sum + count, 0)}/${rounds || "—"}`} detail="Your completed selections" tone="emerald" /></div>
      <div className="grid gap-4 lg:grid-cols-2"><Card className="p-4"><h3 className="font-black">Who can take your target?</h3><p className="mt-1 text-[10px] text-white/30">Predicted from each roster’s drafted position counts.</p><div className="mt-3 space-y-2">{targetThreats.map((row) => <div key={row.rosterId} className="flex justify-between rounded-xl bg-black/15 p-3 text-xs"><b>{row.manager}</b><span className="text-rose-100">{row.likely} need · {row.count} drafted</span></div>)}{!targetThreats.length ? <div className="text-xs text-white/35">No immediate roster-need threat detected for {target?.name || "this target"}.</div> : null}</div></Card><Card className="p-4"><h3 className="font-black">Stack and construction forecast</h3><div className="mt-3 space-y-2">{ranked.filter((row) => {
        const rosterIds=rosterMap.get(String(focusRosterId))?.players || [];
        return rosterIds.some((id) => players?.[id]?.team === row.team && ((pos(players?.[id]) === "QB" && ["WR","TE"].includes(row.pos)) || (row.pos === "QB" && ["WR","TE"].includes(pos(players?.[id])))));
      }).slice(0, 6).map((row) => <button type="button" onClick={() => onInspect?.(row)} key={row.id} className="flex w-full items-center justify-between rounded-xl bg-cyan-300/[0.04] p-3 text-left text-xs"><b>{row.name}</b><span className="text-cyan-100">{row.team} stack · {row.pos}</span></button>)}</div></Card></div>
    </> : null}

    {view === "report" ? <section className="draft-report-print space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Draft grade" value={myPicks.length ? grade : "Pending"} detail={myPicks.length ? `${reportScore}/100 market score` : "No selections yet"} tone={reportScore >= 85 ? "emerald" : reportScore >= 70 ? "amber" : "rose"} /><Metric label="Best value" value={reportRows.sort((a, b) => b.delta - a.delta)[0]?.player ? name(reportRows.sort((a, b) => b.delta - a.delta)[0].player) : "—"} detail="Largest market-rank gain" tone="emerald" /><Metric label="Biggest reach" value={reportRows.sort((a, b) => a.delta - b.delta)[0]?.player ? name(reportRows.sort((a, b) => a.delta - b.delta)[0].player) : "—"} detail="Largest pick-over-market gap" tone="rose" /><Metric label="Bye risk" value={heavyBye && n(heavyBye[1]) >= 4 ? "Concentrated" : "Controlled"} detail={heavyBye ? `${heavyBye[1]} players in Week ${heavyBye[0]}` : "No known conflicts"} tone="violet" /></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]"><Card className="overflow-hidden"><div className="border-b border-white/10 p-4"><h3 className="text-xl font-black">Draft-grade timeline</h3></div><div className="divide-y divide-white/[0.06]">{reportRows.map((row) => <button type="button" onClick={() => onInspect?.(row.pick.player_id)} key={row.pick.pick_no} className="grid w-full grid-cols-[54px_minmax(0,1fr)_80px] items-center gap-3 p-3 text-left hover:bg-white/[0.03]"><span className="text-xs font-black text-white/30">#{row.pick.pick_no}</span><div className="min-w-0"><div className="truncate font-semibold">{name(row.player, row.pick.player_id)}</div><div className="text-[9px] text-white/28">{pos(row.player)} · current market rank {row.marketRank}</div></div><b className={row.label === "Value" ? "text-emerald-100" : row.label === "Reach" ? "text-rose-100" : "text-white/45"}>{row.label}</b></button>)}{!reportRows.length ? <div className="p-6 text-sm text-white/35">The report populates automatically as this roster drafts.</div> : null}</div></Card><div className="space-y-4"><Card className="p-4"><h3 className="font-black">Roster identity</h3><p className="mt-2 text-xs leading-5 text-white/42">{strengths.length ? `The draft is strongest at ${strengths.map(([position, count]) => `${position} (${count})`).join(" and ")}.` : "No positional identity yet."} {needs.length ? `Immediate post-draft priorities: ${needs.join(", ")}.` : "Core position depth is balanced."}</p></Card><Card className="p-4"><h3 className="font-black">Post-draft actions</h3><div className="mt-3 space-y-2 text-xs text-white/45"><div className="rounded-xl bg-black/15 p-3">Waivers: target the best available {needs[0] || "depth"} option.</div><div className="rounded-xl bg-black/15 p-3">Trade need: consolidate excess {strengths[0]?.[0] || "depth"} for {needs[0] || "upside"}.</div><div className="rounded-xl bg-black/15 p-3">Timeline: {myPicks.filter((pick) => n(players?.[pick.player_id]?.years_exp) <= 1).length >= myPicks.length / 2 ? "Youth-heavy build with a longer runway." : "Veteran-balanced build positioned for current production."}</div></div></Card><button type="button" onClick={() => window.print()} className="w-full rounded-2xl bg-violet-300/10 px-4 py-3 text-sm font-black text-violet-100">Print / save report</button></div></div>
    </section> : null}
  </div>;
}
