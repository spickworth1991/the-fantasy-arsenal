"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";
import { classifyLeagueFormat } from "../../lib/leagueFormat";
import PlayerResearchPanel from "../../components/PlayerResearchPanel";
import DraftStrategySuite from "./DraftStrategySuite";

const OFFENSE = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const FLEX = new Set(["RB", "WR", "TE"]);
const IDP = new Set(["DL", "LB", "DB", "IDP", "DE", "DT", "CB", "S", "EDGE"]);
const n = (value) => Number(value || 0);
const upper = (value) => String(value || "").toUpperCase();

function Panel({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/90 to-slate-950/85 shadow-[0_32px_100px_-70px_rgba(34,211,238,.55)] ${className}`}>{children}</div>;
}

function Stat({ label, value, detail }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-[9px] font-semibold uppercase tracking-[.17em] text-white/35">{label}</div><div className="mt-1 text-lg font-black sm:text-xl">{value}</div>{detail ? <div className="mt-1 text-[10px] leading-4 text-white/35">{detail}</div> : null}</div>;
}

function playerName(player, id) {
  return player?.full_name || player?.search_full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || `Player ${id}`;
}

function managerName(rosterId, rosterMap, userMap) {
  const roster = rosterMap.get(String(rosterId));
  const user = userMap.get(String(roster?.owner_id));
  return user?.metadata?.team_name || user?.display_name || user?.username || `Roster ${rosterId || "—"}`;
}

function getSlotForPick(pickNo, teams, type) {
  const round = Math.ceil(pickNo / Math.max(1, teams));
  const index = (pickNo - 1) % Math.max(1, teams);
  return type === "snake" && round % 2 === 0 ? teams - index : index + 1;
}

function effectivePosition(player) {
  const pos = upper(player?.position || player?.fantasy_positions?.[0]);
  if (["DE", "DT", "EDGE"].includes(pos)) return "DL";
  if (["CB", "S", "FS", "SS"].includes(pos)) return "DB";
  return pos;
}

function buildNeeds(roster, players, league, draftedPlayerIds = []) {
  const counts = {};
  const baseIds = (roster?.players || []).map(String);
  const draftedIds = draftedPlayerIds.map(String);
  [...new Set([...baseIds, ...draftedIds])].forEach((id) => {
    const pos = effectivePosition(players?.[id]);
    if (pos) counts[pos] = (counts[pos] || 0) + 1;
  });
  const draftedCounts = {};
  draftedIds.forEach((id) => {
    const pos = effectivePosition(players?.[id]);
    if (pos) draftedCounts[pos] = (draftedCounts[pos] || 0) + 1;
  });
  const required = {};
  let flex = 0;
  (league?.roster_positions || []).forEach((slot) => {
    const pos = upper(slot);
    if (["BN", "IR", "TAXI"].includes(pos)) return;
    if (["FLEX", "WRRB_FLEX", "REC_FLEX"].includes(pos)) flex += 1;
    else if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(pos)) required.QB = (required.QB || 0) + 0.65;
    else required[pos] = (required[pos] || 0) + 1;
  });
  const rows = [...new Set([...Object.keys(required), ...Object.keys(counts)])].filter((pos) => OFFENSE.has(pos) || IDP.has(pos)).map((pos) => {
    const target = (required[pos] || 0) + (FLEX.has(pos) ? flex / 3 : 0);
    const count = counts[pos] || 0;
    const gap = Math.max(0, target - count);
    const depth = count - target;
    const urgency = gap > 0 ? 1 + Math.min(0.55, gap * 0.28) : depth < 1 ? 1.12 : depth < 2 ? 1.04 : 0.94;
    return { pos, count, drafted: draftedCounts[pos] || 0, target, gap, depth, urgency };
  });
  return rows.sort((a, b) => b.urgency - a.urgency || a.pos.localeCompare(b.pos));
}

function RecommendationCard({ label, item, tone, onWatch, watched, onInspect }) {
  if (!item) return <Panel className="p-5 text-sm text-white/35">No eligible recommendation is available.</Panel>;
  const color = tone === "violet" ? "border-violet-300/15 text-violet-100/60" : tone === "amber" ? "border-amber-300/15 text-amber-100/60" : "border-cyan-300/15 text-cyan-100/60";
  return <Panel className={`overflow-hidden ${color.split(" ")[0]}`}><div className="p-4"><div className={`text-[10px] font-semibold uppercase tracking-[.2em] ${color.split(" ")[1]}`}>{label}</div><div className="mt-3 flex items-center gap-3"><AvatarImage name={item.name} playerId={item.id} size={48} className="rounded-2xl" alt="" /><div className="min-w-0 flex-1"><button type="button" onClick={()=>onInspect?.(item)} className="block max-w-full truncate text-left text-lg font-black hover:text-cyan-100">{item.name}</button><div className="text-xs text-white/38">{item.pos} · {item.team || "FA"} · age {item.age || "—"}</div></div><div className="text-right"><div className="text-xl font-black text-cyan-100">{Math.round(item.value).toLocaleString()}</div><div className="text-[9px] uppercase text-white/25">market value</div></div></div><p className="mt-4 text-xs leading-5 text-white/52">{item.reason}</p><button onClick={() => onWatch(item.id)} className={`mt-4 rounded-xl px-3 py-2 text-xs font-semibold ${watched ? "bg-amber-300/10 text-amber-100" : "bg-white/[0.05] text-white/55"}`}>{watched ? "On watchlist" : "+ Watch player"}</button><button type="button" onClick={()=>onInspect?.(item)} className="ml-2 mt-4 rounded-xl bg-cyan-300/[0.07] px-3 py-2 text-xs font-semibold text-cyan-100">Player intelligence</button></div></Panel>;
}

function PlayerSourceDrawer({ item, valueFormat, qbType, getPlayerValue, sourceKey, onClose }) {
  if (!item) return null;
  const rows = DEFAULT_SOURCES.map((source) => {
    const supported = source.type === "projection" || source.supports?.[valueFormat] !== false;
    const amount = supported ? Number(getPlayerValue(item.player, { sourceKey:source.key, format:valueFormat, qbType }) || 0) : 0;
    return { ...source, supported, amount };
  });
  const values = rows.filter(row=>row.type==="value");
  const projections = rows.filter(row=>row.type==="projection");
  const average = (group) => { const usable=group.map(row=>row.amount).filter(value=>value>0);return usable.length?usable.reduce((sum,value)=>sum+value,0)/usable.length:0; };
  const section = (title, group, suffix) => <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-black">{title}</h3><span className="text-[10px] text-white/35">Consensus {average(group)>0?(suffix?average(group).toFixed(1):Math.round(average(group)).toLocaleString()):"—"}{suffix}</span></div><div className="overflow-hidden rounded-2xl border border-white/10"><table className="w-full text-left text-xs"><thead className="bg-white/[0.04] text-[9px] uppercase tracking-wider text-white/30"><tr><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5 text-right">{title}</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{group.map(row=><tr key={row.key} className={row.key===sourceKey?"bg-cyan-300/[0.055]":""}><td className="px-3 py-2.5"><div className="font-semibold text-white/75">{row.label}</div>{row.key===sourceKey?<div className="text-[8px] font-semibold uppercase tracking-wider text-cyan-100/55">Current draft source</div>:null}</td><td className="px-3 py-2.5 text-right font-black">{!row.supported?<span className="font-normal text-white/25">Not offered for {valueFormat}</span>:row.amount>0?suffix?row.amount.toFixed(1):Math.round(row.amount).toLocaleString():<span className="font-normal text-white/25">Unavailable</span>}</td></tr>)}</tbody></table></div></section>;
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div role="dialog" aria-modal="true" aria-label={`All sources for ${item.name}`} className="max-h-[92vh] w-full overflow-y-auto rounded-t-[30px] border border-white/12 bg-slate-950 shadow-2xl sm:max-w-2xl sm:rounded-[30px]"><div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-950/95 p-4 backdrop-blur"><AvatarImage inspectable={false} name={item.name} playerId={item.id} size={46} className="rounded-2xl" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-xl font-black">{item.name}</div><div className="text-xs text-white/38">{item.pos} · {item.team||"FA"} · {valueFormat} · {qbType==="sf"?"Superflex":"1QB"}</div></div><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-lg text-white/60" aria-label="Close source comparison">×</button></div><div className="space-y-5 p-4 sm:p-5"><div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] p-3 text-xs leading-5 text-white/45">Values and projections use different scales, so each group has its own consensus. Missing results remain visible instead of silently becoming zero.</div><PlayerResearchPanel player={item.player} name={item.name}/>{section("Player values",values,"")}{section("Season projections",projections," pts")}</div></div></div>;
}

function PlayerNewsPreview({ name }) {
  const [article, setArticle] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/player-news?q=${encodeURIComponent(name)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (active) setArticle(payload?.article || null); })
      .catch(() => {});
    return () => { active = false; };
  }, [name]);
  if (!article) return <div className="mt-3 text-[10px] text-white/28">No recent article found in the last 30 days.</div>;
  return <a href={article.link} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3 transition hover:bg-cyan-300/[0.07]"><div className="line-clamp-2 text-xs font-semibold leading-5 text-white/75">{article.title}</div><div className="mt-1 text-[9px] text-cyan-100/45">{article.source || "Latest coverage"}{article.published ? ` · ${new Date(article.published).toLocaleDateString()}` : ""}</div></a>;
}

function MyTeamView({ name, roster, draftedIds, needs, recommendations, candidates, players, onInspect }) {
  const rosterIds = [...new Set([...(roster?.players || []).map(String), ...draftedIds.map(String)])];
  const groups = rosterIds.reduce((map, id) => {
    const pos = effectivePosition(players?.[id]) || "OTHER";
    if (!map[pos]) map[pos] = [];
    map[pos].push({ id, player:players?.[id] });
    return map;
  }, {});
  const urgent = needs.filter((need) => need.gap > 0).slice(0, 4);
  const candidateRoles = new Map();
  recommendations.filter(Boolean).forEach((item, index) => {
    const role = ["Best value", "Best fit", "Best strategy"][index];
    candidateRoles.set(item.id, [...(candidateRoles.get(item.id) || []), role]);
  });
  const uniqueCandidates = [...recommendations.filter(Boolean), ...(candidates || [])].filter((item, index, rows) => rows.findIndex((row) => row.id === item.id) === index).slice(0, 3);
  return <div className="mt-5 space-y-5">
    <Panel className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.14),transparent_38%)] p-5"><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-200/55">My draft command center</div><h2 className="mt-1 text-2xl font-black">{name}</h2><p className="mt-1 text-xs text-white/40">Roster construction, selections made, remaining needs, and decision context in one view.</p></div><div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4"><Stat label="Rostered" value={rosterIds.length} /><Stat label="Drafted here" value={draftedIds.length} /><Stat label="Open starter needs" value={urgent.length} /><Stat label="Top need" value={urgent[0]?.pos || "Depth"} detail={urgent[0] ? `${urgent[0].gap.toFixed(1)} slot gap` : "No starting gap detected"} /></div></Panel>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,.95fr)]">
      <Panel className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Current roster construction</h3><p className="mt-1 text-xs text-white/35">Includes every selection recorded in this draft.</p></div><div className="grid gap-4 p-4 sm:grid-cols-2">{Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).map(([pos, rows]) => <div key={pos} className="rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center justify-between"><b>{pos}</b><span className="text-xs text-white/35">{rows.length}</span></div><div className="mt-2 space-y-1.5">{rows.map(({ id, player }) => <div key={id} className="flex items-center justify-between gap-2 text-xs"><button type="button" onClick={()=>onInspect?.(id)} className="min-w-0 truncate text-left hover:text-cyan-100">{playerName(player, id)}</button>{draftedIds.includes(id) ? <span className="shrink-0 rounded bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-semibold text-cyan-100">DRAFTED</span> : null}</div>)}</div></div>)}</div></Panel>
      <div className="space-y-5"><Panel className="p-5"><h3 className="text-xl font-black">Remaining build priorities</h3><div className="mt-4 space-y-3">{needs.slice(0, 8).map((need) => <div key={need.pos} className="rounded-2xl bg-white/[0.025] p-3"><div className="flex items-center justify-between"><b>{need.pos}</b><span className={need.gap > 0 ? "text-xs text-amber-100" : "text-xs text-emerald-100"}>{need.gap > 0 ? `${need.gap.toFixed(1)} starter gap` : "Starter target met"}</span></div><div className="mt-1 text-[10px] text-white/32">{need.count} total · {need.drafted} selected in this draft</div></div>)}</div></Panel></div>
    </div>
    <Panel className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Candidate intelligence</h3><p className="mt-1 text-xs text-white/35">Three distinct candidates with roster context, recent coverage, and deeper research.</p></div><div className="grid gap-3 p-4 lg:grid-cols-3">{uniqueCandidates.map((item) => { const query=encodeURIComponent(`${item.name} NFL`); const contract=encodeURIComponent(item.name); const roles=candidateRoles.get(item.id)||["Next best available"]; return <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 flex flex-wrap gap-1">{roles.map(role=><span key={role} className="rounded-full bg-violet-300/[0.08] px-2 py-1 text-[8px] font-semibold uppercase tracking-wider text-violet-100/70">{role}</span>)}</div><div className="flex items-center gap-3"><AvatarImage name={item.name} playerId={item.id} size={42} className="rounded-xl" alt="" /><div className="min-w-0 flex-1"><button type="button" onClick={()=>onInspect?.(item)} className="block max-w-full truncate text-left font-bold hover:text-cyan-100">{item.name}</button><div className="text-xs text-white/35">{item.pos} · {item.team || "FA"} · value {Math.round(item.value).toLocaleString()}</div></div></div><div className="mt-3 grid grid-cols-2 gap-2 text-center text-[10px]"><div className="rounded-xl bg-white/[0.035] p-2"><b className="block text-sm">{item.age || "—"}</b>Age</div><div className="rounded-xl bg-white/[0.035] p-2"><b className="block text-sm">{n(item.player?.years_exp)}</b>Years exp.</div><div className="rounded-xl bg-white/[0.035] p-2"><b className="block text-sm">{item.player?.depth_chart_order || "—"}</b>Depth order</div><div className="rounded-xl bg-white/[0.035] p-2"><b className="block text-sm">{item.player?.injury_status || "Clear"}</b>Injury</div></div><PlayerNewsPreview name={item.name} /><div className="mt-3 flex flex-wrap gap-2"><a href={`https://news.google.com/search?q=${query}`} target="_blank" rel="noreferrer" className="rounded-lg bg-cyan-300/8 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100">All news ↗</a><a href={`https://www.spotrac.com/search?q=${contract}`} target="_blank" rel="noreferrer" className="rounded-lg bg-violet-300/8 px-2.5 py-1.5 text-[10px] font-semibold text-violet-100">Contract ↗</a></div></div>; })}</div><div className="border-t border-white/10 p-4 text-[10px] leading-4 text-white/30">Article previews use recent Google News coverage. Sleeper supplies age, experience, team, depth-chart, and injury context; contract links open current external research.</div></Panel>
  </div>;
}

function TeamNeedsView({ rosters, rosterMap, userMap, players, league, draftedByRoster, ranked, onRecommend, onInspect }) {
  return <div className="mt-5 space-y-5"><Panel className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(245,158,11,.12),transparent_40%)] p-5"><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-amber-200/55">League construction map</div><h2 className="mt-1 text-2xl font-black">Team needs and position pressure</h2><p className="mt-1 text-xs text-white/38">Starter gaps, depth stability, selections made, and the best available fits for every roster.</p></div><div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4"><Stat label="Teams analyzed" value={rosters.length} /><Stat label="Available candidates" value={ranked.length} /><Stat label="Positions tracked" value={new Set(ranked.map(item=>item.pos)).size} /><Stat label="Model" value="League-aware" detail="Settings plus current construction" /></div></Panel><div className="grid gap-4 xl:grid-cols-2">{rosters.map((roster) => { const drafted=draftedByRoster.get(String(roster.roster_id))||[];const rosterNeeds=buildNeeds(roster,players,league,drafted);const urgent=rosterNeeds.filter(need=>need.gap>0);const construction=Math.max(0,Math.round(100-urgent.reduce((sum,need)=>sum+need.gap*13,0)));const targets=urgent.slice(0,3).map(need=>({need,players:ranked.filter(item=>item.pos===need.pos).slice(0,3)}));return <Panel key={roster.roster_id} className="overflow-hidden"><div className="flex items-start justify-between gap-3 border-b border-white/10 p-5"><div className="min-w-0"><h3 className="truncate text-lg font-black">{managerName(roster.roster_id,rosterMap,userMap)}</h3><div className="mt-1 text-xs text-white/35">{drafted.length} drafted here · {urgent.length} open starter need{urgent.length===1?"":"s"}</div></div><button onClick={()=>onRecommend(roster.roster_id)} className="shrink-0 rounded-xl bg-cyan-300/[0.08] px-3 py-2 text-[10px] font-semibold text-cyan-100">Open recommendations</button></div><div className="grid grid-cols-3 gap-2 p-4"><Stat label="Build score" value={`${construction}/100`} /><Stat label="Top need" value={urgent[0]?.pos||"Depth"} /><Stat label="Drafted" value={drafted.length} /></div><div className="px-4 pb-4"><div className="grid grid-cols-4 gap-2">{rosterNeeds.slice(0,8).map(need=><div key={need.pos} title={`${need.count} rostered; ${need.target.toFixed(1)} target`} className={`rounded-xl p-2 text-center ${need.gap>0?"bg-amber-300/[0.07]":"bg-emerald-300/[0.035]"}`}><b className={need.gap>0?"text-amber-100":"text-emerald-100/75"}>{need.pos}</b><small className="block text-[9px] text-white/30">{need.gap>0?`${need.gap.toFixed(1)} gap`:`${need.count} deep`}</small></div>)}</div>{targets.length?<div className="mt-4 space-y-3">{targets.map(({need,players:targetPlayers})=><div key={need.pos} className="rounded-2xl border border-white/8 bg-black/10 p-3"><div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider"><span className="text-amber-100/70">{need.pos} targets</span><span className="text-white/28">{need.gap.toFixed(1)} starter gap</span></div><div className="mt-2 flex flex-wrap gap-2">{targetPlayers.map(item=><button type="button" onClick={()=>onInspect?.(item)} key={item.id} className="rounded-lg bg-white/[0.045] px-2.5 py-1.5 text-[10px] hover:bg-cyan-300/[0.08]"><b>{item.name}</b> <span className="text-white/30">· {Math.round(item.value).toLocaleString()}</span></button>)}</div></div>)}</div>:<div className="mt-4 rounded-2xl bg-emerald-300/[0.045] p-3 text-xs text-emerald-100/70">Starting requirements are covered. Prioritize value, fragile depth, and tier breaks.</div>}</div></Panel>;})}</div></div>;
}

function DraftIntelligence({ nextMyPick, picksAway, recentRun, tierSize, valueCliff, draftedCounts }) {
  return <Panel className="mt-5 overflow-hidden"><div className="border-b border-white/10 p-5"><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-200/55">Live draft intelligence</div><h3 className="mt-1 text-xl font-black">What the board is telling you</h3></div><div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-6"><Stat label="Your next pick" value={nextMyPick ? `#${nextMyPick}` : "None"} detail={picksAway != null ? `${picksAway} picks away` : "No remaining owned pick"} /><Stat label="Recent run" value={recentRun?.pos || "None"} detail={recentRun ? `${recentRun.count} of the last ${recentRun.sample} picks` : "Waiting for selections"} /><Stat label="Top value tier" value={tierSize} detail="Players within 10% of BPA" /><Stat label="Value cliff" value={`${valueCliff}%`} detail="BPA to player 12" /><Stat label="Most drafted" value={draftedCounts[0]?.pos || "—"} detail={draftedCounts[0] ? `${draftedCounts[0].count} selected` : "No picks yet"} /><Stat label="Board pressure" value={picksAway != null && picksAway > tierSize ? "Act now" : "Flexible"} detail={picksAway != null && picksAway > tierSize ? "Current tier may not reach you" : "A top tier may survive"} /></div></Panel>;
}

function DraftPremiumLab({ ranked, picksAway, nextMyPick, strategy, setStrategy, queue, toggleQueue, compareIds, setCompareIds, players, focusRoster, picks, tradedPicks, valueFormat, qbType, getPlayerValue, onInspect }) {
  const top = ranked[0];
  const tiers = useMemo(()=>{if(!top)return[];const groups=[];ranked.slice(0,50).forEach(item=>{const tier=Math.min(6,Math.floor(Math.max(0,1-item.value/top.value)/.1)+1);if(!groups[tier-1])groups[tier-1]=[];groups[tier-1].push(item);});return groups.filter(Boolean);},[ranked,top]);
  const availability = (item) => { if(picksAway==null)return null;const marketRank=Math.max(1,ranked.findIndex(row=>row.id===item.id)+1);return Math.max(4,Math.min(96,Math.round(100/(1+Math.exp(-(marketRank-picksAway-2)/3))))); };
  const compared=compareIds.map(id=>ranked.find(row=>row.id===id)).filter(Boolean);
  const rosterTeams=new Map();(focusRoster?.players||[]).forEach(id=>{const p=players?.[id];if(!p?.team)return;const team=String(p.team);if(!rosterTeams.has(team))rosterTeams.set(team,[]);rosterTeams.get(team).push(p);});
  const stacks=ranked.filter(item=>{const owned=rosterTeams.get(String(item.team))||[];return owned.some(p=>String(p.position)==="QB")&&["WR","TE","RB"].includes(item.pos)||item.pos==="QB"&&owned.some(p=>["WR","TE"].includes(String(p.position)));}).slice(0,6);
  const gradeRows=[...picks].slice(-10).reverse().map(pick=>{const p=players?.[pick.player_id];const value=Number(getPlayerValue?.(p,{format:valueFormat,qbType})||0);const expected=top?top.value*Math.max(.2,1-(Number(pick.pick_no||1)-1)*.018):0;const pendingReason=!p?"Sleeper did not return player details for this selection.":!value?`${p.full_name||pick.player_id} has no value in the selected ${valueFormat} ${qbType==="sf"?"Superflex":"1QB"} source.`:!expected?"The draft-position baseline could not be calculated because no eligible value board is available.":"";return{pick,p,value,expected,pendingReason,grade:pendingReason?"Pending":value>=expected*1.08?"Value win":value>=expected*.88?"On market":"Reach"};});
  const rookiePicks=(tradedPicks||[]).filter(pick=>String(pick.owner_id)===String(focusRoster?.roster_id));
  return <Panel className="mt-5 overflow-hidden border-violet-300/15"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(139,92,246,.14),transparent_40%)] p-5"><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-200/55">Premium draft lab</div><h2 className="mt-1 text-2xl font-black">Tiers, probability, strategy, and queue</h2><div className="mt-4 flex flex-wrap gap-2">{[["balanced","Balanced"],["win-now","Win now"],["productive-struggle","Productive struggle"],["zero-rb","Zero RB"],["best-ball","Best Ball"]].map(([key,label])=><button key={key} onClick={()=>setStrategy(key)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${strategy===key?"border-violet-300/30 bg-violet-300/10 text-violet-100":"border-white/10 text-white/45"}`}>{label}</button>)}</div></div><div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]"><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tiers.slice(0,3).map((tier,index)=><div key={index} className="rounded-2xl bg-white/[0.025] p-4"><div className="flex justify-between"><b>Tier {index+1}</b><span className="text-[10px] text-white/30">{tier.length} players</span></div><div className="mt-3 space-y-2">{tier.slice(0,6).map(item=>{const pct=availability(item);return <div key={item.id} className="flex items-center gap-2 text-xs"><div className="min-w-0 flex-1"><button type="button" onClick={()=>onInspect?.(item)} className="block max-w-full truncate text-left font-semibold hover:text-cyan-100">{item.name}</button><div className="text-[9px] text-white/28">{item.pos} · value {Math.round(item.value).toLocaleString()} · value rank {ranked.findIndex(row=>row.id===item.id)+1} · Sleeper ADP rank {item.player?.search_rank||"—"}</div></div>{pct!=null?<span className={pct<40?"text-rose-100":pct<70?"text-amber-100":"text-emerald-100"}>{pct}%</span>:null}<button onClick={()=>toggleQueue(item.id)} className={queue.includes(item.id)?"text-amber-200":"text-white/25"}>★</button></div>})}</div>{index===0&&picksAway!=null&&tier.length<=picksAway?<div className="mt-3 rounded-xl bg-rose-300/[0.06] p-2 text-[10px] text-rose-100">Tier-break warning: {picksAway} picks until #{nextMyPick}; this tier has only {tier.length} players.</div>:null}</div>)}</div><div className="grid gap-3 lg:grid-cols-2"><div className="rounded-2xl bg-white/[0.025] p-4"><h3 className="font-black">Player comparison</h3><div className="mt-3 grid grid-cols-2 gap-2">{[0,1].map(index=><select key={index} value={compareIds[index]||""} onChange={event=>setCompareIds(current=>{const next=[...current];next[index]=event.target.value;return next;})} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-2 py-2 text-xs"><option value="">Choose player</option>{ranked.slice(0,60).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>)}</div>{compared.length===2?<div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-2 text-center"><div><button type="button" onClick={()=>onInspect?.(compared[0])} className="font-bold hover:text-cyan-100">{compared[0].name}</button><div className="mt-2 text-xl font-black text-cyan-100">{Math.round(compared[0].value)}</div><small className="text-white/30">{compared[0].pos} · age {compared[0].age||"—"}</small></div><span className="self-center text-white/20">VS</span><div><button type="button" onClick={()=>onInspect?.(compared[1])} className="font-bold hover:text-cyan-100">{compared[1].name}</button><div className="mt-2 text-xl font-black text-violet-100">{Math.round(compared[1].value)}</div><small className="text-white/30">{compared[1].pos} · age {compared[1].age||"—"}</small></div></div>:null}</div><div className="rounded-2xl bg-white/[0.025] p-4"><h3 className="font-black">Stack opportunities</h3><p className="mt-1 text-[10px] text-white/30">Correlation with players already on the selected roster.</p><div className="mt-3 flex flex-wrap gap-2">{stacks.length?stacks.map(item=><button key={item.id} onClick={()=>onInspect?.(item)} className="rounded-xl bg-cyan-300/[0.055] px-3 py-2 text-xs"><b>{item.name}</b> · {item.team}</button>):<span className="text-xs text-white/35">No top-ranked stacks detected.</span>}</div></div></div></div><div className="space-y-4"><div className="rounded-2xl bg-white/[0.025] p-4"><h3 className="font-black">My queue · {queue.length}</h3><div className="mt-3 space-y-2">{queue.map((id,index)=>{const item=ranked.find(row=>row.id===id);return item?<div key={id} className="flex items-center gap-2 rounded-xl bg-black/15 p-2 text-xs"><b className="text-white/25">{index+1}</b><button type="button" onClick={()=>onInspect?.(item)} className="min-w-0 flex-1 truncate text-left hover:text-cyan-100">{item.name}</button><span className="text-white/30">{item.pos}</span><button onClick={()=>toggleQueue(id)} className="text-rose-100/60">×</button></div>:null})}{!queue.length?<div className="text-xs text-white/35">Star players to build a live queue. Drafted players are removed automatically.</div>:null}</div></div><details className="rounded-2xl bg-white/[0.025] p-4" open><summary className="cursor-pointer font-black">Draft grade timeline</summary><div className="mt-3 space-y-2">{gradeRows.map(({pick,p,grade,pendingReason})=><div key={pick.pick_no} className="flex justify-between gap-3 rounded-xl bg-black/15 p-2 text-xs"><button type="button" onClick={()=>onInspect?.(pick.player_id)} className="min-w-0 truncate text-left hover:text-cyan-100">#{pick.pick_no} · {p?.full_name||pick.player_id}</button><div className="flex shrink-0 items-center gap-1.5"><b className={grade==="Value win"?"text-emerald-100":grade==="Reach"?"text-rose-100":"text-white/45"}>{grade}</b>{grade==="Pending"?<span className="group relative"><button type="button" aria-label={`Why ${p?.full_name||pick.player_id} is pending`} className="grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-white/[0.05] text-[10px] font-black text-white/55 outline-none hover:border-cyan-300/30 hover:text-cyan-100 focus:border-cyan-300/40 focus:text-cyan-100">?</button><span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 hidden w-64 rounded-xl border border-white/12 bg-slate-950 p-3 text-left text-[11px] font-normal leading-4 text-white/70 shadow-2xl group-hover:block group-focus-within:block">{pendingReason}</span></span>:null}</div></div>)}</div></details>{rookiePicks.length?<div className="rounded-2xl bg-amber-300/[0.045] p-4"><h3 className="font-black text-amber-100">Incoming rookie picks</h3><div className="mt-2 text-xs text-white/45">{rookiePicks.map(pick=>`${pick.season||"Future"} R${pick.round}`).join(" · ")}</div></div>:null}<div className="rounded-2xl bg-white/[0.025] p-4"><h3 className="font-black">Player context</h3><p className="mt-1 text-[10px] text-white/30">Depth, experience, status, and current market framing.</p>{top?<div className="mt-3 text-xs leading-5 text-white/50"><button type="button" onClick={()=>onInspect?.(top)} className="font-bold text-white hover:text-cyan-100">{top.name}</button><br/>{top.player?.depth_chart_position?`Depth chart: ${top.player.depth_chart_position} · `:""}{top.player?.years_exp!=null?`${top.player.years_exp} years experience · `:""}{top.player?.status||"Active"}<br/><a className="text-cyan-100" target="_blank" rel="noreferrer" href={`https://news.google.com/search?q=${encodeURIComponent(top.name+" NFL")}`}>Latest player news ↗</a> · {valueFormat} market</div>:null}</div></div></div></Panel>;
}

function DraftPreparation({ ranked, strategy, setStrategy, queue, toggleQueue, compareIds, setCompareIds, onInspect }) {
  const compared = compareIds.map((id) => ranked.find((row) => row.id === id)).filter(Boolean);
  return <Panel className="mt-5 overflow-hidden border-violet-300/15"><div className="border-b border-white/10 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-200/55">Draft preparation</div><h2 className="mt-1 text-xl font-black">Strategy, queue, and comparison</h2><p className="mt-1 text-xs text-white/35">Simulation, room intelligence, auction planning, and grading live once in Strategy Suite.</p></div><div className="grid gap-4 p-4 xl:grid-cols-3"><div><h3 className="text-sm font-black">Build preset</h3><div className="mt-3 flex flex-wrap gap-2">{[["balanced","Balanced"],["win-now","Win now"],["productive-struggle","Productive struggle"],["zero-rb","Zero RB"],["best-ball","Best Ball"]].map(([key,label]) => <button type="button" key={key} onClick={() => setStrategy(key)} className={`rounded-full border px-3 py-1.5 text-xs ${strategy === key ? "border-violet-300/30 bg-violet-300/10 text-violet-100" : "border-white/10 text-white/40"}`}>{label}</button>)}</div></div><div><div className="flex items-center justify-between"><h3 className="text-sm font-black">Ready queue</h3><span className="text-[10px] text-white/30">{queue.length} saved</span></div><div className="mt-3 flex flex-wrap gap-2">{queue.map((id) => { const item=ranked.find((row) => row.id === id); return item ? <button type="button" onClick={() => toggleQueue(id)} key={id} className="rounded-xl bg-amber-300/[0.06] px-3 py-2 text-xs text-amber-100">{item.name} ×</button> : null; })}{!queue.length ? <span className="text-xs text-white/35">Add a candidate below.</span> : null}</div><select defaultValue="" onChange={(event) => { if (event.target.value) toggleQueue(event.target.value); event.target.value=""; }} className="mt-3 min-h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-xs"><option value="">Add player to queue…</option>{ranked.slice(0, 80).filter((row) => !queue.includes(row.id)).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.pos}</option>)}</select></div><div><h3 className="text-sm font-black">Compare candidates</h3><div className="mt-3 grid grid-cols-2 gap-2">{[0,1].map((index) => <select key={index} value={compareIds[index] || ""} onChange={(event) => setCompareIds((current) => { const next=[...current];next[index]=event.target.value;return next; })} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-2 py-2 text-xs"><option value="">Choose</option>{ranked.slice(0, 80).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>)}</div>{compared.length === 2 ? <button type="button" onClick={() => onInspect?.(compared[0].value >= compared[1].value ? compared[0] : compared[1])} className="mt-3 w-full rounded-xl bg-cyan-300/[0.05] p-3 text-left text-xs"><b>{compared[0].name}</b> {Math.round(compared[0].value).toLocaleString()} <span className="mx-2 text-white/20">vs</span> <b>{compared[1].name}</b> {Math.round(compared[1].value).toLocaleString()}<div className="mt-1 text-[9px] text-cyan-100">Open higher-valued candidate intelligence →</div></button> : null}</div></div></Panel>;
}

export default function DraftHelperClient() {
  const { username, leagues, activeLeague, setActiveLeague, players, getPlayerValue, sourceKey, setSourceKey } = useSleeper();
  const [drafts, setDrafts] = useState([]);
  const [draftId, setDraftId] = useState("");
  const [draft, setDraft] = useState(null);
  const [picks, setPicks] = useState([]);
  const [tradedPicks, setTradedPicks] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("room");
  const [focusRosterId, setFocusRosterId] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [poolOverride, setPoolOverride] = useState("auto");
  const [valueFormatOverride, setValueFormatOverride] = useState("auto");
  const [watchlist, setWatchlist] = useState([]);
  const [draftStrategy, setDraftStrategy] = useState("balanced");
  const [draftQueue, setDraftQueue] = useState([]);
  const [compareIds, setCompareIds] = useState(["", ""]);
  const [fastDraft, setFastDraft] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(0);
  const [refreshCountdown, setRefreshCountdown] = useState(0);
  const refreshInFlight = useRef(false);
  const league = useMemo(() => (leagues || []).find((item) => String(item.league_id) === String(activeLeague)), [activeLeague, leagues]);
  const draftingLeagues = useMemo(() => (leagues || [])
    .filter((item) => String(item.status || "").toLowerCase() === "drafting")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))), [leagues]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("league");
    if (requested && (leagues || []).some((item) => String(item.league_id) === String(requested)) && String(activeLeague || "") !== String(requested)) {
      setActiveLeague(requested);
    }
  }, [activeLeague, leagues, setActiveLeague]);

  useEffect(() => {
    try { setWatchlist(JSON.parse(localStorage.getItem("draft-helper-watchlist") || "[]")); } catch { setWatchlist([]); }
  }, []);

  const toggleWatch = (id) => setWatchlist((current) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    try { localStorage.setItem("draft-helper-watchlist", JSON.stringify(next)); } catch {}
    return next;
  });
  const toggleQueue = (id) => setDraftQueue((current) => {
    const next=current.includes(id)?current.filter((item)=>item!==id):[...current,id];
    try{localStorage.setItem(`draft-helper-queue:${draftId}`,JSON.stringify(next));}catch{}
    return next;
  });

  useEffect(() => {
    let active = true;
    if (!activeLeague) { setDrafts([]); setDraftId(""); return undefined; }
    setLoading(true); setError("");
    Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${activeLeague}/drafts`, { cache:"no-store" }).then((response) => response.ok ? response.json() : Promise.reject()),
      league?.rosters ? Promise.resolve(league.rosters) : fetch(`https://api.sleeper.app/v1/league/${activeLeague}/rosters`).then((response) => response.json()),
      league?.users ? Promise.resolve(league.users) : fetch(`https://api.sleeper.app/v1/league/${activeLeague}/users`).then((response) => response.json()),
    ]).then(([draftRows, rosterRows, userRows]) => {
      if (!active) return;
      const sorted = [...(draftRows || [])].sort((a, b) => a.status === "drafting" ? -1 : b.status === "drafting" ? 1 : n(b.created) - n(a.created));
      setDrafts(sorted); setRosters(rosterRows || []); setUsers(userRows || []);
      setDraftId((current) => sorted.some((item) => String(item.draft_id) === String(current)) ? current : String(sorted[0]?.draft_id || ""));
    }).catch(() => active && setError("This league's draft information could not be loaded.")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [activeLeague, league?.rosters, league?.users]);

  const refreshDraft = useCallback(async (quiet = false) => {
    if (!draftId || refreshInFlight.current === draftId) return;
    const requestDraftId = draftId;
    refreshInFlight.current = requestDraftId;
    if (!quiet) setLoading(true);
    try {
      const [draftResponse, picksResponse, tradedResponse] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/draft/${draftId}`, { cache:"no-store" }),
        fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`, { cache:"no-store" }),
        fetch(`https://api.sleeper.app/v1/draft/${draftId}/traded_picks`, { cache:"no-store" }),
      ]);
      if (!draftResponse.ok || !picksResponse.ok) throw new Error();
      setDraft(await draftResponse.json());
      const pickRows = await picksResponse.json();
      setPicks(pickRows);
      setRosters((current) => current.map((roster) => {
        const selected = pickRows.filter((pick) => String(pick.roster_id) === String(roster.roster_id) || String(pick.picked_by) === String(roster.owner_id)).map((pick) => String(pick.player_id));
        return { ...roster, players:[...new Set([...(roster.players || []).map(String), ...selected])] };
      }));
      setTradedPicks(tradedResponse.ok ? await tradedResponse.json() : []);
      setLastRefreshAt(Date.now());
      setError("");
    } catch { if (!quiet) setError("Live draft data could not be refreshed."); }
    finally { if (refreshInFlight.current === requestDraftId) refreshInFlight.current = null; if (!quiet) setLoading(false); }
  }, [draftId]);

  useEffect(() => { refreshDraft(); }, [refreshDraft]);
  useEffect(() => { setPoolOverride("auto"); setValueFormatOverride("auto"); }, [draftId]);
  useEffect(()=>{try{setDraftQueue(JSON.parse(localStorage.getItem(`draft-helper-queue:${draftId}`)||"[]"));}catch{setDraftQueue([]);}},[draftId]);
  useEffect(() => {
    if (draft?.status !== "drafting") return undefined;
    const timer = setInterval(() => refreshDraft(true), fastDraft ? 5000 : 10000);
    return () => clearInterval(timer);
  }, [draft?.status, fastDraft, refreshDraft]);
  useEffect(() => {
    if (!fastDraft || draft?.status !== "drafting") { setRefreshCountdown(0); return undefined; }
    const update = () => setRefreshCountdown(Math.max(0, 5 - Math.floor((Date.now() - lastRefreshAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [draft?.status, fastDraft, lastRefreshAt]);
  useEffect(() => { setFastDraft(false); setLastRefreshAt(0); }, [draftId]);

  const rosterMap = useMemo(() => new Map(rosters.map((roster) => [String(roster.roster_id), roster])), [rosters]);
  const userMap = useMemo(() => new Map(users.map((user) => [String(user.user_id), user])), [users]);
  const signedInUser = useMemo(() => users.find((user) => [user.username, user.display_name].some((value) => String(value || "").toLowerCase() === String(username || "").toLowerCase())), [username, users]);
  const signedInRosterId = useMemo(() => String(rosters.find((roster) => String(roster.owner_id) === String(signedInUser?.user_id))?.roster_id || ""), [rosters, signedInUser?.user_id]);
  const slotMap = draft?.slot_to_roster_id || {};
  const teams = n(draft?.settings?.teams || league?.total_rosters || rosters.length || 12);
  const rounds = n(draft?.settings?.rounds || 0);
  const totalPicks = teams * rounds;
  const nextPickNo = Math.min(totalPicks || picks.length + 1, picks.length + 1);
  const nextSlot = getSlotForPick(nextPickNo, teams, draft?.type || "snake");
  const nextRound = Math.ceil(nextPickNo / Math.max(1, teams));
  const nextOriginalRosterId = String(slotMap[nextSlot] || "");
  const nextTradedPick = [...tradedPicks].reverse().find((item) => n(item.round) === nextRound && String(item.roster_id) === nextOriginalRosterId);
  const nextRosterId = String(nextTradedPick?.owner_id || nextOriginalRosterId);

  useEffect(() => {
    const preferred = signedInRosterId || nextRosterId || String(rosters[0]?.roster_id || "");
    if (preferred) setFocusRosterId(preferred);
  }, [draftId, signedInRosterId]);
  useEffect(() => {
    if (tab === "myteam" && signedInRosterId) setFocusRosterId(signedInRosterId);
  }, [signedInRosterId, tab]);

  const formatInfo = useMemo(() => {
    const detected = classifyLeagueFormat(league || {}, drafts);
    const explicitType = Number(league?.settings?.type);
    if (explicitType === 2) return { ...detected, key:"dynasty", label:"Dynasty", shortLabel:"DYN", confidence:"high" };
    if (explicitType === 1) return { ...detected, key:"keeper", label:"Keeper", shortLabel:"KPR", confidence:"high" };
    return detected;
  }, [drafts, league]);
  const qbType = useMemo(() => {
    const slots = (league?.roster_positions || []).map(upper);
    return slots.filter((slot) => slot === "QB").length >= 2 || slots.some((slot) => ["SUPER_FLEX", "SUPERFLEX", "OP"].includes(slot)) ? "sf" : "1qb";
  }, [league?.roster_positions]);
  const detectedValueFormat = formatInfo.key === "dynasty" || upper(draft?.type) === "ROOKIE" ? "dynasty" : "redraft";
  const valueFormat = valueFormatOverride === "auto" ? detectedValueFormat : valueFormatOverride;
  const pickedIds = useMemo(() => new Set(picks.map((pick) => String(pick.player_id))), [picks]);
  useEffect(()=>{setDraftQueue(current=>{const next=current.filter(id=>!pickedIds.has(String(id)));if(next.length!==current.length){try{localStorage.setItem(`draft-helper-queue:${draftId}`,JSON.stringify(next));}catch{}}return next;});},[draftId,pickedIds]);
  const rosteredIds = useMemo(() => new Set(rosters.flatMap((roster) => roster.players || []).map(String)), [rosters]);
  const inferredPool = useMemo(() => {
    const label = `${draft?.metadata?.name || ""} ${draft?.metadata?.description || ""}`.toLowerCase();
    if (/vet|veteran/.test(label)) return "veterans";
    if (/rookie/.test(label)) return "rookies";
    const sampled = picks.map((pick) => players?.[pick.player_id]).filter(Boolean);
    if (sampled.length >= 2) {
      const rookieShare = sampled.filter((player) => n(player?.years_exp) === 0 || n(player?.rookie_year) >= n(draft?.season)).length / sampled.length;
      if (rookieShare >= 0.8) return "rookies";
      if (rookieShare <= 0.2) return "veterans";
    }
    return "all";
  }, [draft?.metadata?.description, draft?.metadata?.name, draft?.season, picks, players]);
  const playerPool = poolOverride === "auto" ? inferredPool : poolOverride;
  const rookieOnly = playerPool === "rookies";
  const rosterSlots = useMemo(() => (league?.roster_positions || []).map(upper), [league?.roster_positions]);
  const allowsKicker = rosterSlots.includes("K");
  const allowsTeamDefense = rosterSlots.some((slot) => ["DEF", "DST", "D/ST"].includes(slot));
  const allowsIdp = rosterSlots.some((slot) => IDP.has(slot) || ["IDP_FLEX", "IDP FLEX"].includes(slot));
  const eligible = useMemo(() => Object.entries(players || {}).map(([id, player]) => ({ id, player, pos:effectivePosition(player) })).filter(({ id, player, pos }) => {
    if (!OFFENSE.has(pos) && !IDP.has(pos)) return false;
    if (pos === "K" && !allowsKicker) return false;
    if (pos === "DEF" && !allowsTeamDefense) return false;
    if (IDP.has(pos) && !allowsIdp) return false;
    if (pickedIds.has(id) || rosteredIds.has(id)) return false;
    if (["Inactive", "Retired"].includes(player?.status)) return false;
    if (rookieOnly && !(n(player?.years_exp) === 0 || n(player?.rookie_year) >= n(draft?.season))) return false;
    if (playerPool === "veterans" && (n(player?.years_exp) === 0 || n(player?.rookie_year) >= n(draft?.season))) return false;
    return true;
  }).map(({ id, player, pos }) => ({ id, player, pos, name:playerName(player, id), team:player.team, age:n(player.age), value:n(getPlayerValue(player, { format:valueFormat, qbType })) })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value), [allowsIdp, allowsKicker, allowsTeamDefense, draft?.season, getPlayerValue, pickedIds, playerPool, players, qbType, rookieOnly, rosteredIds, valueFormat]);

  const draftedByRoster = useMemo(() => {
    const map = new Map();
    picks.forEach((pick) => {
      const rosterId = String(pick.roster_id || rosters.find((roster) => String(roster.owner_id) === String(pick.picked_by))?.roster_id || "");
      if (!rosterId || !pick.player_id) return;
      if (!map.has(rosterId)) map.set(rosterId, []);
      map.get(rosterId).push(String(pick.player_id));
    });
    return map;
  }, [picks, rosters]);
  const focusRoster = rosterMap.get(String(focusRosterId));
  const focusDraftedIds = draftedByRoster.get(String(focusRosterId)) || [];
  const needs = useMemo(() => buildNeeds(focusRoster, players, league, focusDraftedIds), [focusDraftedIds, focusRoster, league, players]);
  const needMap = useMemo(() => new Map(needs.map((need) => [need.pos, need])), [needs]);
  const ranked = useMemo(() => eligible.slice(0, 160).map((item, index, list) => {
    const need = needMap.get(item.pos) || { urgency:1, count:0, gap:0 };
    const samePositionAhead = list.slice(0, index).filter((row) => row.pos === item.pos).length;
    const scarcity = Math.max(0, 1 - samePositionAhead / 12);
    const age=item.age||27;const presetMultiplier=draftStrategy==="win-now"?(age>=25?1.08:.98):draftStrategy==="productive-struggle"?(age<=24?1.13:.92):draftStrategy==="zero-rb"?(item.pos==="RB"?.82:1.07):draftStrategy==="best-ball"?(["WR","QB","TE"].includes(item.pos)?1.06:1):1;
    return { ...item, need, fitScore:item.value * need.urgency, strategyScore:item.value * (0.9 + need.urgency * 0.14 + scarcity * 0.08) * presetMultiplier };
  }), [draftStrategy, eligible, needMap]);
  const bestValue = ranked[0];
  const bestFit = [...ranked].sort((a, b) => b.fitScore - a.fitScore)[0];
  const bestStrategy = [...ranked].sort((a, b) => b.strategyScore - a.strategyScore)[0];
  const recommendation = (item, mode) => item ? { ...item, reason:mode === "value" ? `${item.name} is the highest-valued eligible player in the selected ${valueFormat} market. The recommendation intentionally does not force positional need over a meaningful value tier.` : mode === "fit" ? `${item.pos} is ${item.need.gap > 0 ? `short by about ${item.need.gap.toFixed(1)} starter slots` : `one of this roster's thinner positions`}. This selection balances market value with the actual lineup and current depth.` : `${item.name} combines strong value with ${item.need.urgency > 1.1 ? "an urgent roster need" : "positional scarcity"}. The strategy score avoids a large reach while accounting for what may be harder to replace later.` } : null;
  const recommendations = [recommendation(bestValue, "value"), recommendation(bestFit, "fit"), recommendation(bestStrategy, "strategy")];

  const ownerForCell = (round, slot) => {
    const original = String(slotMap[slot] || "");
    const traded = [...tradedPicks].reverse().find((item) => n(item.round) === round && String(item.roster_id) === original);
    return String(traded?.owner_id || original);
  };
  const remainingOwnedPicks = Array.from({ length:Math.max(0, totalPicks - picks.length) }, (_, index) => picks.length + index + 1).filter((pickNo) => {
    const round = Math.ceil(pickNo / Math.max(1, teams));
    const slot = getSlotForPick(pickNo, teams, draft?.type || "snake");
    return ownerForCell(round, slot) === String(signedInRosterId || focusRosterId);
  });
  const nextMyPick = remainingOwnedPicks[0] || null;
  const picksAway = nextMyPick ? Math.max(0, nextMyPick - nextPickNo) : null;
  const recentPositionCounts = [...picks].slice(-12).reduce((map, pick) => { const pos=effectivePosition(players?.[pick.player_id]) || "Other"; map[pos]=(map[pos]||0)+1; return map; }, {});
  const recentRun = Object.entries(recentPositionCounts).map(([pos,count]) => ({ pos,count,sample:Math.min(12,picks.length) })).sort((a,b) => b.count-a.count)[0] || null;
  const draftedCounts = Object.entries(picks.reduce((map, pick) => { const pos=effectivePosition(players?.[pick.player_id]) || "Other"; map[pos]=(map[pos]||0)+1; return map; }, {})).map(([pos,count]) => ({pos,count})).sort((a,b) => b.count-a.count);
  const tierSize = ranked[0] ? ranked.filter((item) => item.value >= ranked[0].value * 0.9).length : 0;
  const valueCliff = ranked[0] && ranked[11] ? Math.max(0, Math.round((1 - ranked[11].value / ranked[0].value) * 100)) : 0;
  const pickByNumber = useMemo(() => new Map(picks.map((pick) => [n(pick.pick_no), pick])), [picks]);
  const positionOptions = ["ALL", ...new Set(eligible.map((item) => item.pos))];
  const visiblePlayers = ranked.filter((item) => (position === "ALL" || item.pos === position) && (!query.trim() || `${item.name} ${item.team} ${item.pos}`.toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 80);
  const inspectPlayer = useCallback((input) => {
    const id=String(typeof input==="object" ? input?.id || input?.player_id || "" : input || "");
    const player=typeof input==="object"&&input?.player ? input.player : players?.[id];
    if(!id||!player)return;
    window.dispatchEvent(new CustomEvent("tfa:inspect-player", { detail:{ playerId:id } }));
  },[players]);

  return <main className="min-h-screen text-white"><BackgroundParticles /><Navbar pageTitle="Draft Command Center" /><div className="mx-auto max-w-[1500px] px-4 pb-20 pt-20">
    <header className="overflow-hidden rounded-[34px] border border-cyan-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(34,211,238,.22),transparent_35%),radial-gradient(circle_at_8%_100%,rgba(139,92,246,.17),transparent_35%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-7"><div className="text-[11px] font-semibold uppercase tracking-[.28em] text-cyan-200/60">League-aware draft intelligence</div><h1 className="mt-2 text-3xl font-black sm:text-5xl">Draft Command Center</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/55 sm:text-base">Live Sleeper draftboard, traded-pick ownership, roster needs, and recommendations built for this league's actual settings.</p><div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(250px,.55fr)_auto]"><select value={activeLeague || ""} onChange={(event) => { setActiveLeague(event.target.value); setDraftId(""); setDraft(null); setPicks([]); }} className="rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm"><option value="">Choose a league</option>{(leagues || []).map((item) => <option key={item.league_id} value={item.league_id}>{item.name}</option>)}</select><select value={draftId} onChange={(event) => setDraftId(event.target.value)} disabled={!drafts.length} className="rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm"><option value="">Choose a draft</option>{drafts.map((item) => <option key={item.draft_id} value={item.draft_id}>{item.season} · {item.status} · {item.settings?.rounds || "—"} rounds</option>)}</select><button onClick={() => refreshDraft()} disabled={!draftId || loading} className="rounded-2xl bg-cyan-300/10 px-5 py-3 text-sm font-bold text-cyan-100">{loading ? "Loading..." : "Refresh live draft"}</button></div></header>

    {username && draftingLeagues.length ? <Panel className="mt-5 overflow-hidden"><div className="flex flex-col gap-1 border-b border-white/10 p-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-emerald-200/55">Drafting now</div><h2 className="mt-1 text-xl font-black">Jump into a live league</h2></div><div className="text-xs text-white/35">{draftingLeagues.length} active draft{draftingLeagues.length === 1 ? "" : "s"}</div></div><div className="flex gap-2 overflow-x-auto p-3">{draftingLeagues.map((item) => <button type="button" key={item.league_id} onClick={() => { setActiveLeague(item.league_id); setDraftId(""); setDraft(null); setPicks([]); }} className={`min-w-[220px] rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${String(item.league_id) === String(activeLeague) ? "border-emerald-300/30 bg-emerald-300/[0.09]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-1 flex items-center justify-between text-[10px] text-white/35"><span>{item.season || "Current season"}</span><span className="font-semibold text-emerald-100/70">Open →</span></div></button>)}</div></Panel> : null}
    {!username ? <Panel className="mt-5 p-8 text-center text-white/55">Log in with your Sleeper username on the homepage to load your leagues.</Panel> : null}
    {error ? <div className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.07] p-4 text-sm text-rose-100">{error}</div> : null}
    {username && activeLeague && !loading && !drafts.length ? <Panel className="mt-5 p-8 text-center"><div className="text-lg font-black">No Sleeper drafts found</div><p className="mt-2 text-sm text-white/42">This league does not currently expose a draft to build a board from.</p></Panel> : null}

    {draft ? <>
      <Panel className={`mt-5 overflow-hidden ${fastDraft ? "border-emerald-300/30 shadow-[0_0_38px_-22px_rgba(52,211,153,.75)]" : ""}`}>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className={`text-[10px] font-semibold uppercase tracking-[.22em] ${fastDraft ? "text-emerald-200" : "text-white/35"}`}>{fastDraft ? "Live fast draft active" : "Live draft mode"}</div>
            <div className="mt-1 text-lg font-black">{fastDraft ? "Five-second command mode" : "Standard draft monitoring"}</div>
            <p className="mt-1 text-xs text-white/38">{fastDraft ? `Refreshing every five seconds${lastRefreshAt ? ` · next check in ${refreshCountdown}s` : ""}.` : draft.status === "drafting" ? "Currently refreshing every ten seconds." : "Fast Draft activates when this draft is live."}</p>
          </div>
          <button type="button" onClick={() => { const next=!fastDraft; setFastDraft(next); setTab("room"); if(next) refreshDraft(true); }} disabled={draft.status !== "drafting"} className={`rounded-2xl border px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${fastDraft ? "border-emerald-300/35 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-white/[0.045] text-white/70 hover:border-emerald-300/25 hover:text-emerald-100"}`}>{fastDraft ? "Exit Fast Draft" : "Start Fast Draft"}</button>
        </div>
        {fastDraft ? <div className="border-t border-white/10 bg-emerald-300/[0.025] p-3 sm:p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.25fr_1.5fr]">
            <div className="rounded-2xl bg-black/20 p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/35">On the clock · #{nextPickNo}</div><div className="mt-1 truncate text-lg font-black text-emerald-100">{managerName(nextRosterId, rosterMap, userMap)}</div></div>
            <div className="rounded-2xl bg-black/20 p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/35">Your next selection</div><div className="mt-1 text-lg font-black">{nextMyPick ? `#${nextMyPick}` : "No pick remaining"}</div><div className="text-[10px] text-white/35">{picksAway != null ? `${picksAway} picks away` : "Draft plan complete"}</div></div>
            <div className="rounded-2xl bg-black/20 p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/35">Best live recommendation</div><button type="button" onClick={()=>inspectPlayer(recommendations[2]||recommendations[0]||null)} className="mt-1 block max-w-full truncate text-left text-lg font-black text-cyan-100 hover:text-cyan-50">{recommendations[2]?.name || recommendations[0]?.name || "Waiting for board"}</button><div className="text-[10px] text-white/35">{recommendations[2] ? `${recommendations[2].pos} · ${Math.round(recommendations[2].value).toLocaleString()} value` : "No eligible recommendation"}</div></div>
            <div className="rounded-2xl bg-black/20 p-3"><div className="flex items-center justify-between"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/35">Ready queue</div><button type="button" onClick={()=>setTab("players")} className="text-[10px] font-semibold text-cyan-100">Open players →</button></div><div className="mt-2 flex flex-wrap gap-1.5">{draftQueue.slice(0,5).map(id=>{const item=ranked.find(row=>row.id===id);return item?<button type="button" onClick={()=>inspectPlayer(item)} key={id} className="rounded-lg bg-white/[0.06] px-2 py-1 text-[10px] hover:bg-cyan-300/[0.09]"><b>{item.name}</b> · {item.pos}</button>:null})}{!draftQueue.length?<span className="text-xs text-white/35">Queue players before the clock reaches you.</span>:null}</div></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Latest picks</span>
            {[...picks].reverse().slice(0,3).map(pick=><button type="button" onClick={()=>inspectPlayer(pick.player_id)} key={pick.pick_no} className="rounded-lg bg-white/[0.045] px-2.5 py-1.5 text-[10px] hover:bg-cyan-300/[0.09]">#{pick.pick_no} <b>{playerName(players?.[pick.player_id],pick.player_id)}</b></button>)}
            <button type="button" onClick={()=>refreshDraft()} disabled={loading} className="ml-auto rounded-xl bg-emerald-300/10 px-3 py-2 text-[10px] font-bold text-emerald-100">Sync now</button>
          </div>
        </div> : null}
      </Panel>
      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8"><Stat label="Draft state" value={draft.status || "—"} detail={draft.status === "drafting" ? fastDraft ? "Fast Draft · every 5s" : "Auto-refreshing every 10s" : "Manual refresh available"} /><Stat label="Format" value={formatInfo.label} detail={formatInfo.confidence + " confidence"} /><Stat label="QB format" value={qbType === "sf" ? "Superflex" : "1QB"} /><Stat label="Draft pool" value={rookieOnly ? "Rookies" : "Full player pool"} /><Stat label="Progress" value={`${picks.length}/${totalPicks}`} /><Stat label="On the clock" value={managerName(nextRosterId, rosterMap, userMap)} detail={`Pick ${nextPickNo}`} /><Stat label="Teams" value={teams} /><Stat label="Rounds" value={rounds} /></section>
      <Panel className="mt-5 p-4"><div className="grid gap-4 xl:grid-cols-[minmax(0,.8fr)_minmax(420px,1.2fr)] xl:items-center"><div><div className="text-sm font-bold">Draft controls</div><p className="mt-1 text-xs text-white/35">Player eligibility and your selected market or projection model are always available before recommendations.</p><label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Eligible pool<select value={poolOverride} onChange={(event) => setPoolOverride(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-white"><option value="auto">Auto: {inferredPool === "veterans" ? "Veterans only" : inferredPool === "rookies" ? "Rookies only" : "All unrostered players"}</option><option value="all">All unrostered players</option><option value="veterans">Veterans only</option><option value="rookies">Rookies only</option></select></label><label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Market format<select value={valueFormatOverride} onChange={(event) => setValueFormatOverride(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-white"><option value="auto">Auto: {detectedValueFormat === "dynasty" ? "Dynasty" : "Redraft"}</option><option value="dynasty">Dynasty values</option><option value="redraft">Redraft values</option></select></label></div><SourceSelector value={sourceKey || "val:fantasycalc"} onChange={setSourceKey} sources={DEFAULT_SOURCES} mode={valueFormat} onModeChange={setValueFormatOverride} qbType={qbType} label="Draft player source" layout="inline" /></div></Panel>
      <Panel className="sticky top-14 z-30 mt-5 overflow-x-auto rounded-2xl bg-slate-950/95 p-2 backdrop-blur"><div className="flex w-max gap-1">{[["room","Draft Room"],["myteam","My Team"],["board","Full Board"],["players","Player Queue"],["needs","Team Needs"],["strategy","Strategy Suite"]].map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === key ? "bg-white/10 text-white" : "text-white/42"}`}>{label}</button>)}</div></Panel>
      {tab === "room" ? <DraftIntelligence nextMyPick={nextMyPick} picksAway={picksAway} recentRun={recentRun} tierSize={tierSize} valueCliff={valueCliff} draftedCounts={draftedCounts} /> : null}
      {tab === "room" && !fastDraft ? <DraftPreparation ranked={ranked} strategy={draftStrategy} setStrategy={setDraftStrategy} queue={draftQueue} toggleQueue={toggleQueue} compareIds={compareIds} setCompareIds={setCompareIds} onInspect={inspectPlayer}/> : null}

      {tab === "myteam" ? <MyTeamView name={managerName(signedInRosterId || focusRosterId, rosterMap, userMap)} roster={rosterMap.get(String(signedInRosterId || focusRosterId))} draftedIds={draftedByRoster.get(String(signedInRosterId || focusRosterId)) || []} needs={buildNeeds(rosterMap.get(String(signedInRosterId || focusRosterId)), players, league, draftedByRoster.get(String(signedInRosterId || focusRosterId)) || [])} recommendations={recommendations} candidates={ranked} players={players} onInspect={inspectPlayer} /> : null}

      {tab === "room" ? <Panel className="mt-5 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black">{managerName(focusRosterId, rosterMap, userMap)}</h2>{focusRosterId === signedInRosterId ? <span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-100">YOUR TEAM</span> : null}</div><p className="mt-1 text-xs text-white/38">{focusDraftedIds.length} selection{focusDraftedIds.length === 1 ? "" : "s"} recorded in this draft.</p></div><div className="flex flex-wrap gap-2">{needs.filter((need) => need.drafted > 0).map((need) => <div key={need.pos} className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.045] px-3 py-2 text-center"><div className="font-black text-cyan-100">{need.drafted}</div><div className="text-[9px] font-semibold uppercase text-white/35">{need.pos} drafted</div></div>)}{!focusDraftedIds.length ? <div className="rounded-xl bg-white/[0.035] px-4 py-3 text-xs text-white/40">No selections yet</div> : null}</div></div></Panel> : null}

      {tab === "room" ? <div className="mt-5 space-y-5"><Panel className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-200/55">Recommendation target</div><h2 className="mt-1 text-2xl font-black">{managerName(focusRosterId, rosterMap, userMap)}</h2><p className="mt-1 text-xs text-white/38">Defaults to the roster currently on the clock. Select any team to prepare ahead.</p></div><select value={focusRosterId} onChange={(event) => setFocusRosterId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm">{rosters.map((roster) => <option key={roster.roster_id} value={roster.roster_id}>{managerName(roster.roster_id, rosterMap, userMap)}</option>)}</select></div></Panel><div className="grid gap-4 xl:grid-cols-3"><RecommendationCard label="Best value" item={recommendations[0]} tone="cyan" onWatch={toggleWatch} watched={watchlist.includes(recommendations[0]?.id)} onInspect={inspectPlayer} /><RecommendationCard label="Best roster fit" item={recommendations[1]} tone="violet" onWatch={toggleWatch} watched={watchlist.includes(recommendations[1]?.id)} onInspect={inspectPlayer} /><RecommendationCard label="Best strategy" item={recommendations[2]} tone="amber" onWatch={toggleWatch} watched={watchlist.includes(recommendations[2]?.id)} onInspect={inspectPlayer} /></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]"><Panel className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Recent selections</h3></div><div className="grid gap-2 p-4 sm:grid-cols-2">{[...picks].reverse().slice(0, 10).map((pick) => <div key={pick.pick_no} className="flex items-center gap-3 rounded-2xl bg-white/[0.025] p-3"><span className="text-xs font-black text-cyan-100/55">{pick.round}.{String(pick.draft_slot).padStart(2, "0")}</span><AvatarImage name={playerName(players?.[pick.player_id], pick.player_id)} playerId={pick.player_id} size={34} className="rounded-xl" alt="" /><div className="min-w-0"><button type="button" onClick={()=>inspectPlayer(pick.player_id)} className="block max-w-full truncate text-left text-sm font-semibold hover:text-cyan-100">{playerName(players?.[pick.player_id], pick.player_id)}</button><div className="truncate text-[10px] text-white/32">{managerName(pick.roster_id, rosterMap, userMap)}</div></div></div>)}</div></Panel><Panel className="p-5"><h3 className="text-xl font-black">Position pressure</h3><p className="mt-1 text-xs text-white/35">Current roster depth against configured starters.</p><div className="mt-4 space-y-3">{needs.slice(0, 8).map((need) => <div key={need.pos}><div className="flex justify-between text-xs"><b>{need.pos}</b><span className={need.gap > 0 ? "text-amber-100" : "text-white/38"}>{need.count} rostered · {need.target.toFixed(1)} target</span></div><div className="mt-1.5 h-1.5 rounded bg-white/[0.05]"><div className={`h-full rounded ${need.gap > 0 ? "bg-amber-300" : "bg-emerald-300"}`} style={{ width:`${Math.min(100, need.count / Math.max(1, need.target) * 100)}%` }} /></div></div>)}</div></Panel></div></div> : null}

      {tab === "board" ? <Panel className="mt-5 overflow-hidden"><div className="border-b border-white/10 p-5"><h2 className="text-2xl font-black">Complete draftboard</h2><p className="mt-1 text-xs text-white/38">Horizontal scrolling preserves the full board on phones. Empty cells show current pick ownership.</p></div><div className="overflow-x-auto p-4"><div className="grid min-w-max gap-2" style={{ gridTemplateColumns:`60px repeat(${teams}, minmax(132px, 1fr))` }}><div />{Array.from({ length:teams }, (_, index) => <div key={index} className="truncate px-2 pb-1 text-center text-[10px] font-semibold text-white/35">{managerName(slotMap[index + 1], rosterMap, userMap)}</div>)}{Array.from({ length:rounds }, (_, roundIndex) => { const round=roundIndex+1; return [<div key={`r${round}`} className="grid place-items-center text-xs font-black text-white/35">R{round}</div>, ...Array.from({ length:teams }, (_, visualIndex) => { const slot=visualIndex+1; const pickNo=(round-1)*teams+(draft.type === "snake" && round%2===0 ? teams-slot+1 : slot); const pick=pickByNumber.get(pickNo); const ownerId=pick ? String(pick.roster_id) : ownerForCell(round, slot); const onClock=pickNo===nextPickNo && draft.status==="drafting"; return <div key={pickNo} className={`min-h-[92px] rounded-2xl border p-2.5 ${pick ? "border-white/10 bg-white/[0.035]" : onClock ? "border-cyan-300/35 bg-cyan-300/[0.09] shadow-[0_0_24px_-12px_rgba(34,211,238,.9)]" : "border-white/[0.06] bg-black/10"}`}><div className="flex justify-between text-[9px] text-white/28"><span>{round}.{String(slot).padStart(2, "0")}</span>{onClock ? <span className="font-bold text-cyan-100">ON CLOCK</span> : null}</div>{pick ? <><button type="button" onClick={()=>inspectPlayer(pick.player_id)} className="mt-2 block max-w-full truncate text-left text-xs font-bold hover:text-cyan-100">{playerName(players?.[pick.player_id], pick.player_id)}</button><div className="mt-1 text-[9px] text-white/30">{effectivePosition(players?.[pick.player_id])} · {players?.[pick.player_id]?.team || "FA"}</div></> : <div className="mt-3 text-[10px] leading-4 text-white/35">{managerName(ownerId, rosterMap, userMap)}</div>}</div>; })]; })}</div></div></Panel> : null}

      {tab === "players" ? <Panel className="mt-5 overflow-hidden"><div className="border-b border-white/10 p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-2xl font-black">Available player queue</h2><p className="mt-1 text-xs text-white/38">Sorted by selected market value with roster-fit context.</p></div><div className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players..." className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" /><select value={position} onChange={(event) => setPosition(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm">{positionOptions.map((item) => <option key={item}>{item}</option>)}</select></div></div></div><div className="divide-y divide-white/[0.06]">{visiblePlayers.map((item, index) => <div key={item.id} className="flex items-center gap-3 p-3 sm:p-4"><div className="w-7 text-center text-xs font-black text-white/25">{index + 1}</div><AvatarImage name={item.name} playerId={item.id} size={42} className="rounded-xl" alt="" /><div className="min-w-0 flex-1"><button type="button" onClick={()=>inspectPlayer(item)} className="block max-w-full truncate text-left font-semibold hover:text-cyan-100">{item.name}</button><div className="text-xs text-white/35">{item.pos} · {item.team || "FA"} · {item.need.gap > 0 ? "Need" : "Depth"}</div></div><div className="text-right"><div className="font-black text-cyan-100">{Math.round(item.value).toLocaleString()}</div><div className="text-[9px] text-white/25">value</div></div><button type="button" onClick={()=>inspectPlayer(item)} className="rounded-xl bg-cyan-300/[0.07] px-3 py-2 text-[10px] font-bold text-cyan-100">Player intelligence</button><button onClick={() => toggleWatch(item.id)} className={`rounded-xl px-3 py-2 text-lg ${watchlist.includes(item.id) ? "bg-amber-300/10 text-amber-100" : "bg-white/[0.04] text-white/30"}`} aria-label="Toggle watchlist">★</button></div>)}</div></Panel> : null}

      {tab === "needs" ? <TeamNeedsView rosters={rosters} rosterMap={rosterMap} userMap={userMap} players={players} league={league} draftedByRoster={draftedByRoster} ranked={ranked} onRecommend={(rosterId)=>{setFocusRosterId(String(rosterId));setTab("room");}} onInspect={inspectPlayer} /> : null}
      {tab === "strategy" ? <DraftStrategySuite ranked={ranked} picks={picks} picksAway={picksAway} nextMyPick={nextMyPick} players={players} rosters={rosters} focusRosterId={focusRosterId} draftedByRoster={draftedByRoster} rosterMap={rosterMap} userMap={userMap} getPlayerValue={(player)=>getPlayerValue(player,{format:valueFormat,qbType})} teams={teams} rounds={rounds} draft={draft} onInspect={inspectPlayer} /> : null}

    </> : null}
  </div></main>;
}
