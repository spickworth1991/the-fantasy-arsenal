"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSleeper } from "../../context/SleeperContext";

const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });

const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const avatarUrl = (id) => id ? `https://sleepercdn.com/avatars/thumbs/${id}` : DEFAULT_LEAGUE_IMG;
const TABS = [["overview", "Overview"], ["records", "Record Book"], ["rivalries", "Rivalries"], ["seasons", "Seasons"], ["yearbook", "Yearbook"]];

const number = (value) => Number(value || 0);
const pct = (wins, games) => games ? `${((wins / games) * 100).toFixed(1)}%` : "—";
const points = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);
  return response.json();
}

function managerLabel(user, roster) {
  return String(user?.metadata?.team_name || user?.display_name || user?.username || `Roster ${roster?.roster_id || "—"}`);
}

function resultPoints(row) {
  const custom = row?.custom_points;
  return custom != null ? number(custom) : number(row?.points);
}

function buildSeasonSummary({ league, users, rosters, matchups, transactions, bracket, regularEnd, drafts = [], draftPicks = [] }) {
  const usersById = new Map((users || []).map((user) => [String(user.user_id), user]));
  const teams = new Map();
  (rosters || []).forEach((roster) => {
    const user = usersById.get(String(roster.owner_id));
    teams.set(String(roster.roster_id), {
      rosterId: String(roster.roster_id),
      userId: String(roster.owner_id || `orphan-${roster.roster_id}`),
      name: managerLabel(user, roster),
      avatar: user?.avatar || null,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      highScore: 0,
      lowScore: null,
      biggestWin: 0,
      closestWin: null,
      playoffWins: 0,
      transactionCount: 0,
      playerIds: (roster.players || []).map(String),
    });
  });

  const weeklyGames = [];
  (matchups || []).forEach(({ week, rows }) => {
    const groups = new Map();
    (rows || []).forEach((row) => {
      if (row?.matchup_id == null || !teams.has(String(row.roster_id))) return;
      if (!groups.has(row.matchup_id)) groups.set(row.matchup_id, []);
      groups.get(row.matchup_id).push(row);
    });
    groups.forEach((group) => {
      if (group.length !== 2) return;
      const [a, b] = group;
      const ta = teams.get(String(a.roster_id));
      const tb = teams.get(String(b.roster_id));
      const scoreA = resultPoints(a);
      const scoreB = resultPoints(b);
      const isPlayoff = week > regularEnd;
      if (!isPlayoff) {
        ta.pointsFor += scoreA; ta.pointsAgainst += scoreB;
        tb.pointsFor += scoreB; tb.pointsAgainst += scoreA;
      }
      ta.highScore = Math.max(ta.highScore, scoreA); tb.highScore = Math.max(tb.highScore, scoreB);
      ta.lowScore = ta.lowScore == null ? scoreA : Math.min(ta.lowScore, scoreA);
      tb.lowScore = tb.lowScore == null ? scoreB : Math.min(tb.lowScore, scoreB);
      const margin = Math.abs(scoreA - scoreB);
      if (scoreA > scoreB) {
        if (isPlayoff) ta.playoffWins += 1; else { ta.wins += 1; tb.losses += 1; }
        ta.biggestWin = Math.max(ta.biggestWin, margin);
        ta.closestWin = ta.closestWin == null ? margin : Math.min(ta.closestWin, margin);
      } else if (scoreB > scoreA) {
        if (isPlayoff) tb.playoffWins += 1; else { tb.wins += 1; ta.losses += 1; }
        tb.biggestWin = Math.max(tb.biggestWin, margin);
        tb.closestWin = tb.closestWin == null ? margin : Math.min(tb.closestWin, margin);
      } else {
        if (!isPlayoff) { ta.ties += 1; tb.ties += 1; }
      }
      weeklyGames.push({ week, isPlayoff, a: ta.userId, b: tb.userId, nameA: ta.name, nameB: tb.name, scoreA, scoreB, margin });
    });
  });

  (transactions || []).forEach((transaction) => {
    const rosterIds = new Set([...(transaction?.roster_ids || []), ...Object.values(transaction?.adds || {}), ...Object.values(transaction?.drops || {})].map(String));
    rosterIds.forEach((rid) => { const team = teams.get(rid); if (team) team.transactionCount += 1; });
  });

  const championship = (bracket || []).find((game) => number(game?.p) === 1 && game?.w != null);
  let championRosterId = championship ? String(championship.w) : "";
  if (!championRosterId && String(league?.status) === "complete") {
    championRosterId = [...teams.values()].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)[0]?.rosterId || "";
  }
  const champion = teams.get(championRosterId) || null;
  const standings = [...teams.values()].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
  const highGame = [...weeklyGames].flatMap((game) => [{ name: game.nameA, score: game.scoreA, week: game.week }, { name: game.nameB, score: game.scoreB, week: game.week }]).sort((a, b) => b.score - a.score)[0] || null;
  const heartbreak = weeklyGames.filter((game) => game.scoreA !== game.scoreB).map((game) => game.scoreA < game.scoreB ? { name: game.nameA, score: game.scoreA, opponent: game.nameB, week: game.week } : { name: game.nameB, score: game.scoreB, opponent: game.nameA, week: game.week }).sort((a, b) => b.score - a.score)[0] || null;
  const blowout = [...weeklyGames].sort((a, b) => b.margin - a.margin)[0] || null;
  const active = [...teams.values()].sort((a, b) => b.transactionCount - a.transactionCount)[0] || null;

  return {
    id: String(league.league_id),
    season: String(league.season),
    name: league.name || "Sleeper League",
    avatar: league.avatar || null,
    status: league.status || "",
    previousLeagueId: league.previous_league_id ? String(league.previous_league_id) : "",
    teamCount: number(league.total_rosters),
    playoffTeams: number(league?.settings?.playoff_teams),
    standings,
    games: weeklyGames,
    champion,
    transactions: transactions || [],
    drafts,
    draftPicks,
    awards: { highGame, heartbreak, blowout, active },
  };
}

async function fetchSeason(league) {
  const regularEnd = Math.max(1, Math.min(18, number(league?.settings?.playoff_week_start || 15) - 1 || 14));
  const weekNumbers = Array.from({ length: 18 }, (_, index) => index + 1);
  const txWeeks = Array.from(new Set([0, ...weekNumbers, regularEnd + 1, regularEnd + 2, regularEnd + 3])).filter((week) => week <= 18);
  const [users, rosters, bracket, matchupRows, transactionRows, drafts] = await Promise.all([
    getJson(`https://api.sleeper.app/v1/league/${league.league_id}/users`).catch(() => []),
    getJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(() => []),
    getJson(`https://api.sleeper.app/v1/league/${league.league_id}/winners_bracket`).catch(() => []),
    Promise.all(weekNumbers.map((week) => getJson(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`).then((rows) => ({ week, rows })).catch(() => ({ week, rows: [] })))),
    Promise.all(txWeeks.map((week) => getJson(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/${week}`).catch(() => []))),
    getJson(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).catch(() => []),
  ]);
  const draftPicks = (await Promise.all((drafts || []).map((draft) => getJson(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`).catch(() => [])))).flat();
  const transactionMap = new Map();
  transactionRows.flat().forEach((tx) => transactionMap.set(String(tx.transaction_id || `${tx.created}-${tx.type}`), tx));
  return buildSeasonSummary({ league, users, rosters, matchups: matchupRows, transactions: [...transactionMap.values()], bracket, regularEnd, drafts, draftPicks });
}

function aggregateHistory(seasons) {
  const managers = new Map();
  const rivalries = new Map();
  seasons.forEach((season) => {
    season.standings.forEach((team) => {
      if (!managers.has(team.userId)) managers.set(team.userId, { userId: team.userId, name: team.name, seasons: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, championships: 0, highScore: 0, transactions: 0 });
      const row = managers.get(team.userId);
      row.name = team.name; row.seasons += 1; row.wins += team.wins; row.losses += team.losses; row.ties += team.ties; row.pointsFor += team.pointsFor; row.highScore = Math.max(row.highScore, team.highScore); row.transactions += team.transactionCount;
      if (season.champion?.userId === team.userId) row.championships += 1;
    });
    season.games.forEach((game) => {
      const ids = [game.a, game.b].sort();
      const key = ids.join("|");
      if (!rivalries.has(key)) rivalries.set(key, { key, a: ids[0], b: ids[1], names: {}, wins: {}, ties: 0, games: 0, points: {}, playoffGames: 0, closest: null, largest: 0 });
      const rivalry = rivalries.get(key);
      rivalry.names[game.a] = game.nameA; rivalry.names[game.b] = game.nameB;
      rivalry.games += 1; rivalry.points[game.a] = number(rivalry.points[game.a]) + game.scoreA; rivalry.points[game.b] = number(rivalry.points[game.b]) + game.scoreB;
      if (game.isPlayoff) rivalry.playoffGames += 1;
      rivalry.closest = rivalry.closest == null ? game.margin : Math.min(rivalry.closest, game.margin); rivalry.largest = Math.max(rivalry.largest, game.margin);
      if (game.scoreA > game.scoreB) rivalry.wins[game.a] = number(rivalry.wins[game.a]) + 1;
      else if (game.scoreB > game.scoreA) rivalry.wins[game.b] = number(rivalry.wins[game.b]) + 1;
      else rivalry.ties += 1;
    });
  });
  const managerRows = [...managers.values()].sort((a, b) => b.championships - a.championships || b.wins - a.wins || b.pointsFor - a.pointsFor);
  const rivalryRows = [...rivalries.values()].filter((row) => row.games >= 2).sort((a, b) => b.games - a.games || b.largest - a.largest);
  return { managers: managerRows, rivalries: rivalryRows };
}

function Shell({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/70 shadow-[0_28px_90px_-65px_rgba(0,0,0,1)] backdrop-blur ${className}`}>{children}</div>;
}

function Metric({ label, value, hint }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">{label}</div><div className="mt-1.5 text-xl font-black text-white">{value}</div>{hint ? <div className="mt-1 text-[11px] text-white/42">{hint}</div> : null}</div>;
}

function YearbookPrintDocument({ season, players }) {
  if (!season) return null;
  const draftRows=season.draftPicks||[];
  return <article className="yearbook-print-only"><header className="print-cover"><div className="print-kicker">THE FANTASY ARSENAL · OFFICIAL YEARBOOK</div><h1>{season.season}</h1><h2>{season.name}</h2><div className="print-summary"><div><small>Champion</small><b>{season.champion?.name||"Unavailable"}</b></div><div><small>Teams</small><b>{season.teamCount||season.standings.length}</b></div><div><small>Matchups</small><b>{season.games.length}</b></div><div><small>Transactions</small><b>{season.transactions.length}</b></div></div></header><section className="print-section"><h2>Season honors</h2><div className="print-summary"><div><small>High score</small><b>{season.awards.highGame?`${season.awards.highGame.name} · ${points(season.awards.highGame.score)}`:"—"}</b></div><div><small>Heartbreak</small><b>{season.awards.heartbreak?`${season.awards.heartbreak.name} · ${points(season.awards.heartbreak.score)}`:"—"}</b></div><div><small>Largest margin</small><b>{season.awards.blowout?points(season.awards.blowout.margin):"—"}</b></div><div><small>Most active</small><b>{season.awards.active?.name||"—"}</b></div></div></section><section className="print-section"><h2>Final standings</h2><table><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>Points for</th><th>High score</th></tr></thead><tbody>{season.standings.map((team,index)=><tr key={team.rosterId}><td>{index+1}</td><td>{team.name}{season.champion?.rosterId===team.rosterId?" · Champion":""}</td><td>{team.wins}-{team.losses}-{team.ties}</td><td>{points(team.pointsFor)}</td><td>{points(team.highScore)}</td></tr>)}</tbody></table></section><section className="print-section print-page-break"><h2>Complete rosters</h2><div className="print-rosters">{season.standings.map(team=><div key={team.rosterId} className="print-roster"><h3>{team.name}</h3><p>{(team.playerIds||[]).map(id=>players?.[id]?.full_name||id).join(" · ")||"Roster unavailable"}</p></div>)}</div></section>{draftRows.length?<section className="print-section print-page-break"><h2>Complete draft</h2><table><thead><tr><th>Pick</th><th>Player</th><th>Position</th><th>NFL team</th></tr></thead><tbody>{draftRows.map(row=>{const player=players?.[row.player_id];return <tr key={`${row.draft_id}-${row.pick_no}`}><td>#{row.pick_no}</td><td>{player?.full_name||row.player_id}</td><td>{player?.position||"—"}</td><td>{player?.team||"—"}</td></tr>})}</tbody></table></section>:null}<footer>Generated by The Fantasy Arsenal · Sleeper data is read-only.</footer></article>;
}

function LegacyExpansion({ seasons, selectedSeason, history, players, getPlayerValue }) {
  const [recordScope,setRecordScope]=useState("all");
  if(!selectedSeason)return null;
  const games=seasons.flatMap(season=>season.games.map(game=>({...game,season:season.season}))).filter(game=>recordScope==="all"||(recordScope==="playoffs"?game.isPlayoff:!game.isPlayoff));
  const highest=games.flatMap(game=>[{name:game.nameA,score:game.scoreA,week:game.week,season:game.season},{name:game.nameB,score:game.scoreB,week:game.week,season:game.season}]).sort((a,b)=>b.score-a.score)[0];
  const draftRows=(selectedSeason.draftPicks||[]).map(pick=>{const player=players?.[pick.player_id];return{...pick,player,name:player?.full_name||player?.search_full_name||pick.player_id,value:Number(getPlayerValue?.(player)||0)};});
  const draftBest=[...draftRows].sort((a,b)=>b.value-a.value).slice(0,8);const draftReaches=[...draftRows].filter(row=>row.value>0).sort((a,b)=>(a.value/(Number(a.pick_no)||1))-(b.value/(Number(b.pick_no)||1))).slice(0,6);
  const tradeRows=(selectedSeason.transactions||[]).filter(tx=>tx.type==="trade").map(tx=>({tx,assets:Object.keys(tx.adds||{}).length+Object.keys(tx.drops||{}).length+(tx.draft_picks||[]).length})).sort((a,b)=>b.assets-a.assets);
  const continuity=history.managers.map(manager=>({manager,seasons:seasons.filter(season=>season.standings.some(team=>team.userId===manager.userId)).map(season=>season.season)})).sort((a,b)=>b.seasons.length-a.seasons.length);
  const valueTimeline=seasons.map(season=>({season:season.season,total:season.standings.reduce((sum,team)=>sum+(team.playerIds||[]).reduce((s,id)=>s+Number(getPlayerValue?.(players?.[id])||0),0),0)}));const maxValue=Math.max(1,...valueTimeline.map(row=>row.total));
  const awards=[{label:"Regular-season powerhouse",team:[...selectedSeason.standings].sort((a,b)=>b.wins-a.wins||b.pointsFor-a.pointsFor)[0]?.name},{label:"Points machine",team:[...selectedSeason.standings].sort((a,b)=>b.pointsFor-a.pointsFor)[0]?.name},{label:"Iron manager",team:selectedSeason.awards.active?.name},{label:"Cardiac season",team:selectedSeason.awards.heartbreak?.name}];
  const story=`${selectedSeason.season} belonged to ${selectedSeason.champion?.name||"the eventual champion"}. ${selectedSeason.awards.highGame?`${selectedSeason.awards.highGame.name} set the scoring standard with ${points(selectedSeason.awards.highGame.score)} in Week ${selectedSeason.awards.highGame.week}.`:""} ${selectedSeason.awards.blowout?`The widest margin arrived in Week ${selectedSeason.awards.blowout.week}, when ${selectedSeason.awards.blowout.nameA} and ${selectedSeason.awards.blowout.nameB} produced a ${points(selectedSeason.awards.blowout.margin)}-point gap.`:""} The league completed ${selectedSeason.transactions.length} observable transactions across the season.`;
  const share=async(text)=>{try{await navigator.clipboard.writeText(text);}catch{}};
  return <div className="mt-6 space-y-5"><Shell className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-amber-200/55">Season story engine</div><h2 className="mt-1 text-2xl font-black">Awards, narrative, and share cards</h2></div><div className="flex gap-2"><button onClick={()=>share(`🏆 ${selectedSeason.season} Champion: ${selectedSeason.champion?.name||"—"} · ${selectedSeason.name}`)} className="rounded-xl bg-amber-300/10 px-3 py-2 text-xs text-amber-100">Copy champion card</button><button onClick={()=>share(story)} className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs text-white/60">Copy season story</button></div></div><p className="mt-4 rounded-2xl bg-white/[0.025] p-4 text-sm leading-6 text-white/55">{story}</p><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{awards.map(award=><Metric key={award.label} label={award.label} value={award.team||"—"}/>)}</div></Shell><div className="grid gap-5 xl:grid-cols-2"><Shell className="p-5"><h3 className="text-xl font-black">Draft-class retrospective</h3><p className="mt-1 text-xs text-white/38">Current selected-market value applied to the historical draft class.</p><div className="mt-4 space-y-2">{draftBest.map(row=><div key={`${row.draft_id}-${row.pick_no}`} className="flex items-center gap-3 rounded-xl bg-white/[0.025] p-3"><b className="text-xs text-violet-100">#{row.pick_no}</b><span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</span><span className="text-xs text-white/40">{Math.round(row.value).toLocaleString()}</span></div>)}{!draftBest.length?<div className="text-sm text-white/35">No historical draft picks were returned.</div>:null}</div>{draftReaches.length?<details className="mt-3 rounded-xl bg-rose-300/[0.035] p-3"><summary className="cursor-pointer text-xs font-semibold text-rose-100/70">Review lowest current-value selections</summary><div className="mt-2 text-xs leading-5 text-white/40">{draftReaches.map(row=>`#${row.pick_no} ${row.name}`).join(" · ")}</div></details>:null}</Shell><Shell className="p-5"><h3 className="text-xl font-black">Trade trees</h3><p className="mt-1 text-xs text-white/38">The season’s largest asset exchanges, ready for deeper lineage review.</p><div className="mt-4 space-y-2">{tradeRows.slice(0,10).map(({tx,assets},index)=><details key={tx.transaction_id||index} className="rounded-xl bg-white/[0.025] p-3"><summary className="cursor-pointer text-sm font-semibold">Trade {index+1} · {assets} assets · Week {tx.leg||tx.week||"—"}</summary><div className="mt-2 text-xs leading-5 text-white/40">Players moved: {Object.keys(tx.adds||{}).map(id=>players?.[id]?.full_name||id).join(" · ")||"None"}<br/>Picks moved: {(tx.draft_picks||[]).map(pick=>`${pick.season} R${pick.round}`).join(" · ")||"None"}</div></details>)}{!tradeRows.length?<div className="text-sm text-white/35">No trades returned for this season.</div>:null}</div></Shell></div><div className="grid gap-5 xl:grid-cols-2"><Shell className="p-5"><div className="flex items-center justify-between"><h3 className="text-xl font-black">Expanded record book</h3><select value={recordScope} onChange={event=>setRecordScope(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs"><option value="all">All games</option><option value="regular">Regular season</option><option value="playoffs">Playoffs</option></select></div><div className="mt-4 grid grid-cols-2 gap-3"><Metric label="Highest score" value={highest?points(highest.score):"—"} hint={highest?`${highest.name} · ${highest.season} W${highest.week}`:""}/><Metric label="Games indexed" value={games.length}/></div><div className="mt-4 text-xs leading-5 text-white/45">Records can now be isolated to regular season or playoffs instead of mixing both contexts.</div></Shell><Shell className="p-5"><h3 className="text-xl font-black">Franchise continuity</h3><div className="mt-4 space-y-2">{continuity.slice(0,10).map(row=><div key={row.manager.userId} className="flex justify-between rounded-xl bg-white/[0.025] p-3 text-xs"><b>{row.manager.name}</b><span className="text-white/35">{row.seasons.length} seasons · {row.seasons.join(", ")}</span></div>)}</div></Shell></div><Shell className="p-5"><h3 className="text-xl font-black">Historical roster-value timeline</h3><p className="mt-1 text-xs text-white/38">A current-market retrospective of the rosters preserved by Sleeper—not the value those assets held at the time.</p><div className="mt-4 space-y-3">{valueTimeline.map(row=><div key={row.season}><div className="flex justify-between text-xs"><b>{row.season}</b><span className="text-white/35">{Math.round(row.total).toLocaleString()}</span></div><div className="mt-1 h-2 rounded bg-white/[0.04]"><div className="h-full rounded bg-gradient-to-r from-cyan-300 to-violet-300" style={{width:`${row.total/maxValue*100}%`}}/></div></div>)}</div></Shell><Shell className="yearbook-print p-5"><h3 className="text-xl font-black">Full season appendix</h3><p className="mt-1 text-xs text-white/38">Included when printing the yearbook.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{selectedSeason.standings.map(team=><div key={team.rosterId} className="rounded-2xl border border-white/10 p-3"><b>{team.name}</b><div className="mt-2 text-xs leading-5 text-white/42">{(team.playerIds||[]).map(id=>players?.[id]?.full_name||id).join(" · ")||"Roster unavailable"}</div></div>)}</div>{draftRows.length?<div className="mt-5"><h4 className="font-black">Complete draft</h4><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{draftRows.map(row=><div key={`${row.draft_id}-${row.pick_no}`} className="rounded-xl bg-white/[0.025] p-2 text-xs">#{row.pick_no} · {row.name}</div>)}</div></div>:null}</Shell></div>;
}

export default function LeagueHistoryClient() {
  const { username, year, players, getPlayerValue } = useSleeper();
  const [leagues, setLeagues] = useState([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [tab, setTab] = useState("overview");
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [progress, setProgress] = useState("");
  const [seasons, setSeasons] = useState([]);
  const [error, setError] = useState("");
  const [rivalryKey, setRivalryKey] = useState("");
  const [yearbookSeason, setYearbookSeason] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    if (!username) { setLeagues([]); return; }
    setLoadingLeagues(true); setError("");
    (async () => {
      try {
        const user = await getJson(`https://api.sleeper.app/v1/user/${username}`);
        const rows = await getJson(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${year || new Date().getFullYear()}`);
        if (!active) return;
        const sorted = (rows || []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setLeagues(sorted);
        setSelectedLeagueId((current) => current || String(sorted[0]?.league_id || ""));
      } catch { if (active) setError("We couldn’t load your Sleeper leagues for this season."); }
      finally { if (active) setLoadingLeagues(false); }
    })();
    return () => { active = false; };
  }, [username, year]);

  useEffect(() => {
    let active = true;
    if (!selectedLeagueId) { setSeasons([]); return; }
    const cacheKey = `league-history:v2:${selectedLeagueId}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached?.seasons?.length && Date.now() - number(cached.ts) < 30 * 60 * 1000) {
        setSeasons(cached.seasons); setYearbookSeason(String(cached.seasons[0].season)); return;
      }
    } catch {}

    setLoadingHistory(true); setError(""); setSeasons([]);
    (async () => {
      try {
        const chain = [];
        let id = selectedLeagueId;
        for (let index = 0; index < 12 && id; index += 1) {
          setProgress(`Finding season ${index + 1}…`);
          const league = await getJson(`https://api.sleeper.app/v1/league/${id}`);
          chain.push(league);
          id = league.previous_league_id ? String(league.previous_league_id) : "";
        }
        const summaries = [];
        for (let index = 0; index < chain.length; index += 1) {
          setProgress(`Building ${chain[index].season} season · ${index + 1}/${chain.length}`);
          summaries.push(await fetchSeason(chain[index]));
          if (active) setSeasons([...summaries]);
        }
        if (!active) return;
        setYearbookSeason(String(summaries[0]?.season || ""));
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), seasons: summaries })); } catch {}
      } catch { if (active) setError("The historical season chain could not be completed. Try refreshing this league."); }
      finally { if (active) { setLoadingHistory(false); setProgress(""); } }
    })();
    return () => { active = false; };
  }, [selectedLeagueId]);

  const history = useMemo(() => aggregateHistory(seasons), [seasons]);
  const selectedRivalry = history.rivalries.find((row) => row.key === rivalryKey) || history.rivalries[0] || null;
  const selectedYearbook = seasons.find((season) => String(season.season) === String(yearbookSeason)) || seasons[0] || null;
  const totalGames = seasons.reduce((sum, season) => sum + season.games.length, 0);
  const totalTransactions = seasons.reduce((sum, season) => sum + season.transactions.length, 0);
  const allGames = seasons.flatMap((season) => season.games.map((game) => ({ ...game, season: season.season })));
  const recordScore = allGames.flatMap((game) => [{ name: game.nameA, score: game.scoreA, week: game.week, season: game.season }, { name: game.nameB, score: game.scoreB, week: game.week, season: game.season }]).sort((a, b) => b.score - a.score)[0];
  const recordBlowout = [...allGames].sort((a, b) => b.margin - a.margin)[0];
  const copyYearbookSummary = async () => {
    if (!selectedYearbook) return;
    const summary = [
      `${selectedYearbook.season} ${selectedYearbook.name} Yearbook`,
      `Champion: ${selectedYearbook.champion?.name || "Unavailable"}`,
      `${selectedYearbook.games.length} matchups · ${selectedYearbook.transactions.length} transactions`,
      selectedYearbook.awards.highGame ? `High score: ${selectedYearbook.awards.highGame.name} (${points(selectedYearbook.awards.highGame.score)})` : "",
      selectedYearbook.awards.heartbreak ? `Heartbreak: ${selectedYearbook.awards.heartbreak.name} scored ${points(selectedYearbook.awards.heartbreak.score)} in a loss` : "",
      "Built with The Fantasy Arsenal",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <main className="min-h-screen text-white">
      <BackgroundParticles />
      <Navbar pageTitle="League History" />
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-20">
        <header className="relative overflow-hidden rounded-[34px] border border-violet-300/15 bg-[radial-gradient(circle_at_80%_0%,rgba(167,139,250,.22),transparent_32%),radial-gradient(circle_at_10%_100%,rgba(34,211,238,.14),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.94))] p-5 shadow-[0_40px_120px_-70px_rgba(139,92,246,.8)] sm:p-7">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-violet-200/65">The archive</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">League History <span className="text-white/30">&</span> Yearbook</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">Every season, rivalry, champion, record, and unforgettable result—rebuilt from your Sleeper league chain.</p>
            </div>
          </div>

          <div className="relative mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block"><span className="mb-2 block text-xs font-semibold text-white/50">League</span><select value={selectedLeagueId} onChange={(event) => setSelectedLeagueId(event.target.value)} disabled={loadingLeagues} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 text-sm text-white outline-none focus:border-violet-300/35"><option value="">Choose a league</option>{leagues.map((league) => <option key={league.league_id} value={league.league_id}>{league.name}</option>)}</select></label>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[330px]"><Metric label="Seasons" value={seasons.length || "—"} /><Metric label="Matchups" value={totalGames || "—"} /><Metric label="Moves" value={totalTransactions || "—"} /></div>
          </div>
        </header>

        {!username ? <Shell className="mt-6 p-8 text-center text-white/60">Log in with your Sleeper username on the home page to open a league archive.</Shell> : null}
        {error ? <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div> : null}
        {loadingHistory ? <div className="mt-5 flex items-center gap-3 rounded-2xl border border-violet-300/15 bg-violet-400/[0.07] p-4 text-sm text-violet-100"><span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200/25 border-t-violet-200" />{progress || "Building league history…"}</div> : null}

        {seasons.length ? <>
          <nav className="sticky top-16 z-30 -mx-4 mt-6 overflow-x-auto border-y border-white/10 bg-slate-950/90 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border">
            <div className="flex w-max gap-1 sm:w-full">{TABS.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition sm:flex-1 ${tab === key ? "bg-white/10 text-white shadow-inner" : "text-white/50 hover:bg-white/5 hover:text-white/80"}`}>{label}</button>)}</div>
          </nav>

          {tab === "overview" ? <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.7fr)]">
            <Shell className="p-5 sm:p-6"><div className="flex items-center gap-4"><img src={avatarUrl(seasons[0].avatar)} alt="" className="h-16 w-16 rounded-2xl border border-white/10 object-cover" /><div><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-cyan-200/55">League legacy</div><h2 className="mt-1 text-2xl font-black">{seasons[0].name}</h2><p className="mt-1 text-sm text-white/50">{seasons.length} season{seasons.length === 1 ? "" : "s"} preserved · {history.managers.length} franchises represented</p></div></div>
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="All-time leader" value={history.managers[0]?.name || "—"} hint={`${history.managers[0]?.wins || 0} wins`} /><Metric label="Most titles" value={history.managers[0]?.championships || 0} hint={history.managers[0]?.name} /><Metric label="Record score" value={recordScore ? points(recordScore.score) : "—"} hint={recordScore ? `${recordScore.name} · ${recordScore.season}` : ""} /><Metric label="Biggest margin" value={recordBlowout ? points(recordBlowout.margin) : "—"} hint={recordBlowout ? `${recordBlowout.season} · W${recordBlowout.week}` : ""} /></div>
              <div className="mt-6"><div className="mb-3 flex items-end justify-between"><div><div className="text-lg font-bold">Franchise leaderboard</div><div className="text-xs text-white/45">Titles, wins, and scoring across linked seasons</div></div><button onClick={() => setTab("records")} className="text-xs font-semibold text-cyan-200">Full record book →</button></div><div className="space-y-2">{history.managers.slice(0, 6).map((manager, index) => <div key={manager.userId} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-sm font-black text-white/45">{index + 1}</div><div className="min-w-0 flex-1"><div className="truncate font-semibold">{manager.name}</div><div className="text-xs text-white/42">{manager.wins}-{manager.losses}-{manager.ties} · {points(manager.pointsFor)} PF</div></div><div className="text-right"><div className="font-black text-amber-200">{manager.championships}</div><div className="text-[10px] uppercase tracking-wider text-white/35">titles</div></div></div>)}</div></div>
            </Shell>
            <div className="space-y-5"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-amber-200/55">Champions row</div><div className="mt-4 space-y-3">{seasons.map((season) => <button key={season.id} onClick={() => { setYearbookSeason(season.season); setTab("yearbook"); }} className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3 text-left transition hover:bg-white/[0.06]"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400/10 text-xl">🏆</div><div className="min-w-0 flex-1"><div className="font-bold">{season.season}</div><div className="truncate text-xs text-white/48">{season.champion?.name || "Champion unavailable"}</div></div><span className="text-white/25">→</span></button>)}</div></Shell></div>
          </div> : null}

          {tab === "records" ? <div className="mt-6 grid gap-5 lg:grid-cols-2"><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h2 className="text-xl font-black">All-time standings</h2><p className="mt-1 text-xs text-white/45">Regular-season results reconstructed from weekly matchups.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="text-left text-xs text-white/40"><tr><th className="p-3">Manager</th><th className="p-3">Titles</th><th className="p-3">Record</th><th className="p-3">Win%</th><th className="p-3">Points</th><th className="p-3">High</th></tr></thead><tbody>{history.managers.map((manager) => <tr key={manager.userId} className="border-t border-white/5"><td className="p-3 font-semibold">{manager.name}</td><td className="p-3 text-amber-200">{manager.championships}</td><td className="p-3 tabular-nums">{manager.wins}-{manager.losses}-{manager.ties}</td><td className="p-3">{pct(manager.wins + manager.ties * .5, manager.wins + manager.losses + manager.ties)}</td><td className="p-3">{points(manager.pointsFor)}</td><td className="p-3">{points(manager.highScore)}</td></tr>)}</tbody></table></div></Shell><div className="grid content-start grid-cols-2 gap-3"><Metric label="Highest score" value={recordScore ? points(recordScore.score) : "—"} hint={recordScore ? `${recordScore.name} · W${recordScore.week}, ${recordScore.season}` : ""} /><Metric label="Largest win" value={recordBlowout ? points(recordBlowout.margin) : "—"} hint={recordBlowout ? `${recordBlowout.nameA} vs ${recordBlowout.nameB}` : ""} /><Metric label="Most transactions" value={history.managers[0] ? Math.max(...history.managers.map((row) => row.transactions)) : "—"} hint={[...history.managers].sort((a,b) => b.transactions-a.transactions)[0]?.name} /><Metric label="Most meetings" value={history.rivalries[0]?.games || "—"} hint={history.rivalries[0] ? `${history.rivalries[0].names[history.rivalries[0].a]} vs ${history.rivalries[0].names[history.rivalries[0].b]}` : ""} /></div></div> : null}

          {tab === "rivalries" ? <div className="mt-6 grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]"><Shell className="p-3"><div className="px-2 pb-3 pt-2 text-sm font-bold">Most-played rivalries</div><div className="space-y-1">{history.rivalries.length ? history.rivalries.slice(0, 20).map((row) => <button key={row.key} onClick={() => setRivalryKey(row.key)} className={`w-full rounded-2xl p-3 text-left transition ${selectedRivalry?.key === row.key ? "border border-violet-300/20 bg-violet-400/10" : "border border-transparent hover:bg-white/5"}`}><div className="truncate text-sm font-semibold">{row.names[row.a]} <span className="text-white/25">vs</span> {row.names[row.b]}</div><div className="mt-1 text-xs text-white/42">{row.games} meetings · closest {points(row.closest)}</div></button>) : <div className="p-4 text-sm text-white/50">At least two meetings are needed to establish a rivalry.</div>}</div></Shell>{selectedRivalry ? <Shell className="relative overflow-hidden p-6"><div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-violet-400/10 blur-3xl" /><div className="relative text-center"><div className="text-[11px] font-semibold uppercase tracking-[.28em] text-violet-200/55">Head to head</div><div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div><div className="text-xl font-black sm:text-3xl">{selectedRivalry.names[selectedRivalry.a]}</div><div className="mt-2 text-4xl font-black text-cyan-200">{number(selectedRivalry.wins[selectedRivalry.a])}</div></div><div className="text-sm font-bold text-white/25">VS</div><div><div className="text-xl font-black sm:text-3xl">{selectedRivalry.names[selectedRivalry.b]}</div><div className="mt-2 text-4xl font-black text-violet-200">{number(selectedRivalry.wins[selectedRivalry.b])}</div></div></div><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Meetings" value={selectedRivalry.games} /><Metric label="Ties" value={selectedRivalry.ties} /><Metric label="Closest" value={points(selectedRivalry.closest)} /><Metric label="Largest margin" value={points(selectedRivalry.largest)} /></div><div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-sm text-white/55">All-time points: <span className="font-semibold text-white">{points(selectedRivalry.points[selectedRivalry.a])}</span> to <span className="font-semibold text-white">{points(selectedRivalry.points[selectedRivalry.b])}</span></div></div></Shell> : null}</div> : null}

          {tab === "seasons" ? <div className="mt-6 space-y-4">{seasons.map((season) => <Shell key={season.id} className="overflow-hidden"><div className="flex flex-col gap-4 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-cyan-200/50">{season.status || "Season"}</div><h2 className="mt-1 text-2xl font-black">{season.season} Season</h2><div className="mt-1 text-sm text-white/48">{season.games.length} matchups · {season.transactions.length} transactions</div></div><div className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.07] px-4 py-3"><div className="text-[10px] uppercase tracking-wider text-amber-100/50">Champion</div><div className="mt-1 font-bold text-amber-100">{season.champion?.name || "Not available"}</div></div></div><div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="text-left text-xs text-white/38"><tr><th className="pb-3">#</th><th className="pb-3">Team</th><th className="pb-3">Record</th><th className="pb-3">PF</th><th className="pb-3">High</th></tr></thead><tbody>{season.standings.map((team, index) => <tr key={team.rosterId} className="border-t border-white/5"><td className="py-3 text-white/35">{index + 1}</td><td className="py-3 font-semibold">{team.name}</td><td className="py-3">{team.wins}-{team.losses}-{team.ties}</td><td className="py-3">{points(team.pointsFor)}</td><td className="py-3">{points(team.highScore)}</td></tr>)}</tbody></table></div><div className="grid grid-cols-2 gap-2"><Metric label="High game" value={season.awards.highGame ? points(season.awards.highGame.score) : "—"} hint={season.awards.highGame?.name} /><Metric label="Heartbreak" value={season.awards.heartbreak ? points(season.awards.heartbreak.score) : "—"} hint={season.awards.heartbreak?.name} /><Metric label="Largest margin" value={season.awards.blowout ? points(season.awards.blowout.margin) : "—"} hint={season.awards.blowout ? `Week ${season.awards.blowout.week}` : ""} /><Metric label="Most active" value={season.awards.active?.transactionCount || "—"} hint={season.awards.active?.name} /></div></div></Shell>)}</div> : null}

          {tab === "yearbook" && selectedYearbook ? <div className="mt-6"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black">Season Yearbook</h2><p className="mt-1 text-sm text-white/50">A polished snapshot built to revisit and share.</p></div><div className="flex flex-wrap gap-2"><select value={selectedYearbook.season} onChange={(event) => setYearbookSeason(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm">{seasons.map((season) => <option key={season.id} value={season.season}>{season.season}</option>)}</select><button type="button" onClick={copyYearbookSummary} className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15">{copied ? "Copied" : "Copy recap"}</button><button type="button" onClick={() => window.print()} className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/10">Print / PDF</button></div></div>
            <div className="yearbook-print overflow-hidden rounded-[34px] border border-amber-200/15 bg-[radial-gradient(circle_at_50%_-20%,rgba(251,191,36,.22),transparent_35%),linear-gradient(160deg,rgba(30,41,59,.98),rgba(2,6,23,.96))] shadow-[0_45px_130px_-75px_rgba(251,191,36,.7)]"><section className="px-5 py-12 text-center sm:px-10 sm:py-16"><div className="text-[11px] font-semibold uppercase tracking-[.34em] text-amber-100/55">The official yearbook</div><h2 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">{selectedYearbook.season}</h2><div className="mt-2 text-xl font-bold text-white/65">{selectedYearbook.name}</div><div className="mx-auto mt-8 grid max-w-3xl grid-cols-3 gap-3"><Metric label="Teams" value={selectedYearbook.teamCount || selectedYearbook.standings.length} /><Metric label="Matchups" value={selectedYearbook.games.length} /><Metric label="Transactions" value={selectedYearbook.transactions.length} /></div></section>
              <section className="border-t border-white/10 bg-black/15 px-5 py-10 sm:px-10"><div className="mx-auto max-w-4xl text-center"><div className="text-5xl">🏆</div><div className="mt-3 text-[11px] font-semibold uppercase tracking-[.3em] text-amber-100/55">League champion</div><h3 className="mt-3 text-3xl font-black sm:text-5xl">{selectedYearbook.champion?.name || "Champion unavailable"}</h3>{selectedYearbook.champion ? <p className="mt-3 text-white/50">{selectedYearbook.champion.wins}-{selectedYearbook.champion.losses}-{selectedYearbook.champion.ties} regular-season record · {points(selectedYearbook.champion.pointsFor)} points</p> : null}</div></section>
              <section className="border-t border-white/10 px-5 py-10 sm:px-10"><div className="text-center"><div className="text-[11px] font-semibold uppercase tracking-[.28em] text-violet-200/55">Season honors</div><h3 className="mt-2 text-2xl font-black">The moments that defined the year</h3></div><div className="mx-auto mt-7 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Score of the year" value={selectedYearbook.awards.highGame ? points(selectedYearbook.awards.highGame.score) : "—"} hint={selectedYearbook.awards.highGame ? `${selectedYearbook.awards.highGame.name} · W${selectedYearbook.awards.highGame.week}` : ""} /><Metric label="Heartbreak award" value={selectedYearbook.awards.heartbreak ? points(selectedYearbook.awards.heartbreak.score) : "—"} hint={selectedYearbook.awards.heartbreak ? `${selectedYearbook.awards.heartbreak.name} lost in W${selectedYearbook.awards.heartbreak.week}` : ""} /><Metric label="Biggest blowout" value={selectedYearbook.awards.blowout ? points(selectedYearbook.awards.blowout.margin) : "—"} hint={selectedYearbook.awards.blowout ? `${selectedYearbook.awards.blowout.nameA} vs ${selectedYearbook.awards.blowout.nameB}` : ""} /><Metric label="Most active" value={selectedYearbook.awards.active?.transactionCount || "—"} hint={selectedYearbook.awards.active?.name} /></div></section>
              <section className="border-t border-white/10 bg-black/15 px-5 py-10 sm:px-10"><div className="mx-auto max-w-4xl"><div className="mb-5 text-center"><div className="text-[11px] font-semibold uppercase tracking-[.28em] text-cyan-200/55">Final table</div><h3 className="mt-2 text-2xl font-black">How the league finished</h3></div><div className="grid gap-2 sm:grid-cols-2">{selectedYearbook.standings.map((team, index) => <div key={team.rosterId} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] font-black text-white/40">{index + 1}</div><div className="min-w-0 flex-1"><div className="truncate font-semibold">{team.name}</div><div className="text-xs text-white/42">{team.wins}-{team.losses}-{team.ties} · {points(team.pointsFor)} PF</div></div>{selectedYearbook.champion?.rosterId === team.rosterId ? <span title="Champion">🏆</span> : null}</div>)}</div></div></section>
            </div>
          </div> : null}
          {tab === "yearbook" ? <LegacyExpansion seasons={seasons} selectedSeason={selectedYearbook} history={history} players={players} getPlayerValue={getPlayerValue}/> : null}
        </> : null}
        <YearbookPrintDocument season={selectedYearbook} players={players}/>
      </div>
    </main>
  );
}
