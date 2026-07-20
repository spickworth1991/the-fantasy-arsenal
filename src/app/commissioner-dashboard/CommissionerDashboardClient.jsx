"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";

const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
const CommissionerLeagueOffice = dynamic(() => import("./CommissionerLeagueOffice"), { ssr: false });
const CommissionerCommandCenter = dynamic(() => import("./CommissionerCommandCenter"), { ssr: false });

const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const VALUE_SOURCES = DEFAULT_SOURCES.filter((source) => source.type === "value");
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
  const expectedStarters = (league?.roster_positions || []).filter((slot) => {
    const value = String(slot).toUpperCase();
    return value !== "BN" && !value.includes("IR") && !value.includes("RESERVE") && !value.includes("TAXI");
  }).length;
  const managerRows = rosters.map((roster) => {
    const user = userById.get(String(roster.owner_id));
    const playerRows = (roster.players || []).map((id) => players?.[id]).filter(Boolean);
    const rosterValue = playerRows.reduce((sum, player) => sum + number(valueFor(player)), 0);
    const ages = playerRows.map((player) => number(player.age)).filter((age) => age > 0);
    return {
      rosterId: String(roster.roster_id), ownerId: roster.owner_id ? String(roster.owner_id) : "", name: teamName(user, roster), avatar: user?.avatar || null,
      orphan: !roster.owner_id, wins: number(roster?.settings?.wins), losses: number(roster?.settings?.losses), points: rosterPoints(roster), rosterValue,
      averageAge: ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0, transactions: 0, trades: 0, waivers: 0,
      emptyLineups: 0, emptyWeeks: [], measuredWeeks: 0, efficiencies: [], unchangedLineups: 0, previousStarterKey: "", reviewSignals: [], playerRows, activityWeeks: [],
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
      if (emptyCount > 0) { manager.emptyLineups += 1; manager.emptyWeeks.push({ week, emptyCount }); }
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
      manager.activityWeeks.push({ week: number(transaction.leg), type: transaction.type, id: String(transaction.transaction_id || "") });
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
  const hasIrSlots = rosterPositions.some((slot) => { const value = String(slot).toUpperCase(); return value === "IR" || value.includes("RESERVE"); }) || number(settings.reserve_slots) > 0 || number(settings.reserve) > 0;
  if (!hasIrSlots) recommendations.push({ title: "Consider IR slots", reason: "The league has no listed IR or reserve positions, which can force avoidable drops during injury clusters." });
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
    manager.assets = (manager.playerRows || []).map((player) => ({ id: player.player_id, name: assetName(player, player.player_id), pos: player.position, age: number(player.age) || null, team: player.team || "FA", value: number(valueFor(player)) })).sort((a, b) => b.value - a.value);
    manager.topAssets = manager.assets.slice(0, 5);
  });

  const valueRanked = [...managerRows].sort((a, b) => b.rosterValue - a.rosterValue);
  valueRanked.forEach((row, index) => { row.valueRank = index + 1; });
  const attentionCount = managerRows.filter((row) => row.reviewSignals.length).length + tradeSignals.length;
  const participation = completedTransactions.length ? managerRows.filter((row) => row.transactions > 0).length / Math.max(1, managerRows.length) : 0;
  const healthScore = clamp(balanceScore * 0.35 + (1 - managerRows.reduce((sum, row) => sum + row.emptyLineups, 0) / Math.max(1, managerRows.length * Math.max(1, throughWeek))) * 35 + participation * 20 + (managerRows.some((row) => row.orphan) ? 0 : 10), 0, 100);
  return { managers: managerRows, tradeSignals, recommendations, balanceScore, healthScore, attentionCount, participation, completedTransactions, matchups, pointCv: pointsCv, valueSpread, parityTrend, earlyParity, recentParity, throughWeek };
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function buildSettingsAudit(league, managerCount) {
  const settings = league?.settings || {};
  const scoring = league?.scoring_settings || {};
  const slots = (league?.roster_positions || []).map((slot) => String(slot).toUpperCase());
  const count = (slot) => slots.filter((value) => value === slot).length;
  const teams = number(league?.total_rosters) || managerCount || 12;
  const bench = count("BN");
  const starters = slots.filter((slot) => slot !== "BN" && !slot.includes("IR") && !slot.includes("RESERVE") && !slot.includes("TAXI")).length;
  const flex = count("FLEX") + count("WRRB_FLEX") + count("REC_FLEX");
  const superflex = count("SUPER_FLEX");
  const qbDemand = count("QB") + superflex * 0.82;
  const taxi = Math.max(slots.filter((slot) => slot.includes("TAXI")).length, number(settings.taxi_slots), number(settings.taxi), number(settings.taxi_squads));
  const ir = Math.max(slots.filter((slot) => slot === "IR" || slot.includes("RESERVE")).length, number(settings.reserve_slots), number(settings.reserve));
  const reception = number(scoring.rec);
  const teKeys = Object.entries(scoring).filter(([key, value]) => /(^|_)te($|_)/i.test(key) && number(value) !== 0);
  const tePremium = teKeys.reduce((sum, [, value]) => sum + Math.abs(number(value)), 0);
  const draftRounds = number(settings.draft_rounds) || 0;
  const playoffTeams = number(settings.playoff_teams);
  const playoffStart = number(settings.playoff_week_start);
  const tradeDeadline = number(settings.trade_deadline);
  const median = !!number(settings.league_average_match);
  const rosteredPerTeam = starters + bench + taxi + ir;
  const waiverPressure = rosteredPerTeam * teams;
  const identity = superflex ? (tePremium > 0 ? "Superflex, TE-premium" : "Quarterback-driven") : taxi >= 3 && bench >= 10 ? "Deep dynasty" : bench <= 6 ? "Shallow and active" : "Balanced traditional";
  const rows = [];
  const add = (key, label, grade, value, common, effect) => rows.push({ key, label, grade, value, common, effect });
  add("scarcity", "Starting-position scarcity", starters >= 11 || flex >= 3 ? "High" : starters <= 8 ? "Low" : "Moderate", `${starters} starters · ${flex + superflex} flexible`, "Common leagues start roughly 9–10 players.", starters >= 11 ? "Depth and injury resilience matter more than star-only builds." : starters <= 8 ? "Elite difference-makers matter more because fewer players reach lineups." : "Lineup depth and elite production remain reasonably balanced.");
  add("qb", "Quarterback importance", superflex ? "Premium" : count("QB") >= 2 ? "Very high" : "Standard", superflex ? `${count("QB")} QB + ${superflex} superflex` : `${count("QB")} starting QB`, "One-QB and one-QB-plus-superflex are the most familiar formats.", superflex ? "Starting quarterbacks, secure backups, and young QB prospects gain substantial trade value." : "Replacement-level quarterbacks remain easier to find; elite rushing QBs create most of the separation.");
  add("te", "Tight-end premium strength", tePremium >= 1 ? "Strong" : tePremium > 0 ? "Light" : "None", teKeys.length ? teKeys.map(([key, value]) => `${key}: ${value}`).join(" · ") : "No TE-specific scoring found", "Standard scoring gives tight ends the same reception value as other positions.", tePremium ? "High-volume tight ends and young route-earning prospects gain value; touchdown-only options gain less." : "Only the truly elite tight ends separate meaningfully from replacement options.");
  add("bench", "Bench depth", bench >= 13 ? "Very deep" : bench >= 9 ? "Deep" : bench <= 6 ? "Shallow" : "Moderate", `${bench} bench · ${rosteredPerTeam} total slots/team`, "About 7–10 bench spots is a familiar range; dynasty often runs deeper.", bench >= 9 ? "Prospects, backup running backs, and developmental quarterbacks stay rostered longer." : "Waivers should remain active and speculative players are easier to replace.");
  add("waivers", "Expected waiver availability", waiverPressure >= 300 ? "Thin" : waiverPressure <= 210 ? "Rich" : "Competitive", `Up to ${waiverPressure} roster slots across ${teams} teams`, "Availability changes sharply with team count, bench, taxi, and IR depth.", waiverPressure >= 300 ? "Future opportunity matters more than current free-agent production; FAAB spikes may be concentrated." : "Useful spot starters and breakout candidates should reach waivers more often.");
  add("playoffs", "Playoff format", playoffTeams > teams * .67 ? "Broad" : playoffTeams && playoffTeams < teams * .4 ? "Exclusive" : "Typical", playoffTeams ? `${playoffTeams} of ${teams} · starts Week ${playoffStart || "—"}` : "Not reported", "Six playoff teams in a 12-team league is a common reference point.", playoffTeams > teams * .67 ? "More teams remain engaged, but regular-season separation carries less elimination pressure." : playoffTeams && playoffTeams < teams * .4 ? "Regular-season consistency is heavily rewarded and borderline contenders face more urgency." : "The field balances sustained engagement with regular-season stakes.");
  add("deadline", "Trade deadline", !tradeDeadline ? "Open / not reported" : tradeDeadline <= 10 ? "Early" : tradeDeadline >= 14 ? "Late" : "Typical", tradeDeadline ? `Week ${tradeDeadline}` : "No deadline detected", "Weeks 11–13 are common, with major variation by league culture.", !tradeDeadline || tradeDeadline >= 14 ? "Contenders can react late, while rebuilding teams retain a longer selling window." : "Managers must declare direction earlier and late injury replacement is harder.");
  add("median", "Median scoring", median ? "Enabled" : "Disabled", median ? "Extra weekly median result" : "Head-to-head only", "Median games are increasingly common but are not universal.", median ? "Consistent depth and weekly scoring reduce schedule-luck volatility." : "Matchup variance and schedule luck have more influence on standings.");
  add("taxi", "Taxi and IR usage", taxi >= 4 || ir >= 4 ? "Generous" : taxi || ir ? "Moderate" : "None", `${taxi} taxi · ${ir} IR`, "Dynasty commonly uses taxi and multiple IR slots; redraft often uses IR only.", taxi ? "Rookies and developmental players can be held without consuming active bench space." : "Prospects compete directly with current contributors for roster spots.");
  add("draft", "Draft round count", draftRounds >= 6 ? "Long" : draftRounds && draftRounds <= 3 ? "Short" : "Typical", draftRounds ? `${draftRounds} rounds` : "Not reported", "Dynasty rookie drafts commonly run 3–5 rounds.", draftRounds >= 6 ? "Late picks and deep rookies retain practical utility." : draftRounds && draftRounds <= 3 ? "Priority free agency after the draft becomes more important." : "The draft covers primary prospects without requiring extreme depth.");
  const scoringFlags = [];
  if (number(scoring.pass_td) >= 6) scoringFlags.push({ name: "Six-point passing TDs", effect: "Pocket passers and high-volume touchdown QBs close some of the gap on rushing quarterbacks." });
  if (number(scoring.pass_int) <= -2) scoringFlags.push({ name: "Heavy interception penalty", effect: "Careful passers gain relative value; volatile high-attempt quarterbacks carry more weekly risk." });
  if (reception >= 1) scoringFlags.push({ name: "Full PPR", effect: "Target volume, receiving backs, and short-area receivers gain value." });
  else if (reception > 0) scoringFlags.push({ name: "Half PPR", effect: "Reception volume matters without overwhelming rushing and touchdown production." });
  else scoringFlags.push({ name: "Standard receptions", effect: "Touchdowns, yardage, and rushing roles matter more than low-depth targets." });
  Object.entries(scoring).filter(([key, value]) => number(value) && /(bonus|fd|first_down|carry|comp|inc|sack)/i.test(key)).slice(0, 5).forEach(([key, value]) => scoringFlags.push({ name: `${key.replaceAll("_", " ")} (${value})`, effect: "This nonstandard category can reward specific usage patterns beyond ordinary yardage and touchdowns." }));
  const archetypes = [];
  if (superflex || count("QB") >= 2) archetypes.push(["Starting and developmental QBs", "More required QB slots create real scarcity."]);
  if (tePremium) archetypes.push(["Target-earning tight ends", "TE-specific scoring rewards routes and receptions over touchdown chasing."]);
  if (reception >= 1) archetypes.push(["Receiving backs and target hogs", "Each reception creates an additional scoring floor."]);
  if (bench >= 9 || taxi >= 3) archetypes.push(["Prospects and contingent-value RBs", "Deep storage lets future opportunity compound in value."]);
  if (flex + superflex >= 3 || starters >= 11) archetypes.push(["Reliable WR2/3 depth", "Deep starting requirements make usable weekly volume more valuable."]);
  if (median) archetypes.push(["Stable weekly producers", "Median scoring rewards repeatable output more than matchup-driven spikes."]);
  if (!archetypes.length) archetypes.push(["Elite difference-makers", "Shallower, traditional formats concentrate value in the highest-scoring starters."]);
  return { rows, scoringFlags, archetypes, identity, starters, bench, teams, reception, tePremium };
}

function OrphanEvaluator({ report, evaluator, managers, recruiting, updateRecruiting, copied, copyReport, printReport, setReportRosterId }) {
  if (!report || !evaluator) return null;
  const fields = [["entryFee", "Entry fee / dues", "$50 per season"], ["duesStatus", "Dues status", "2026 paid; 2027 due"], ["deposit", "Deposit", "One season deposit"], ["faab", "FAAB / waivers", "$100 rolling FAAB"], ["contact", "Commissioner contact", "Discord, email, or handle"], ["deadline", "Decision deadline", "August 15"], ["constitution", "Rules / constitution link", "https://..."]];
  const picksBySeason = Object.entries((report.picks || []).reduce((groups, pick) => ({ ...groups, [pick.season]: [...(groups[pick.season] || []), pick] }), {}));
  return <div className="mt-6 space-y-5">
    <Shell className="overflow-hidden"><div className="flex flex-col gap-4 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.2),transparent_38%)] p-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-violet-200/55">Orphan team evaluator</div><h2 className="mt-1 text-2xl font-black">Turn an open roster into an honest opportunity</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">Sleeper supplies read-only roster and league data. Recruiting details below stay only in this browser.</p></div><div className="flex flex-wrap gap-2"><select value={report.rosterId} onChange={(event) => setReportRosterId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm">{managers.map((manager) => <option key={manager.rosterId} value={manager.rosterId}>{manager.name}{manager.orphan ? " · Open" : ""}</option>)}</select><button onClick={copyReport} className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] px-4 py-2.5 text-sm font-semibold text-cyan-100">{copied ? "Recruiting brief copied" : "Copy recruiting brief"}</button><button onClick={printReport} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70">Print / save PDF</button></div></div>
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]"><div><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-3xl bg-violet-400/10 text-xl font-black">#{report.valueRank}</div><div><div className="text-2xl font-black">{report.name}</div><div className="mt-1 text-sm text-white/45">{report.orphan ? "Open roster" : "Currently managed"} · {report.wins}-{report.losses} · average age {report.averageAge ? report.averageAge.toFixed(1) : "—"}</div></div></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Timeline" value={evaluator.timeline} /><Metric label="Difficulty" value={evaluator.difficulty} detail={`${evaluator.difficultyScore}/100 estimated`} tone={evaluator.difficulty === "Challenging" ? "warn" : "good"} /><Metric label="Roster value" value={`#${report.valueRank}`} detail={`${Math.round(report.rosterValue).toLocaleString()} market value`} /><Metric label="Draft capital" value={report.pickCount} detail="Modeled future picks" /></div><div className="mt-5 rounded-3xl border border-cyan-300/12 bg-cyan-400/[0.045] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-100/50">Recommended path</div><div className="mt-2 text-sm leading-6 text-white/70">{evaluator.path}</div></div></div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4"><div className="text-sm font-bold">League-relative position profile</div><div className="mt-4 space-y-3">{evaluator.positionProfile.map((row) => { const pct = Math.max(8, 100 - ((row.rank - 1) / Math.max(1, managers.length - 1)) * 92); return <div key={row.position}><div className="flex justify-between text-xs"><span className="font-semibold">{row.position} <span className="font-normal text-white/30">· {row.count} rostered</span></span><span className="text-white/55">#{row.rank} of {managers.length}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{ width: `${pct}%` }} /></div></div>; })}</div><div className="mt-4 text-[11px] leading-5 text-white/35">Ranks use the selected player-value market and emphasize likely usable depth. They are directional, not projections.</div></div></div>
    </Shell>
    <div className="grid gap-5 lg:grid-cols-2"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-emerald-200/50">Assets candidates will notice</div><h3 className="mt-1 text-xl font-black">Foundation and trade appeal</h3><div className="mt-4 grid gap-2 sm:grid-cols-2">{report.topAssets.map((asset, index) => <div key={asset.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3"><AvatarImage name={asset.name} playerId={asset.id} size={36} className="rounded-full" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{asset.name}</div><div className="text-xs text-white/35">{asset.pos || "—"} · {index < 2 ? "Core asset" : "Trade-interest asset"}</div></div><div className="text-xs font-bold text-white/55">{Math.round(asset.value).toLocaleString()}</div></div>)}</div><details className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3"><summary className="cursor-pointer text-sm font-semibold text-white/70">View complete roster · {(report.assets || []).length} players</summary><div className="mt-3 grid gap-1.5 sm:grid-cols-2">{(report.assets || []).map((player) => <div key={player.id} className="flex justify-between gap-3 rounded-xl bg-white/[0.025] px-3 py-2 text-xs"><span className="truncate">{player.name}</span><span className="shrink-0 text-white/35">{player.pos || "—"} · {player.age || "—"}</span></div>)}</div></details></Shell>
      <Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-amber-200/50">Draft capital</div><h3 className="mt-1 text-xl font-black">Pick inventory</h3><div className="mt-4 space-y-3">{picksBySeason.length ? picksBySeason.map(([season, picks]) => <div key={season} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="text-sm font-bold">{season}</div><div className="mt-2 flex flex-wrap gap-1.5">{picks.sort((a,b) => a.round-b.round).map((pick, index) => <span key={`${pick.round}-${pick.originalRosterId}-${index}`} className={`rounded-lg px-2 py-1 text-[10px] ${pick.round === 1 ? "bg-amber-300/10 text-amber-100" : "bg-white/[0.05] text-white/50"}`}>R{pick.round}{pick.own ? " · own" : ` · via #${pick.originalRosterId}`}</span>)}</div></div>) : <div className="text-sm text-white/45">No modeled picks found.</div>}</div></Shell></div>
    <Shell className="p-5"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-violet-200/50">Local recruiting details</div><h3 className="mt-1 text-xl font-black">Complete the opportunity</h3></div><div className="text-[11px] text-white/35">Auto-saved locally · never sent to Sleeper</div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields.map(([key, label, placeholder]) => <label key={key} className={key === "constitution" ? "sm:col-span-2" : ""}><span className="text-xs text-white/50">{label}</span><input value={recruiting[key]} onChange={(event) => updateRecruiting(key, event.target.value)} placeholder={placeholder} className={recruitingInputClass()} /></label>)}</div><label className="mt-3 block"><span className="text-xs text-white/50">Commissioner notes and selling points</span><textarea value={recruiting.notes} onChange={(event) => updateRecruiting("notes", event.target.value)} placeholder="League culture, dispersal details, special rules, or anything a replacement manager should know..." rows={4} className={recruitingInputClass()} /></label></Shell>
  </div>;
}

function SettingsAuditor({ league, managerCount, recommendations }) {
  const audit = useMemo(() => buildSettingsAudit(league, managerCount), [league, managerCount]);
  const baselineScenario = useMemo(() => ({ superflex: (league?.roster_positions || []).includes("SUPER_FLEX"), tePremium: audit.tePremium > 0, bench: audit.bench, starters: audit.starters, median: !!number(league?.settings?.league_average_match), playoffs: number(league?.settings?.playoff_teams) || Math.ceil(audit.teams / 2) }), [audit, league]);
  const [scenario, setScenario] = useState(baselineScenario);
  useEffect(() => setScenario(baselineScenario), [baselineScenario]);
  const scenarioEffects = useMemo(() => {
    const effects = [];
    if (scenario.superflex !== baselineScenario.superflex) effects.push(scenario.superflex ? "Quarterbacks become the league’s primary scarce asset; secure starters and QB prospects gain sharply." : "Quarterback scarcity falls; elite skill-position starters absorb more relative value.");
    if (scenario.tePremium !== baselineScenario.tePremium) effects.push(scenario.tePremium ? "Target-earning tight ends gain, with the largest effect concentrated among high-route-volume players." : "Mid-tier tight ends compress toward replacement value unless they produce elite yardage or touchdowns.");
    if (scenario.bench !== baselineScenario.bench) effects.push(scenario.bench > baselineScenario.bench ? `Adding ${scenario.bench-baselineScenario.bench} bench spot(s) thins waivers and increases prospect/handcuff value.` : `Removing ${baselineScenario.bench-scenario.bench} bench spot(s) strengthens waivers and increases in-season churn.`);
    if (scenario.starters !== baselineScenario.starters) effects.push(scenario.starters > baselineScenario.starters ? "Deeper starting requirements reward WR/RB depth and reduce the advantage of star-only roster construction." : "Shallower lineups concentrate wins and market value among elite difference-makers.");
    if (scenario.median !== baselineScenario.median) effects.push(scenario.median ? "A median result reduces schedule luck and rewards stable weekly depth." : "Head-to-head variance has more influence on standings and playoff qualification.");
    if (scenario.playoffs !== baselineScenario.playoffs) effects.push(scenario.playoffs > baselineScenario.playoffs ? "A broader playoff field sustains engagement but reduces regular-season elimination pressure." : "A smaller field increases regular-season stakes and makes early contender/rebuilder decisions more consequential.");
    return effects;
  }, [baselineScenario, scenario]);
  const gradeTone = (grade) => ["Premium", "Very high", "High", "Strong", "Very deep", "Deep", "Thin", "Exclusive", "Late", "Generous", "Long"].includes(grade) ? "border-amber-300/15 bg-amber-300/[0.07] text-amber-100" : ["Enabled", "Typical", "Moderate", "Standard", "Competitive"].includes(grade) ? "border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-100" : "border-white/10 bg-white/[0.04] text-white/60";
  return <div className="mt-6 space-y-5">
    <Shell className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.16),transparent_38%)] p-5 sm:p-6"><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-cyan-200/55">League settings auditor</div><div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black sm:text-3xl">What kind of league did these settings create?</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">A gameplay interpretation of roster scarcity, scoring, league depth, and format—not a claim that one configuration is universally better.</p></div><div className="shrink-0 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] px-4 py-3"><div className="text-[10px] uppercase tracking-[.18em] text-cyan-100/45">Detected identity</div><div className="mt-1 font-black text-cyan-50">{audit.identity}</div></div></div></div><div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4"><Metric label="Teams" value={audit.teams} /><Metric label="Starters" value={audit.starters} /><Metric label="Bench" value={audit.bench} /><Metric label="Reception scoring" value={audit.reception ? `${audit.reception} PPR` : "Standard"} /></div></Shell>

    <Shell className="p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-cyan-200/50">Read-only simulation</div><h3 className="mt-1 text-xl font-black">Settings What-If Lab</h3><p className="mt-1 text-xs text-white/38">Preview incentive changes. Nothing is sent to Sleeper.</p></div><button onClick={() => setScenario(baselineScenario)} className="text-xs font-semibold text-cyan-100/65">Reset to current settings</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs"><span className="text-white/45">Superflex</span><input type="checkbox" checked={scenario.superflex} onChange={(event) => setScenario({ ...scenario, superflex: event.target.checked })} className="mt-3 block" /></label><label className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs"><span className="text-white/45">TE premium</span><input type="checkbox" checked={scenario.tePremium} onChange={(event) => setScenario({ ...scenario, tePremium: event.target.checked })} className="mt-3 block" /></label><label className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs"><span className="text-white/45">Bench spots</span><input type="number" min="0" max="30" value={scenario.bench} onChange={(event) => setScenario({ ...scenario, bench: number(event.target.value) })} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /></label><label className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs"><span className="text-white/45">Starters</span><input type="number" min="5" max="20" value={scenario.starters} onChange={(event) => setScenario({ ...scenario, starters: number(event.target.value) })} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /></label><label className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs"><span className="text-white/45">Median game</span><input type="checkbox" checked={scenario.median} onChange={(event) => setScenario({ ...scenario, median: event.target.checked })} className="mt-3 block" /></label><label className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs"><span className="text-white/45">Playoff teams</span><input type="number" min="2" max={audit.teams} value={scenario.playoffs} onChange={(event) => setScenario({ ...scenario, playoffs: number(event.target.value) })} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /></label></div><div className="mt-4 grid gap-2 md:grid-cols-2">{scenarioEffects.length ? scenarioEffects.map((effect, index) => <div key={index} className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3 text-xs leading-5 text-white/58">{effect}</div>) : <div className="rounded-2xl bg-white/[0.025] p-4 text-sm text-white/40 md:col-span-2">Adjust a setting to see the expected league-economy effect.</div>}</div></Shell>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]"><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Experience profile</h3><p className="mt-1 text-xs text-white/40">Each comparison uses a broad common configuration as a reference—not as a recommendation.</p></div><div className="divide-y divide-white/[0.06]">{audit.rows.map((row) => <details key={row.key} className="group p-4 open:bg-white/[0.018]"><summary className="flex cursor-pointer list-none items-center gap-3"><div className="min-w-0 flex-1"><div className="font-semibold">{row.label}</div><div className="mt-1 truncate text-xs text-white/38 group-open:whitespace-normal">{row.value}</div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${gradeTone(row.grade)}`}>{row.grade}</span><span className="text-white/25 transition group-open:rotate-180">⌄</span></summary><div className="mt-4 grid gap-3 pl-0 text-xs leading-5 sm:grid-cols-2"><div className="rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-white/30">Compared with common formats</div><div className="mt-1 text-white/55">{row.common}</div></div><div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3"><div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-100/35">Likely gameplay effect</div><div className="mt-1 text-white/60">{row.effect}</div></div></div></details>)}</div></Shell>
      <div className="space-y-5"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-emerald-200/50">Value winners</div><h3 className="mt-1 text-xl font-black">Archetypes that gain</h3><div className="mt-4 space-y-3">{audit.archetypes.map(([name, reason]) => <div key={name} className="rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-3"><div className="text-sm font-semibold text-emerald-50">{name}</div><div className="mt-1 text-xs leading-5 text-white/45">{reason}</div></div>)}</div></Shell><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-violet-200/50">Commissioner review</div><h3 className="mt-1 text-lg font-black">Potential adjustments</h3><div className="mt-3 space-y-3">{recommendations.map((item) => <div key={item.title}><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs leading-5 text-white/42">{item.reason}</div></div>)}</div></Shell></div></div>

    <Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-amber-200/50">Scoring fingerprint</div><h3 className="mt-1 text-xl font-black">Categories with outsized or nonstandard effects</h3><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{audit.scoringFlags.map((flag, index) => <div key={`${flag.name}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="text-sm font-bold">{flag.name}</div><div className="mt-2 text-xs leading-5 text-white/45">{flag.effect}</div></div>)}</div><div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-3 text-[11px] leading-5 text-white/35">Sleeper exposes league configuration, but “common” varies by redraft, keeper, dynasty, team count, and community. This audit describes incentives created by the settings; it does not prescribe a single correct format.</div></Shell>
  </div>;
}

function CommissionerOperations({ league, data }) {
  const storageKey = `commissioner-operations:v1:${league.league_id}`;
  const [local, setLocal] = useState({ actions: {}, dues: {}, deadlines: [], constitution: "" });
  const [section, setSection] = useState("actions");
  useEffect(() => { try { setLocal({ actions: {}, dues: {}, deadlines: [], constitution: "", ...JSON.parse(localStorage.getItem(storageKey) || "{}") }); } catch {} }, [storageKey]);
  const save = (next) => { setLocal(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {} };
  const actions = useMemo(() => {
    const rows = [];
    data.managers.forEach((manager) => manager.reviewSignals.forEach((signal, index) => rows.push({ id: `manager:${manager.rosterId}:${index}:${signal.label}`, priority: signal.label.includes("empty") || manager.orphan ? 1 : signal.type === "fact" ? 2 : 3, category: manager.orphan ? "Roster" : "Manager", title: `${manager.name}: ${signal.label}`, detail: signal.detail })));
    data.tradeSignals.forEach((signal) => rows.push({ id: `trade:${signal.id}`, priority: signal.gapPct >= 1 ? 1 : 2, category: "Trade", title: `Week ${signal.week || "—"} trade requires context`, detail: signal.detail }));
    const deadline = number(league?.settings?.trade_deadline);
    if (deadline) rows.push({ id: "league:trade-deadline", priority: data.throughWeek >= deadline - 1 ? 1 : 3, category: "Deadline", title: `Trade deadline: Week ${deadline}`, detail: data.throughWeek >= deadline ? "The configured trade deadline has arrived or passed." : `${Math.max(0, deadline - data.throughWeek)} week(s) remain based on completed-week data.` });
    return rows.sort((a,b) => a.priority-b.priority || a.title.localeCompare(b.title));
  }, [data, league]);
  const openActions = actions.filter((action) => !["resolved", "dismissed"].includes(local.actions[action.id]?.status));
  const updateAction = (id, patch) => save({ ...local, actions: { ...local.actions, [id]: { ...(local.actions[id] || {}), ...patch } } });
  const updateDues = (rosterId, patch) => save({ ...local, dues: { ...local.dues, [rosterId]: { ...(local.dues[rosterId] || {}), ...patch } } });
  const addDeadline = () => save({ ...local, deadlines: [...local.deadlines, { id: `${Date.now()}`, title: "New league deadline", date: "", complete: false }] });
  const updateDeadline = (id, patch) => save({ ...local, deadlines: local.deadlines.map((row) => row.id === id ? { ...row, ...patch } : row) });
  const constitutionChecks = useMemo(() => {
    const text = local.constitution.toLowerCase();
    if (!text.trim()) return [];
    const slots = (league.roster_positions || []).map((slot) => String(slot).toUpperCase());
    const checks = [];
    const test = (mentioned, matches, label, observed) => { if (mentioned) checks.push({ label, matches, observed }); };
    test(/super\s*flex|sf\b/.test(text), slots.includes("SUPER_FLEX"), "Superflex", slots.includes("SUPER_FLEX") ? "Superflex slot found" : "No Superflex slot found");
    test(/median/.test(text), !!number(league?.settings?.league_average_match), "Median scoring", number(league?.settings?.league_average_match) ? "Median game enabled" : "Median game disabled");
    test(/taxi/.test(text), slots.some((slot) => slot.includes("TAXI")) || number(league?.settings?.taxi_slots) > 0, "Taxi squad", `${Math.max(slots.filter((slot) => slot.includes("TAXI")).length, number(league?.settings?.taxi_slots))} detected slots`);
    test(/\bir\b|injured reserve/.test(text), slots.some((slot) => slot === "IR" || slot.includes("RESERVE")) || number(league?.settings?.reserve_slots) > 0, "IR / reserve", "Compared with Sleeper reserve configuration");
    test(/trade deadline/.test(text), number(league?.settings?.trade_deadline) > 0, "Trade deadline", number(league?.settings?.trade_deadline) ? `Sleeper Week ${league.settings.trade_deadline}` : "No Sleeper deadline detected");
    test(/playoff/.test(text), number(league?.settings?.playoff_teams) > 0, "Playoff configuration", `${number(league?.settings?.playoff_teams) || "No"} playoff teams detected`);
    return checks;
  }, [league, local.constitution]);
  return <div className="mt-6 space-y-5"><Shell className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(245,158,11,.16),transparent_40%)] p-5 sm:p-6"><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-amber-200/55">Commissioner operations</div><div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black sm:text-3xl">Run the league from one action center</h2><p className="mt-2 text-sm text-white/45">Observed Sleeper signals plus private, local commissioner workflow. Notes and payment information never leave this browser.</p></div><div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3"><div className="text-[10px] uppercase tracking-wider text-amber-100/45">Open actions</div><div className="mt-1 text-2xl font-black">{openActions.length}</div></div></div></div><div className="flex overflow-x-auto p-2">{[["actions","Action queue"],["dues","Dues & renewal"],["deadlines","Deadlines"],["constitution","Constitution checker"]].map(([key,label]) => <button key={key} onClick={() => setSection(key)} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${section === key ? "bg-white/10 text-white" : "text-white/42 hover:text-white/70"}`}>{label}</button>)}</div></Shell>
    {section === "actions" ? <Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Prioritized action queue</h3><p className="mt-1 text-xs text-white/38">Acknowledging, resolving, or dismissing a signal is a private workflow decision and never changes Sleeper.</p></div><div className="divide-y divide-white/[0.06]">{actions.length ? actions.map((action) => { const state = local.actions[action.id] || {}; return <details key={action.id} className={`group p-4 ${["resolved","dismissed"].includes(state.status) ? "opacity-45" : ""}`}><summary className="flex cursor-pointer list-none items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${action.priority === 1 ? "bg-rose-400" : action.priority === 2 ? "bg-amber-300" : "bg-cyan-300"}`} /><div className="min-w-0 flex-1"><div className="truncate font-semibold">{action.title}</div><div className="mt-1 text-xs text-white/35">{action.category} · {state.status || "Open"}</div></div><span className="text-white/25 transition group-open:rotate-180">⌄</span></summary><div className="mt-4 pl-5"><p className="text-xs leading-5 text-white/48">{action.detail}</p><textarea value={state.note || ""} onChange={(event) => updateAction(action.id, { note: event.target.value })} placeholder="Private commissioner note…" rows={2} className={recruitingInputClass()} /><div className="mt-2 flex flex-wrap gap-2">{["acknowledged","resolved","dismissed","open"].map((status) => <button key={status} onClick={() => updateAction(action.id, { status: status === "open" ? "" : status })} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold capitalize ${state.status === status ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-white/45"}`}>{status}</button>)}</div></div></details>; }) : <div className="p-8 text-center text-sm text-emerald-100">No action signals were generated.</div>}</div></Shell> : null}
    {section === "dues" ? <Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Dues, deposits, and renewal</h3><p className="mt-1 text-xs text-white/38">Local administrative tracking only.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-xs text-white/35"><tr><th className="p-3">Manager</th><th className="p-3">Renewal</th><th className="p-3">Dues</th><th className="p-3">Deposit</th><th className="p-3">Note</th></tr></thead><tbody>{data.managers.map((manager) => { const row = local.dues[manager.rosterId] || {}; return <tr key={manager.rosterId} className="border-t border-white/[0.06]"><td className="p-3 font-semibold">{manager.name}</td><td className="p-3"><select value={row.renewal || "unknown"} onChange={(event) => updateDues(manager.rosterId, { renewal: event.target.value })} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5"><option value="unknown">Unknown</option><option value="returning">Returning</option><option value="undecided">Undecided</option><option value="leaving">Leaving</option></select></td><td className="p-3"><select value={row.dues || "untracked"} onChange={(event) => updateDues(manager.rosterId, { dues: event.target.value })} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5"><option value="untracked">Untracked</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option></select></td><td className="p-3"><input value={row.deposit || ""} onChange={(event) => updateDues(manager.rosterId, { deposit: event.target.value })} placeholder="$ / status" className="w-28 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /></td><td className="p-3"><input value={row.note || ""} onChange={(event) => updateDues(manager.rosterId, { note: event.target.value })} placeholder="Private note" className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /></td></tr>; })}</tbody></table></div></Shell> : null}
    {section === "deadlines" ? <Shell className="p-5"><div className="flex items-end justify-between"><div><h3 className="text-xl font-black">League calendar</h3><p className="mt-1 text-xs text-white/38">Sleeper’s trade deadline plus locally managed dates.</p></div><button onClick={addDeadline} className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.07] px-3 py-2 text-xs font-semibold text-cyan-100">Add deadline</button></div>{number(league?.settings?.trade_deadline) ? <div className="mt-4 rounded-2xl border border-violet-300/12 bg-violet-300/[0.04] p-4"><div className="text-sm font-semibold">Sleeper trade deadline</div><div className="mt-1 text-xs text-white/45">Week {league.settings.trade_deadline} · read-only league setting</div></div> : null}<div className="mt-3 space-y-2">{local.deadlines.map((row) => <div key={row.id} className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[auto_1fr_170px_auto]"><input type="checkbox" checked={row.complete} onChange={(event) => updateDeadline(row.id, { complete: event.target.checked })} /><input value={row.title} onChange={(event) => updateDeadline(row.id, { title: event.target.value })} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /><input type="date" value={row.date} onChange={(event) => updateDeadline(row.id, { date: event.target.value })} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5" /><button onClick={() => save({ ...local, deadlines: local.deadlines.filter((item) => item.id !== row.id) })} className="px-2 text-xs text-rose-200/60">Remove</button></div>)}</div></Shell> : null}
    {section === "constitution" ? <div className="grid gap-5 lg:grid-cols-2"><Shell className="p-5"><h3 className="text-xl font-black">Constitution text</h3><p className="mt-1 text-xs leading-5 text-white/38">Paste the relevant rules. The checker only compares clearly detectable phrases with observable Sleeper settings.</p><textarea value={local.constitution} onChange={(event) => save({ ...local, constitution: event.target.value })} rows={14} placeholder="Paste league rules here…" className={recruitingInputClass()} /></Shell><Shell className="p-5"><h3 className="text-xl font-black">Observable checks</h3><div className="mt-4 space-y-3">{constitutionChecks.length ? constitutionChecks.map((check) => <div key={check.label} className={`rounded-2xl border p-4 ${check.matches ? "border-emerald-300/12 bg-emerald-300/[0.045]" : "border-amber-300/12 bg-amber-300/[0.045]"}`}><div className="flex items-center justify-between"><div className="font-semibold">{check.label}</div><span className="text-[10px] font-semibold uppercase">{check.matches ? "Aligned" : "Review"}</span></div><div className="mt-1 text-xs text-white/45">{check.observed}</div></div>) : <div className="rounded-2xl bg-white/[0.025] p-5 text-sm text-white/40">Paste rules to begin. Ambiguous or behavioral rules will not be guessed.</div>}</div></Shell></div> : null}
  </div>;
}

function HistoricalHealth({ league }) {
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyProgress, setHistoryProgress] = useState("");
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const scanHistory = async () => {
    if (!league?.league_id || loadingHistory) return;
    setLoadingHistory(true); setHistoryError("");
    const cacheKey = `commissioner-history:v1:${league.league_id}`;
    try { const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); if (cached && Date.now() - number(cached.ts) < 60 * 60 * 1000) { setHistory(cached.payload); setLoadingHistory(false); return; } } catch {}
    try {
      const seasons = [];
      let cursor = league;
      const seen = new Set();
      while (cursor?.league_id && !seen.has(String(cursor.league_id)) && seasons.length < 12) {
        seen.add(String(cursor.league_id));
        const id = String(cursor.league_id);
        setHistoryProgress(`Reading ${cursor.season || "league"} structure…`);
        const [users, rosters] = await Promise.all([cursor.users?.length ? cursor.users : getJson(`https://api.sleeper.app/v1/league/${id}/users`).catch(() => []), cursor.rosters?.length ? cursor.rosters : getJson(`https://api.sleeper.app/v1/league/${id}/rosters`).catch(() => [])]);
        const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
        const weekly = await mapConcurrent(weeks, 8, async (week) => {
          const [matchups, transactions] = await Promise.all([getJson(`https://api.sleeper.app/v1/league/${id}/matchups/${week}`).catch(() => []), getJson(`https://api.sleeper.app/v1/league/${id}/transactions/${week}`).catch(() => [])]);
          return { week, matchups, transactions };
        }, (done, total) => setHistoryProgress(`Auditing ${cursor.season || "season"} · ${done}/${total} weeks`));
        const completed = weekly.flatMap((row) => row.transactions).filter((tx) => String(tx.status).toLowerCase() === "complete");
        const expected = (cursor.roster_positions || []).filter((slot) => { const value = String(slot).toUpperCase(); return value !== "BN" && value !== "IR" && !value.includes("RESERVE") && !value.includes("TAXI"); }).length;
        let lineupWeeks = 0; let emptyLineups = 0;
        weekly.forEach((row) => row.matchups.forEach((matchup) => { if (!(matchup.starters || []).length) return; lineupWeeks += 1; const filled = matchup.starters.filter((playerId) => playerId && String(playerId) !== "0").length; if (filled < expected) emptyLineups += 1; }));
        const userById = new Map(users.map((user) => [String(user.user_id), user]));
        const managers = rosters.map((roster) => ({ rosterId: String(roster.roster_id), ownerId: roster.owner_id ? String(roster.owner_id) : "", name: teamName(userById.get(String(roster.owner_id)), roster), points: rosterPoints(roster), wins: number(roster?.settings?.wins), losses: number(roster?.settings?.losses) }));
        const points = managers.map((manager) => manager.points).filter((value) => value > 0);
        seasons.push({ id, name: cursor.name, season: String(cursor.season || "—"), managers, ownerIds: managers.map((manager) => manager.ownerId).filter(Boolean), trades: completed.filter((tx) => tx.type === "trade").length, waivers: completed.filter((tx) => tx.type === "waiver" || tx.type === "free_agent").length, emptyRate: lineupWeeks ? emptyLineups / lineupWeeks : 0, parity: clamp(100 - coefficientOfVariation(points) * 140, 10, 100), open: managers.filter((manager) => !manager.ownerId).length });
        const previousId = cursor.previous_league_id;
        cursor = previousId && String(previousId) !== "0" ? await getJson(`https://api.sleeper.app/v1/league/${previousId}`).catch(() => null) : null;
      }
      const userHistory = new Map();
      seasons.forEach((season) => season.managers.forEach((manager) => { if (!manager.ownerId) return; const row = userHistory.get(manager.ownerId) || { id: manager.ownerId, name: manager.name, seasons: [], teams: [] }; row.name = manager.name; row.seasons.push(season.season); row.teams.push({ season: season.season, name: manager.name, rosterId: manager.rosterId }); userHistory.set(manager.ownerId, row); }));
      const retention = seasons.map((season, index) => { const previous = seasons[index + 1]; if (!previous) return { season: season.season, rate: null, returning: null }; const prior = new Set(previous.ownerIds); const returning = season.ownerIds.filter((id) => prior.has(id)).length; return { season: season.season, rate: previous.ownerIds.length ? returning / previous.ownerIds.length : 0, returning }; });
      const franchiseChanges = [];
      for (let index = 0; index < seasons.length - 1; index += 1) { const current = seasons[index]; const previous = seasons[index + 1]; current.managers.forEach((manager) => { const old = previous.managers.find((row) => row.rosterId === manager.rosterId); if (old && old.ownerId && manager.ownerId && old.ownerId !== manager.ownerId) franchiseChanges.push({ rosterId: manager.rosterId, from: old.name, to: manager.name, season: current.season }); }); }
      const payload = { seasons, retention, members: [...userHistory.values()].sort((a,b) => b.seasons.length-a.seasons.length || a.name.localeCompare(b.name)), franchiseChanges };
      setHistory(payload); try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload })); } catch {}
    } catch { setHistoryError("Historical league analysis could not be completed. The previous-league chain may be unavailable."); }
    finally { setLoadingHistory(false); setHistoryProgress(""); }
  };
  const maxMoves = Math.max(1, ...(history?.seasons || []).map((season) => season.trades + season.waivers));
  const SeasonActivityCell = ({ season }) => <div className="flex items-center gap-2"><span>{season.waivers}</span><div className="h-1.5 w-16 rounded bg-white/[0.05]"><div className="h-full rounded bg-violet-300" style={{ width: `${((season.trades + season.waivers) / maxMoves) * 100}%` }} /></div></div>;
  return <div className="mt-6 space-y-5">
    <Shell className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(16,185,129,.16),transparent_40%)] p-5 sm:p-6"><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-emerald-200/55">Historical health</div><div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black sm:text-3xl">League health across eras</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Parity, participation, lineup compliance, retention, and franchise changes across Sleeper’s linked seasons.</p></div><button onClick={scanHistory} disabled={loadingHistory} className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.07] px-5 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-45">{loadingHistory ? historyProgress || "Reading history…" : history ? "Refresh history" : "Analyze league history"}</button></div></div>{historyError ? <div className="m-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.07] p-4 text-sm text-rose-100">{historyError}</div> : null}{loadingHistory ? <div className="flex items-center gap-3 p-5 text-sm text-emerald-100"><span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200/20 border-t-emerald-200" />{historyProgress}</div> : null}{!history && !loadingHistory ? <div className="p-8 text-center text-sm text-white/40">Historical requests run only when requested and are cached for one hour.</div> : null}{history ? <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4"><Metric label="Seasons" value={history.seasons.length} /><Metric label="Long-tenured" value={history.members.filter((member) => member.seasons.length >= Math.min(3, history.seasons.length)).length} /><Metric label="Franchise changes" value={history.franchiseChanges.length} /><Metric label="Latest retention" value={history.retention[0]?.rate == null ? "—" : percent(history.retention[0].rate * 100)} /></div> : null}</Shell>
    {history ? <><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Season-by-season health</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-left text-xs text-white/35"><tr><th className="p-3">Season</th><th className="p-3">Parity</th><th className="p-3">Trades</th><th className="p-3">Waivers</th><th className="p-3">Unset</th><th className="p-3">Retention</th><th className="p-3">Open</th></tr></thead><tbody>{history.seasons.map((season, index) => <tr key={season.id} className="border-t border-white/[0.06]"><td className="p-3 font-bold">{season.season}</td><td className="p-3">{Math.round(season.parity)}/100</td><td className="p-3">{season.trades}</td><td className="p-3"><SeasonActivityCell season={season} /></td><td className="p-3">{percent(season.emptyRate * 100)}</td><td className="p-3">{history.retention[index]?.rate == null ? "—" : percent(history.retention[index].rate * 100)}</td><td className="p-3">{season.open}</td></tr>)}</tbody></table></div></Shell><div className="grid gap-5 lg:grid-cols-2"><Shell className="p-5"><h3 className="text-xl font-black">Member tenure</h3><p className="mt-1 text-xs text-white/38">Completed seasons in this league lineage.</p><div className="mt-4 space-y-2">{history.members.slice(0,30).map((member) => <details key={member.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><summary className="flex cursor-pointer list-none justify-between gap-3"><span className="font-semibold">{member.name}</span><span className="text-xs text-white/45">{member.seasons.length} seasons</span></summary><div className="mt-2 text-xs text-white/38">{member.seasons.join(" · ")}</div></details>)}</div></Shell><Shell className="p-5"><h3 className="text-xl font-black">Franchise continuity</h3><p className="mt-1 text-xs text-white/38">Ownership changes inferred from stable roster IDs.</p><div className="mt-4 space-y-2">{history.franchiseChanges.length ? history.franchiseChanges.map((change,index) => <div key={`${change.rosterId}-${change.season}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="text-sm font-semibold">Roster {change.rosterId} · {change.season}</div><div className="mt-1 text-xs text-white/42">{change.from} → {change.to}</div></div>) : <div className="rounded-2xl bg-emerald-300/[0.04] p-4 text-sm text-emerald-100">No owner changes were inferred.</div>}</div></Shell></div></> : null}
  </div>;
  /* Legacy inline renderer retained temporarily for diff safety.
  return <div className="mt-6 space-y-5"><Shell className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(16,185,129,.16),transparent_40%)] p-5 sm:p-6"><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-emerald-200/55">Historical health</div><div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black sm:text-3xl">League health across eras</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Follow Sleeper’s previous-league chain to measure parity, participation, lineup compliance, retention, and franchise changes.</p></div><button onClick={scanHistory} disabled={loadingHistory} className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.07] px-5 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-45">{loadingHistory ? historyProgress || "Reading history…" : history ? "Refresh history" : "Analyze league history"}</button></div></div>{historyError ? <div className="m-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.07] p-4 text-sm text-rose-100">{historyError}</div> : null}{loadingHistory ? <div className="flex items-center gap-3 p-5 text-sm text-emerald-100"><span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200/20 border-t-emerald-200" />{historyProgress}</div> : null}{!history && !loadingHistory ? <div className="p-8 text-center text-sm text-white/40">Historical requests run only when requested and are cached for one hour.</div> : null}{history ? <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4"><Metric label="Seasons" value={history.seasons.length} /><Metric label="Long-tenured members" value={history.members.filter((member) => member.seasons.length >= Math.min(3, history.seasons.length)).length} /><Metric label="Franchise changes" value={history.franchiseChanges.length} /><Metric label="Latest retention" value={history.retention[0]?.rate == null ? "—" : percent(history.retention[0].rate * 100)} /></div> : null}</Shell>
    {history ? <><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Season-by-season health</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-left text-xs text-white/35"><tr><th className="p-3">Season</th><th className="p-3">Parity</th><th className="p-3">Trades</th><th className="p-3">Waiver moves</th><th className="p-3">Unset rate</th><th className="p-3">Retention</th><th className="p-3">Open</th></tr></thead><tbody>{history.seasons.map((season, index) => <tr key={season.id} className="border-t border-white/[0.06]"><td className="p-3 font-bold">{season.season}</td><td className="p-3"><div className="w-28"><div className="flex justify-between text-xs"><span>{Math.round(season.parity)}/100</span></div><div className="mt-1 h-1.5 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${season.parity}%` }} /></div></div></td><td className="p-3">{season.trades}</td><td className="p-3"><div className="flex items-center gap-2"><span>{season.waivers}</span><div className="h-1.5 w-16 rounded bg-white/[0.05]"><div className="h-full rounded bg-violet-300" style={{ width: `${((season.trades + season.waivers) / maxMoves) * 100}%` }} /></div></div></div></td><td className="p-3">{percent(season.emptyRate * 100)}</td><td className="p-3">{history.retention[index]?.rate == null ? "—" : percent(history.retention[index].rate * 100)}</td><td className="p-3">{season.open}</td></tr>)}</tbody></table></div></Shell><div className="grid gap-5 lg:grid-cols-2"><Shell className="p-5"><h3 className="text-xl font-black">Member tenure</h3><p className="mt-1 text-xs text-white/38">Completed seasons detected in this league lineage.</p><div className="mt-4 space-y-2">{history.members.slice(0, 30).map((member) => <details key={member.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><summary className="flex cursor-pointer list-none justify-between gap-3"><span className="font-semibold">{member.name}</span><span className="text-xs text-white/45">{member.seasons.length} season{member.seasons.length === 1 ? "" : "s"}</span></summary><div className="mt-2 text-xs text-white/38">{member.seasons.join(" · ")}</div></details>)}</div></Shell><Shell className="p-5"><h3 className="text-xl font-black">Franchise continuity</h3><p className="mt-1 text-xs text-white/38">Ownership changes inferred from stable roster IDs across linked seasons.</p><div className="mt-4 space-y-2">{history.franchiseChanges.length ? history.franchiseChanges.map((change, index) => <div key={`${change.rosterId}-${change.season}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="text-sm font-semibold">Roster {change.rosterId} · {change.season}</div><div className="mt-1 text-xs text-white/42">{change.from} → {change.to}</div></div>) : <div className="rounded-2xl bg-emerald-300/[0.04] p-4 text-sm text-emerald-100">No owner changes were inferred from linked roster IDs.</div>}</div></Shell></div></> : null}
  </div>;
}

  */
}

function LeagueNetwork({ leagues, username, currentManagers = [] }) {
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [network, setNetwork] = useState(null);
  const [query, setQuery] = useState("");
  const [scanError, setScanError] = useState("");
  const [profileNotes, setProfileNotes] = useState({});
  useEffect(() => { try { setProfileNotes(JSON.parse(localStorage.getItem(`commissioner-network-notes:${username}`) || "{}")); } catch {} }, [username]);
  const updateProfileNote = (id, note) => { const next = { ...profileNotes, [id]: note }; setProfileNotes(next); try { localStorage.setItem(`commissioner-network-notes:${username}`, JSON.stringify(next)); } catch {} };
  const scan = async () => {
    if (!leagues.length || scanning) return;
    setScanning(true); setScanError("");
    const fingerprint = `${username}:${leagues.map((league) => league.league_id).sort().join(",")}`;
    const cacheKey = `commissioner-network:v1:${fingerprint}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - number(cached.ts) < 30 * 60 * 1000) { setNetwork(cached.payload); setScanning(false); return; }
    } catch {}
    try {
      const memberships = await mapConcurrent(leagues, 8, async (league) => ({ id: String(league.league_id), name: league.name || `League ${league.league_id}`, avatar: league.avatar || null, users: await getJson(`https://api.sleeper.app/v1/league/${league.league_id}/users`).catch(() => []) }), (done, total) => setScanProgress(`Reading league memberships · ${done}/${total}`));
      const userMap = new Map();
      memberships.forEach((membership) => membership.users.forEach((user) => {
        const display = user.display_name || user.username || "Unknown manager";
        if (String(display).toLowerCase() === String(username).toLowerCase() || String(user.username).toLowerCase() === String(username).toLowerCase()) return;
        const id = String(user.user_id);
        const existing = userMap.get(id) || { id, name: display, avatar: user.avatar || null, leagues: [] };
        existing.leagues.push({ id: membership.id, name: membership.name, avatar: membership.avatar });
        userMap.set(id, existing);
      }));
      const sharedUsers = [...userMap.values()].filter((user) => user.leagues.length >= 2).sort((a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name));
      const pairMap = new Map();
      sharedUsers.forEach((user) => {
        for (let left = 0; left < user.leagues.length; left += 1) for (let right = left + 1; right < user.leagues.length; right += 1) {
          const pair = [user.leagues[left], user.leagues[right]].sort((a, b) => a.id.localeCompare(b.id));
          const key = `${pair[0].id}|${pair[1].id}`;
          const existing = pairMap.get(key) || { leagues: pair, users: [] };
          existing.users.push({ id: user.id, name: user.name });
          pairMap.set(key, existing);
        }
      });
      const leaguePairs = [...pairMap.values()].sort((a, b) => b.users.length - a.users.length || a.leagues[0].name.localeCompare(b.leagues[0].name));
      const payload = { sharedUsers, leaguePairs, scannedLeagues: memberships.length, uniqueManagers: userMap.size };
      setNetwork(payload);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload })); } catch {}
    } catch { setScanError("The league network scan could not be completed. Please try again."); }
    finally { setScanning(false); setScanProgress(""); }
  };
  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = (network?.sharedUsers || []).filter((user) => !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery) || user.leagues.some((league) => league.name.toLowerCase().includes(normalizedQuery)));
  return <div className="mt-6 space-y-5"><Shell className="overflow-hidden"><div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(139,92,246,.18),transparent_40%)] p-5 sm:p-6"><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-violet-200/55">League network</div><div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black sm:text-3xl">Where your league communities overlap</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Find managers who share multiple leagues with you and reveal which leagues have the strongest membership overlap. Sleeper remains read-only.</p></div><button onClick={scan} disabled={scanning || !leagues.length} className="shrink-0 rounded-2xl border border-violet-300/15 bg-violet-300/[0.08] px-5 py-3 text-sm font-semibold text-violet-100 disabled:opacity-45">{scanning ? scanProgress || "Scanning…" : network ? "Refresh network" : `Scan ${leagues.length} leagues`}</button></div></div>{scanError ? <div className="m-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.07] p-4 text-sm text-rose-100">{scanError}</div> : null}{!network && !scanning ? <div className="p-8 text-center text-sm text-white/42">The network scan runs only when requested, so it never delays the commissioner health audit.</div> : null}{scanning ? <div className="flex items-center gap-3 p-5 text-sm text-violet-100"><span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200/20 border-t-violet-200" />{scanProgress || "Preparing scan…"}</div> : null}{network ? <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4"><Metric label="Leagues scanned" value={network.scannedLeagues} /><Metric label="Managers found" value={network.uniqueManagers} /><Metric label="Repeat managers" value={network.sharedUsers.length} /><Metric label="League connections" value={network.leaguePairs.length} /></div> : null}</Shell>
    {network ? <><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-violet-200/50">Community map</div><h3 className="mt-1 text-xl font-black">Core members and league clusters</h3><p className="mt-1 text-xs text-white/38">Node size represents shared-league count. This is a relationship map, not a manager rating.</p><div className="mt-5 flex min-h-48 flex-wrap items-center justify-center gap-3 rounded-3xl border border-white/8 bg-[radial-gradient(circle,rgba(139,92,246,.1),transparent_65%)] p-5">{network.sharedUsers.slice(0, 24).map((user) => { const size = clamp(52 + user.leagues.length * 5, 56, 112); return <div key={user.id} title={`${user.name}: ${user.leagues.length} shared leagues`} className="grid shrink-0 place-items-center rounded-full border border-violet-300/15 bg-violet-300/[0.08] text-center shadow-[0_0_30px_-16px_rgba(167,139,250,.9)]" style={{ width: size, height: size }}><div><div className="max-w-[88px] truncate px-2 text-[10px] font-semibold">{user.name}</div><div className="text-[9px] text-violet-100/50">{user.leagues.length} leagues</div></div></div>; })}</div></Shell><div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(330px,.85fr)]"><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-xl font-black">Manager reliability context</h3><p className="mt-1 text-xs text-white/38">Shared-league tenure plus active-league evidence and private notes—never a public score.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search manager or league…" className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm outline-none placeholder:text-white/20 focus:border-violet-300/30" /></div></div><div className="divide-y divide-white/[0.06]">{visibleUsers.length ? visibleUsers.map((user) => { const current = currentManagers.find((manager) => manager.ownerId === user.id); return <details key={user.id} className="group p-4 open:bg-white/[0.018]"><summary className="flex cursor-pointer list-none items-center gap-3">{user.avatar ? <img src={`https://sleepercdn.com/avatars/thumbs/${user.avatar}`} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-xs font-black text-white/35">{user.name.slice(0,2).toUpperCase()}</div>}<div className="min-w-0 flex-1"><div className="truncate font-semibold">{user.name}</div><div className="text-xs text-white/35">{user.leagues.length} shared leagues{current ? ` · ${current.transactions} active-league moves` : ""}</div></div><span className="text-white/25 transition group-open:rotate-180">⌄</span></summary><div className="mt-3 flex flex-wrap gap-1.5">{user.leagues.map((league) => <span key={league.id} className="rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-[11px] text-white/55">{league.name}</span>)}</div>{current ? <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs"><div className="rounded-xl bg-white/[0.025] p-2"><b>{current.transactions}</b><small className="block text-white/30">Moves</small></div><div className="rounded-xl bg-white/[0.025] p-2"><b>{current.trades}</b><small className="block text-white/30">Trades</small></div><div className="rounded-xl bg-white/[0.025] p-2"><b>{current.measuredWeeks ? percent((current.emptyLineups/current.measuredWeeks)*100) : "—"}</b><small className="block text-white/30">Unset</small></div><div className="rounded-xl bg-white/[0.025] p-2"><b>{current.efficiency == null ? "—" : percent(current.efficiency*100)}</b><small className="block text-white/30">Efficiency</small></div></div> : <div className="mt-3 text-[11px] text-white/30">No active-league activity profile is available for this manager. The tool does not infer reliability from membership alone.</div>}<textarea value={profileNotes[user.id] || ""} onChange={(event) => updateProfileNote(user.id, event.target.value)} rows={2} placeholder="Private commissioner context…" className={recruitingInputClass()} /></details>; }) : <div className="p-8 text-center text-sm text-white/40">No matching repeat managers found.</div>}</div></Shell><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Most connected leagues</h3><p className="mt-1 text-xs text-white/38">League pairs ranked by other managers appearing in both.</p></div><div className="divide-y divide-white/[0.06]">{network.leaguePairs.slice(0, 30).map((pair, index) => <details key={`${pair.leagues[0].id}-${pair.leagues[1].id}`} className="group p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-300/[0.07] text-xs font-black text-cyan-100">#{index + 1}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{pair.leagues[0].name}</div><div className="truncate text-xs text-white/35">↔ {pair.leagues[1].name}</div></div><span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] text-white/55">{pair.users.length} shared</span></summary><div className="mt-3 text-xs leading-5 text-white/42">{pair.users.map((user) => user.name).join(" · ")}</div></details>)}</div></Shell></div></> : null}
  </div>;
}

export default function CommissionerDashboardClient() {
  const { username, leagues, activeLeague, setActiveLeague, fetchLeagueRostersSilent, players, getPlayerValue, format, setFormat, qbType, setQbType, sourceKey, setSourceKey } = useSleeper();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [reportRosterId, setReportRosterId] = useState("");
  const [copied, setCopied] = useState(false);
  const [recruiting, setRecruiting] = useState(RECRUITING_DEFAULTS);
  const league = useMemo(() => leagues.find((row) => row.league_id === activeLeague) || null, [activeLeague, leagues]);
  const commissionerSourceKey = String(sourceKey || "").startsWith("val:") ? sourceKey : "val:thefantasyarsenal";
  const selectedValueSource = VALUE_SOURCES.find((source) => source.key === commissionerSourceKey) || VALUE_SOURCES[0];
  const valueFor = useMemo(() => (player) => getPlayerValue(player, { format, qbType, sourceKey: commissionerSourceKey }) || 0, [commissionerSourceKey, format, getPlayerValue, qbType]);

  useEffect(() => {
    if (sourceKey !== commissionerSourceKey) setSourceKey(commissionerSourceKey);
  }, [commissionerSourceKey, setSourceKey, sourceKey]);

  useEffect(() => {
    if (activeLeague && (!league?.rosters || !league?.users)) fetchLeagueRostersSilent(activeLeague).catch(() => {});
  }, [activeLeague, fetchLeagueRostersSilent, league?.rosters, league?.users]);

  useEffect(() => {
    let active = true;
    if (!league?.league_id || !league?.rosters?.length) { setData(null); return; }
    const cacheKey = `commissioner-health:v7:${league.league_id}:${commissionerSourceKey}:${format}:${qbType}`;
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
  const printReport = () => {
    if (!report || !evaluator) return;
    const printFrame = document.createElement("iframe");
    printFrame.setAttribute("aria-hidden", "true");
    Object.assign(printFrame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(printFrame);
    const printWindow = printFrame.contentWindow;
    if (!printWindow) { printFrame.remove(); setError("The printable report could not be created. Please refresh and try again."); return; }
    const detailRows = [["Entry fee / dues", recruiting.entryFee], ["Dues status", recruiting.duesStatus], ["Deposit", recruiting.deposit], ["FAAB / waivers", recruiting.faab], ["Commissioner contact", recruiting.contact], ["Decision deadline", recruiting.deadline], ["Rules / constitution", recruiting.constitution]].filter(([, value]) => value);
    const positionSections = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB", "IDP"].map((position) => [position, (report.assets || []).filter((asset) => String(asset.pos).toUpperCase() === position)]).filter(([, assets]) => assets.length);
    const otherAssets = (report.assets || []).filter((asset) => !positionSections.some(([position]) => position === String(asset.pos).toUpperCase()));
    const rosterHtml = [...positionSections, ...(otherAssets.length ? [["Other", otherAssets]] : [])].map(([position, assets]) => `<section class="position"><h3>${escapeHtml(position)} <small>${assets.length}</small></h3>${assets.map((asset) => `<div class="player"><span><b>${escapeHtml(asset.name)}</b><small>${escapeHtml(asset.team)} · age ${escapeHtml(asset.age || "—")}</small></span><strong>${Math.round(asset.value).toLocaleString()}</strong></div>`).join("")}</section>`).join("");
    const picksHtml = Object.entries((report.picks || []).reduce((groups, pick) => ({ ...groups, [pick.season]: [...(groups[pick.season] || []), pick] }), {})).map(([season, picks]) => `<div class="pickyear"><b>${escapeHtml(season)}</b><span>${picks.sort((a,b) => a.round-b.round).map((pick) => `R${pick.round}${pick.own ? " own" : ` via roster ${pick.originalRosterId}`}`).join(" · ")}</span></div>`).join("");
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(report.name)} · Orphan Team Report</title><style>@page{size:auto;margin:14mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#172033;margin:0;font-size:12px;line-height:1.45}header{border-bottom:4px solid #17a8bd;padding-bottom:18px;margin-bottom:20px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;color:#168ca0;font-size:10px;font-weight:700}h1{font-size:30px;margin:4px 0}h2{font-size:17px;margin:22px 0 10px}h3{font-size:13px;margin:0 0 7px;color:#31415f}small{font-size:10px;color:#718096;font-weight:400}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric,.panel{border:1px solid #dce4ed;border-radius:10px;padding:10px}.metric b{display:block;font-size:17px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.path{background:#edfafd;border:1px solid #bfe9ef;border-radius:10px;padding:12px;margin-top:12px}.position{break-inside:avoid;border:1px solid #dce4ed;border-radius:10px;padding:10px;margin-bottom:9px}.player{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-top:1px solid #edf1f5}.player:first-of-type{border-top:0}.player span small{display:block}.pickyear{display:flex;gap:12px;padding:7px 0;border-top:1px solid #edf1f5}.pickyear b{min-width:42px}.details{display:grid;grid-template-columns:1fr 1fr;gap:7px}.detail{border-bottom:1px solid #e8edf3;padding:5px 0}.notes{white-space:pre-wrap}.footer{margin-top:24px;border-top:1px solid #dce4ed;padding-top:10px;color:#718096;font-size:9px}@media print{.position,.panel{break-inside:avoid}}</style></head><body><header><div class="eyebrow">The Fantasy Arsenal · Orphan Team Evaluator</div><h1>${escapeHtml(report.name)}</h1><div>${escapeHtml(league.name)} · ${report.orphan ? "Open roster" : "Roster evaluation"} · ${report.wins}-${report.losses}</div></header><div class="metrics"><div class="metric"><small>Timeline</small><b>${escapeHtml(evaluator.timeline)}</b></div><div class="metric"><small>Difficulty</small><b>${escapeHtml(evaluator.difficulty)}</b>${evaluator.difficultyScore}/100</div><div class="metric"><small>Roster value rank</small><b>#${report.valueRank} of ${data.managers.length}</b>${Math.round(report.rosterValue).toLocaleString()}</div><div class="metric"><small>Future picks</small><b>${report.pickCount}</b>3-year model</div></div><div class="path"><b>Recommended path</b><br>${escapeHtml(evaluator.path)}</div><div class="grid"><div><h2>Complete roster</h2>${rosterHtml || "No players found."}</div><div><h2>Position profile</h2><div class="panel">${evaluator.positionProfile.map((row) => `<div class="pickyear"><b>${row.position}</b><span>#${row.rank} of ${data.managers.length} · ${row.count} rostered</span></div>`).join("")}</div><h2>Draft capital</h2><div class="panel">${picksHtml || "No modeled picks found."}</div><h2>League opportunity</h2><div class="panel details">${detailRows.map(([label, value]) => `<div class="detail"><small>${escapeHtml(label)}</small><br><b>${escapeHtml(value)}</b></div>`).join("") || "No commissioner details entered."}</div>${recruiting.notes ? `<h2>Commissioner notes</h2><div class="panel notes">${escapeHtml(recruiting.notes)}</div>` : ""}</div></div><div class="footer">Sleeper data is read-only. Market values and difficulty are estimates, not guarantees. Recruiting details were supplied locally by the commissioner. Generated by The Fantasy Arsenal.</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
    printWindow.document.close();
    printWindow.addEventListener("afterprint", () => printFrame.remove(), { once: true });
    window.setTimeout(() => printFrame.remove(), 60000);
  };
  const printSeasonReport = () => {
    if (!league || !data) return;
    const printFrame = document.createElement("iframe");
    printFrame.setAttribute("aria-hidden", "true");
    Object.assign(printFrame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(printFrame);
    const printWindow = printFrame.contentWindow;
    if (!printWindow) { printFrame.remove(); setError("The printable season report could not be created. Please refresh and try again."); return; }
    const standings = [...data.managers].sort((a,b) => b.wins-a.wins || b.points-a.points);
    const leaders = { points: [...data.managers].sort((a,b) => b.points-a.points)[0], value: [...data.managers].sort((a,b) => b.rosterValue-a.rosterValue)[0], activity: [...data.managers].sort((a,b) => b.transactions-a.transactions)[0], waivers: [...data.managers].sort((a,b) => b.waivers-a.waivers)[0] };
    const settingsAudit = buildSettingsAudit(league, data.managers.length);
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(league.name)} · Commissioner Report</title><style>@page{margin:14mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#172033;margin:0;font-size:11px;line-height:1.45}header{border-bottom:4px solid #17a8bd;padding-bottom:16px;margin-bottom:18px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;color:#168ca0;font-size:9px;font-weight:700}h1{font-size:29px;margin:4px 0}h2{font-size:17px;margin:22px 0 9px}.metrics,.awards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.card,.panel{border:1px solid #dce4ed;border-radius:9px;padding:9px;break-inside:avoid}.card b{display:block;font-size:17px}.card small{color:#718096}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px;border-bottom:1px solid #e7edf3}th{font-size:9px;text-transform:uppercase;color:#718096}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.signal{border-left:3px solid #e4a11b;padding:7px 10px;margin:6px 0;background:#fff9ed}.recommend{padding:7px 0;border-bottom:1px solid #e7edf3}.footer{margin-top:22px;padding-top:9px;border-top:1px solid #dce4ed;color:#718096;font-size:9px}</style></head><body><header><div class="eyebrow">The Fantasy Arsenal · Full Season Commissioner Report</div><h1>${escapeHtml(league.name)}</h1><div>${escapeHtml(league.season)} season · ${data.managers.length} teams · generated ${escapeHtml(new Date().toLocaleDateString())}</div></header><div class="metrics"><div class="card"><small>Health score</small><b>${Math.round(data.healthScore)}/100</b></div><div class="card"><small>Competitive balance</small><b>${Math.round(data.balanceScore)}/100</b></div><div class="card"><small>Participation</small><b>${percent(data.participation*100)}</b></div><div class="card"><small>Review signals</small><b>${data.attentionCount}</b></div></div><h2>Season recognitions</h2><div class="awards"><div class="card"><small>Points leader</small><b>${escapeHtml(leaders.points?.name)}</b>${leaders.points?.points.toFixed(1)} points</div><div class="card"><small>Roster-value leader</small><b>${escapeHtml(leaders.value?.name)}</b>${Math.round(leaders.value?.rosterValue || 0).toLocaleString()}</div><div class="card"><small>Most active</small><b>${escapeHtml(leaders.activity?.name)}</b>${leaders.activity?.transactions || 0} moves</div><div class="card"><small>Waiver leader</small><b>${escapeHtml(leaders.waivers?.name)}</b>${leaders.waivers?.waivers || 0} moves</div></div><h2>League standings and participation</h2><table><thead><tr><th>Team</th><th>Record</th><th>Points</th><th>Value rank</th><th>Moves</th><th>Trades</th><th>Waivers</th><th>Unset</th></tr></thead><tbody>${standings.map((manager) => `<tr><td><b>${escapeHtml(manager.name)}</b>${manager.orphan ? " · OPEN" : ""}</td><td>${manager.wins}-${manager.losses}</td><td>${manager.points.toFixed(1)}</td><td>#${manager.valueRank}</td><td>${manager.transactions}</td><td>${manager.trades}</td><td>${manager.waivers}</td><td>${manager.measuredWeeks ? percent((manager.emptyLineups/manager.measuredWeeks)*100) : "—"}</td></tr>`).join("")}</tbody></table><div class="grid"><div><h2>Items requiring context</h2>${data.managers.flatMap((manager) => manager.reviewSignals.map((signal) => `<div class="signal"><b>${escapeHtml(manager.name)} · ${escapeHtml(signal.label)}</b><br>${escapeHtml(signal.detail)}</div>`)).join("") || '<div class="panel">No manager-level signals.</div>'}${data.tradeSignals.map((signal) => `<div class="signal"><b>Week ${escapeHtml(signal.week || "—")} trade review</b><br>${escapeHtml(signal.detail)}</div>`).join("")}</div><div><h2>Settings identity</h2><div class="panel"><b>${escapeHtml(settingsAudit.identity)}</b>${settingsAudit.rows.map((row) => `<div class="recommend"><b>${escapeHtml(row.label)}:</b> ${escapeHtml(row.grade)}<br>${escapeHtml(row.value)}</div>`).join("")}</div><h2>Commissioner recommendations</h2><div class="panel">${data.recommendations.map((item) => `<div class="recommend"><b>${escapeHtml(item.title)}</b><br>${escapeHtml(item.reason)}</div>`).join("")}</div></div></div><div class="footer">Signals are review prompts, not findings of misconduct. Values and efficiency estimates depend on available data and selected markets. Sleeper data is read-only. Generated by The Fantasy Arsenal.</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
    printWindow.document.close();
    printWindow.addEventListener("afterprint", () => printFrame.remove(), { once: true });
    window.setTimeout(() => printFrame.remove(), 60000);
  };

  return <main className="min-h-screen text-white"><BackgroundParticles /><Navbar pageTitle="Commissioner Dashboard" /><div className="mx-auto max-w-7xl px-4 pb-16 pt-20">
    <header className="relative overflow-hidden rounded-[34px] border border-cyan-300/15 bg-[radial-gradient(circle_at_85%_0%,rgba(34,211,238,.2),transparent_34%),radial-gradient(circle_at_10%_100%,rgba(139,92,246,.14),transparent_32%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))] p-5 shadow-[0_42px_125px_-75px_rgba(34,211,238,.75)] sm:p-7"><div className="text-[11px] font-semibold uppercase tracking-[.28em] text-cyan-200/60">Commissioner intelligence</div><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">League Health Dashboard</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/58 sm:text-base">Participation, competitive balance, lineup habits, roster quality, settings, and review signals—with evidence and neutral language built in.</p><div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label><span className="mb-1.5 block text-xs text-white/45">League to audit</span><select value={activeLeague || ""} onChange={(event) => { setActiveLeague(event.target.value); setData(null); if (event.target.value) fetchLeagueRostersSilent(event.target.value).catch(() => {}); }} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 text-sm"><option value="">Choose a league</option>{leagues.map((row) => <option key={row.league_id} value={row.league_id}>{row.name}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><Metric label="Your access" value={isCommissioner ? "Commissioner" : "Read-only"} detail={isCommissioner ? "You are listed as a league owner." : "Audit data remains publicly viewable."} /><Metric label="Commissioners" value={commissioners.length || "—"} detail={commissioners.slice(0,2).join(", ")} /></div></div></header>

    {username ? <Shell className="mt-4 p-4"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,440px)] lg:items-center"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-cyan-200/50">Valuation model</div><div className="mt-1 text-lg font-black">Choose how roster strength is measured</div><p className="mt-1 text-xs leading-5 text-white/42">This controls roster values, value ranks, positional profiles, trade-review estimates, orphan evaluations, and printed reports. Activity and lineup-compliance metrics are unaffected.</p><div className="mt-2 text-[11px] text-white/35">Currently using <span className="font-semibold text-white/65">{selectedValueSource?.label}</span> · {format === "redraft" ? "Redraft" : "Dynasty"} · {qbType === "1qb" ? "1QB" : "Superflex"}</div></div><SourceSelector value={commissionerSourceKey} onChange={setSourceKey} sources={VALUE_SOURCES} mode={format} qbType={qbType} onModeChange={setFormat} onQbTypeChange={setQbType} label="Commissioner value source" layout="inline" /></div></Shell> : null}

    {loading ? <div className="mt-5 flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.07] p-4 text-sm text-cyan-100"><span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-200/25 border-t-cyan-200" />{progress}</div> : null}
    {error ? <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div> : null}
    {!username ? <Shell className="mt-6 p-8 text-center text-white/55">Log in with your Sleeper username to select and audit a league.</Shell> : null}

    {data ? <><section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric label="Health score" value={`${Math.round(data.healthScore)}/100`} detail="Composite participation and balance signal" tone={data.healthScore >= 75 ? "good" : data.healthScore >= 55 ? "warn" : "risk"} /><Metric label="Balance" value={`${Math.round(data.balanceScore)}/100`} detail={`${data.valueSpread.toFixed(1)}× top-to-bottom value`} /><Metric label="Balance trend" value={data.parityTrend} detail="Early weeks compared with recent weeks" /><Metric label="Participation" value={percent(data.participation * 100)} detail="Managers with recorded activity" /><Metric label="Needs review" value={data.attentionCount} detail="Manager and trade signals" tone={data.attentionCount ? "warn" : "good"} /><Metric label="Open rosters" value={data.managers.filter((manager) => manager.orphan).length} detail="No Sleeper owner assigned" tone={data.managers.some((manager) => manager.orphan) ? "risk" : "good"} /></section>

      <div className="mt-4 flex justify-end"><button onClick={printSeasonReport} className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-xs font-semibold text-cyan-100">Print full season report</button></div>
      <nav className="sticky top-16 z-30 -mx-4 mt-4 overflow-x-auto border-y border-white/10 bg-slate-950/90 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border"><div className="flex w-max gap-1">{[["overview","Overview"],["command","Command Center"],["office","League Office"],["operations","Operations"],["managers","Managers"],["review","Review"],["auditor","Settings"],["network","Network"],["history","History"],["orphan","Orphan"]].map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === key ? "bg-white/10 text-white" : "text-white/48 hover:bg-white/5 hover:text-white/80"}`}>{label}</button>)}</div></nav>

      {tab === "orphan" ? <OrphanEvaluator report={report} evaluator={evaluator} managers={data.managers} recruiting={recruiting} updateRecruiting={updateRecruiting} copied={copied} copyReport={copyReport} printReport={printReport} setReportRosterId={setReportRosterId} /> : null}
      {tab === "auditor" ? <SettingsAuditor league={league} managerCount={data.managers.length} recommendations={data.recommendations} /> : null}
      {tab === "network" ? <LeagueNetwork leagues={leagues} username={username} currentManagers={data.managers} /> : null}
      {tab === "operations" ? <CommissionerOperations league={league} data={data} /> : null}
      {tab === "history" ? <HistoricalHealth league={league} /> : null}
      {tab === "office" ? <CommissionerLeagueOffice league={league} data={data} sourceLabel={selectedValueSource?.label || commissionerSourceKey} /> : null}
      {tab === "command" ? <CommissionerCommandCenter league={league} data={data} players={players} /> : null}

      {tab === "overview" ? <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]"><Shell className="overflow-hidden"><div className="border-b border-white/10 p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-cyan-200/55">League pulse</div><h2 className="mt-1 text-xl font-black">Competitive balance</h2><p className="mt-1 text-xs text-white/45">Standings and roster-market value reveal different kinds of parity.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="text-left text-xs text-white/38"><tr><th className="p-3">Team</th><th className="p-3">Record</th><th className="p-3">Points</th><th className="p-3">Value rank</th><th className="p-3">Activity</th><th className="p-3">Signals</th></tr></thead><tbody>{[...data.managers].sort((a,b) => b.wins-a.wins || b.points-a.points).map((manager) => <tr key={manager.rosterId} className="border-t border-white/5"><td className="p-3 font-semibold">{manager.name}{manager.orphan ? <span className="ml-2 rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] text-rose-100">OPEN</span> : null}</td><td className="p-3">{manager.wins}-{manager.losses}</td><td className="p-3">{manager.points.toFixed(1)}</td><td className="p-3">#{manager.valueRank}</td><td className="p-3">{manager.transactions} moves</td><td className="p-3">{manager.reviewSignals.length || "—"}</td></tr>)}</tbody></table></div></Shell><div className="space-y-5"><Shell className="p-5"><div className="text-lg font-bold">What the score means</div><div className="mt-3 space-y-3 text-xs leading-5 text-white/52"><p><span className="font-semibold text-emerald-100">Observed facts</span> include empty slots, ownership, and transaction counts.</p><p><span className="font-semibold text-amber-100">Review signals</span> use thresholds for lineup efficiency or trade-value difference and require commissioner context.</p><p>No signal is labeled collusion, tanking, or misconduct automatically.</p></div></Shell><Shell className="p-5"><div className="text-lg font-bold">Quick recommendations</div><div className="mt-3 space-y-3">{data.recommendations.slice(0,3).map((item) => <div key={item.title} className="rounded-2xl border border-white/8 bg-white/[0.025] p-3"><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs leading-5 text-white/45">{item.reason}</div></div>)}</div></Shell></div></div> : null}

      {tab === "managers" ? <div className="mt-6 grid gap-4 lg:grid-cols-2">{data.managers.map((manager) => <Shell key={manager.rosterId} className="p-5"><div className="flex items-start gap-3">{manager.avatar ? <img src={`https://sleepercdn.com/avatars/thumbs/${manager.avatar}`} alt="" className="h-11 w-11 rounded-2xl object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.06] text-sm font-black text-white/40">R{manager.rosterId}</div>}<div className="min-w-0 flex-1"><div className="truncate text-lg font-bold">{manager.name}</div><div className="mt-1 text-xs text-white/45">{manager.wins}-{manager.losses} · value rank #{manager.valueRank} · age {manager.averageAge ? manager.averageAge.toFixed(1) : "—"}</div></div>{manager.reviewSignals.length ? <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2.5 py-1 text-[10px] font-semibold text-amber-100">REVIEW</span> : <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] px-2.5 py-1 text-[10px] font-semibold text-emerald-100">CLEAR</span>}</div><div className="mt-4 grid grid-cols-5 gap-2 text-center"><div><div className="text-lg font-black">{manager.transactions}</div><div className="text-[9px] uppercase text-white/30">Moves</div></div><div><div className="text-lg font-black">{manager.trades}</div><div className="text-[9px] uppercase text-white/30">Trades</div></div><div><div className="text-lg font-black">{manager.waivers}</div><div className="text-[9px] uppercase text-white/30">Waivers</div></div><div><div className="text-lg font-black">{manager.measuredWeeks ? percent((manager.emptyLineups/manager.measuredWeeks)*100) : "—"}</div><div className="text-[9px] uppercase text-white/30">Unset</div></div><div><div className="text-lg font-black">{manager.efficiency == null ? "—" : percent(manager.efficiency*100)}</div><div className="text-[9px] uppercase text-white/30">Efficiency</div></div></div>{manager.reviewSignals.length ? <div className="mt-4 space-y-2">{manager.reviewSignals.map((signal) => <div key={signal.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold">{signal.label}</div><span className="text-[9px] uppercase tracking-wider text-white/30">{signal.type}</span></div><div className="mt-1 text-xs leading-5 text-white/45">{signal.detail}</div></div>)}</div> : null}</Shell>)}</div> : null}

      {tab === "review" ? <div className="mt-6 grid gap-5 lg:grid-cols-2"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-amber-200/55">Lineup and activity review</div><h2 className="mt-1 text-xl font-black">Evidence requiring context</h2><div className="mt-4 space-y-3">{data.managers.filter((manager) => manager.reviewSignals.length).length ? data.managers.filter((manager) => manager.reviewSignals.length).map((manager) => <div key={manager.rosterId} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="font-bold">{manager.name}</div><div className="mt-2 space-y-1 text-xs leading-5 text-white/50">{manager.reviewSignals.map((signal) => <div key={signal.label}>• <span className="text-white/75">{signal.label}:</span> {signal.detail}</div>)}</div></div>) : <div className="rounded-2xl bg-emerald-400/[0.06] p-4 text-sm text-emerald-100">No manager-level review signals were found.</div>}</div></Shell><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-rose-200/55">Trade review</div><h2 className="mt-1 text-xl font-black">Unusual patterns—not conclusions</h2><div className="mt-4 space-y-3">{data.tradeSignals.length ? data.tradeSignals.map((signal) => <div key={signal.id} className="rounded-2xl border border-rose-300/12 bg-rose-400/[0.045] p-4"><div className="flex items-center justify-between"><div className="text-sm font-bold">Week {signal.week || "—"} trade</div><span className="text-xs text-rose-100">{Math.round(signal.gapPct*100)}% value gap</span></div><div className="mt-2 text-xs leading-5 text-white/50">{signal.detail}</div>{signal.repeated >= 4 ? <div className="mt-2 text-[11px] text-amber-100/70">These managers completed {signal.repeated} trades with each other.</div> : null}</div>) : <div className="rounded-2xl bg-emerald-400/[0.06] p-4 text-sm text-emerald-100">No large value differences or repeated-pair patterns crossed the review thresholds.</div>}</div><div className="mt-4 rounded-2xl border border-cyan-300/12 bg-cyan-400/[0.045] p-3 text-[11px] leading-5 text-white/45">Market values cannot capture roster direction, scoring rules, pick position, injuries, or manager preference. These rows are prompts for review only.</div></Shell></div> : null}

      {tab === "settings" ? <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><Shell className="p-5"><div className="text-[11px] font-semibold uppercase tracking-[.22em] text-violet-200/55">Configuration audit</div><h2 className="mt-1 text-xl font-black">Recommended league review</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{data.recommendations.map((item) => <div key={item.title} className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-400/[0.055] to-white/[0.02] p-4"><div className="font-bold">{item.title}</div><div className="mt-2 text-xs leading-5 text-white/50">{item.reason}</div></div>)}</div></Shell><Shell className="p-5"><div className="text-lg font-bold">Current structure</div><div className="mt-4 grid grid-cols-2 gap-2"><Metric label="Teams" value={league.total_rosters || data.managers.length} /><Metric label="Playoff teams" value={league?.settings?.playoff_teams || "—"} /><Metric label="Playoffs start" value={league?.settings?.playoff_week_start ? `Week ${league.settings.playoff_week_start}` : "—"} /><Metric label="Median game" value={number(league?.settings?.league_average_match) ? "On" : "Off"} /><Metric label="Starter slots" value={(league.roster_positions || []).filter((slot) => !["BN","IR","TAXI"].includes(String(slot).toUpperCase())).length} /><Metric label="Bench slots" value={(league.roster_positions || []).filter((slot) => String(slot).toUpperCase() === "BN").length} /></div><div className="mt-4 text-[11px] leading-5 text-white/38">Recommendations describe tradeoffs; they are not universal rules. League culture and commissioner intent should control final settings.</div></Shell></div> : null}

      {tab === "replacement" ? <div className="mt-6"><Shell className="overflow-hidden"><div className="flex flex-col gap-4 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.17),transparent_38%)] p-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-violet-200/55">Replacement manager report</div><h2 className="mt-1 text-2xl font-black">Package a roster honestly</h2><p className="mt-1 text-xs text-white/45">Useful for open teams, commissioner review, or recruiting a future replacement.</p></div><div className="flex flex-wrap gap-2"><select value={reportRosterId} onChange={(event) => setReportRosterId(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm">{data.managers.map((manager) => <option key={manager.rosterId} value={manager.rosterId}>{manager.name}{manager.orphan ? " · Open" : ""}</option>)}</select><button onClick={copyReport} className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] px-4 py-2.5 text-sm font-semibold text-cyan-100">{copied ? "Copied" : "Copy report"}</button></div></div>{report ? <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px]"><div><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-3xl bg-violet-400/10 text-xl font-black">#{report.valueRank}</div><div><div className="text-2xl font-black">{report.name}</div><div className="mt-1 text-sm text-white/45">{report.orphan ? "Open roster" : "Currently managed"} · {report.wins}-{report.losses} record · age {report.averageAge ? report.averageAge.toFixed(1) : "—"}</div></div></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Value rank" value={`#${report.valueRank}`} /><Metric label="Roster value" value={Math.round(report.rosterValue).toLocaleString()} /><Metric label="Future picks" value={report.pickCount} /><Metric label="Activity" value={`${report.transactions} moves`} /></div><div className="mt-6"><div className="text-lg font-bold">Foundation assets</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{report.topAssets.map((asset) => <div key={asset.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3"><AvatarImage name={asset.name} playerId={asset.id} size={34} className="rounded-full" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{asset.name}</div><div className="text-xs text-white/40">{asset.pos || "—"}</div></div><div className="text-xs font-bold text-white/55">{Math.round(asset.value).toLocaleString()}</div></div>)}</div></div></div><div className="space-y-3"><div className="rounded-3xl border border-emerald-300/12 bg-emerald-400/[0.05] p-4"><div className="text-[10px] uppercase tracking-wider text-emerald-100/45">Best selling point</div><div className="mt-2 text-sm font-semibold">{report.valueRank <= Math.ceil(data.managers.length/3) ? "Strong roster-value foundation" : report.pickCount >= 12 ? "Flexible future draft capital" : "Clear opportunity to reshape the team"}</div></div><div className="rounded-3xl border border-amber-300/12 bg-amber-400/[0.05] p-4"><div className="text-[10px] uppercase tracking-wider text-amber-100/45">Expectation to set</div><div className="mt-2 text-sm leading-5 text-white/58">{report.valueRank > Math.ceil(data.managers.length*0.67) ? "This roster grades in the bottom third by the selected market, so a multi-season plan may be realistic." : "This roster is not in the bottom third by value, but lineup balance and pick placement still deserve review."}</div></div></div></div> : null}</Shell></div> : null}
    </> : null}
  </div></main>;
}
