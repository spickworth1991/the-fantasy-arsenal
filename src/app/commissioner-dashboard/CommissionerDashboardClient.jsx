"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import AvatarImage from "../../components/AvatarImage";
import { useSleeper } from "../../context/SleeperContext";

const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });

const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatar = (id) => id ? `https://sleepercdn.com/avatars/thumbs/${id}` : DEFAULT_LEAGUE_IMG;
const number = (value) => Number(value || 0);
const percent = (value) => `${Math.round(Number(value || 0))}%`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function mapConcurrent(items, limit, worker, onProgress) {
  const output = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      output[index] = await worker(items[index], index);
      completed += 1;
      onProgress?.(completed, items.length);
    }
  });
  await Promise.all(runners);
  return output;
}

function teamName(user, roster) {
  return user?.metadata?.team_name || user?.display_name || user?.username || `Roster ${roster.roster_id}`;
}

function rosterPoints(roster) {
  return number(roster?.settings?.fpts) + number(roster?.settings?.fpts_decimal) / 100;
}

function coefficientOfVariation(values) {
  const rows = values.filter(Number.isFinite);
  if (!rows.length) return 0;
  const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  if (!mean) return 0;
  const variance = rows.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / rows.length;
  return Math.sqrt(variance) / mean;
}

function assetName(player, id) {
  return player?.full_name || player?.search_full_name || `${player?.first_name || ""} ${player?.last_name || ""}`.trim() || String(id);
}

function calculateTradeReview(transaction, players, valueFor) {
  const rosterIds = [...new Set((transaction.roster_ids || []).map(String))];
  if (rosterIds.length !== 2) return null;
  const received = Object.fromEntries(rosterIds.map((id) => [id, 0]));
  Object.entries(transaction.adds || {}).forEach(([playerId, rosterId]) => {
    const key = String(rosterId);
    if (received[key] != null) received[key] += number(valueFor(players?.[playerId]));
  });
  (transaction.draft_picks || []).forEach((pick) => {
    const key = String(pick.owner_id);
    if (received[key] == null) return;
    const round = Math.max(1, number(pick.round));
    received[key] += Math.max(150, 5000 * Math.pow(0.43, round - 1) * Math.pow(0.88, Math.max(0, number(pick.season) - new Date().getFullYear())));
  });
  const values = rosterIds.map((id) => received[id]);
  const total = values[0] + values[1];
  if (!total) return null;
  const gapPct = Math.abs(values[0] - values[1]) / Math.max(1, total / 2);
  return { rosterIds, received, gapPct, review: gapPct >= 0.75 };
}

function buildAudit({ league, matchups, transactions, tradedPicks, players, valueFor, throughWeek }) {
  const rosters = league?.rosters || [];
  const users = league?.users || [];
  const userById = new Map(users.map((user) => [String(user.user_id), user]));
  const expectedStarters = (league?.roster_positions || []).filter((slot) => !["BN", "IR", "TAXI"].includes(String(slot).toUpperCase())).length;
  const managerRows = rosters.map((roster) => {
    const user = userById.get(String(roster.owner_id));
    const playerRows = (roster.players || []).map((id) => players?.[id]).filter(Boolean);
    const rosterValue = playerRows.reduce((sum, player) => sum + number(valueFor(player)), 0);
    const ages = playerRows.map((player) => number(player.age)).filter((age) => age > 0);
    return {
      rosterId: String(roster.roster_id), ownerId: roster.owner_id ? String(roster.owner_id) : "", name: teamName(user, roster), avatar: user?.avatar || null,
      orphan: !roster.owner_id, wins: number(roster?.settings?.wins), losses: number(roster?.settings?.losses), points: rosterPoints(roster), rosterValue,
      averageAge: ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0, transactions: 0, trades: 0, waivers: 0,
      emptyLineups: 0, measuredWeeks: 0, efficiencies: [], unchangedLineups: 0, previousStarterKey: "", reviewSignals: [], playerRows,
    };
  });
  const byRoster = new Map(managerRows.map((row) => [row.rosterId, row]));

  matchups.forEach(({ week, rows }) => {
    (rows || []).forEach((matchup) => {
      const manager = byRoster.get(String(matchup.roster_id));
      if (!manager) return;
      const starters = (matchup.starters || []).map(String);
      const starterKey = starters.join("|");
      if (manager.previousStarterKey && starterKey && starterKey === manager.previousStarterKey) manager.unchangedLineups += 1;
      if (starterKey) manager.previousStarterKey = starterKey;
      const emptyCount = Math.max(0, expectedStarters - starters.filter((id) => id && id !== "0").length) + starters.filter((id) => !id || id === "0").length;
      if (emptyCount > 0) manager.emptyLineups += 1;
      const pointMap = matchup.players_points && typeof matchup.players_points === "object" ? matchup.players_points : null;
      if (pointMap && Object.keys(pointMap).length) {
        const actual = starters.reduce((sum, id) => sum + number(pointMap[id]), 0);
        const best = Object.values(pointMap).map(number).sort((a, b) => b - a).slice(0, Math.max(1, starters.filter((id) => id && id !== "0").length)).reduce((sum, value) => sum + value, 0);
        if (best > 0) manager.efficiencies.push(clamp(actual / best, 0, 1));
      }
      manager.measuredWeeks += 1;
    });
  });

  const completedTransactions = transactions.filter((transaction) => String(transaction.status).toLowerCase() === "complete");
  completedTransactions.forEach((transaction) => {
    const involved = new Set([...(transaction.roster_ids || []), ...Object.values(transaction.adds || {}), ...Object.values(transaction.drops || {})].map(String));
    involved.forEach((rosterId) => {
      const manager = byRoster.get(rosterId);
      if (!manager) return;
      manager.transactions += 1;
      if (transaction.type === "trade") manager.trades += 1;
      if (transaction.type === "waiver" || transaction.type === "free_agent") manager.waivers += 1;
    });
  });

  managerRows.forEach((manager) => {
    manager.efficiency = manager.efficiencies.length ? manager.efficiencies.reduce((sum, value) => sum + value, 0) / manager.efficiencies.length : null;
    if (manager.orphan) manager.reviewSignals.push({ type: "fact", label: "Open roster", detail: "Sleeper currently reports no owner for this roster." });
    if (manager.emptyLineups >= 2) manager.reviewSignals.push({ type: "fact", label: "Repeated empty slots", detail: `${manager.emptyLineups} weeks contained at least one empty starter position.` });
    if (throughWeek >= 4 && manager.transactions === 0) manager.reviewSignals.push({ type: "fact", label: "No recorded activity", detail: "No completed trades, waivers, or free-agent moves were found in the scanned period." });
    if (manager.efficiencies.length >= 3 && manager.efficiency < 0.72) manager.reviewSignals.push({ type: "heuristic", label: "Low lineup efficiency", detail: `${percent(manager.efficiency * 100)} average efficiency in weeks with usable player scoring data. Review context before drawing conclusions.` });
    if (manager.unchangedLineups >= Math.max(3, Math.floor(manager.measuredWeeks * 0.65))) manager.reviewSignals.push({ type: "heuristic", label: "Frequently unchanged lineup", detail: `The same starter combination appeared in ${manager.unchangedLineups} consecutive-week comparisons.` });
  });

  const tradeReviews = completedTransactions.filter((transaction) => transaction.type === "trade").map((transaction) => ({ transaction, analysis: calculateTradeReview(transaction, players, valueFor) })).filter((row) => row.analysis);
  const pairCounts = new Map();
  tradeReviews.forEach((row) => {
    const key = [...row.analysis.rosterIds].sort().join("|");
    pairCounts.set(key, number(pairCounts.get(key)) + 1);
  });
  const tradeSignals = tradeReviews.filter((row) => row.analysis.review || number(pairCounts.get([...row.analysis.rosterIds].sort().join("|"))) >= 4).map((row) => ({
    id: String(row.transaction.transaction_id), week: row.transaction.leg, rosterIds: row.analysis.rosterIds, gapPct: row.analysis.gapPct,
    repeated: number(pairCounts.get([...row.analysis.rosterIds].sort().join("|"))),
    detail: row.analysis.review ? "Selected market values show a large difference between the assets received. Picks and league context can materially change this interpretation." : "The same two rosters traded repeatedly in the scanned period. Repetition alone is not evidence of improper activity.",
  }));

  const values = managerRows.map((row) => row.rosterValue).filter((value) => value > 0);
  const pointValues = managerRows.map((row) => row.points).filter((value) => value > 0);
  const valueSpread = values.length ? Math.max(...values) / Math.max(1, Math.min(...values)) : 1;
  const pointsCv = coefficientOfVariation(pointValues);
  const weeklyParity = matchups.map(({ week, rows }) => ({ week, cv: coefficientOfVariation((rows || []).map((row) => number(row.points)).filter((value) => value > 0)) })).filter((row) => Number.isFinite(row.cv));
  const split = Math.max(1, Math.floor(weeklyParity.length / 2));
  const earlyParity = weeklyParity.slice(0, split).reduce((sum, row) => sum + row.cv, 0) / Math.max(1, weeklyParity.slice(0, split).length);
  const recentParity = weeklyParity.slice(split).reduce((sum, row) => sum + row.cv, 0) / Math.max(1, weeklyParity.slice(split).length);
  const parityTrend = !weeklyParity.length ? "Unavailable" : recentParity < earlyParity * 0.9 ? "Getting closer" : recentParity > earlyParity * 1.1 ? "Spreading out" : "Holding steady";
  const balanceScore = clamp(100 - pointsCv * 120 - Math.max(0, valueSpread - 1.5) * 10, 20, 100);

  const settings = league?.settings || {};
  const rosterPositions = league?.roster_positions || [];
  const starterCount = expectedStarters;
  const benchCount = rosterPositions.filter((slot) => String(slot).toUpperCase() === "BN").length;
  const playoffTeams = number(settings.playoff_teams || 0);
  const recommendations = [];
  if (!number(settings.league_average_match) && pointsCv >= 0.18) recommendations.push({ title: "Consider a weekly median matchup", reason: "Scoring outcomes are relatively dispersed; a median result can reduce schedule luck without removing head-to-head play." });
  if (benchCount > starterCount * 1.4) recommendations.push({ title: "Review bench depth", reason: `${benchCount} bench spots against ${starterCount} starters can make waivers unusually thin.` });
  if (!rosterPositions.some((slot) => String(slot).toUpperCase() === "IR")) recommendations.push({ title: "Consider IR slots", reason: "The league has no listed IR positions, which can force avoidable drops during injury clusters." });
  if (playoffTeams && playoffTeams > Math.ceil(rosters.length * 0.67)) recommendations.push({ title: "Review playoff field size", reason: `${playoffTeams} of ${rosters.length} teams qualify, reducing the regular season’s elimination pressure.` });
  if (playoffTeams && playoffTeams < Math.max(4, Math.floor(rosters.length * 0.33))) recommendations.push({ title: "Review playoff accessibility", reason: `Only ${playoffTeams} of ${rosters.length} teams qualify; confirm that this level of exclusivity is intentional.` });
  if (number(settings.playoff_week_start) >= 16) recommendations.push({ title: "Review the playoff calendar", reason: `A Week ${settings.playoff_week_start} start may push championship matchups into late-season NFL rest risk.` });
  if (!recommendations.length) recommendations.push({ title: "Settings look structurally sound", reason: "No strong configuration anomalies were detected. Commissioner preference should remain the deciding factor." });

  const draftRounds = Math.max(3, number(settings.draft_rounds || 4));
  const currentSeason = number(league.season || new Date().getFullYear());
  const transferredOwner = new Map((tradedPicks || []).map((pick) => [`${pick.season}-${pick.round}-${pick.roster_id}`, String(pick.owner_id)]));
  managerRows.forEach((manager) => {
    const picks = [];
    for (let season = currentSeason; season <= currentSeason + 2; season += 1) for (let round = 1; round <= draftRounds; round += 1) {
      rosters.forEach((original) => {
        const owner = transferredOwner.get(`${season}-${round}-${original.roster_id}`) || String(original.roster_id);
        if (owner === manager.rosterId) picks.push({ season, round, originalRosterId: String(original.roster_id), own: String(original.roster_id) === manager.rosterId });
      });
    }
    manager.picks = picks;
    manager.pickCount = picks.length;
    manager.topAssets = (manager.playerRows || []).map((player) => ({ id: player.player_id, name: assetName(player, player.player_id), pos: player.position, value: number(valueFor(player)) })).sort((a, b) => b.value - a.value).slice(0, 5);
  });

  const valueRanked = [...managerRows].sort((a, b) => b.rosterValue - a.rosterValue);
  valueRanked.forEach((row, index) => { row.valueRank = index + 1; });
  const attentionCount = managerRows.filter((row) => row.reviewSignals.length).length + tradeSignals.length;
  const participation = completedTransactions.length ? managerRows.filter((row) => row.transactions > 0).length / Math.max(1, managerRows.length) : 0;
  const healthScore = clamp(balanceScore * 0.35 + (1 - managerRows.reduce((sum, row) => sum + row.emptyLineups, 0) / Math.max(1, managerRows.length * Math.max(1, throughWeek))) * 35 + participation * 20 + (managerRows.some((row) => row.orphan) ? 0 : 10), 0, 100);
  return { managers: managerRows, tradeSignals, recommendations, balanceScore, healthScore, attentionCount, participation, completedTransactions, pointCv: pointsCv, valueSpread, parityTrend, earlyParity, recentParity };
}

function Shell({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/82 to-slate-950/75 shadow-[0_30px_100px_-65px_rgba(0,0,0,1)] backdrop-blur ${className}`}>{children}</div>;
}

function Metric({ label, value, detail, tone = "default" }) {
  const color = tone === "good" ? "text-emerald-100" : tone === "warn" ? "text-amber-100" : tone === "risk" ? "text-rose-100" : "text-white";
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-white/40">{label}</div><div className={`mt-1.5 text-2xl font-black ${color}`}>{value}</div>{detail ? <div className="mt-1 text-[11px] leading-4 text-white/40">{detail}</div> : null}</div>;
}

const RECRUITING_DEFAULTS = { entryFee: "", duesStatus: "", deposit: "", faab: "", contact: "", deadline: "", constitution: "", notes: "" };

function recruitingInputClass() {
  return "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-300/35";
}

function OrphanEvaluator({ report, evaluator, managers, recruiting, updateRecruiting, copied, copyReport, setReportRosterId }) {
  if (!report || !evaluator) return null;
  const fields = [["entryFee", "Entry fee / dues", "$50 per season"], ["duesStatus", "Dues status", "2026 paid; 2027 due"], ["deposit", "Deposit", "One season deposit"], ["faab", "FAAB / waivers", "$100 rolling FAAB"], ["contact", "Commissioner contact", "Discord, email, or handle"], ["deadline", "Decision deadline", "August 15"], ["constitution", "Rules / constitution link", "https://..."]];
  const picksBySeason = Object.entries((report.picks || []).reduce((groups, pick) => ({ ...groups, [pick.season]: [...(groups[pick.season] || []), pick] }), {}));
  return <div className="mt-6 space-y-5">
    <Shell className="overflow-hidden"><div className="flex flex-col gap-4 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.2),transparent_38%)] p-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-violet-200/55">Orphan team evaluator</div><h2 className="mt-1 text-2xl font-black">Turn an open roster into an honest opportunity</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">Sleeper supplies read-only roster and league data. Recruiting details below stay only in this browser.</p></div><div className="flex flex-wrap gap-2"><select value={report.rosterId} onChange={(event) => setReportRosterId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm">{managers.map((manager) => <option key={manager.rosterId} value={manager.rosterId}>{manager.name}{manager.orphan ? " · Open" : ""}</option>)}</select><button onClick={copyReport} className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] px-4 py-2.5 text-sm font-semibold text-cyan-100">{copied ? "Recruiting brief copied" : "Copy recruiting brief"}</button><button onClick={() => window.print()} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70">Print / PDF</button></div></div>
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]"><div><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-3xl bg-violet-400/10 text-xl font-black">#{report.valueRank}</div><div><div className="text-2xl font-black">{report.name}</div><div className="mt-1 text-sm text-white/45">{report.orphan ? "Open roster" : "Currently managed"} · {report.wins}-{report.losses} · average age {report.averageAge ? report.averageAge.toFixed(1) : "—"}</div></div></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Timeline" value={evaluator.timeline} /><Metric label="Difficulty" value={evaluator.difficulty} detail={`${evaluator.difficultyScore}/100 estimated`} tone={evaluator.difficulty === "Challenging" ? "warn" : "good"} /><Metric label="Roster value" value={`#${report.valueRank}`} detail={`${Math.round(report.rosterValue).toLocaleString()} market value`} /><Metric label="Draft capital" value={report.pickCount} detail="Modeled future picks" /></div><div className="mt-5 rounded-3xl border border-cyan-300/12 bg-cyan-400/[0.045] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-100/50">Recommended path</div><div className="mt-2 text-sm leading-6 text-white/70">{evaluator.path}</div></div></div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4"><div className="text-sm font-bold">League-relative position profile</div><div className="mt-4 space-y-3">{evaluator.positionProfile.map((row) => { const pct = Math.max(8, 100 - ((row.rank - 1) / Math.max(1, managers.length - 1)) * 92); return <div key={row.position}><div className="flex justify-between text-xs"><span className="font-semibold">{row.position} <span className="font-normal text-white/30">· {row.count} rostered</span></span><span className="text-white/55">#{row.rank} of {managers.length}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{ width: `${pct}%` }} /></div></div>; })}</div><div className="mt-4 text-[11px] leading-5 text-white/35">Ranks use the selected player-value market and emphasize likely usable depth. They are directional, not projections.</div></div></div>
    </Shell>
    <div className="grid gap-5 lg:grid-cols-2"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-emerald-200/50">Assets candidates will notice</div><h3 className="mt-1 text-xl font-black">Foundation and trade appeal</h3><div className="mt-4 grid gap-2 sm:grid-cols-2">{report.topAssets.map((asset, index) => <div key={asset.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3"><AvatarImage name={asset.name} playerId={asset.id} size={36} className="rounded-full" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{asset.name}</div><div className="text-xs text-white/35">{asset.pos || "—"} · {index < 2 ? "Core asset" : "Trade-interest asset"}</div></div><div className="text-xs font-bold text-white/55">{Math.round(asset.value).toLocaleString()}</div></div>)}</div></Shell>
      <Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-amber-200/50">Draft capital</div><h3 className="mt-1 text-xl font-black">Pick inventory</h3><div className="mt-4 space-y-3">{picksBySeason.length ? picksBySeason.map(([season, picks]) => <div key={season} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="text-sm font-bold">{season}</div><div className="mt-2 flex flex-wrap gap-1.5">{picks.sort((a,b) => a.round-b.round).map((pick, index) => <span key={`${pick.round}-${pick.originalRosterId}-${index}`} className={`rounded-lg px-2 py-1 text-[10px] ${pick.round === 1 ? "bg-amber-300/10 text-amber-100" : "bg-white/[0.05] text-white/50"}`}>R{pick.round}{pick.own ? " · own" : ` · via #${pick.originalRosterId}`}</span>)}</div></div>) : <div className="text-sm text-white/45">No modeled picks found.</div>}</div></Shell></div>
    <Shell className="p-5"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-violet-200/50">Local recruiting details</div><h3 className="mt-1 text-xl font-black">Complete the opportunity</h3></div><div className="text-[11px] text-white/35">Auto-saved locally · never sent to Sleeper</div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields.map(([key, label, placeholder]) => <label key={key} className={key === "constitution" ? "sm:col-span-2" : ""}><span className="text-xs text-white/50">{label}</span><input value={recruiting[key]} onChange={(event) => updateRecruiting(key, event.target.value)} placeholder={placeholder} className={recruitingInputClass()} /></label>)}</div><label className="mt-3 block"><span className="text-xs text-white/50">Commissioner notes and selling points</span><textarea value={recruiting.notes} onChange={(event) => updateRecruiting("notes", event.target.value)} placeholder="League culture, dispersal details, special rules, or anything a replacement manager should know..." rows={4} className={recruitingInputClass()} /></label></Shell>
  </div>;
}

export default function CommissionerDashboardClient() {
  const { username, leagues, activeLeague, setActiveLeague, fetchLeagueRostersSilent, players, getPlayerValue, format, qbType, sourceKey } = useSleeper();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [reportRosterId, setReportRosterId] = useState("");
  const [copied, setCopied] = useState(false);
  const [recruiting, setRecruiting] = useState(RECRUITING_DEFAULTS);
  const league = useMemo(() => leagues.find((row) => row.league_id === activeLeague) || null, [activeLeague, leagues]);
  const valueFor = useMemo(() => (player) => getPlayerValue(player, { format, qbType, sourceKey }) || 0, [format, getPlayerValue, qbType, sourceKey]);

  useEffect(() => {
    if (activeLeague && (!league?.rosters || !league?.users)) fetchLeagueRostersSilent(activeLeague).catch(() => {});
  }, [activeLeague, fetchLeagueRostersSilent, league?.rosters, league?.users]);

  useEffect(() => {
    let active = true;
    if (!league?.league_id || !league?.rosters?.length) { setData(null); return; }
    const cacheKey = `commissioner-health:v2:${league.league_id}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - number(cached.ts) < 10 * 60 * 1000) { setData(cached.payload); return; }
    } catch {}
    setLoading(true); setError("");
    (async () => {
      try {
        setProgress("Reading NFL and league state…");
        const state = await getJson("https://api.sleeper.app/v1/state/nfl").catch(() => ({}));
        const sameSeason = String(state.season) === String(league.season);
        const throughWeek = sameSeason ? clamp(number(state.week || 1) - 1, 0, 18) : 18;
        const weeks = Array.from({ length: throughWeek }, (_, index) => index + 1);
        setProgress(`Auditing ${weeks.length} completed week${weeks.length === 1 ? "" : "s"}…`);
        const matchupRows = await mapConcurrent(weeks, 6, async (week) => ({ week, rows: await getJson(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`).catch(() => []) }), (done, total) => active && setProgress(`Auditing lineups · ${done}/${total}`));
        const transactionWeeks = Array.from(new Set([0, ...weeks, Math.min(18, throughWeek + 1)]));
        const transactionRows = await mapConcurrent(transactionWeeks, 6, async (week) => getJson(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/${week}`).catch(() => []), (done, total) => active && setProgress(`Auditing league activity · ${done}/${total}`));
        const tradedPicks = await getJson(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).catch(() => []);
        const txMap = new Map();
        transactionRows.flat().forEach((transaction) => txMap.set(String(transaction.transaction_id || `${transaction.created}-${transaction.type}`), transaction));
        const payload = buildAudit({ league, matchups: matchupRows, transactions: [...txMap.values()], tradedPicks, players, valueFor, throughWeek });
        if (!active) return;
        setData(payload);
        const orphan = payload.managers.find((manager) => manager.orphan);
        setReportRosterId((current) => current || orphan?.rosterId || payload.managers[0]?.rosterId || "");
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload })); } catch {}
      } catch { if (active) setError("The league audit could not be completed. Please refresh and try again."); }
      finally { if (active) { setLoading(false); setProgress(""); } }
    })();
    return () => { active = false; };
  }, [league, players, valueFor]);

  const report = data?.managers?.find((manager) => manager.rosterId === String(reportRosterId));
  const evaluator = useMemo(() => {
    if (!report || !data?.managers?.length) return null;
    const positions = ["QB", "RB", "WR", "TE"];
    const positionProfile = positions.map((position) => {
      const limit = position === "QB" || position === "TE" ? 2 : 4;
      const positionScore = (manager) => (manager.playerRows || []).filter((player) => String(player.position).toUpperCase() === position).map((player) => number(valueFor(player))).sort((a, b) => b - a).slice(0, limit).reduce((sum, value) => sum + value, 0);
      const score = positionScore(report);
      const leagueScores = data.managers.map(positionScore).sort((a, b) => b - a);
      return { position, count: (report.playerRows || []).filter((player) => String(player.position).toUpperCase() === position).length, score, rank: Math.max(1, leagueScores.findIndex((value) => value <= score) + 1) };
    });
    const teamCount = data.managers.length;
    const strongPositions = positionProfile.filter((row) => row.rank <= Math.ceil(teamCount / 3)).map((row) => row.position);
    const weakPositions = positionProfile.filter((row) => row.rank > Math.ceil(teamCount * 0.67)).map((row) => row.position);
    const youngCore = (report.playerRows || []).filter((player) => number(player.age) > 0 && number(player.age) <= (String(player.position).toUpperCase() === "QB" ? 27 : 25)).reduce((sum, player) => sum + number(valueFor(player)), 0) / Math.max(1, report.rosterValue);
    const timeline = report.valueRank <= Math.ceil(teamCount / 3) && report.wins >= report.losses ? "Ready to compete" : report.valueRank > Math.ceil(teamCount * 0.67) || youngCore >= 0.55 ? "Build around the future" : "Flexible retool";
    const difficultyScore = clamp(Math.round((report.valueRank / teamCount) * 48 + (report.pickCount < teamCount ? 20 : 7) + weakPositions.length * 6 - youngCore * 18), 18, 92);
    const difficulty = difficultyScore >= 68 ? "Challenging" : difficultyScore >= 42 ? "Moderate" : "Accessible";
    const path = timeline === "Ready to compete" ? `Protect the core, use depth and picks to address ${weakPositions.slice(0, 2).join(" and ") || "starter depth"}, and compete immediately.` : timeline === "Build around the future" ? `Build around the youngest premium assets, shop aging producers, and prioritize ${weakPositions.slice(0, 2).join(" and ") || "scarce positions"} plus future first-round flexibility.` : `Retool selectively: keep the strongest ${strongPositions.slice(0, 2).join("/") || "position groups"}, consolidate replaceable depth, and avoid forcing a full teardown.`;
    return { positionProfile, strongPositions, weakPositions, youngCore, timeline, difficulty, difficultyScore, path };
  }, [data, report, valueFor]);
  const commissioners = (league?.users || []).filter((user) => user.is_owner).map((user) => user.display_name || user.username).filter(Boolean);
  const currentUser = (league?.users || []).find((user) => String(user.username || user.display_name).toLowerCase() === String(username || "").toLowerCase());
  const isCommissioner = !!currentUser?.is_owner;
  useEffect(() => {
    if (!league?.league_id || !reportRosterId) return;
    try { setRecruiting({ ...RECRUITING_DEFAULTS, ...JSON.parse(localStorage.getItem(`orphan-recruiting:${league.league_id}:${reportRosterId}`) || "{}") }); } catch { setRecruiting(RECRUITING_DEFAULTS); }
  }, [league?.league_id, reportRosterId]);

  const updateRecruiting = (key, value) => {
    const next = { ...recruiting, [key]: value };
    setRecruiting(next);
    try { localStorage.setItem(`orphan-recruiting:${league.league_id}:${reportRosterId}`, JSON.stringify(next)); } catch {}
  };
  const copyReport = async () => {
    if (!report || !evaluator) return;
    const text = [`${league.name} · Replacement Manager Report`, report.name, `Roster value rank: ${report.valueRank}/${data.managers.length}`, `Record: ${report.wins}-${report.losses}`, `Future picks modeled: ${report.pickCount}`, `Top assets: ${report.topAssets.map((asset) => asset.name).join(", ")}`, `Open roster: ${report.orphan ? "Yes" : "No"}`, "Generated by The Fantasy Arsenal"].join("\n");
    const details = [["Entry fee", recruiting.entryFee], ["Dues", recruiting.duesStatus], ["Deposit", recruiting.deposit], ["FAAB", recruiting.faab], ["Contact", recruiting.contact], ["Decision deadline", recruiting.deadline], ["League rules", recruiting.constitution]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
    const shareText = [`${league.name} · Orphan Team Opportunity`, report.name, report.orphan ? "OPEN ROSTER" : "Roster evaluation", "", `Competitive timeline: ${evaluator.timeline}`, `Estimated difficulty: ${evaluator.difficulty} (${evaluator.difficultyScore}/100)`, `Roster value rank: ${report.valueRank}/${data.managers.length}`, `Record: ${report.wins}-${report.losses}`, `Future picks modeled: ${report.pickCount}`, `Position ranks: ${evaluator.positionProfile.map((row) => `${row.position} #${row.rank}`).join(" · ")}`, `Foundation assets: ${report.topAssets.map((asset) => asset.name).join(", ")}`, "", `Recommended path: ${evaluator.path}`, ...details, recruiting.notes ? `Notes: ${recruiting.notes}` : "", "", "Sleeper data is read-only. Recruiting details were supplied locally by the commissioner.", "Generated by The Fantasy Arsenal"].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(shareText || text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };

  return <main className="min-h-screen text-white"><BackgroundParticles /><Navbar pageTitle="Commissioner Dashboard" /><div className="mx-auto max-w-7xl px-4 pb-16 pt-20">
    <header className="relative overflow-hidden rounded-[34px] border border-cyan-300/15 bg-[radial-gradient(circle_at_85%_0%,rgba(34,211,238,.2),transparent_34%),radial-gradient(circle_at_10%_100%,rgba(139,92,246,.14),transparent_32%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))] p-5 shadow-[0_42px_125px_-75px_rgba(34,211,238,.75)] sm:p-7"><div className="text-[11px] font-semibold uppercase tracking-[.28em] text-cyan-200/60">Commissioner intelligence</div><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">League Health Dashboard</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/58 sm:text-base">Participation, competitive balance, lineup habits, roster quality, settings, and review signals—with evidence and neutral language built in.</p><div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label><span className="mb-1.5 block text-xs text-white/45">League to audit</span><select value={activeLeague || ""} onChange={(event) => { setActiveLeague(event.target.value); setData(null); if (event.target.value) fetchLeagueRostersSilent(event.target.value).catch(() => {}); }} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 text-sm"><option value="">Choose a league</option>{leagues.map((row) => <option key={row.league_id} value={row.league_id}>{row.name}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><Metric label="Your access" value={isCommissioner ? "Commissioner" : "Read-only"} detail={isCommissioner ? "You are listed as a league owner." : "Audit data remains publicly viewable."} /><Metric label="Commissioners" value={commissioners.length || "—"} detail={commissioners.slice(0,2).join(", ")} /></div></div></header>

    {loading ? <div className="mt-5 flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.07] p-4 text-sm text-cyan-100"><span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-200/25 border-t-cyan-200" />{progress}</div> : null}
    {error ? <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div> : null}
    {!username ? <Shell className="mt-6 p-8 text-center text-white/55">Log in with your Sleeper username to select and audit a league.</Shell> : null}

    {data ? <><section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric label="Health score" value={`${Math.round(data.healthScore)}/100`} detail="Composite participation and balance signal" tone={data.healthScore >= 75 ? "good" : data.healthScore >= 55 ? "warn" : "risk"} /><Metric label="Balance" value={`${Math.round(data.balanceScore)}/100`} detail={`${data.valueSpread.toFixed(1)}× top-to-bottom value`} /><Metric label="Balance trend" value={data.parityTrend} detail="Early weeks compared with recent weeks" /><Metric label="Participation" value={percent(data.participation * 100)} detail="Managers with recorded activity" /><Metric label="Needs review" value={data.attentionCount} detail="Manager and trade signals" tone={data.attentionCount ? "warn" : "good"} /><Metric label="Open rosters" value={data.managers.filter((manager) => manager.orphan).length} detail="No Sleeper owner assigned" tone={data.managers.some((manager) => manager.orphan) ? "risk" : "good"} /></section>

      <nav className="sticky top-16 z-30 -mx-4 mt-6 overflow-x-auto border-y border-white/10 bg-slate-950/90 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border"><div className="flex w-max gap-1 sm:w-full">{[["overview","Overview"],["managers","Manager Activity"],["review","Review Signals"],["settings","Settings"],["orphan","Orphan Evaluator"]].map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition sm:flex-1 ${tab === key ? "bg-white/10 text-white" : "text-white/48 hover:bg-white/5 hover:text-white/80"}`}>{label}</button>)}</div></nav>

      {tab === "orphan" ? <OrphanEvaluator report={report} evaluator={evaluator} managers={data.managers} recruiting={recruiting} updateRecruiting={updateRecruiting} copied={copied} copyReport={copyReport} setReportRosterId={setReportRosterId} /> : null}

      {tab === "overview" ? <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]"><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-cyan-200/55">League pulse</div><h2 className="mt-1 text-xl font-black">Competitive balance</h2><p className="mt-1 text-xs text-white/45">Standings and roster-market value reveal different kinds of parity.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="text-left text-xs text-white/38"><tr><th className="p-3">Team</th><th className="p-3">Record</th><th className="p-3">Points</th><th className="p-3">Value rank</th><th className="p-3">Activity</th><th className="p-3">Signals</th></tr></thead><tbody>{[...data.managers].sort((a,b) => b.wins-a.wins || b.points-a.points).map((manager) => <tr key={manager.rosterId} className="border-t border-white/5"><td className="p-3 font-semibold">{manager.name}{manager.orphan ? <span className="ml-2 rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] text-rose-100">OPEN</span> : null}</td><td className="p-3">{manager.wins}-{manager.losses}</td><td className="p-3">{manager.points.toFixed(1)}</td><td className="p-3">#{manager.valueRank}</td><td className="p-3">{manager.transactions} moves</td><td className="p-3">{manager.reviewSignals.length || "—"}</td></tr>)}</tbody></table></div></Shell><div className="space-y-5"><Shell className="p-5"><div className="text-lg font-bold">What the score means</div><div className="mt-3 space-y-3 text-xs leading-5 text-white/52"><p><span className="font-semibold text-emerald-100">Observed facts</span> include empty slots, ownership, and transaction counts.</p><p><span className="font-semibold text-amber-100">Review signals</span> use thresholds for lineup efficiency or trade-value difference and require commissioner context.</p><p>No signal is labeled collusion, tanking, or misconduct automatically.</p></div></Shell><Shell className="p-5"><div className="text-lg font-bold">Quick recommendations</div><div className="mt-3 space-y-3">{data.recommendations.slice(0,3).map((item) => <div key={item.title} className="rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs leading-5 text-white/45">{item.reason}</div></div>)}</div></Shell></div></div> : null}

      {tab === "managers" ? <div className="mt-6 grid gap-4 lg:grid-cols-2">{data.managers.map((manager) => <Shell key={manager.rosterId} className="p-5"><div className="flex items-start gap-3">{manager.avatar ? <img src={`https://sleepercdn.com/avatars/thumbs/${manager.avatar}`} alt="" className="h-11 w-11 rounded-2xl object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.06] text-sm font-black text-white/40">R{manager.rosterId}</div>}<div className="min-w-0 flex-1"><div className="truncate text-lg font-bold">{manager.name}</div><div className="mt-1 text-xs text-white/45">{manager.wins}-{manager.losses} · value rank #{manager.valueRank} · age {manager.averageAge ? manager.averageAge.toFixed(1) : "—"}</div></div>{manager.reviewSignals.length ? <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2.5 py-1 text-[10px] font-semibold text-amber-100">REVIEW</span> : <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] px-2.5 py-1 text-[10px] font-semibold text-emerald-100">CLEAR</span>}</div><div className="mt-4 grid grid-cols-5 gap-2 text-center"><div><div className="text-lg font-black">{manager.transactions}</div><div className="text-[9px] uppercase text-white/30">Moves</div></div><div><div className="text-lg font-black">{manager.trades}</div><div className="text-[9px] uppercase text-white/30">Trades</div></div><div><div className="text-lg font-black">{manager.waivers}</div><div className="text-[9px] uppercase text-white/30">Waivers</div></div><div><div className="text-lg font-black">{manager.measuredWeeks ? percent((manager.emptyLineups/manager.measuredWeeks)*100) : "—"}</div><div className="text-[9px] uppercase text-white/30">Unset</div></div><div><div className="text-lg font-black">{manager.efficiency == null ? "—" : percent(manager.efficiency*100)}</div><div className="text-[9px] uppercase text-white/30">Efficiency</div></div></div>{manager.reviewSignals.length ? <div className="mt-4 space-y-2">{manager.reviewSignals.map((signal) => <div key={signal.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold">{signal.label}</div><span className="text-[9px] uppercase tracking-wider text-white/30">{signal.type}</span></div><div className="mt-1 text-xs leading-5 text-white/45">{signal.detail}</div></div>)}</div> : null}</Shell>)}</div> : null}

      {tab === "review" ? <div className="mt-6 grid gap-5 lg:grid-cols-2"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-amber-200/55">Lineup and activity review</div><h2 className="mt-1 text-xl font-black">Evidence requiring context</h2><div className="mt-4 space-y-3">{data.managers.filter((manager) => manager.reviewSignals.length).length ? data.managers.filter((manager) => manager.reviewSignals.length).map((manager) => <div key={manager.rosterId} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="font-bold">{manager.name}</div><div className="mt-2 space-y-1 text-xs leading-5 text-white/50">{manager.reviewSignals.map((signal) => <div key={signal.label}>• <span className="text-white/75">{signal.label}:</span> {signal.detail}</div>)}</div></div>) : <div className="rounded-2xl bg-emerald-400/[0.06] p-4 text-sm text-emerald-100">No manager-level review signals were found.</div>}</div></Shell><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-rose-200/55">Trade review</div><h2 className="mt-1 text-xl font-black">Unusual patterns—not conclusions</h2><div className="mt-4 space-y-3">{data.tradeSignals.length ? data.tradeSignals.map((signal) => <div key={signal.id} className="rounded-2xl border border-rose-300/12 bg-rose-400/[0.045] p-4"><div className="flex items-center justify-between"><div className="text-sm font-bold">Week {signal.week || "—"} trade</div><span className="text-xs text-rose-100">{Math.round(signal.gapPct*100)}% value gap</span></div><div className="mt-2 text-xs leading-5 text-white/50">{signal.detail}</div>{signal.repeated >= 4 ? <div className="mt-2 text-[11px] text-amber-100/70">These managers completed {signal.repeated} trades with each other.</div> : null}</div>) : <div className="rounded-2xl bg-emerald-400/[0.06] p-4 text-sm text-emerald-100">No large value differences or repeated-pair patterns crossed the review thresholds.</div>}</div><div className="mt-4 rounded-2xl border border-cyan-300/12 bg-cyan-400/[0.045] p-3 text-[11px] leading-5 text-white/45">Market values cannot capture roster direction, scoring rules, pick position, injuries, or manager preference. These rows are prompts for review only.</div></Shell></div> : null}

      {tab === "settings" ? <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-violet-200/55">Configuration audit</div><h2 className="mt-1 text-xl font-black">Recommended league review</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{data.recommendations.map((item) => <div key={item.title} className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-400/[0.055] to-white/[0.02] p-4"><div className="font-bold">{item.title}</div><div className="mt-2 text-xs leading-5 text-white/50">{item.reason}</div></div>)}</div></Shell><Shell className="p-5"><div className="text-lg font-bold">Current structure</div><div className="mt-4 grid grid-cols-2 gap-2"><Metric label="Teams" value={league.total_rosters || data.managers.length} /><Metric label="Playoff teams" value={league?.settings?.playoff_teams || "—"} /><Metric label="Playoffs start" value={league?.settings?.playoff_week_start ? `Week ${league.settings.playoff_week_start}` : "—"} /><Metric label="Median game" value={number(league?.settings?.league_average_match) ? "On" : "Off"} /><Metric label="Starter slots" value={(league.roster_positions || []).filter((slot) => !["BN","IR","TAXI"].includes(String(slot).toUpperCase())).length} /><Metric label="Bench slots" value={(league.roster_positions || []).filter((slot) => String(slot).toUpperCase() === "BN").length} /></div><div className="mt-4 text-[11px] leading-5 text-white/38">Recommendations describe tradeoffs; they are not universal rules. League culture and commissioner intent should control final settings.</div></Shell></div> : null}

      {tab === "replacement" ? <div className="mt-6"><Shell className="overflow-hidden"><div className="flex flex-col gap-4 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.17),transparent_38%)] p-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-violet-200/55">Replacement manager report</div><h2 className="mt-1 text-2xl font-black">Package a roster honestly</h2><p className="mt-1 text-xs text-white/45">Useful for open teams, commissioner review, or recruiting a future replacement.</p></div><div className="flex flex-wrap gap-2"><select value={reportRosterId} onChange={(event) => setReportRosterId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm">{data.managers.map((manager) => <option key={manager.rosterId} value={manager.rosterId}>{manager.name}{manager.orphan ? " · Open" : ""}</option>)}</select><button onClick={copyReport} className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] px-4 py-2.5 text-sm font-semibold text-cyan-100">{copied ? "Copied" : "Copy report"}</button></div></div>{report ? <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px]"><div><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-3xl bg-violet-400/10 text-xl font-black">#{report.valueRank}</div><div><div className="text-2xl font-black">{report.name}</div><div className="mt-1 text-sm text-white/45">{report.orphan ? "Open roster" : "Currently managed"} · {report.wins}-{report.losses} record · age {report.averageAge ? report.averageAge.toFixed(1) : "—"}</div></div></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Value rank" value={`#${report.valueRank}`} /><Metric label="Roster value" value={Math.round(report.rosterValue).toLocaleString()} /><Metric label="Future picks" value={report.pickCount} /><Metric label="Activity" value={`${report.transactions} moves`} /></div><div className="mt-6"><div className="text-lg font-bold">Foundation assets</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{report.topAssets.map((asset) => <div key={asset.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3"><AvatarImage name={asset.name} playerId={asset.id} size={34} className="rounded-full" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{asset.name}</div><div className="text-xs text-white/40">{asset.pos || "—"}</div></div><div className="text-xs font-bold text-white/55">{Math.round(asset.value).toLocaleString()}</div></div>)}</div></div></div><div className="space-y-3"><div className="rounded-3xl border border-emerald-300/12 bg-emerald-400/[0.05] p-4"><div className="text-[10px] uppercase tracking-wider text-emerald-100/45">Best selling point</div><div className="mt-2 text-sm font-semibold">{report.valueRank <= Math.ceil(data.managers.length/3) ? "Strong roster-value foundation" : report.pickCount >= 12 ? "Flexible future draft capital" : "Clear opportunity to reshape the team"}</div></div><div className="rounded-3xl border border-amber-300/12 bg-amber-400/[0.05] p-4"><div className="text-[10px] uppercase tracking-wider text-amber-100/45">Expectation to set</div><div className="mt-2 text-sm leading-5 text-white/58">{report.valueRank > Math.ceil(data.managers.length*0.67) ? "This roster grades in the bottom third by the selected market, so a multi-season plan may be realistic." : "This roster is not in the bottom third by value, but lineup balance and pick placement still deserve review."}</div></div></div></div> : null}</Shell></div> : null}
    </> : null}
  </div></main>;
}
