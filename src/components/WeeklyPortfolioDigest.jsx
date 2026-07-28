"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSleeper } from "../context/SleeperContext";
import { useArsenalAccount } from "../context/ArsenalAccountContext";

const n=(v)=>Number(v||0);
const get=async(url)=>{const r=await fetch(url);if(!r.ok)throw new Error(`Sleeper HTTP ${r.status}`);return r.json();};
const Panel=({children,className=""})=><section className={`rounded-[26px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</section>;
const Metric=({label,value,detail})=><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-white/30">{label}</div><div className="mt-1 text-xl font-black">{value}</div>{detail?<div className="mt-1 text-[10px] text-white/32">{detail}</div>:null}</div>;

export default function WeeklyPortfolioDigest(){
  const {username,leagues=[]}=useSleeper();
  const {account,accountRequest,syncNow}=useArsenalAccount();
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [email,setEmail]=useState("");
  const [emailEnabled,setEmailEnabled]=useState(false);
  const [message,setMessage]=useState("");
  const season=new Date().getFullYear();
  const week=Math.max(1,n(leagues[0]?.settings?.leg)||1);
  useEffect(()=>{try{const p=JSON.parse(localStorage.getItem("tfa:account-preferences")||"{}");setEmail(p.digestEmail||"");setEmailEnabled(!!p.weeklyDigest);}catch{}},[]);
  useEffect(()=>{if(!username||!leagues.length)return;let live=true;setLoading(true);setError("");(async()=>{
    const user=await get(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
    const data=await Promise.all(leagues.map(async league=>{
      const [rosters,users,matchups]=await Promise.all([
        get(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(()=>[]),
        get(`https://api.sleeper.app/v1/league/${league.league_id}/users`).catch(()=>[]),
        get(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`).catch(()=>[]),
      ]);
      const mine=rosters.find(r=>String(r.owner_id)===String(user.user_id));if(!mine)return null;
      const my=matchups.find(m=>String(m.roster_id)===String(mine.roster_id));
      const opp=matchups.find(m=>m.matchup_id===my?.matchup_id&&String(m.roster_id)!==String(mine.roster_id));
      const oppRoster=rosters.find(r=>String(r.roster_id)===String(opp?.roster_id));
      const oppUser=users.find(u=>String(u.user_id)===String(oppRoster?.owner_id));
      const points=n(my?.points),oppPoints=n(opp?.points);
      const empty=(my?.starters||[]).filter(id=>!id||id==="0").length;
      const started=points>0||oppPoints>0;
      return {id:league.league_id,name:league.name,points,oppPoints,margin:points-oppPoints,started,result:!started?"Not started":points>oppPoints?"Winning":points<oppPoints?"Losing":"Tied",empty,opponent:oppUser?.display_name||oppUser?.username||"Opponent"};
    }));
    if(live)setRows(data.filter(Boolean));
  })().catch(e=>live&&setError(e.message||"Digest unavailable.")).finally(()=>live&&setLoading(false));return()=>{live=false};},[username,leagues,week]);
  const summary=useMemo(()=>{const active=rows.filter(r=>r.started),wins=active.filter(r=>r.margin>0).length,losses=active.filter(r=>r.margin<0).length,ties=active.length-wins-losses,points=rows.reduce((s,r)=>s+r.points,0),close=active.filter(r=>Math.abs(r.margin)<=10).length,empty=rows.reduce((s,r)=>s+r.empty,0),gradedEmpty=active.reduce((s,r)=>s+r.empty,0);if(!active.length)return{wins:0,losses:0,ties:0,started:0,points,close:0,empty,score:null,grade:"—",best:null,worst:null};const winRate=(wins+ties*.5)/active.length;const score=Math.round(Math.max(0,Math.min(100,76+winRate*22-gradedEmpty*4)));return{wins,losses,ties,started:active.length,points,close,empty,score,grade:score>=97?"A+":score>=93?"A":score>=90?"A−":score>=87?"B+":score>=83?"B":score>=80?"B−":score>=77?"C+":score>=73?"C":"D",best:[...active].sort((a,b)=>b.margin-a.margin)[0],worst:[...active].sort((a,b)=>a.margin-b.margin)[0]};},[rows]);
  const saveEmail=async()=>{setMessage("");const prefs={...JSON.parse(localStorage.getItem("tfa:account-preferences")||"{}"),weeklyDigest:emailEnabled,digestEmail:email.trim()};localStorage.setItem("tfa:account-preferences",JSON.stringify(prefs));await syncNow();await accountRequest("/api/arsenal/digest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim(),enabled:emailEnabled})});setMessage(emailEnabled?"Weekly email delivery saved.":"Email delivery disabled.");};
  return <Panel className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.14),transparent_42%)] p-5"><div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200/55">Week {week} · {season}</div><div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black">Weekly Portfolio Digest</h2><p className="mt-1 text-xs leading-5 text-white/38">One account-level recap across every loaded league, with urgent problems and direct next steps.</p></div><div className="text-right"><div className="text-5xl font-black text-cyan-100">{summary.grade}</div><div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-white/30">{summary.started?`${summary.started} live matchup${summary.started===1?"":"s"}`:"Grading begins at kickoff"}</div></div></div></div>
    <div className="p-4 sm:p-5">{loading?<div className="text-sm text-white/40">Building this week’s portfolio story…</div>:error?<div className="text-sm text-rose-100">{error}</div>:<><div className="grid grid-cols-2 gap-2 lg:grid-cols-6"><Metric label="Live record" value={summary.started?`${summary.wins}-${summary.losses}${summary.ties?`-${summary.ties}`:""}`:"Not started"}/><Metric label="Points" value={summary.points.toFixed(1)}/><Metric label="Close live games" value={summary.close}/><Metric label="Lineup zeros" value={summary.empty}/><Metric label="Best live result" value={summary.best?`${summary.best.margin>=0?"+":""}${summary.best.margin.toFixed(1)}`:"—"} detail={summary.best?.name}/><Metric label="Biggest live concern" value={summary.worst?`${summary.worst.margin.toFixed(1)}`:"—"} detail={summary.worst?.name}/></div><div className="mt-4 grid gap-3 md:grid-cols-2">{[...rows].sort((a,b)=>Number(b.started)-Number(a.started)||(a.started?Math.abs(a.margin)-Math.abs(b.margin):a.name.localeCompare(b.name))).slice(0,8).map(r=><Link key={r.id} href={`/league-hub?league=${r.id}`} className="rounded-2xl border border-white/[0.07] bg-black/15 p-3 transition hover:bg-white/[0.04]"><div className="flex justify-between gap-3"><b className="truncate">{r.name}</b><span className={!r.started?"text-white/35":r.margin>=0?"text-emerald-100":"text-rose-100"}>{r.started?`${r.margin>=0?"+":""}${r.margin.toFixed(1)}`:"Not started"}</span></div><div className="mt-1 text-[10px] text-white/32">{r.started?`${r.points.toFixed(1)}–${r.oppPoints.toFixed(1)}`:"0–0"} vs {r.opponent}{r.empty?` · ${r.empty} empty slot`:""}</div></Link>)}</div><div className="mt-4 flex flex-wrap gap-2"><Link href="/game-center" className="rounded-xl bg-cyan-300/10 px-4 py-2 text-xs font-black text-cyan-100">Open live command center</Link><Link href="/lineup" className="rounded-xl bg-white/[0.05] px-4 py-2 text-xs font-black">Review lineups</Link><Link href="/player-availability" className="rounded-xl bg-white/[0.05] px-4 py-2 text-xs font-black">Find acquisitions</Link></div></>}</div>
    <div className="border-t border-white/10 p-4 sm:p-5"><h3 className="font-black">Sunday email edition</h3><p className="mt-1 text-xs text-white/35">Receive the digest at this address. Delivery uses contact.stickypicky@gmail.com after Gmail API secrets are configured.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2"/><label className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-xs"><input type="checkbox" checked={emailEnabled} onChange={e=>setEmailEnabled(e.target.checked)} className="accent-cyan-300"/> Weekly email</label><button onClick={saveEmail} disabled={!account||emailEnabled&&!email.includes("@")} className="rounded-xl bg-violet-300/10 px-4 py-2 text-xs font-black text-violet-100 disabled:opacity-35">Save delivery</button></div>{message?<div className="mt-2 text-xs text-emerald-100">{message}</div>:null}</div>
  </Panel>;
}
