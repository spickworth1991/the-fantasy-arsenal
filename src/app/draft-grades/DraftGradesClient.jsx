"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";

const n = (value) => Number(value || 0);
const clamp = (value, min=0, max=100) => Math.max(min, Math.min(max, value));
const position = (player) => {
  const raw = String(player?.position || player?.fantasy_positions?.[0] || "—").toUpperCase();
  return raw === "DST" ? "DEF" : raw;
};
const playerName = (player, id) => player?.full_name || player?.search_full_name || `${player?.first_name || ""} ${player?.last_name || ""}`.trim() || id;
const grade = (score) => score >= 97 ? "A+" : score >= 93 ? "A" : score >= 90 ? "A−" : score >= 87 ? "B+" : score >= 83 ? "B" : score >= 80 ? "B−" : score >= 77 ? "C+" : score >= 73 ? "C" : score >= 70 ? "C−" : score >= 65 ? "D" : "F";
const gradeTone = (score) => score >= 90 ? "text-emerald-100" : score >= 80 ? "text-cyan-100" : score >= 70 ? "text-amber-100" : "text-rose-100";
const getJson = async (url) => {
  const response = await fetch(url, { cache:"no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

function Panel({ children, className="" }) {
  return <section className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 shadow-[0_30px_95px_-70px_rgba(34,211,238,.65)] ${className}`}>{children}</section>;
}
function Metric({ label, value, detail, tone="white" }) {
  const color = tone === "green" ? "text-emerald-100" : tone === "amber" ? "text-amber-100" : tone === "rose" ? "text-rose-100" : tone === "cyan" ? "text-cyan-100" : "text-white";
  return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3"><div className="text-[9px] font-bold uppercase tracking-[.15em] text-white/30">{label}</div><div className={`mt-1 text-xl font-black ${color}`}>{value}</div>{detail ? <div className="mt-1 text-[10px] leading-4 text-white/32">{detail}</div> : null}</div>;
}
function ownerName(user) {
  return user?.metadata?.team_name || user?.display_name || user?.username || "Unassigned team";
}
function draftIsRookie(draft, picks, players) {
  const description = [draft?.type, draft?.metadata?.type, draft?.metadata?.name, draft?.settings?.player_type, draft?.settings?.type].filter(Boolean).join(" ").toLowerCase();
  if (description.includes("rookie")) return true;
  const known = picks.map((pick) => players?.[pick.player_id]).filter(Boolean);
  return known.length >= 6 && known.filter((player) => n(player.years_exp) <= 0).length / known.length >= .82;
}
function starterRequirements(league) {
  const counts = {};
  (league?.roster_positions || []).forEach((slot) => {
    const key = String(slot || "").toUpperCase();
    if (["QB","RB","WR","TE","K","DEF"].includes(key)) counts[key] = n(counts[key]) + 1;
    else if (["FLEX","WRRB_FLEX","REC_FLEX","RBTE_FLEX"].includes(key)) counts.FLEX = n(counts.FLEX) + 1;
    else if (["SUPER_FLEX","SF","OP"].includes(key)) counts.SUPER_FLEX = n(counts.SUPER_FLEX) + 1;
  });
  return counts;
}
function teamForPick(pick, draft, rosters, users) {
  const pickedBy = users.find((user) => String(user.user_id) === String(pick.picked_by));
  let roster = rosters.find((row) => String(row.owner_id) === String(pickedBy?.user_id));
  if (!roster) {
    const rosterId = draft?.slot_to_roster_id?.[pick.draft_slot] || pick.roster_id;
    roster = rosters.find((row) => String(row.roster_id) === String(rosterId));
  }
  const user = users.find((row) => String(row.user_id) === String(roster?.owner_id)) || pickedBy;
  return { roster, user, rosterId:String(roster?.roster_id || pick.roster_id || pick.draft_slot || "unknown"), name:ownerName(user) };
}

function buildGrades({ draft, picks, players, league, rosters, users, getMetric }) {
  if (!draft || !picks.length) return null;
  const ordered = [...picks].sort((a,b) => n(a.pick_no)-n(b.pick_no));
  const rookieOnly = draftIsRookie(draft, ordered, players);
  const pickedIds = new Set(ordered.map((pick) => String(pick.player_id)));
  const draftSeason = n(draft?.season || draft?.metadata?.season);
  const currentSeason = new Date().getFullYear();
  const eligible = Object.entries(players || {}).map(([id, player]) => ({ id:String(id), player, value:n(getMetric(player)) }))
    .filter((row) => row.value > 0 && position(row.player) !== "PICK" && (
      !rookieOnly
      || pickedIds.has(row.id)
      || (draftSeason >= currentSeason && n(row.player.years_exp) <= 0)
    ))
    .sort((a,b) => b.value-a.value);
  const marketRank = new Map(eligible.map((row,index) => [row.id,index+1]));
  const requirements = starterRequirements(league);
  const draftPoolIds = new Set(ordered.map((pick) => String(pick.player_id)));
  const baseRosterIds = new Map(rosters.map((roster) => [String(roster.roster_id), (roster.players || []).map(String).filter((id) => !draftPoolIds.has(id))]));
  const teamCounts = new Map(rosters.map((roster) => {
    const counts = {};
    (baseRosterIds.get(String(roster.roster_id)) || []).forEach((id) => { const key=position(players?.[id]);counts[key]=n(counts[key])+1; });
    return [String(roster.roster_id), counts];
  }));
  const selected = new Set();
  const pickRows = ordered.map((pick) => {
    const player = players?.[pick.player_id] || { player_id:pick.player_id, full_name:pick.metadata?.first_name ? `${pick.metadata.first_name} ${pick.metadata.last_name || ""}`.trim() : pick.player_id, position:pick.metadata?.position, team:pick.metadata?.team };
    const team = teamForPick(pick, draft, rosters, users);
    const counts = teamCounts.get(team.rosterId) || {};
    const pos = position(player);
    const target = pos === "QB" ? n(requirements.QB)+n(requirements.SUPER_FLEX)+1 : pos === "RB" ? n(requirements.RB)+Math.ceil(n(requirements.FLEX)/2)+2 : pos === "WR" ? n(requirements.WR)+Math.ceil(n(requirements.FLEX)/2)+2 : pos === "TE" ? n(requirements.TE)+1 : Math.max(1,n(requirements[pos]));
    const needPct = clamp((target-n(counts[pos]))/Math.max(1,target),0,1);
    const available = eligible.filter((row) => !selected.has(row.id));
    const bestAvailable = available[0];
    const alternatives = available.filter((row) => row.id !== String(pick.player_id)).slice(0,3);
    const value = n(getMetric(player));
    const rank = marketRank.get(String(pick.player_id)) || eligible.length + 1;
    const delta = n(pick.pick_no)-rank;
    const valueScore = clamp(80 + delta*.72,35,99);
    const opportunityScore = bestAvailable?.value ? clamp(value/bestAvailable.value*100,25,100) : 75;
    const needScore = 55 + needPct*45;
    const score = Math.round(clamp(valueScore*.62 + opportunityScore*.2 + needScore*.18,35,99));
    counts[pos] = n(counts[pos])+1;
    teamCounts.set(team.rosterId,counts);
    selected.add(String(pick.player_id));
    const verdict = delta >= 18 ? "Major steal" : delta >= 8 ? "Strong value" : delta <= -18 ? "Major reach" : delta <= -8 ? "Reach" : "On market";
    return { pick, player, team, pos, value, rank, delta, valueScore, opportunityScore, needScore, needPct, score, grade:grade(score), verdict, alternatives, bestAvailable };
  });
  const teamMap = new Map();
  pickRows.forEach((row) => {
    if (!teamMap.has(row.team.rosterId)) teamMap.set(row.team.rosterId,{ ...row.team, picks:[] });
    teamMap.get(row.team.rosterId).picks.push(row);
  });
  const teams = [...teamMap.values()].map((team) => {
    const avg = team.picks.reduce((sum,row)=>sum+row.score,0)/Math.max(1,team.picks.length);
    const counts = team.picks.reduce((map,row)=>({ ...map,[row.pos]:n(map[row.pos])+1 }),{});
    const core = ["QB","RB","WR","TE"];
    const construction = rookieOnly ? team.picks.reduce((sum,row)=>sum+row.needScore,0)/Math.max(1,team.picks.length) : core.reduce((sum,key) => {
      const minimum = key === "QB" ? Math.max(1,n(requirements.QB)+n(requirements.SUPER_FLEX)) : key === "RB" ? Math.max(2,n(requirements.RB)) : key === "WR" ? Math.max(2,n(requirements.WR)) : Math.max(1,n(requirements.TE));
      return sum + clamp(n(counts[key])/minimum*100);
    },0)/core.length;
    const values = team.picks.map((row)=>row.value).filter(Boolean);
    const balance = values.length > 1 ? clamp(100-(Math.max(...values)-Math.min(...values))/Math.max(1,Math.max(...values))*25,60,100) : 80;
    const score = Math.round(clamp(avg*.78+construction*.17+balance*.05,35,99));
    const best = [...team.picks].sort((a,b)=>b.delta-a.delta)[0];
    const reach = [...team.picks].sort((a,b)=>a.delta-b.delta)[0];
    const identity = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    return { ...team, score, grade:grade(score), pickAverage:avg, construction, balance, counts, totalValue:team.picks.reduce((sum,row)=>sum+row.value,0), best, reach, identity };
  }).sort((a,b)=>b.score-a.score || b.totalValue-a.totalValue);
  teams.forEach((team,index)=>{team.rank=index+1;});
  const steals = [...pickRows].sort((a,b)=>b.delta-a.delta).slice(0,8);
  const reaches = [...pickRows].sort((a,b)=>a.delta-b.delta).slice(0,8);
  const runs = [];
  for (let start=0;start<pickRows.length;start+=1) {
    const window=pickRows.slice(start,start+6);if(window.length<4)continue;
    const counts=window.reduce((map,row)=>({...map,[row.pos]:n(map[row.pos])+1}),{});
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    if(top?.[1]>=4&&!runs.some((run)=>run.pos===top[0]&&Math.abs(run.start-n(window[0].pick.pick_no))<6))runs.push({pos:top[0],count:top[1],start:n(window[0].pick.pick_no),end:n(window.at(-1).pick.pick_no)});
  }
  return { pickRows, teams, steals, reaches, runs, rookieOnly, eligibleCount:eligible.length, requirements };
}

function PrintReport({ analysis, league, draft, sourceLabel }) {
  if (!analysis) return null;
  return <article className="draft-grade-print-only"><header className="dg-cover"><div className="dg-kicker">THE FANTASY ARSENAL · DRAFT GRADE STUDIO</div><h1>{league?.name}</h1><h2>{draft?.season} Draft Report</h2><p>{analysis.rookieOnly ? "Rookie-only" : "Full player pool"} · {analysis.pickRows.length} selections · {sourceLabel}</p><div className="dg-metrics"><div><small>Draft champion</small><b>{analysis.teams[0]?.name}</b></div><div><small>Winning grade</small><b>{analysis.teams[0]?.grade} · {analysis.teams[0]?.score}</b></div><div><small>Best value</small><b>{playerName(analysis.steals[0]?.player)}</b></div><div><small>Largest reach</small><b>{playerName(analysis.reaches[0]?.player)}</b></div></div></header><section><h2>Team leaderboard</h2><table><thead><tr><th>Rank</th><th>Team</th><th>Grade</th><th>Pick quality</th><th>Construction</th><th>Value captured</th></tr></thead><tbody>{analysis.teams.map((team)=><tr key={team.rosterId}><td>#{team.rank}</td><td>{team.name}</td><td><b>{team.grade} · {team.score}</b></td><td>{team.pickAverage.toFixed(1)}</td><td>{team.construction.toFixed(0)}</td><td>{Math.round(team.totalValue).toLocaleString()}</td></tr>)}</tbody></table></section>{analysis.teams.map((team)=><section className="dg-page" key={team.rosterId}><h2>#{team.rank} · {team.name} · {team.grade}</h2><div className="dg-metrics"><div><small>Overall</small><b>{team.score}/100</b></div><div><small>Pick average</small><b>{team.pickAverage.toFixed(1)}</b></div><div><small>Construction</small><b>{team.construction.toFixed(0)}</b></div><div><small>Drafted value</small><b>{Math.round(team.totalValue).toLocaleString()}</b></div></div><table><thead><tr><th>Pick</th><th>Player</th><th>Pos</th><th>Grade</th><th>Market rank</th><th>Verdict</th></tr></thead><tbody>{team.picks.map((row)=><tr key={row.pick.pick_no}><td>#{row.pick.pick_no}</td><td>{playerName(row.player,row.pick.player_id)}</td><td>{row.pos}</td><td>{row.grade} · {row.score}</td><td>#{row.rank}</td><td>{row.verdict}</td></tr>)}</tbody></table></section>)}<section className="dg-page"><h2>Every selection</h2><table><thead><tr><th>Pick</th><th>Team</th><th>Player</th><th>Grade</th><th>Need</th><th>Opportunity</th></tr></thead><tbody>{analysis.pickRows.map((row)=><tr key={row.pick.pick_no}><td>#{row.pick.pick_no}</td><td>{row.team.name}</td><td>{playerName(row.player,row.pick.player_id)}</td><td>{row.grade} · {row.score}</td><td>{row.needScore.toFixed(0)}</td><td>{row.opportunityScore.toFixed(0)}</td></tr>)}</tbody></table></section><footer>Grades use current selected-source values, league settings, roster construction, need at the selection, and opportunity cost. They are analytical estimates—not values known on draft day.</footer></article>;
}

export default function DraftGradesClient() {
  const { username, leagues=[], players, activeLeague, setActiveLeague, fetchLeagueRostersSilent, sourceKey, setSourceKey, format, setFormat, qbType, setQbType, getPlayerValue } = useSleeper();
  const [drafts,setDrafts]=useState([]);
  const [draftId,setDraftId]=useState("");
  const [draft,setDraft]=useState(null);
  const [picks,setPicks]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [tab,setTab]=useState("leaderboard");
  const [teamId,setTeamId]=useState("");
  const [query,setQuery]=useState("");
  const league=leagues.find((row)=>String(row.league_id)===String(activeLeague));
  const sourceLabel=DEFAULT_SOURCES.find((source)=>source.key===sourceKey)?.label || sourceKey;

  useEffect(()=>{if(!activeLeague&&leagues[0])setActiveLeague(leagues[0].league_id);},[activeLeague,leagues,setActiveLeague]);
  useEffect(()=>{
    if(!activeLeague){setDrafts([]);setDraftId("");return;}
    let active=true;setLoading(true);setError("");
    Promise.all([getJson(`https://api.sleeper.app/v1/league/${activeLeague}/drafts`),fetchLeagueRostersSilent(activeLeague)])
      .then(([rows])=>{if(!active)return;const sorted=[...(rows||[])].sort((a,b)=>n(b.season)-n(a.season)||n(b.created)-n(a.created));setDrafts(sorted);setDraftId((current)=>sorted.some((row)=>String(row.draft_id)===String(current))?current:String(sorted[0]?.draft_id||""));})
      .catch(()=>active&&setError("Drafts could not be loaded for this league.")).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[activeLeague,fetchLeagueRostersSilent]);
  useEffect(()=>{
    if(!draftId){setDraft(null);setPicks([]);return;}
    let active=true;setLoading(true);setError("");
    Promise.all([getJson(`https://api.sleeper.app/v1/draft/${draftId}`),getJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`)])
      .then(([draftRow,pickRows])=>{if(!active)return;setDraft(draftRow);setPicks(Array.isArray(pickRows)?pickRows:[]);})
      .catch(()=>active&&setError("The selected draft could not be graded.")).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[draftId]);
  const analysis=useMemo(()=>buildGrades({ draft,picks,players,league,rosters:league?.rosters||[],users:league?.users||[],getMetric:getPlayerValue }),[draft,getPlayerValue,league,picks,players]);
  useEffect(()=>{if(analysis?.teams?.length&&!analysis.teams.some((team)=>team.rosterId===teamId))setTeamId(analysis.teams[0].rosterId);},[analysis,teamId]);
  const selectedTeam=analysis?.teams.find((team)=>team.rosterId===teamId)||analysis?.teams[0];
  const boardRows=(analysis?.pickRows||[]).filter((row)=>!query.trim()||`${playerName(row.player)} ${row.team.name} ${row.pos} ${row.verdict}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="min-h-screen text-white"><BackgroundParticles/><Navbar pageTitle="Draft Grade Studio"/><div className="mx-auto max-w-7xl px-4 pb-20 pt-20">
    <header className="overflow-hidden rounded-[34px] border border-violet-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(139,92,246,.22),transparent_36%),radial-gradient(circle_at_8%_100%,rgba(34,211,238,.15),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-8"><div className="text-[10px] font-bold uppercase tracking-[.28em] text-violet-200/60">League-wide draft intelligence</div><h1 className="mt-2 text-3xl font-black sm:text-5xl">Draft Grade Studio</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Grade every pick and every team using the league’s format, positional need at the moment of selection, current market rank, opportunity cost, and finished roster construction.</p><div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.65fr)_auto]"><select value={activeLeague||""} onChange={(event)=>{setActiveLeague(event.target.value);setDraftId("");}} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"><option value="">Choose a league</option>{leagues.map((row)=><option key={row.league_id} value={row.league_id}>{row.name}</option>)}</select><select value={draftId} onChange={(event)=>setDraftId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"><option value="">Choose a draft</option>{drafts.map((row)=><option key={row.draft_id} value={row.draft_id}>{row.season} · {row.status} · {row.settings?.rounds||"—"} rounds</option>)}</select><button onClick={()=>window.print()} disabled={!analysis} className="rounded-2xl bg-violet-300/10 px-5 py-3 text-sm font-black text-violet-100 disabled:opacity-35">Print / save PDF</button></div></header>
    {username?<Panel className="mt-4 overflow-visible p-4"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,480px)] lg:items-center"><div><div className="text-[10px] font-bold uppercase tracking-wider text-cyan-200/50">Grading lens</div><h2 className="mt-1 text-xl font-black">Change the market and the grades recalculate</h2><p className="mt-1 text-xs leading-5 text-white/38">Value sources produce a current-market retrospective. Projection sources grade immediate seasonal utility. Historical reports never pretend today’s values were known on draft day.</p></div><SourceSelector sources={DEFAULT_SOURCES} value={sourceKey} onChange={setSourceKey} mode={format} qbType={qbType} onModeChange={setFormat} onQbTypeChange={setQbType} layout="inline"/></div></Panel>:null}
    {loading?<div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.05] p-4 text-sm text-cyan-100">Building grades from the selected draft…</div>:null}{error?<div className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-100">{error}</div>:null}
    {analysis?<><section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric label="Draft champion" value={analysis.teams[0]?.name||"—"} detail={`${analysis.teams[0]?.grade} · ${analysis.teams[0]?.score}/100`} tone="green"/><Metric label="Best selection" value={playerName(analysis.steals[0]?.player)||"—"} detail={analysis.steals[0]?`Pick #${analysis.steals[0].pick.pick_no}`:""} tone="cyan"/><Metric label="Largest reach" value={playerName(analysis.reaches[0]?.player)||"—"} detail={analysis.reaches[0]?`Pick #${analysis.reaches[0].pick.pick_no}`:""} tone="rose"/><Metric label="Draft pool" value={analysis.rookieOnly?"Rookies":"Full pool"} detail={`${analysis.eligibleCount} graded candidates`}/><Metric label="Selections" value={analysis.pickRows.length} detail={`${analysis.teams.length} teams`}/><Metric label="Position runs" value={analysis.runs.length} detail="Four of six picks" tone="amber"/></section>
      <Panel className="sticky top-14 z-30 mt-4 overflow-x-auto rounded-2xl bg-slate-950/95 p-2 backdrop-blur"><div className="flex w-max gap-1">{[["leaderboard","Team Grades"],["board","Every Pick"],["teams","Team Report"],["awards","Awards & Runs"],["method","Methodology"]].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab===key?"bg-violet-300/10 text-violet-100":"text-white/40"}`}>{label}</button>)}</div></Panel>
      {tab==="leaderboard"?<div className="mt-4 grid gap-3 lg:grid-cols-2">{analysis.teams.map((team)=><button type="button" key={team.rosterId} onClick={()=>{setTeamId(team.rosterId);setTab("teams");}} className="rounded-[26px] border border-white/10 bg-slate-900/80 p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-300/20"><div className="flex items-center gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-violet-300/[0.07] text-xl font-black text-violet-100">#{team.rank}</div><div className="min-w-0 flex-1"><div className="truncate text-lg font-black">{team.name}</div><div className="mt-1 text-[10px] text-white/32">{team.picks.length} picks · {Math.round(team.totalValue).toLocaleString()} value captured</div></div><div className="text-right"><div className={`text-4xl font-black ${gradeTone(team.score)}`}>{team.grade}</div><small className="text-white/30">{team.score}/100</small></div></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Pick quality" value={team.pickAverage.toFixed(0)}/><Metric label="Construction" value={team.construction.toFixed(0)}/><Metric label="Best value" value={team.best?`#${team.best.pick.pick_no}`:"—"} detail={team.best?playerName(team.best.player):""}/></div></button>)}</div>:null}
      {tab==="board"?<div className="mt-4 space-y-4"><Panel className="p-4"><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search player, team, position, or verdict…" className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"/></Panel><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{boardRows.map((row)=><details key={row.pick.pick_no} className="rounded-[24px] border border-white/10 bg-slate-900/80 p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><b className="text-xs text-violet-100">#{row.pick.pick_no}</b><AvatarImage name={playerName(row.player)} playerId={row.pick.player_id} size={38} className="rounded-xl" alt=""/><div className="min-w-0 flex-1"><div className="truncate font-bold">{playerName(row.player,row.pick.player_id)}</div><div className="truncate text-[10px] text-white/32">{row.team.name} · {row.pos}</div></div><div className="text-right"><b className={`text-xl ${gradeTone(row.score)}`}>{row.grade}</b><small className="block text-[8px] text-white/25">{row.score}</small></div></summary><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Market" value={row.valueScore.toFixed(0)} detail={`Rank #${row.rank}`}/><Metric label="Need" value={row.needScore.toFixed(0)}/><Metric label="Opportunity" value={row.opportunityScore.toFixed(0)}/></div><p className="mt-3 text-xs leading-5 text-white/45"><b className="text-white/70">{row.verdict}.</b> Selected {row.delta>=0?`${row.delta} picks after`:`${Math.abs(row.delta)} picks before`} current market rank. {row.alternatives.length?`Top alternatives still available: ${row.alternatives.map((alt)=>playerName(alt.player)).join(", ")}.`:""}</p></details>)}</div></div>:null}
      {tab==="teams"&&selectedTeam?<div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><Panel className="p-4"><label><span className="mb-1 block text-xs text-white/38">Team report</span><select value={selectedTeam.rosterId} onChange={(event)=>setTeamId(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3">{analysis.teams.map((team)=><option key={team.rosterId} value={team.rosterId}>#{team.rank} · {team.name}</option>)}</select></label><div className="mt-5 text-center"><div className={`text-7xl font-black ${gradeTone(selectedTeam.score)}`}>{selectedTeam.grade}</div><div className="mt-1 text-sm text-white/35">{selectedTeam.score}/100 overall</div></div><div className="mt-5 grid grid-cols-2 gap-2"><Metric label="Pick quality" value={selectedTeam.pickAverage.toFixed(0)}/><Metric label="Construction" value={selectedTeam.construction.toFixed(0)}/><Metric label="Value" value={Math.round(selectedTeam.totalValue).toLocaleString()}/><Metric label="Identity" value={selectedTeam.identity?.[0]||"Balanced"} detail={selectedTeam.identity?`${selectedTeam.identity[1]} selected`:""}/></div><p className="mt-4 text-xs leading-5 text-white/42">{selectedTeam.score>=90?"An elite blend of value discipline and roster construction.":selectedTeam.score>=80?"A strong draft with more wins than reaches and a credible starting structure.":selectedTeam.score>=70?"A mixed class with useful selections but identifiable opportunity cost.":"Current-market results expose several reaches or construction gaps; review context before treating hindsight as process."}</p></Panel><Panel className="overflow-hidden"><div className="border-b border-white/10 p-4"><h3 className="text-xl font-black">Pick-by-pick report card</h3></div><div className="divide-y divide-white/[0.06]">{selectedTeam.picks.map((row)=><div key={row.pick.pick_no} className="grid grid-cols-[46px_minmax(0,1fr)_70px] items-center gap-3 p-3 sm:p-4"><b className="text-xs text-violet-100">#{row.pick.pick_no}</b><div className="min-w-0"><div className="truncate font-bold">{playerName(row.player,row.pick.player_id)}</div><div className="mt-1 text-[10px] text-white/32">{row.pos} · {row.verdict} · market rank #{row.rank}</div></div><div className="text-right"><b className={`text-xl ${gradeTone(row.score)}`}>{row.grade}</b><small className="block text-[8px] text-white/25">{row.score}/100</small></div></div>)}</div></Panel></div>:null}
      {tab==="awards"?<div className="mt-4 grid gap-4 xl:grid-cols-2"><Panel className="p-5"><h3 className="text-xl font-black text-emerald-100">Best values</h3><div className="mt-4 space-y-2">{analysis.steals.map((row,index)=><div key={row.pick.pick_no} className="flex items-center gap-3 rounded-xl bg-emerald-300/[0.035] p-3"><b className="text-xs">#{index+1}</b><span className="min-w-0 flex-1 truncate font-semibold">{playerName(row.player)} · pick #{row.pick.pick_no}</span><span className="text-xs text-emerald-100">{row.delta>=0?"+":""}{row.delta} slots</span></div>)}</div></Panel><Panel className="p-5"><h3 className="text-xl font-black text-rose-100">Largest reaches</h3><div className="mt-4 space-y-2">{analysis.reaches.map((row,index)=><div key={row.pick.pick_no} className="flex items-center gap-3 rounded-xl bg-rose-300/[0.035] p-3"><b className="text-xs">#{index+1}</b><span className="min-w-0 flex-1 truncate font-semibold">{playerName(row.player)} · pick #{row.pick.pick_no}</span><span className="text-xs text-rose-100">{row.delta} slots</span></div>)}</div></Panel><Panel className="p-5 xl:col-span-2"><h3 className="text-xl font-black">Position-run detector</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{analysis.runs.map((run)=><div key={`${run.pos}-${run.start}`} className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4"><b className="text-2xl text-amber-100">{run.pos}</b><div className="mt-1 text-xs text-white/42">{run.count} of picks #{run.start}–#{run.end}</div></div>)}{!analysis.runs.length?<p className="text-sm text-white/35">No four-of-six positional runs detected.</p>:null}</div></Panel></div>:null}
      {tab==="method"?<Panel className="mt-4 p-5 sm:p-7"><h3 className="text-2xl font-black">How the grades work</h3><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-2xl bg-white/[0.025] p-4"><b>62% current market result</b><p className="mt-2 text-xs leading-5 text-white/42">Compares the selection’s current rank in the chosen value or projection source with its actual draft slot.</p></div><div className="rounded-2xl bg-white/[0.025] p-4"><b>20% opportunity cost</b><p className="mt-2 text-xs leading-5 text-white/42">Compares the selected player with the strongest eligible player still available at that moment.</p></div><div className="rounded-2xl bg-white/[0.025] p-4"><b>18% team need</b><p className="mt-2 text-xs leading-5 text-white/42">Reconstructs the roster before each pick and measures the selected position against league starting requirements and practical depth targets.</p></div><div className="rounded-2xl bg-white/[0.025] p-4"><b>Team construction adjustment</b><p className="mt-2 text-xs leading-5 text-white/42">Team grades combine average pick quality with coverage of QB, RB, WR, and TE requirements plus value distribution.</p></div></div><div className="mt-5 rounded-2xl border border-amber-300/12 bg-amber-300/[0.04] p-4 text-xs leading-5 text-amber-100/65"><b>Important:</b> these are current-market retrospective grades. They judge outcomes through today’s selected source and do not claim a manager had access to today’s information on draft day. Switch sources to see where expert markets disagree.</div></Panel>:null}
      <PrintReport analysis={analysis} league={league} draft={draft} sourceLabel={sourceLabel}/></>:!loading&&username?<Panel className="mt-5 p-8 text-center text-white/40">Choose a league and draft to create the full report.</Panel>:null}
  </div></main>;
}
