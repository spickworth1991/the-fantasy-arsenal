"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../context/SleeperContext";
import AvatarImage from "./AvatarImage";
import { DEFAULT_SOURCES } from "./SourceSelector";
import PlayerResearchPanel from "./PlayerResearchPanel";

export default function GlobalPlayerSourceDrawer() {
  const { players, getPlayerValue, sourceKey, format, qbType } = useSleeper();
  const [playerId,setPlayerId]=useState("");
  useEffect(()=>{
    const open=(event)=>setPlayerId(String(event.detail?.playerId||""));
    window.addEventListener("tfa:inspect-player",open);
    return()=>window.removeEventListener("tfa:inspect-player",open);
  },[]);
  useEffect(()=>{
    if(!playerId)return undefined;
    const close=(event)=>{if(event.key==="Escape")setPlayerId("");};
    window.addEventListener("keydown",close);
    return()=>window.removeEventListener("keydown",close);
  },[playerId]);
  const player=players?.[playerId];
  const rows=useMemo(()=>player?DEFAULT_SOURCES.map(source=>{
    const supported=source.type==="projection"||source.supports?.[format]!==false;
    const amount=supported?Number(getPlayerValue(player,{sourceKey:source.key,format,qbType})||0):0;
    return{...source,supported,amount};
  }):[],[format,getPlayerValue,player,qbType]);
  if(!playerId||!player)return null;
  const name=player.full_name||player.search_full_name||[player.first_name,player.last_name].filter(Boolean).join(" ")||playerId;
  const average=(group)=>{const usable=group.map(row=>row.amount).filter(value=>value>0);return usable.length?usable.reduce((sum,value)=>sum+value,0)/usable.length:0;};
  const section=(title,group,suffix)=><section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-black">{title}</h3><span className="text-right text-[10px] text-white/35">Consensus {average(group)>0?(suffix?average(group).toFixed(1):Math.round(average(group)).toLocaleString()):"—"}{suffix}</span></div><div className="overflow-hidden rounded-2xl border border-white/10"><table className="w-full text-left text-xs"><thead className="bg-white/[0.04] text-[9px] uppercase tracking-wider text-white/30"><tr><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5 text-right">{title}</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{group.map(row=><tr key={row.key} className={row.key===sourceKey?"bg-cyan-300/[0.055]":""}><td className="px-3 py-2.5"><div className="font-semibold text-white/75">{row.label}</div>{row.key===sourceKey?<div className="text-[8px] font-semibold uppercase tracking-wider text-cyan-100/55">Current source</div>:null}</td><td className="px-3 py-2.5 text-right font-black">{!row.supported?<span className="font-normal text-white/25">Not offered for {format}</span>:row.amount>0?suffix?row.amount.toFixed(1):Math.round(row.amount).toLocaleString():<span className="font-normal text-white/25">Unavailable</span>}</td></tr>)}</tbody></table></div></section>;
  return <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event=>{if(event.target===event.currentTarget)setPlayerId("");}}><div role="dialog" aria-modal="true" aria-label={`All sources for ${name}`} className="max-h-[92vh] w-full overflow-y-auto rounded-t-[30px] border border-white/12 bg-slate-950 shadow-2xl sm:max-w-2xl sm:rounded-[30px]"><div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-950/95 p-4 backdrop-blur"><AvatarImage inspectable={false} name={name} playerId={playerId} size={46} className="rounded-2xl" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-xl font-black">{name}</div><div className="text-xs text-white/38">{player.position||"—"} · {player.team||"FA"} · {format} · {qbType==="sf"?"Superflex":"1QB"}</div></div><button type="button" onClick={()=>setPlayerId("")} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-lg text-white/60" aria-label="Close source comparison">×</button></div><div className="space-y-5 p-4 sm:p-5"><div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] p-3 text-xs leading-5 text-white/45">Values and season projections use separate scales and separate consensus figures.</div><PlayerResearchPanel player={player} name={name}/>{section("Player values",rows.filter(row=>row.type==="value"),"")}{section("Season projections",rows.filter(row=>row.type==="projection")," pts")}</div></div></div>;
}
