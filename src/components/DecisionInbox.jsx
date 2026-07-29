"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSleeper } from "../context/SleeperContext";
import { useArsenalAccount } from "../context/ArsenalAccountContext";

const n = (value) => Number(value || 0);
const CACHE_MS = 5 * 60 * 1000;
const ACTIONS_KEY = "tfa:intelligence-actions";
const getJson = async (url) => {
  const response = await fetch(url, { cache:"no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const name = (players, id) => players?.[id]?.full_name || players?.[id]?.search_full_name || id;
const pos = (player) => String(player?.position || player?.fantasy_positions?.[0] || "").toUpperCase();
const injury = (player) => String(player?.injury_status || "").toUpperCase();
const unavailable = (player) => ["OUT","DOUBTFUL","IR","PUP","SUSPENDED"].includes(injury(player)) || String(player?.status || "").toLowerCase() === "inactive";
const risk = (player) => unavailable(player) || injury(player) === "QUESTIONABLE";
const deadlineText = (deadline) => {
  if (!deadline) return "No immediate lock";
  const date = new Date(deadline);
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "Locked";
  if (ms < 3600000) return `${Math.max(1, Math.ceil(ms / 60000))}m remaining`;
  if (ms < 86400000) return `${Math.ceil(ms / 3600000)}h remaining`;
  return date.toLocaleString([], { weekday:"short", hour:"numeric", minute:"2-digit" });
};

async function concurrentMap(rows, limit, worker, progress) {
  const output = new Array(rows.length);
  let cursor = 0;
  let complete = 0;
  await Promise.all(Array.from({ length:Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index]);
      complete += 1;
      progress?.(complete, rows.length);
    }
  }));
  return output;
}

function tone(priority) {
  if (priority >= 90) return "critical";
  if (priority >= 70) return "warning";
  if (priority >= 45) return "opportunity";
  return "planning";
}
function toneClass(value) {
  if (value === "critical") return "border-rose-300/20 bg-rose-300/[0.06] text-rose-100";
  if (value === "warning") return "border-amber-300/20 bg-amber-300/[0.06] text-amber-100";
  if (value === "opportunity") return "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100";
  return "border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-100";
}
function priorityLabel(priority) {
  return priority >= 90 ? "Critical" : priority >= 70 ? "High" : priority >= 45 ? "Opportunity" : "Planning";
}
function actionHref(path, leagueId) {
  if (!path || path.startsWith("http")) return path;
  const divider = path.includes("?") ? "&" : "?";
  return leagueId ? `${path}${divider}league=${encodeURIComponent(leagueId)}` : path;
}
function mergeDecisionRows(serverRows = [], localRows = []) {
  const merged = new Map();
  [...serverRows, ...localRows].forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id) || {};
    merged.set(item.id, {
      ...existing,
      ...item,
      evidence:item.evidence?.length ? item.evidence : existing.evidence,
      priorityReason:item.priorityReason || existing.priorityReason,
      previousPriority:item.previousPriority ?? existing.previousPriority,
      priorityChange:item.priorityChange ?? existing.priorityChange ?? 0,
    });
  });
  return [...merged.values()].sort((a,b) => n(b.priority)-n(a.priority));
}

function RecommendationCard({ item, state, update, compact=false }) {
  const content = <><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-sm font-black ${toneClass(item.tone)}`}>{item.priority >= 90 ? "!" : item.category === "draft" ? "D" : item.category === "waiver" ? "W" : item.category === "trade" ? "T" : "A"}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-white">{item.title}</span><span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${toneClass(item.tone)}`}>{priorityLabel(item.priority)}</span></div><div className="mt-1 text-xs text-white/38">{item.leagueName}{item.teamName ? ` · ${item.teamName}` : ""}</div>{!compact ? <><p className="mt-2 text-xs leading-5 text-white/55">{item.why}</p><div className="mt-2 flex flex-wrap gap-2 text-[9px]"><span className="rounded-full bg-white/[0.04] px-2 py-1 text-white/42">Impact · {item.impact}</span><span className="rounded-full bg-white/[0.04] px-2 py-1 text-white/42">Confidence · {item.confidence}%</span><span className="rounded-full bg-white/[0.04] px-2 py-1 text-white/42">{deadlineText(item.deadline)}</span></div></> : null}</div><span className="shrink-0 text-[10px] font-bold text-cyan-100">{item.action} →</span></>;
  const href = actionHref(item.href, item.leagueId);
  return <article className="rounded-[24px] border border-white/[0.07] bg-white/[0.025] p-3 sm:p-4">
    {item.external ? <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3">{content}</a> : <Link href={href} className="flex items-center gap-3">{content}</Link>}
    {!compact ? <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
      <button type="button" onClick={() => update(item.id, { saved:!state?.saved, decision:item })} className={`rounded-xl px-3 py-2 text-[10px] font-bold ${state?.saved ? "bg-violet-300/12 text-violet-100" : "bg-white/[0.045] text-white/45"}`}>{state?.saved ? "Saved" : "Save"}</button>
      <button type="button" onClick={() => update(item.id, { snoozedUntil:Date.now() + 4 * 3600000, status:"snoozed", decision:item })} className="rounded-xl bg-white/[0.045] px-3 py-2 text-[10px] font-bold text-white/45">Snooze 4h</button>
      <button type="button" onClick={() => update(item.id, { status:"completed", completedAt:Date.now(), decision:item }, "completed") } className="rounded-xl bg-emerald-300/10 px-3 py-2 text-[10px] font-bold text-emerald-100">Mark completed</button>
      <button type="button" onClick={() => update(item.id, { status:"dismissed", completedAt:Date.now(), decision:item })} className="rounded-xl bg-white/[0.035] px-3 py-2 text-[10px] font-bold text-white/30">Dismiss</button>
    </div> : null}
    {!compact && (item.priorityReason || item.evidence?.length) ? <details className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-3"><summary className="cursor-pointer text-[10px] font-bold text-white/45">Why this priority?</summary><p className="mt-2 text-xs leading-5 text-white/48">{item.priorityReason || item.why}</p>{item.priorityChange ? <div className={`mt-2 text-[10px] font-bold ${item.priorityChange > 0 ? "text-rose-100" : "text-emerald-100"}`}>{item.priorityChange > 0 ? "Priority increased" : "Priority decreased"} by {Math.abs(item.priorityChange)} points since the prior server snapshot.</div> : null}{item.evidence?.length ? <ul className="mt-2 space-y-1 text-[10px] text-white/32">{item.evidence.map((row,index)=><li key={`${row}-${index}`}>• {row}</li>)}</ul> : null}</details> : null}
    {!compact && state?.status === "completed" && !state?.outcome ? <div className="mt-3 rounded-xl bg-cyan-300/[0.04] p-3 text-xs text-white/50"><span>Did this decision help?</span><button onClick={() => update(item.id, { outcome:"helped" })} className="ml-3 text-emerald-100">Yes</button><button onClick={() => update(item.id, { outcome:"did-not-help" })} className="ml-3 text-rose-100">No</button></div> : null}
  </article>;
}

export default function DecisionInbox({ full=false }) {
  const { username, leagues=[], players, year, getPlayerValue, metricType, sourceKey } = useSleeper();
  const { isConnected, syncNow, accountRequest } = useArsenalAccount();
  const [items, setItems] = useState([]);
  const [actions, setActions] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tab, setTab] = useState("now");
  const [category, setCategory] = useState("all");
  const [notificationRules, setNotificationRules] = useState({ critical:true, lineup:true, drafts:true, commissioner:false, minimumPriority:70 });
  const cacheKey = `tfa:intelligence-cache:${String(username || "").toLowerCase()}:${year || new Date().getFullYear()}:${sourceKey || "default"}`;

  useEffect(() => {
    try {
      setActions(JSON.parse(localStorage.getItem(ACTIONS_KEY) || "{}"));
      const preferences = JSON.parse(localStorage.getItem("tfa:account-preferences") || "{}");
      if (preferences.intelligenceNotifications) setNotificationRules((current) => ({ ...current, ...preferences.intelligenceNotifications }));
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached?.at && Date.now() - cached.at < CACHE_MS && Array.isArray(cached.items)) {
        setItems(cached.items); setUpdatedAt(new Date(cached.at));
      }
    } catch {}
  }, [cacheKey]);

  const saveNotificationRules = (patch) => {
    const next = { ...notificationRules, ...patch };
    setNotificationRules(next);
    try {
      const preferences = JSON.parse(localStorage.getItem("tfa:account-preferences") || "{}");
      localStorage.setItem("tfa:account-preferences", JSON.stringify({ ...preferences, intelligenceNotifications:next }));
    } catch {}
    if (isConnected) window.setTimeout(() => syncNow({ quiet:true }), 100);
  };

  useEffect(() => {
    if (!isConnected) return;
    let active = true;
    const hydrate = async () => {
      try {
        const result = await accountRequest("/api/arsenal/intelligence");
        if (!active) return;
        if (result?.snapshot?.items?.length) {
          setItems((current) => mergeDecisionRows(result.snapshot.items, current));
          setUpdatedAt(new Date(result.snapshot.generatedAt));
        }
        if (result?.stale) {
          const refreshed = await accountRequest("/api/arsenal/intelligence", {
            method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ force:false }),
          });
          if (active && refreshed?.snapshot) {
            setItems((current) => mergeDecisionRows(refreshed.snapshot.items, current));
            setUpdatedAt(new Date(refreshed.snapshot.generatedAt));
          }
        }
      } catch {}
    };
    hydrate();
    return () => { active = false; };
  }, [accountRequest, isConnected]);

  const updateAction = (id, patch, eventType = "") => {
    const previous = actions[id] || {};
    const event = eventType || (patch.status ? patch.status : patch.saved !== undefined ? (patch.saved ? "saved" : "unsaved") : patch.outcome ? `outcome:${patch.outcome}` : "updated");
    const history = [...(previous.history || []), { event, at:Date.now() }].slice(-40);
    const next = { ...actions, [id]:{ ...previous, ...patch, history, updatedAt:Date.now() } };
    setActions(next);
    try { localStorage.setItem(ACTIONS_KEY, JSON.stringify(next)); } catch {}
    if (isConnected) window.setTimeout(() => syncNow({ quiet:true }), 100);
  };

  const scan = async () => {
    if (!username || loading) return;
    setLoading(true); setError("");
    try {
      let serverItems = [];
      if (isConnected) {
        try {
          const result = await accountRequest("/api/arsenal/intelligence", {
            method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ force:true }),
          });
          serverItems = result?.snapshot?.items || [];
        } catch {}
      }
      const [root, nflState, scoreboard] = await Promise.all([
        getJson(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`),
        getJson("https://api.sleeper.app/v1/state/nfl"),
        getJson(`/api/nfl-scoreboard?season=${year || new Date().getFullYear()}&week=1`).catch(() => ({ games:[] })),
      ]);
      const week = Math.max(1, n(nflState.week) || 1);
      const score = week === 1 ? scoreboard : await getJson(`/api/nfl-scoreboard?season=${nflState.season || year}&week=${week}`).catch(() => ({ games:[] }));
      const games = score.games || [];
      const gameByTeam = new Map(games.flatMap((game) => (game.teams || []).map((team) => [team, game])));
      const rankedPlayers = Object.entries(players || {}).map(([id, player]) => ({ id, player, value:n(getPlayerValue(player)) })).filter((row) => row.value > 0 && ["QB","RB","WR","TE","K","DEF"].includes(pos(row.player))).sort((a,b) => b.value-a.value).slice(0, 220);
      const exposure = new Map();

      const scans = await concurrentMap(leagues, 8, async (league) => {
        try {
          const leagueId = league.league_id;
          const [rosters, users, matchups, transactions, drafts] = await Promise.all([
            league.rosters?.length ? league.rosters : getJson(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
            league.users?.length ? league.users : getJson(`https://api.sleeper.app/v1/league/${leagueId}/users`),
            getJson(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`).catch(() => []),
            getJson(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`).catch(() => []),
            getJson(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).catch(() => []),
          ]);
          const mine = rosters.find((roster) => String(roster.owner_id) === String(root.user_id));
          if (!mine) return { items:[], exposure:[] };
          const user = users.find((row) => String(row.user_id) === String(root.user_id));
          const teamName = user?.metadata?.team_name || user?.display_name || username;
          const matchup = matchups.find((row) => String(row.roster_id) === String(mine.roster_id));
          const starters = (matchup?.starters || []).map(String);
          const starterSet = new Set(starters);
          const rosterIds = (mine.players || []).map(String);
          const bench = rosterIds.filter((id) => !starterSet.has(id));
          const rostered = new Set(rosters.flatMap((roster) => roster.players || []).map(String));
          const leagueItems = [];
          const base = { leagueId, leagueName:league.name, teamName };
          const empty = starters.filter((id) => !id || id === "0").length;
          if (empty) leagueItems.push({ ...base, id:`empty:${leagueId}:${week}`, category:"lineup", priority:100, tone:"critical", title:`Fill ${empty} empty starting slot${empty === 1 ? "" : "s"}`, impact:"Prevents a zero", confidence:100, deadline:null, why:"An empty starter guarantees lost scoring opportunity and is the highest-priority action in the portfolio.", href:`https://sleeper.com/leagues/${leagueId}/matchup`, external:true, action:"Fix in Sleeper" });

          for (const starterId of starters.filter((id) => id && id !== "0")) {
            const player = players?.[starterId];
            if (!risk(player)) continue;
            const replacements = bench.map((id) => ({ id, player:players?.[id], value:n(getPlayerValue(players?.[id])) })).filter((row) => row.player && !unavailable(row.player) && pos(row.player) === pos(player)).sort((a,b) => b.value-a.value);
            const replacement = replacements[0];
            const game = gameByTeam.get(player?.team);
            const impact = replacement ? (metricType === "projection" ? `Protects ${(replacement.value / 17).toFixed(1)} expected weekly pts` : `Protects ${Math.round(replacement.value).toLocaleString()} market value`) : "Avoids inactive exposure";
            leagueItems.push({ ...base, id:`injury:${leagueId}:${week}:${starterId}`, category:"lineup", priority:unavailable(player) ? 97 : 78, tone:tone(unavailable(player) ? 97 : 78), title:`${name(players, starterId)} is ${injury(player) || "inactive"}`, impact, confidence:replacement ? 88 : 75, deadline:game?.date || null, why:replacement ? `${name(players, replacement.id)} is the strongest healthy same-position bench alternative under the selected source.` : "No healthy same-position bench replacement was identified, so waiver or roster action may be required.", href:"/lineup", action:"Open decision tool" });
            if (game?.weather && !game?.venue?.indoor && (n(game.weather.windSpeed) >= 18 || n(game.weather.precipitationProbability) >= 65)) leagueItems.push({ ...base, id:`weather:${leagueId}:${week}:${starterId}`, category:"weather", priority:58, tone:"opportunity", title:`Weather watch · ${name(players, starterId)}`, impact:"Raises scoring volatility", confidence:72, deadline:game.date, why:`${game.weather.summary || "Outdoor conditions"} with ${n(game.weather.windSpeed)} mph wind and ${n(game.weather.precipitationProbability)}% precipitation probability deserves a final pre-kickoff check.`, href:"/game-center", action:"Review game context" });
          }

          const weakestByPos = new Map();
          rosterIds.forEach((id) => { const player=players?.[id];const position=pos(player);const value=n(getPlayerValue(player));if(!weakestByPos.has(position)||value<weakestByPos.get(position).value)weakestByPos.set(position,{ id,value }); });
          const waiver = rankedPlayers.find((row) => !rostered.has(row.id) && row.value > n(weakestByPos.get(pos(row.player))?.value) * 1.15);
          if (waiver) {
            const weakest = weakestByPos.get(pos(waiver.player));
            const waiverDelta = waiver.value - n(weakest?.value);
            leagueItems.push({ ...base, id:`waiver:${leagueId}:${week}:${waiver.id}`, category:"waiver", priority:68, tone:"opportunity", title:`${name(players, waiver.id)} is available`, impact:metricType === "projection" ? `+${(waiverDelta / 17).toFixed(1)} expected weekly pts` : `+${Math.round(waiverDelta).toLocaleString()} market value`, confidence:80, deadline:null, why:`The selected source grades this free agent at least 15% above your weakest ${pos(waiver.player)}. Confirm role, schedule, and the proposed drop before claiming.`, href:`/league-hub?player=${waiver.id}`, action:"Build waiver claim" });
          }

          const counts = rosterIds.reduce((map,id) => { const p=pos(players?.[id]);map[p]=(map[p]||0)+1;return map; },{});
          const surplus = Object.entries(counts).filter(([position,count]) => ["QB","RB","WR","TE"].includes(position) && count >= ({QB:4,RB:7,WR:9,TE:4}[position] || 99)).sort((a,b)=>b[1]-a[1])[0];
          const need = ["QB","RB","WR","TE"].sort((a,b)=>n(counts[a])-n(counts[b]))[0];
          if (surplus && surplus[0] !== need) leagueItems.push({ ...base, id:`trade-fit:${leagueId}:${week}:${surplus[0]}:${need}`, category:"trade", priority:44, tone:"planning", title:`Convert ${surplus[0]} depth into ${need}`, impact:"Improves roster balance", confidence:65, deadline:null, why:`Your roster carries ${surplus[1]} ${surplus[0]}s while ${need} is the thinnest core position. Trade Partner Finder can identify a manager with the inverse need.`, href:"/trade", action:"Find a partner" });

          const activeDraft = drafts.find((draft) => ["drafting","paused"].includes(String(draft.status).toLowerCase()));
          if (activeDraft || String(league.status).toLowerCase() === "drafting") leagueItems.push({ ...base, id:`draft:${activeDraft?.draft_id || leagueId}`, category:"draft", priority:92, tone:"critical", title:"Draft currently active", impact:"Live selection clock", confidence:100, deadline:null, why:"The Draft Command Center can refresh every five seconds, remove selected players, and tailor recommendations to this roster.", href:`/draft-helper?league=${leagueId}${activeDraft?.draft_id ? `&draft=${activeDraft.draft_id}` : ""}`, action:"Enter draft room" });

          const pendingTrades = transactions.filter((row) => row.type === "trade" && !["complete","failed"].includes(String(row.status).toLowerCase()));
          if (pendingTrades.length) leagueItems.push({ ...base, id:`pending-trades:${leagueId}:${week}`, category:"trade", priority:74, tone:"warning", title:`${pendingTrades.length} trade${pendingTrades.length === 1 ? "" : "s"} awaiting resolution`, impact:"Roster and market decision", confidence:95, deadline:null, why:"A pending trade can alter lineup, roster-limit, and playoff decisions. Review it before making dependent moves.", href:"/trade", action:"Review trade context" });
          if (user?.is_owner && (empty || pendingTrades.length)) leagueItems.push({ ...base, id:`commissioner:${leagueId}:${week}`, category:"commissioner", priority:62, tone:"opportunity", title:"Commissioner follow-up recommended", impact:"League participation", confidence:90, deadline:null, why:`This league has ${empty ? "an empty-lineup signal" : "a pending transaction"} that belongs in the neutral commissioner review workflow.`, href:"/commissioner-dashboard", action:"Open command center" });
          if (week >= 11 && String(league.status).toLowerCase() === "in_season") leagueItems.push({ ...base, id:`playoffs:${leagueId}:${week}`, category:"playoffs", priority:52, tone:"opportunity", title:"Playoff leverage is active", impact:"Seed and qualification odds", confidence:82, deadline:null, why:`Week ${week} outcomes can materially change qualification and seeding paths. The Scenario Explorer identifies the matchups that matter most.`, href:"/playoff-odds", action:"Explore scenarios" });
          return { items:leagueItems, exposure:rosterIds };
        } catch {
          return { items:[], exposure:[] };
        }
      }, (done,total) => setProgress(`${done}/${total}`));

      scans.forEach((scan) => scan.exposure.forEach((id) => exposure.set(id, n(exposure.get(id)) + 1)));
      const threshold = Math.max(3, Math.ceil(leagues.length * .35));
      const concentrated = [...exposure.entries()].filter(([,count]) => count >= threshold).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id,count]) => ({
        id:`exposure:${id}:${leagues.length}`, category:"portfolio", priority:40 + Math.min(20,count), tone:"planning", title:`High exposure · ${name(players,id)}`, leagueName:"Portfolio-wide", teamName:`Rostered in ${count} of ${leagues.length} leagues`, impact:`${Math.round(count/Math.max(1,leagues.length)*100)}% concentration`, confidence:96, deadline:null, why:"Concentration can create an edge when correct, but one injury or role change affects several teams. Review whether this is intentional.", href:`/player-stock/results?player=${id}`, action:"Review exposure",
      }));
      const localItems = [...scans.flatMap((scan) => scan.items), ...concentrated].map((item) => ({ ...item, tone:item.tone || tone(item.priority) }));
      const next = mergeDecisionRows(serverItems, localItems);
      const at = Date.now();
      setItems(next); setUpdatedAt(new Date(at));
      localStorage.setItem(cacheKey, JSON.stringify({ at, items:next }));
    } catch (scanError) {
      setError(scanError?.message || "The intelligence scan could not be completed.");
    } finally {
      setLoading(false); setProgress("");
    }
  };

  const itemsForView = useMemo(() => {
    if (tab !== "history") return items;
    return mergeDecisionRows(items, Object.values(actions).map((state) => state?.decision).filter(Boolean));
  }, [actions, items, tab]);
  const activeItems = useMemo(() => itemsForView.filter((item) => {
    const state = actions[item.id] || {};
    if (tab === "history") return ["completed","dismissed"].includes(state.status);
    if (tab === "saved") return state.saved && !["completed","dismissed"].includes(state.status);
    if (["completed","dismissed"].includes(state.status)) return false;
    if (state.status === "snoozed" && n(state.snoozedUntil) > Date.now()) return false;
    return true;
  }).filter((item) => category === "all" || item.category === category), [actions, category, itemsForView, tab]);
  const categories = [...new Set(items.map((item) => item.category))];
  const visible = full ? activeItems : activeItems.slice(0, 8);
  const critical = activeItems.filter((item) => item.priority >= 90).length;
  const potential = activeItems.reduce((sum,item) => sum + (String(item.impact).startsWith("+") ? n(String(item.impact).match(/\d+/)?.[0]) : 0), 0);

  return <section className="overflow-hidden rounded-[30px] border border-amber-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(251,191,36,.13),transparent_38%),radial-gradient(circle_at_8%_100%,rgba(139,92,246,.1),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))]">
    <div className="border-b border-white/10 p-4 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.24em] text-amber-200/55">Arsenal Intelligence</div><h2 className="mt-1 text-2xl font-black sm:text-4xl">What should I do today?</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/44">One prioritized workflow across lineups, injuries, weather, waivers, drafts, trades, playoffs, portfolio exposure, and commissioner responsibilities.</p></div><div className="flex flex-wrap gap-2"><button onClick={scan} disabled={loading || !username} className="min-h-11 rounded-2xl bg-amber-300/10 px-5 text-sm font-black text-amber-100 disabled:opacity-40">{loading ? `Scanning ${progress}` : items.length ? "Refresh intelligence" : "Scan every league"}</button>{!full ? <Link href="/intelligence" className="grid min-h-11 place-items-center rounded-2xl bg-violet-300/10 px-5 text-sm font-black text-violet-100">Open command center</Link> : null}</div></div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-2xl bg-black/20 p-3"><b className="text-2xl">{activeItems.length}</b><small className="block text-[9px] uppercase text-white/30">Open decisions</small></div><div className="rounded-2xl bg-rose-300/[0.05] p-3"><b className="text-2xl text-rose-100">{critical}</b><small className="block text-[9px] uppercase text-white/30">Critical now</small></div><div className="rounded-2xl bg-emerald-300/[0.05] p-3"><b className="text-2xl text-emerald-100">{potential || "—"}</b><small className="block text-[9px] uppercase text-white/30">Modeled upside</small></div><div className="rounded-2xl bg-violet-300/[0.05] p-3"><b className="text-2xl text-violet-100">{isConnected ? "Cloud" : "Local"}</b><small className="block text-[9px] uppercase text-white/30">Decision memory</small></div></div>
    </div>
    {full ? <div className="border-b border-white/10 p-3 sm:p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex overflow-x-auto">{[["now","Act now"],["saved","Saved"],["history","History"]].map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-xs font-bold ${tab===key ? "bg-white/10 text-white" : "text-white/38"}`}>{label}</button>)}</div><select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs"><option value="all">Every decision type</option>{categories.map((value) => <option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></div><details className="mt-3 rounded-2xl border border-white/[0.06] bg-black/15 p-3"><summary className="cursor-pointer text-xs font-bold text-white/50">Notification rules</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{[["critical","Critical"],["lineup","Lineups"],["drafts","Active drafts"],["commissioner","Commissioner"]].map(([key,label])=><label key={key} className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 text-xs text-white/55">{label}<input type="checkbox" checked={!!notificationRules[key]} onChange={(event)=>saveNotificationRules({[key]:event.target.checked})}/></label>)}<label className="rounded-xl bg-white/[0.035] px-3 py-2 text-[10px] text-white/40">Minimum priority<select value={notificationRules.minimumPriority} onChange={(event)=>saveNotificationRules({minimumPriority:Number(event.target.value)})} className="ml-2 rounded-lg bg-slate-950 px-2 py-1 text-white"><option value="90">Critical</option><option value="70">High</option><option value="45">Opportunity</option></select></label></div><p className="mt-2 text-[10px] text-white/28">These account-synced rules prepare notification eligibility. Browser and email delivery still follow each channel’s permission and subscription settings.</p></details></div> : null}
    {error ? <div className="border-b border-white/10 p-4 text-sm text-rose-100">{error}</div> : null}
    <div className={full ? "grid gap-3 p-3 sm:p-5 lg:grid-cols-2" : "divide-y divide-white/[0.06]"}>
      {visible.map((item) => full ? <RecommendationCard key={item.id} item={item} state={actions[item.id]} update={updateAction} /> : <div key={item.id} className="p-2 sm:p-3"><RecommendationCard item={item} state={actions[item.id]} update={updateAction} compact /></div>)}
      {!visible.length && !loading ? <div className="p-6 text-sm text-white/38">{tab === "history" ? "Completed and dismissed decisions will appear here." : tab === "saved" ? "Save a recommendation to build a focused shortlist." : "Run the intelligence scan to build today’s personalized decision queue."}</div> : null}
    </div>
    <div className="border-t border-white/[0.06] px-5 py-3 text-[9px] text-white/25">{updatedAt ? `Last checked ${updatedAt.toLocaleTimeString()} · ` : ""}Recommendations are decision support, not automatic Sleeper actions. Confidence reflects data completeness and model specificity.</div>
  </section>;
}
