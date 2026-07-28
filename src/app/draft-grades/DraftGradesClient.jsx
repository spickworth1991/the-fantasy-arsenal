"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";
import { classifyLeagueFormat } from "../../lib/leagueFormat";
import {
  aggregateBallsvilleAdp,
  ballsvilleAdpProxyUrl,
  normalizeBallsvilleModes,
  resolveBallsvilleAdp,
} from "../../lib/ballsvilleAdp";

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
  const attributedRosterId = pick.roster_id || draft?.slot_to_roster_id?.[pick.draft_slot];
  let roster = rosters.find((row) => String(row.roster_id) === String(attributedRosterId));
  if (!roster) {
    roster = rosters.find((row) => String(row.owner_id) === String(pickedBy?.user_id));
  }
  const user = users.find((row) => String(row.user_id) === String(roster?.owner_id)) || pickedBy;
  return { roster, user, rosterId:String(roster?.roster_id || pick.roster_id || pick.draft_slot || "unknown"), name:ownerName(user) };
}

function buildGrades({ draft, picks, players, league, rosters, users, getMetric, getMarketRank, getMarketMeta, gradingKind="market" }) {
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
  const marketRank = new Map(eligible.map((row,index) => [row.id, n(getMarketRank?.(row.player, row.id)) || index+1]));
  const requirements = starterRequirements(league);
  const draftPoolIds = new Set(ordered.map((pick) => String(pick.player_id)));
  const baseRosterIds = new Map(rosters.map((roster) => [String(roster.roster_id), (roster.players || []).map(String).filter((id) => !draftPoolIds.has(id))]));
  const teamCounts = new Map(rosters.map((roster) => {
    const counts = {};
    (baseRosterIds.get(String(roster.roster_id)) || []).forEach((id) => { const key=position(players?.[id]);counts[key]=n(counts[key])+1; });
    return [String(roster.roster_id), counts];
  }));
  const teamPickNumbers = ordered.reduce((map,pick) => {
    const rosterId=teamForPick(pick,draft,rosters,users).rosterId;
    if(!map.has(rosterId))map.set(rosterId,[]);
    map.get(rosterId).push(n(pick.pick_no));
    return map;
  },new Map());
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
    const marketMeta = getMarketMeta?.(player, pick.player_id) || null;
    const covered = gradingKind === "adp" ? n(marketMeta?.avgOverallPick) > 0 : value > 0;
    const rawRank = n(getMarketRank?.(player, pick.player_id)) || marketRank.get(String(pick.player_id)) || eligible.length + 1;
    const rank = Math.round(rawRank * 10) / 10;
    const delta = n(pick.pick_no)-rank;
    const adpScale = rank <= 24 ? 1.15 : rank <= 72 ? .72 : rank <= 144 ? .5 : .36;
    const valueScore = gradingKind === "adp"
      ? clamp(95 + delta * adpScale, 45, 100)
      : clamp(95 + delta*.45,45,100);
    const bestAvailableRank = bestAvailable
      ? n(getMarketRank?.(bestAvailable.player, bestAvailable.id)) || marketRank.get(bestAvailable.id)
      : 0;
    const adpOpportunityGap = bestAvailableRank ? Math.max(0, rank-bestAvailableRank) : 0;
    const opportunityScore = gradingKind === "adp"
      ? clamp(99-adpOpportunityGap*(rank <= 36 ? 1.25 : rank <= 100 ? .8 : .5),45,100)
      : bestAvailable?.value ? clamp(value/bestAvailable.value*100,25,100) : 75;
    const needScore = 65 + needPct*35;
    const nextTeamPick=(teamPickNumbers.get(team.rosterId)||[]).find((pickNo)=>pickNo>n(pick.pick_no))||0;
    const takeNowScore=nextTeamPick?clamp(100-Math.max(0,rank-nextTeamPick)*1.15,50,100):85;
    const strategyScore = clamp(needScore*.7 + takeNowScore*.3,45,100);
    const calculatedScore = Math.round(clamp(
      gradingKind === "adp"
        ? valueScore*.7 + opportunityScore*.2 + strategyScore*.1
        : valueScore*.67 + opportunityScore*.23 + strategyScore*.1,
      35,
      100
    ));
    const score = covered ? calculatedScore : null;
    counts[pos] = n(counts[pos])+1;
    teamCounts.set(team.rosterId,counts);
    selected.add(String(pick.player_id));
    const verdict = !covered ? "Not graded" : delta >= 18 ? "Major steal" : delta >= 8 ? "Strong value" : delta <= -18 ? "Major reach" : delta <= -8 ? "Reach" : "On market";
    const sampleCount = gradingKind === "adp" ? n(marketMeta?.sampleCount) : 0;
    const confidence = !covered ? "none" : gradingKind !== "adp" ? "standard" : sampleCount >= 20 ? "high" : sampleCount >= 8 ? "medium" : "low";
    return { pick, player, team, pos, value, rank, delta, valueScore, opportunityScore, strategyScore, needScore, needPct, takeNowScore, nextTeamPick, score, grade:covered?grade(score):"—", verdict, alternatives, bestAvailable, gradingKind, covered, sampleCount, confidence };
  });
  const teamMap = new Map();
  pickRows.forEach((row) => {
    if (!teamMap.has(row.team.rosterId)) teamMap.set(row.team.rosterId,{ ...row.team, picks:[] });
    teamMap.get(row.team.rosterId).picks.push(row);
  });
  const teamResults = [...teamMap.values()].map((team) => {
    const gradedPicks = team.picks.filter((row)=>row.covered);
    const avg = gradedPicks.reduce((sum,row)=>sum+row.score,0)/Math.max(1,gradedPicks.length);
    const counts = team.picks.reduce((map,row)=>({ ...map,[row.pos]:n(map[row.pos])+1 }),{});
    const core = ["QB","RB","WR","TE"];
    const lineupCompletion = rookieOnly ? team.picks.reduce((sum,row)=>sum+row.needScore,0)/Math.max(1,team.picks.length) : core.reduce((sum,key) => {
      const minimum = key === "QB" ? Math.max(1,n(requirements.QB)+n(requirements.SUPER_FLEX)) : key === "RB" ? Math.max(2,n(requirements.RB)) : key === "WR" ? Math.max(2,n(requirements.WR)) : Math.max(1,n(requirements.TE));
      return sum + clamp(n(counts[key])/minimum*100);
    },0)/core.length;
    const depthScore = core.reduce((sum,key) => {
      const starterMinimum = key === "QB" ? Math.max(1,n(requirements.QB)+n(requirements.SUPER_FLEX)) : key === "RB" ? Math.max(2,n(requirements.RB)) : key === "WR" ? Math.max(2,n(requirements.WR)) : Math.max(1,n(requirements.TE));
      const desiredDepth = key === "QB" ? starterMinimum+1 : starterMinimum+2;
      return sum+clamp(n(counts[key])/desiredDepth*100);
    },0)/core.length;
    const byeCounts=team.picks.reduce((map,row)=>{const bye=String(row.player?.bye_week||row.player?.bye||"");if(bye)map[bye]=n(map[bye])+1;return map;},{});
    const maxByeShare=Math.max(0,...Object.values(byeCounts))/Math.max(1,team.picks.length);
    const byeScore=clamp(100-Math.max(0,maxByeShare-.25)*120,55,100);
    const construction=rookieOnly?lineupCompletion:lineupCompletion*.7+depthScore*.2+byeScore*.1;
    const values = team.picks.map((row)=>row.value).filter(Boolean);
    const balance = values.length > 1 ? clamp(100-(Math.max(...values)-Math.min(...values))/Math.max(1,Math.max(...values))*25,60,100) : 80;
    const processScore = gradedPicks.length ? clamp(avg*.78+construction*.2+balance*.02,35,100) : null;
    const best = [...gradedPicks].sort((a,b)=>b.delta-a.delta)[0];
    const reach = [...gradedPicks].sort((a,b)=>a.delta-b.delta)[0];
    const identity = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    const coverage=gradedPicks.length/Math.max(1,team.picks.length);
    return { ...team, processScore, pickAverage:avg, construction, lineupCompletion, depthScore, byeScore, balance, counts, totalValue:gradedPicks.reduce((sum,row)=>sum+row.value,0), best, reach, identity, gradedCount:gradedPicks.length, coverage, rankingScore:Number.isFinite(processScore)?processScore-(1-coverage)*8:null };
  });
  const rankedResults=teamResults.filter((team)=>Number.isFinite(team.rankingScore));
  const relativeFloor=rankedResults.length>=10?68:rankedResults.length>=6?72:78;
  const teams = teamResults.map((team)=>{
    if(!Number.isFinite(team.processScore))return{...team,leagueScore:null,score:null,grade:"—"};
    const better=rankedResults.filter((other)=>other.rankingScore>team.rankingScore+.25).length;
    const tied=rankedResults.filter((other)=>Math.abs(other.rankingScore-team.rankingScore)<=.25).length;
    const relativeIndex=better+Math.max(0,tied-1)/2;
    const percentile=rankedResults.length>1?relativeIndex/(rankedResults.length-1):0;
    const leagueScore=clamp(96-percentile*(96-relativeFloor),relativeFloor,96);
    const score=Math.round(clamp(team.processScore*.55+leagueScore*.45,35,100));
    return{...team,leagueScore,score,grade:grade(score)};
  }).sort((a,b)=>n(b.score)-n(a.score)||n(b.processScore)-n(a.processScore)||b.totalValue-a.totalValue);
  teams.forEach((team,index)=>{team.rank=index+1;});
  const gradedRows = pickRows.filter((row)=>row.covered);
  const steals = [...gradedRows].sort((a,b)=>b.delta-a.delta).slice(0,8);
  const reaches = [...gradedRows].sort((a,b)=>a.delta-b.delta).slice(0,8);
  const runs = [];
  for (let start=0;start<pickRows.length;start+=1) {
    const window=pickRows.slice(start,start+6);if(window.length<4)continue;
    const counts=window.reduce((map,row)=>({...map,[row.pos]:n(map[row.pos])+1}),{});
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    if(top?.[1]>=4&&!runs.some((run)=>run.pos===top[0]&&Math.abs(run.start-n(window[0].pick.pick_no))<6))runs.push({pos:top[0],count:top[1],start:n(window[0].pick.pick_no),end:n(window.at(-1).pick.pick_no)});
  }
  return { pickRows, teams, steals, reaches, runs, rookieOnly, eligibleCount:eligible.length, requirements, gradedCount:gradedRows.length, coverage:gradedRows.length/Math.max(1,pickRows.length), gradingKind };
}

function PrintReport({ analysis, league, draft, sourceLabel }) {
  if (!analysis) return null;
  const champion=analysis.teams.find((team)=>team.gradedCount);
  return <article className="draft-grade-print-only">
    <header className="dg-cover">
      <div className="dg-kicker">THE FANTASY ARSENAL · DRAFT GRADE STUDIO</div>
      <h1>{league?.name}</h1><h2>{draft?.season} Draft Report</h2>
      <p>{analysis.rookieOnly ? "Rookie-only" : "Full player pool"} · {analysis.pickRows.length} selections · {sourceLabel}</p>
      <div className="dg-metrics">
        <div><small>Draft champion</small><b>{champion?.name||"Insufficient data"}</b></div>
        <div><small>Winning grade</small><b>{champion?`${champion.grade} · ${champion.score}`:"—"}</b></div>
        <div><small>Grade coverage</small><b>{Math.round(analysis.coverage*100)}%</b></div>
        <div><small>Best value</small><b>{analysis.steals[0]?playerName(analysis.steals[0].player):"—"}</b></div>
      </div>
    </header>
    <section><h2>Team leaderboard</h2><table><thead><tr><th>Rank</th><th>Team</th><th>Grade</th><th>Process</th><th>League score</th><th>Coverage</th></tr></thead><tbody>{analysis.teams.map((team)=><tr key={team.rosterId}><td>#{team.rank}</td><td>{team.name}</td><td><b>{team.gradedCount?`${team.grade} · ${team.score}`:"Not graded"}</b></td><td>{team.gradedCount?team.processScore.toFixed(1):"—"}</td><td>{team.gradedCount?team.leagueScore.toFixed(1):"—"}</td><td>{team.gradedCount}/{team.picks.length}</td></tr>)}</tbody></table></section>
    {analysis.teams.map((team)=><section className="dg-page" key={team.rosterId}><h2>#{team.rank} · {team.name} · {team.grade}</h2><div className="dg-metrics"><div><small>Overall</small><b>{team.gradedCount?`${team.score}/100`:"Not graded"}</b></div><div><small>Process</small><b>{team.gradedCount?team.processScore.toFixed(1):"—"}</b></div><div><small>League score</small><b>{team.gradedCount?team.leagueScore.toFixed(1):"—"}</b></div><div><small>Coverage</small><b>{Math.round(team.coverage*100)}%</b></div></div><table><thead><tr><th>Pick</th><th>Player</th><th>Pos</th><th>Grade</th><th>{analysis.gradingKind==="adp"?"ADP":"Market rank"}</th><th>Confidence</th></tr></thead><tbody>{team.picks.map((row)=><tr key={row.pick.pick_no}><td>#{row.pick.pick_no}</td><td>{playerName(row.player,row.pick.player_id)}</td><td>{row.pos}</td><td>{row.covered?`${row.grade} · ${row.score}`:"Not graded"}</td><td>{row.covered?`#${row.rank}`:"—"}</td><td>{row.confidence}</td></tr>)}</tbody></table></section>)}
    <section className="dg-page"><h2>Every selection</h2><table><thead><tr><th>Pick</th><th>Team</th><th>Player</th><th>Grade</th><th>Strategy</th><th>Opportunity</th></tr></thead><tbody>{analysis.pickRows.map((row)=><tr key={row.pick.pick_no}><td>#{row.pick.pick_no}</td><td>{row.team.name}</td><td>{playerName(row.player,row.pick.player_id)}</td><td>{row.covered?`${row.grade} · ${row.score}`:"Not graded"}</td><td>{row.covered?row.strategyScore.toFixed(0):"—"}</td><td>{row.covered?row.opportunityScore.toFixed(0):"—"}</td></tr>)}</tbody></table></section>
    <footer>Uncovered selections are excluded from grades. ADP confidence reflects draft sample size. Historical, keeper, auction, and format limitations should be reviewed in the in-app compatibility notices.</footer>
  </article>;
}

export default function DraftGradesClient() {
  const { username, leagues=[], players, activeLeague, setActiveLeague, fetchLeagueRostersSilent, sourceKey, setSourceKey, format, setFormat, qbType, setQbType, getPlayerValue } = useSleeper();
  const [drafts,setDrafts]=useState([]);
  const [draftId,setDraftId]=useState("");
  const [draft,setDraft]=useState(null);
  const [picks,setPicks]=useState([]);
  const [loadingDrafts,setLoadingDrafts]=useState(false);
  const [loadingPicks,setLoadingPicks]=useState(false);
  const [error,setError]=useState("");
  const [tab,setTab]=useState("leaderboard");
  const [teamId,setTeamId]=useState("");
  const [query,setQuery]=useState("");
  const [gradingLens,setGradingLens]=useState("source");
  const [adpModes,setAdpModes]=useState([]);
  const [adpMap,setAdpMap]=useState(new Map());
  const [adpLoading,setAdpLoading]=useState(false);
  const [adpError,setAdpError]=useState("");
  const league=leagues.find((row)=>String(row.league_id)===String(activeLeague));
  const loading=loadingDrafts||loadingPicks||adpLoading;
  const detectedFormat=useMemo(()=>{
    const detected=classifyLeagueFormat(league||{},drafts);
    const explicitType=n(league?.settings?.type);
    if(explicitType===2)return{...detected,key:"dynasty",label:"Dynasty",confidence:"high"};
    if(explicitType===1)return{...detected,key:"keeper",label:"Keeper",confidence:"high"};
    return detected;
  },[drafts,league]);
  const detectedQbType=useMemo(()=>{
    const slots=(league?.roster_positions||[]).map((slot)=>String(slot||"").toUpperCase());
    return slots.filter((slot)=>slot==="QB").length>=2||slots.some((slot)=>["SUPER_FLEX","SUPERFLEX","SF","OP","Q/W/R/T"].includes(slot))?"sf":"1qb";
  },[league?.roster_positions]);
  const selectedAdpMode=adpModes.find((mode)=>mode.modeSlug===gradingLens);
  const sourceLabel=selectedAdpMode ? `Ballsville ${selectedAdpMode.title} ADP` : DEFAULT_SOURCES.find((source)=>source.key===sourceKey)?.label || sourceKey;
  const draftType=String(draft?.type||draft?.metadata?.type||"snake").toLowerCase();
  const isAuctionDraft=draftType.includes("auction");
  const isKeeperLeague=n(league?.settings?.type)===1||detectedFormat.key==="keeper";
  const recommendedAdpSlug=draftIsRookie(draft,picks,players)?"dynasty-rookie":detectedFormat.key==="dynasty"?"dynasty-startup":"redraft";
  const recommendedAdpMode=adpModes.find((mode)=>mode.modeSlug===recommendedAdpSlug);
  const gradingNotices=useMemo(()=>{
    const notices=[];
    if(isAuctionDraft)notices.push({tone:"rose",title:"Auction grading requires prices",text:"Pick-versus-ADP grades are disabled for this auction. A logical auction grade needs the amount paid, remaining budgets, and expected auction values."});
    if(isKeeperLeague)notices.push({tone:"amber",title:"Keeper context",text:"Existing keepers and retained rosters affect positional need. Selection grades remain available, but construction and need are lower-confidence unless Sleeper exposes the original pre-draft roster."});
    if(gradingLens!=="source"){
      if(n(draft?.season)&&n(draft?.season)!==2026)notices.push({tone:"amber",title:"Current-ADP retrospective",text:`This ${draft?.season} draft is being compared with 2026 Ballsville ADP. It measures value today, not what was knowable on draft day.`});
      if(gradingLens==="dynasty-rookie"&&!draftIsRookie(draft,picks,players))notices.push({tone:"rose",title:"Draft-pool mismatch",text:"Dynasty Rookie ADP should only grade a rookie-only draft."});
      if(gradingLens!=="dynasty-rookie"&&draftIsRookie(draft,picks,players))notices.push({tone:"amber",title:"Rookie board recommended",text:"This appears to be a rookie-only draft. Dynasty Rookie ADP is the most compatible Ballsville lens."});
      if(detectedFormat.key==="dynasty"&&["redraft","big-game","gauntlet","mini-leagues"].includes(gradingLens))notices.push({tone:"amber",title:"Format mismatch",text:"This dynasty league is using a contest or redraft ADP pool. Select Dynasty Startup or Dynasty Rookie for a more defensible comparison."});
      if(detectedFormat.key!=="dynasty"&&gradingLens==="dynasty-startup")notices.push({tone:"amber",title:"Format mismatch",text:"Dynasty Startup ADP values long-term roster building and may not fit this league’s redraft incentives."});
      notices.push({tone:"cyan",title:"League-rule confidence",text:"Ballsville modes represent distinct draft ecosystems, but the files do not explicitly certify a 1QB/Superflex and scoring match for this league. Grades show data coverage separately from format compatibility."});
    }
    return notices;
  },[detectedFormat.key,draft,gradingLens,isAuctionDraft,isKeeperLeague,picks,players]);

  useEffect(()=>{if(!activeLeague&&leagues[0])setActiveLeague(leagues[0].league_id);},[activeLeague,leagues,setActiveLeague]);
  useEffect(()=>{
    if(!activeLeague){setDrafts([]);setDraftId("");setDraft(null);setPicks([]);return;}
    let active=true;setLoadingDrafts(true);setError("");setDraft(null);setPicks([]);
    Promise.all([getJson(`https://api.sleeper.app/v1/league/${activeLeague}/drafts`),fetchLeagueRostersSilent(activeLeague)])
      .then(([rows])=>{if(!active)return;const sorted=[...(rows||[])].sort((a,b)=>n(b.season)-n(a.season)||n(b.created)-n(a.created));setDrafts(sorted);setDraftId((current)=>sorted.some((row)=>String(row.draft_id)===String(current))?current:String(sorted[0]?.draft_id||""));})
      .catch(()=>active&&setError("Drafts could not be loaded for this league.")).finally(()=>active&&setLoadingDrafts(false));
    return()=>{active=false;};
  },[activeLeague,fetchLeagueRostersSilent]);
  useEffect(()=>{
    if(!draftId){setDraft(null);setPicks([]);return;}
    let active=true;setLoadingPicks(true);setError("");setDraft(null);setPicks([]);
    Promise.all([getJson(`https://api.sleeper.app/v1/draft/${draftId}`),getJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`)])
      .then(([draftRow,pickRows])=>{if(!active)return;setDraft(draftRow);setPicks(Array.isArray(pickRows)?pickRows:[]);})
      .catch(()=>active&&setError("The selected draft could not be graded.")).finally(()=>active&&setLoadingPicks(false));
    return()=>{active=false;};
  },[draftId]);
  useEffect(()=>{
    if(!league)return;
    setFormat(detectedFormat.key==="dynasty"?"dynasty":"redraft");
    setQbType(detectedQbType);
  },[activeLeague,detectedFormat.key,detectedQbType,league,setFormat,setQbType]);
  useEffect(()=>{
    let active=true;
    getJson(ballsvilleAdpProxyUrl("data/draft-compare/modes_2026.json"))
      .then((payload)=>{if(active)setAdpModes(normalizeBallsvilleModes(payload,2026));})
      .catch(()=>{if(active)setAdpModes([]);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(gradingLens==="source"){setAdpMap(new Map());setAdpError("");return;}
    let active=true;setAdpLoading(true);setAdpError("");
    getJson(ballsvilleAdpProxyUrl(`data/draft-compare/drafts_2026_${gradingLens}.json`))
      .then((payload)=>{if(active)setAdpMap(aggregateBallsvilleAdp(payload));})
      .catch(()=>{if(active){setAdpMap(new Map());setAdpError("That Ballsville ADP board could not be loaded.");}})
      .finally(()=>{if(active)setAdpLoading(false);});
    return()=>{active=false;};
  },[gradingLens]);
  const adpMetaForPlayer=useMemo(()=>gradingLens==="source"?null:(player)=>resolveBallsvilleAdp(adpMap,playerName(player),position(player)),[adpMap,gradingLens]);
  const adpForPlayer=useMemo(()=>adpMetaForPlayer?(player)=>adpMetaForPlayer(player)?.avgOverallPick||0:null,[adpMetaForPlayer]);
  const gradingMetric=useMemo(()=>adpForPlayer?(player)=>{const adp=n(adpForPlayer(player));return adp>0?10000/adp:0;}:getPlayerValue,[adpForPlayer,getPlayerValue]);
  const analysis=useMemo(()=>isAuctionDraft||gradingLens!=="source"&&!adpMap.size?null:buildGrades({
    draft,picks,players,league,rosters:league?.rosters||[],users:league?.users||[],
    getMetric:gradingMetric,
    getMarketRank:adpForPlayer,
    getMarketMeta:adpMetaForPlayer,
    gradingKind: gradingLens==="source" ? "market" : "adp",
  }),[adpForPlayer,adpMap.size,adpMetaForPlayer,draft,gradingLens,gradingMetric,isAuctionDraft,league,picks,players]);
  useEffect(()=>{if(analysis?.teams?.length&&!analysis.teams.some((team)=>team.rosterId===teamId))setTeamId(analysis.teams[0].rosterId);},[analysis,teamId]);
  const selectedTeam=analysis?.teams.find((team)=>team.rosterId===teamId)||analysis?.teams[0];
  const boardRows=(analysis?.pickRows||[]).filter((row)=>!query.trim()||`${playerName(row.player)} ${row.team.name} ${row.pos} ${row.verdict}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="min-h-screen text-white"><BackgroundParticles/><Navbar pageTitle="Draft Grade Studio"/><div className="mx-auto max-w-7xl px-4 pb-20 pt-20">
    <header className="overflow-hidden rounded-[34px] border border-violet-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(139,92,246,.22),transparent_36%),radial-gradient(circle_at_8%_100%,rgba(34,211,238,.15),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-8"><div className="text-[10px] font-bold uppercase tracking-[.28em] text-violet-200/60">League-wide draft intelligence</div><h1 className="mt-2 text-3xl font-black sm:text-5xl">Draft Grade Studio</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Grade every pick and every team using the league’s format, positional need at the moment of selection, current market rank, opportunity cost, and finished roster construction.</p><div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.65fr)_auto]"><select value={activeLeague||""} onChange={(event)=>{setActiveLeague(event.target.value);setDraftId("");}} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"><option value="">Choose a league</option>{leagues.map((row)=><option key={row.league_id} value={row.league_id}>{row.name}</option>)}</select><select value={draftId} onChange={(event)=>setDraftId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"><option value="">Choose a draft</option>{drafts.map((row)=><option key={row.draft_id} value={row.draft_id}>{row.season} · {row.status} · {row.settings?.rounds||"—"} rounds</option>)}</select><button onClick={()=>window.print()} disabled={!analysis} className="rounded-2xl bg-violet-300/10 px-5 py-3 text-sm font-black text-violet-100 disabled:opacity-35">Print / save PDF</button></div></header>
    {username?<Panel className="mt-4 overflow-visible p-4"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.85fr)] lg:items-center"><div><div className="text-[10px] font-bold uppercase tracking-wider text-cyan-200/50">Grading lens</div><h2 className="mt-1 text-xl font-black">Grade by market value, projection, or actual draft behavior</h2><p className="mt-1 text-xs leading-5 text-white/38">Ballsville ADP compares every selection with where players are actually being drafted across its 2026 boards. Switch back to Arsenal sources for a current-value retrospective.</p><div className="mt-2 text-[10px] font-semibold text-cyan-100/55">Detected: {detectedFormat.label} · {detectedQbType==="sf"?"Superflex":"1QB"} · {detectedFormat.confidence} confidence</div></div><div className="space-y-3"><label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">Grade against</span><select value={gradingLens} onChange={(event)=>setGradingLens(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-bold"><option value="source">Arsenal value / projection source</option>{adpModes.map((mode)=><option key={mode.modeSlug} value={mode.modeSlug}>Ballsville ADP · {mode.title}</option>)}</select></label>{recommendedAdpMode&&gradingLens!==recommendedAdpSlug?<button type="button" onClick={()=>setGradingLens(recommendedAdpSlug)} className="w-full rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] px-3 py-2 text-left text-xs font-bold text-emerald-100">Recommended for this draft: {recommendedAdpMode.title} ADP <span className="float-right">Use lens →</span></button>:null}{gradingLens==="source"?<SourceSelector sources={DEFAULT_SOURCES} value={sourceKey} onChange={setSourceKey} mode={format} qbType={qbType} onModeChange={setFormat} onQbTypeChange={setQbType} layout="inline"/>:<div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] px-4 py-3 text-xs text-cyan-100/65">{adpLoading?"Loading the selected ADP board…":adpError||`${selectedAdpMode?.title||"Selected"} ADP · ${adpMap.size.toLocaleString()} ranked players · updated from Ballsville R2`}</div>}</div></div></Panel>:null}
    {loading?<div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.05] p-4 text-sm text-cyan-100">Building grades from the selected draft…</div>:null}{error?<div className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-100">{error}</div>:null}
    {draft&&gradingNotices.length?<div className="mt-4 grid gap-2 lg:grid-cols-2">{gradingNotices.map((notice,index)=><div key={`${notice.title}-${index}`} className={`rounded-2xl border p-4 ${notice.tone==="rose"?"border-rose-300/15 bg-rose-300/[0.05] text-rose-100":notice.tone==="amber"?"border-amber-300/15 bg-amber-300/[0.05] text-amber-100":"border-cyan-300/15 bg-cyan-300/[0.04] text-cyan-100"}`}><b className="text-sm">{notice.title}</b><p className="mt-1 text-xs leading-5 opacity-65">{notice.text}</p></div>)}</div>:null}
    {analysis?<><section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric label="Draft champion" value={analysis.teams[0]?.gradedCount?analysis.teams[0]?.name:"Insufficient data"} detail={analysis.teams[0]?.gradedCount?`${analysis.teams[0]?.grade} · ${analysis.teams[0]?.score}/100`:"No covered picks"} tone="green"/><Metric label="Best selection" value={analysis.steals[0]?playerName(analysis.steals[0]?.player):"—"} detail={analysis.steals[0]?`Pick #${analysis.steals[0].pick.pick_no}`:""} tone="cyan"/><Metric label="Largest reach" value={analysis.reaches[0]?playerName(analysis.reaches[0]?.player):"—"} detail={analysis.reaches[0]?`Pick #${analysis.reaches[0].pick.pick_no}`:""} tone="rose"/><Metric label="Draft pool" value={analysis.rookieOnly?"Rookies":"Full pool"} detail={`${analysis.eligibleCount} ranked candidates`}/><Metric label="Grade coverage" value={`${Math.round(analysis.coverage*100)}%`} detail={`${analysis.gradedCount} of ${analysis.pickRows.length} selections`}/><Metric label="Position runs" value={analysis.runs.length} detail="Four of six picks" tone="amber"/></section>
      <Panel className="sticky top-14 z-30 mt-4 overflow-x-auto rounded-2xl bg-slate-950/95 p-2 backdrop-blur"><div className="flex w-max gap-1">{[["leaderboard","Team Grades"],["board","Every Pick"],["teams","Team Report"],["awards","Awards & Runs"],["method","Methodology"]].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab===key?"bg-violet-300/10 text-violet-100":"text-white/40"}`}>{label}</button>)}</div></Panel>
      {tab==="leaderboard"?<div className="mt-4 grid gap-3 lg:grid-cols-2">{analysis.teams.map((team)=><button type="button" key={team.rosterId} onClick={()=>{setTeamId(team.rosterId);setTab("teams");}} className="rounded-[26px] border border-white/10 bg-slate-900/80 p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-300/20"><div className="flex items-center gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-violet-300/[0.07] text-xl font-black text-violet-100">#{team.rank}</div><div className="min-w-0 flex-1"><div className="truncate text-lg font-black">{team.name}</div><div className="mt-1 text-[10px] text-white/32">{team.picks.length} picks · {team.gradedCount} graded · {Math.round(team.coverage*100)}% coverage</div></div><div className="text-right"><div className={`text-4xl font-black ${team.gradedCount?gradeTone(team.score):"text-white/30"}`}>{team.grade}</div><small className="text-white/30">{team.gradedCount?`${team.score}/100`:"Insufficient data"}</small></div></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Process quality" value={team.gradedCount?team.processScore.toFixed(0):"—"} detail="Absolute result"/><Metric label="League score" value={team.gradedCount?team.leagueScore.toFixed(0):"—"} detail={`Rank #${team.rank}`}/><Metric label="Construction" value={team.construction.toFixed(0)}/></div></button>)}</div>:null}
      {tab==="board"?<div className="mt-4 space-y-4"><Panel className="p-4"><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search player, team, position, or verdict…" className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"/></Panel><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{boardRows.map((row)=><details key={row.pick.pick_no} className="rounded-[24px] border border-white/10 bg-slate-900/80 p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><b className="text-xs text-violet-100">#{row.pick.pick_no}</b><AvatarImage name={playerName(row.player)} playerId={row.pick.player_id} size={38} className="rounded-xl" alt=""/><div className="min-w-0 flex-1"><div className="truncate font-bold">{playerName(row.player,row.pick.player_id)}</div><div className="truncate text-[10px] text-white/32">{row.team.name} · {row.pos}</div></div><div className="text-right"><b className={`text-xl ${row.covered?gradeTone(row.score):"text-white/30"}`}>{row.grade}</b><small className="block text-[8px] text-white/25">{row.covered?`${row.score}/100`:"No coverage"}</small></div></summary>{row.covered?<><div className="mt-4 grid grid-cols-3 gap-2"><Metric label={row.gradingKind==="adp"?"ADP value":"Market"} value={row.valueScore.toFixed(0)} detail={`${row.gradingKind==="adp"?"ADP":"Rank"} #${row.rank}`}/><Metric label="Strategy" value={row.strategyScore.toFixed(0)} detail={`Need ${row.needScore.toFixed(0)}`}/><Metric label="Opportunity" value={row.opportunityScore.toFixed(0)}/></div><p className="mt-3 text-xs leading-5 text-white/45"><b className="text-white/70">{row.verdict}.</b> Selected {row.delta>=0?`${row.delta} picks after`:`${Math.abs(row.delta)} picks before`} {row.gradingKind==="adp"?"ADP":"current market rank"}. {row.gradingKind==="adp"?`${row.sampleCount} draft sample${row.sampleCount===1?"":"s"} · ${row.confidence} data confidence. `:""}{row.alternatives.length?`Top alternatives still available: ${row.alternatives.map((alt)=>playerName(alt.player)).join(", ")}.`:""}</p></>:<p className="mt-4 rounded-xl bg-white/[0.025] p-3 text-xs leading-5 text-white/42">This player is not present in the selected grading source. The pick is excluded from the player and team grade instead of being treated as a reach.</p>}</details>)}</div></div>:null}
      {tab==="teams"&&selectedTeam?<div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><Panel className="p-4"><label><span className="mb-1 block text-xs text-white/38">Team report</span><select value={selectedTeam.rosterId} onChange={(event)=>setTeamId(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3">{analysis.teams.map((team)=><option key={team.rosterId} value={team.rosterId}>#{team.rank} · {team.name}</option>)}</select></label><div className="mt-5 text-center"><div className={`text-7xl font-black ${selectedTeam.gradedCount?gradeTone(selectedTeam.score):"text-white/30"}`}>{selectedTeam.grade}</div><div className="mt-1 text-sm text-white/35">{selectedTeam.gradedCount?`${selectedTeam.score}/100 · #${selectedTeam.rank} in league`:"Insufficient source coverage"}</div></div><div className="mt-5 grid grid-cols-2 gap-2"><Metric label="Process quality" value={selectedTeam.gradedCount?selectedTeam.processScore.toFixed(0):"—"} detail="Absolute draft result"/><Metric label="League score" value={selectedTeam.gradedCount?selectedTeam.leagueScore.toFixed(0):"—"} detail={`Relative rank #${selectedTeam.rank}`}/><Metric label="Construction" value={selectedTeam.construction.toFixed(0)}/><Metric label="Coverage" value={`${Math.round(selectedTeam.coverage*100)}%`} detail={`${selectedTeam.gradedCount}/${selectedTeam.picks.length} picks`}/></div><p className="mt-4 text-xs leading-5 text-white/42">{!selectedTeam.gradedCount?"This team is not ranked because the selected source does not cover its picks.":selectedTeam.score>=90?"One of the league’s strongest drafts, supported by both absolute process and relative performance.":selectedTeam.score>=80?"A competitive draft with more wins than reaches, positioned around the league’s middle-to-upper tier.":selectedTeam.score>=70?"A below-average league result with useful selections but identifiable opportunity cost.":"This class finished near the bottom of its league under the selected lens; review confidence and context before treating hindsight as process."}</p></Panel><Panel className="overflow-hidden"><div className="border-b border-white/10 p-4"><h3 className="text-xl font-black">Pick-by-pick report card</h3></div><div className="divide-y divide-white/[0.06]">{selectedTeam.picks.map((row)=><div key={row.pick.pick_no} className="grid grid-cols-[46px_minmax(0,1fr)_70px] items-center gap-3 p-3 sm:p-4"><b className="text-xs text-violet-100">#{row.pick.pick_no}</b><div className="min-w-0"><div className="truncate font-bold">{playerName(row.player,row.pick.player_id)}</div><div className="mt-1 text-[10px] text-white/32">{row.pos} · {row.verdict}{row.covered?` · ${row.gradingKind==="adp"?"ADP":"rank"} #${row.rank}`:""}</div></div><div className="text-right"><b className={`text-xl ${row.covered?gradeTone(row.score):"text-white/30"}`}>{row.grade}</b><small className="block text-[8px] text-white/25">{row.covered?`${row.score}/100`:"Excluded"}</small></div></div>)}</div></Panel></div>:null}
      {tab==="awards"?<div className="mt-4 grid gap-4 xl:grid-cols-2"><Panel className="p-5"><h3 className="text-xl font-black text-emerald-100">Best values</h3><div className="mt-4 space-y-2">{analysis.steals.map((row,index)=><div key={row.pick.pick_no} className="flex items-center gap-3 rounded-xl bg-emerald-300/[0.035] p-3"><b className="text-xs">#{index+1}</b><span className="min-w-0 flex-1 truncate font-semibold">{playerName(row.player)} · pick #{row.pick.pick_no}</span><span className="text-xs text-emerald-100">{row.delta>=0?"+":""}{row.delta} slots</span></div>)}</div></Panel><Panel className="p-5"><h3 className="text-xl font-black text-rose-100">Largest reaches</h3><div className="mt-4 space-y-2">{analysis.reaches.map((row,index)=><div key={row.pick.pick_no} className="flex items-center gap-3 rounded-xl bg-rose-300/[0.035] p-3"><b className="text-xs">#{index+1}</b><span className="min-w-0 flex-1 truncate font-semibold">{playerName(row.player)} · pick #{row.pick.pick_no}</span><span className="text-xs text-rose-100">{row.delta} slots</span></div>)}</div></Panel><Panel className="p-5 xl:col-span-2"><h3 className="text-xl font-black">Position-run detector</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{analysis.runs.map((run)=><div key={`${run.pos}-${run.start}`} className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4"><b className="text-2xl text-amber-100">{run.pos}</b><div className="mt-1 text-xs text-white/42">{run.count} of picks #{run.start}–#{run.end}</div></div>)}{!analysis.runs.length?<p className="text-sm text-white/35">No four-of-six positional runs detected.</p>:null}</div></Panel></div>:null}
      {tab==="method"?<Panel className="mt-4 p-5 sm:p-7"><h3 className="text-2xl font-black">How the grades work</h3><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-2xl bg-white/[0.025] p-4"><b>{gradingLens==="source"?"67% current market result":"70% pick versus ADP"}</b><p className="mt-2 text-xs leading-5 text-white/42">{gradingLens==="source"?"Compares the selection’s current rank in the chosen value or projection source with its actual draft slot. An on-market elite pick begins in A territory.":"Compares the actual pick directly with Ballsville average draft position. Early picks receive tighter but reasonable slot tolerance, so selecting ADP 2 at pick 1 remains an excellent selection."}</p></div><div className="rounded-2xl bg-white/[0.025] p-4"><b>{gradingLens==="source"?"23% opportunity cost":"20% ADP opportunity cost"}</b><p className="mt-2 text-xs leading-5 text-white/42">{gradingLens==="source"?"Compares the selected player with the strongest eligible player still available at that moment.":"Measures the ADP distance to the best undrafted alternative. It uses slot distance—not a value ratio—so adjacent elite players are not treated as dramatically different assets."}</p></div><div className="rounded-2xl bg-white/[0.025] p-4"><b>10% draft strategy</b><p className="mt-2 text-xs leading-5 text-white/42">Combines positional need with whether the player was likely to remain available at that team’s next selection. It supplies context without overpowering best-player-available value.</p></div><div className="rounded-2xl bg-white/[0.025] p-4"><b>League-relative team grade</b><p className="mt-2 text-xs leading-5 text-white/42">The overall team grade is 55% absolute process quality and 45% performance relative to the other teams in that draft. Process quality itself combines selection quality, construction, and balance. Similar teams remain close rather than being separated by an artificial full letter grade.</p></div></div><div className="mt-5 rounded-2xl border border-amber-300/12 bg-amber-300/[0.04] p-4 text-xs leading-5 text-amber-100/65"><b>Important:</b> uncovered players are excluded, not assigned failing grades. Coverage affects relative ranking. ADP confidence reflects sample size, while compatibility notices identify historical, keeper, draft-pool, and format limitations.</div></Panel>:null}
      <PrintReport analysis={analysis} league={league} draft={draft} sourceLabel={sourceLabel}/></>:!loading&&username?<Panel className="mt-5 p-8 text-center text-white/40">{isAuctionDraft?"Auction grades are paused until price-paid data and auction-value baselines are available.":"Choose a league and draft to create the full report."}</Panel>:null}
  </div></main>;
}
