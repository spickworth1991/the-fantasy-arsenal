"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSleeper } from "../../context/SleeperContext";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { makeGetPlayerValue } from "../../lib/values";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(
  () => import("../../components/BackgroundParticles"),
  { ssr: false }
);

import { PROJECTION_DATA_SEASON, PROJ_CBS_JSON_URL, PROJ_ESPN_JSON_URL, PROJ_JSON_URL, PROJ_SLEEPER_JSON_URL } from "../../lib/projectionSeason";
const REG_SEASON_WEEKS = 17;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatPct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function formatSigned(n) {
  const value = Number(n || 0);
  if (!value) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function normNameForMap(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeamAbbr(x) {
  const s = String(x || "").toUpperCase().trim();
  const map = { JAX: "JAC", LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV", WFT: "WAS", WSH: "WAS" };
  return map[s] || s;
}

function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}

function buildProjectionMapFromJSON(json) {
  const rows = Array.isArray(json) ? json : json?.rows || [];
  const byId = Object.create(null);
  const byName = Object.create(null);
  const byNameTeam = Object.create(null);
  const byNamePos = Object.create(null);

  rows.forEach((row) => {
    const pid = row.player_id != null ? String(row.player_id) : "";
    const name = row.name || row.player || row.full_name || "";
    const seasonPts = Number(row.points ?? row.pts ?? row.total ?? row.projection ?? 0) || 0;
    const team = normalizeTeamAbbr(
      row.team ?? row.nfl_team ?? row.team_abbr ?? row.team_code ?? row.pro_team
    );
    const pos = normalizePos(row.pos ?? row.position ?? row.player_position);

    if (pid) byId[pid] = seasonPts;
    if (!name) return;

    const nn = normNameForMap(name);
    byName[nn] = seasonPts;
    byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;
    if (team) byNameTeam[`${nn}|${team}`] = seasonPts;
    if (pos) byNamePos[`${nn}|${pos}`] = seasonPts;
  });

  return { byId, byName, byNameTeam, byNamePos };
}

async function fetchProjectionMap(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return buildProjectionMapFromJSON(await res.json());
}

function getSeasonPointsForPlayer(map, player) {
  if (!map || !player) return 0;

  const exact = map.byId?.[String(player.player_id)];
  if (exact != null) return exact;

  const nn = normNameForMap(
    player.full_name ||
      player.search_full_name ||
      `${player.first_name || ""} ${player.last_name || ""}`.trim()
  );
  const team = normalizeTeamAbbr(player.team);
  const pos = normalizePos(player.position);

  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos && map.byNamePos?.[`${nn}|${pos}`] != null) return map.byNamePos[`${nn}|${pos}`];
  if (team || pos) return 0;
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const compact = String(player.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return compact && map.byName?.[compact] != null ? map.byName[compact] : 0;
}

function parseLeagueSlots(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  const strict = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const flexGroups = [];

  const mapToken = (token) =>
    token === "W" ? "WR" : token === "R" ? "RB" : token === "T" ? "TE" : token === "Q" ? "QB" : token;

  rp.forEach((token) => {
    if (["BN", "IR", "TAXI"].includes(token)) return;
    if (["QB", "RB", "WR", "TE", "K", "DEF", "DST"].includes(token)) {
      strict[token === "DST" ? "DEF" : token] += 1;
      return;
    }
    if (token === "FLEX") {
      flexGroups.push(["RB", "WR", "TE"]);
      return;
    }
    if (token === "SUPER_FLEX" || token === "SUPERFLEX" || token === "Q/W/R/T") {
      flexGroups.push(["QB", "RB", "WR", "TE"]);
      return;
    }
    if (token.includes("/")) {
      const group = Array.from(
        new Set(
          token
            .split("/")
            .map(mapToken)
            .filter((pos) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(pos))
        )
      );
      if (group.length) flexGroups.push(group);
    }
  });

  return { strict, flexGroups };
}

function inferQbTypeFromLeague(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  return rp.includes("SUPER_FLEX") || rp.includes("SUPERFLEX") || rp.includes("Q/W/R/T") ? "sf" : "1qb";
}

function inferFormatFromLeague(league) {
  const name = String(league?.name || "").toLowerCase();
  return name.includes("dynasty") || name.includes("keeper") || !!league?.previous_league_id ? "dynasty" : "redraft";
}

function teamStrength({ roster, players, getMetricWeekly, slots, week, byeMap }) {
  if (!roster) return 0;

  const pool = (roster.players || [])
    .filter(Boolean)
    .map((pid) => {
      const player = players?.[pid];
      if (!player) return null;
      const pos = String(player.position || "").toUpperCase() === "DST" ? "DEF" : String(player.position || "").toUpperCase();
      return { pos, val: getMetricWeekly(player, week, byeMap) || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.val - a.val);

  const pick = (eligible, count) => {
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      let bestIdx = -1;
      let bestVal = -1;
      for (let j = 0; j < pool.length; j += 1) {
        if (!pool[j] || !eligible.includes(pool[j].pos)) continue;
        if (pool[j].val > bestVal) {
          bestVal = pool[j].val;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        total += pool[bestIdx].val;
        pool.splice(bestIdx, 1);
      }
    }
    return total;
  };

  let sum = 0;
  sum += pick(["QB"], slots.strict.QB);
  sum += pick(["RB"], slots.strict.RB);
  sum += pick(["WR"], slots.strict.WR);
  sum += pick(["TE"], slots.strict.TE);
  sum += pick(["K"], slots.strict.K);
  sum += pick(["DEF"], slots.strict.DEF);
  (slots.flexGroups || []).forEach((group) => {
    sum += pick(group, 1);
  });
  sum += pool.slice(0, 5).reduce((acc, item) => acc + 0.18 * (item.val || 0), 0);
  return sum;
}

function samplePerformanceScore(strength) {
  const base = Math.max(1, Number(strength || 0));
  const variance = base < 150 ? 0.28 : base < 500 ? 0.22 : 0.16;
  return base * (1 + (Math.random() * 2 - 1) * variance);
}

function simulateMatchup(ridA, ridB, strengthMap) {
  const scoreA = samplePerformanceScore(strengthMap[ridA] || 0);
  const scoreB = samplePerformanceScore(strengthMap[ridB] || 0);
  if (scoreA === scoreB) {
    return {
      winner: (strengthMap[ridA] || 0) >= (strengthMap[ridB] || 0) ? ridA : ridB,
      scoreA,
      scoreB,
    };
  }
  return { winner: scoreA > scoreB ? ridA : ridB, scoreA, scoreB };
}

function runPlayoffBracket(ranked, playoffSlots, byeSlots, strengthMap) {
  const seeds = ranked.slice(0, playoffSlots);
  if (!seeds.length) return null;
  if (seeds.length === 1) return seeds[0];

  const seedIndex = new Map(seeds.map((rid, idx) => [rid, idx]));

  const playRound = (teams) => {
    const winners = [];
    let left = 0;
    let right = teams.length - 1;
    while (left < right) {
      winners.push(simulateMatchup(teams[left], teams[right], strengthMap).winner);
      left += 1;
      right -= 1;
    }
    if (left === right) winners.push(teams[left]);
    return winners.sort((a, b) => (seedIndex.get(a) || 0) - (seedIndex.get(b) || 0));
  };

  let survivors = seeds.slice(0, byeSlots);
  const openingRound = seeds.slice(byeSlots);
  if (openingRound.length) {
    survivors = survivors.concat(playRound(openingRound));
    survivors.sort((a, b) => (seedIndex.get(a) || 0) - (seedIndex.get(b) || 0));
  }
  while (survivors.length > 1) survivors = playRound(survivors);
  return survivors[0] || null;
}

function getPlayoffByeCount(playoffSlots) {
  const teams = Math.max(2, Number(playoffSlots) || 2);
  let bracketSize = 1;
  while (bracketSize < teams) bracketSize *= 2;
  return Math.max(0, bracketSize - teams);
}

function buildSyntheticMatchups(rosterIds, weekIndex) {
  const ids = [...rosterIds];
  if (ids.length < 2) return ids.map((rid) => [rid]);
  if (ids.length % 2) ids.push(null);
  const fixed = ids[0];
  const rotating = ids.slice(1);
  const shift = weekIndex % rotating.length;
  const rotated = [fixed, ...rotating.slice(shift), ...rotating.slice(0, shift)];
  const groups = [];
  for (let i = 0; i < rotated.length / 2; i += 1) {
    groups.push([rotated[i], rotated[rotated.length - 1 - i]].filter((rid) => rid != null));
  }
  return groups;
}

function addMedianWins(wins, weeklyScores) {
  const scores = Object.values(weeklyScores).filter(Number.isFinite).sort((a, b) => a - b);
  if (!scores.length) return;
  const middle = Math.floor(scores.length / 2);
  const median = scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2;
  Object.entries(weeklyScores).forEach(([rid, score]) => {
    if (score > median) wins[rid] += 1;
    else if (score === median) wins[rid] += 0.5;
  });
}

function getObservedScore(row) {
  if (!row) return null;
  if (row.points == null) return null;
  const score = Number(row.points);
  return Number.isFinite(score) ? score : null;
}

function hasObservedPlayerData(row) {
  if (!row) return false;
  if (row.players_points && typeof row.players_points === "object") {
    if (
      Object.values(row.players_points).some(
        (value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001
      )
    ) {
      return true;
    }
  }
  if (Array.isArray(row.starters_points)) {
    if (
      row.starters_points.some(
        (value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001
      )
    ) {
      return true;
    }
  }
  return false;
}

function isObservedMatchupUsable(teamA, teamB) {
  const scoreA = getObservedScore(teamA);
  const scoreB = getObservedScore(teamB);
  if (scoreA == null || scoreB == null) return false;
  if (scoreA !== 0 || scoreB !== 0) return true;
  return hasObservedPlayerData(teamA) || hasObservedPlayerData(teamB);
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/92 via-slate-900/82 to-slate-950/92 shadow-[0_30px_100px_-60px_rgba(15,23,42,1)] backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">{children}</h2>
      {subtitle ? <div className="mt-1 text-sm text-white/55">{subtitle}</div> : null}
    </div>
  );
}

function StatChip({ label, value, tone = "default", className = "" }) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-100"
      : tone === "amber"
      ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
      : tone === "rose"
      ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
      : "border-white/10 bg-white/5 text-white/80";

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClass} ${className}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CompactSelect({ label, value, onChange, options = [], className = "" }) {
  return (
    <label className={`block rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-white/80 ${className}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <select
        className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none"
        value={value}
        onChange={onChange}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-950 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InsightCard({ eyebrow, title, body, tone = "cyan" }) {
  const toneClass =
    tone === "amber"
      ? "from-amber-500/14 via-slate-900 to-slate-950"
      : tone === "rose"
      ? "from-rose-500/14 via-slate-900 to-slate-950"
      : "from-cyan-500/14 via-slate-900 to-slate-950";

  return (
    <div className={`rounded-3xl border border-white/10 bg-gradient-to-br ${toneClass} p-4 shadow-[0_25px_80px_-60px_rgba(0,0,0,1)]`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">{eyebrow}</div>
      <div className="mt-2 text-lg font-bold text-white">{title}</div>
      <div className="mt-2 text-sm leading-6 text-white/65">{body}</div>
    </div>
  );
}

function OddsBar({ value, color = "cyan" }) {
  const barClass =
    color === "amber"
      ? "from-amber-400 via-orange-400 to-amber-300"
      : color === "rose"
      ? "from-rose-400 via-pink-400 to-fuchsia-300"
      : "from-cyan-400 via-sky-400 to-teal-300";

  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
      <div className={`h-full rounded-full bg-gradient-to-r ${barClass}`} style={{ width: `${clamp(Number(value || 0), 0, 100)}%` }} />
    </div>
  );
}

function ScenarioWorkbench({ scenarioData, results, league, activeLeague, focusRosterId }) {
  const storageKey=`playoff-scenarios:${activeLeague}:${focusRosterId}`;
  const [selections,setSelections]=useState({});
  const [saved,setSaved]=useState({});
  const [notice,setNotice]=useState("");
  useEffect(()=>{try{setSaved(JSON.parse(localStorage.getItem(storageKey)||"{}"));}catch{setSaved({});}setSelections({});},[storageKey]);
  if(!scenarioData)return null;
  const selectedRows=scenarioData.rooting.filter(row=>selections[`${row.a}-${row.b}`]);
  const combinedPct=selectedRows.length?selectedRows.reduce((sum,row)=>sum+(selections[`${row.a}-${row.b}`]===String(row.a)?Number(row.aWinFocusPct||scenarioData.focus.makePct):Number(row.bWinFocusPct||scenarioData.focus.makePct)),0)/selectedRows.length:scenarioData.focus.makePct;
  const cutoff=[...results.table].sort((a,b)=>b.avgWins-a.avgWins)[Math.max(0,(results.playoffSlots||6)-1)];
  const magicWins=Math.max(0,Math.ceil(Number(cutoff?.avgWins||0)-Number(scenarioData.focus.currentWins||0)));
  const save=()=>{const name=`Scenario ${Object.keys(saved).length+1}`;const next={...saved,[name]:{selections,combinedPct,savedAt:Date.now()}};setSaved(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}setNotice(`${name} saved`);};
  const share=async()=>{const payload=btoa(JSON.stringify(selections));const url=`${window.location.origin}/playoff-odds?league=${encodeURIComponent(activeLeague)}&team=${encodeURIComponent(focusRosterId)}&scenario=${encodeURIComponent(payload)}`;try{await navigator.clipboard.writeText(url);setNotice("Share link copied");}catch{setNotice("Unable to copy link");}};
  const tiebreak=league?.settings?.playoff_seed_type===1?"Playoff seeding prioritizes points for, then the league's remaining Sleeper tiebreak sequence.":league?.settings?.divisions?"Division placement affects qualification before record and points-for tiebreaks.":"Projected seeds follow record first, then points for among tied teams, matching the observable Sleeper standings order.";
  return <div className="mt-5 rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/[0.055] via-slate-950/50 to-violet-400/[0.04] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/55">Multi-outcome scenario tree</div><h3 className="mt-1 text-xl font-black">Build the week you need</h3><p className="mt-1 text-xs text-white/38">Combine several matchup outcomes, save the branch, or share the exact setup.</p></div><div className="text-right"><div className="text-3xl font-black text-cyan-100">{formatPct(combinedPct)}</div><div className="text-[9px] uppercase text-white/30">combined scenario estimate</div></div></div><div className="mt-4 grid gap-2 lg:grid-cols-2">{scenarioData.rooting.slice(0,8).map(row=>{const key=`${row.a}-${row.b}`;return <div key={key} className="rounded-2xl bg-black/15 p-3"><div className="truncate text-xs font-semibold">{row.aTeam?.primaryLabel} vs {row.bTeam?.primaryLabel}</div><div className="mt-2 grid grid-cols-3 gap-1"><button onClick={()=>setSelections(current=>({...current,[key]:String(row.a)}))} className={`rounded-lg px-2 py-1.5 text-[10px] ${selections[key]===String(row.a)?"bg-cyan-300/15 text-cyan-100":"bg-white/[0.04] text-white/40"}`}>{row.aTeam?.primaryLabel} wins</button><button onClick={()=>setSelections(current=>({...current,[key]:String(row.b)}))} className={`rounded-lg px-2 py-1.5 text-[10px] ${selections[key]===String(row.b)?"bg-violet-300/15 text-violet-100":"bg-white/[0.04] text-white/40"}`}>{row.bTeam?.primaryLabel} wins</button><button onClick={()=>setSelections(current=>{const next={...current};delete next[key];return next;})} className="rounded-lg bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/30">Either</button></div></div>})}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white/[0.025] p-3"><div className="text-[9px] uppercase text-white/30">Magic number</div><b className="mt-1 block text-xl">{magicWins||"At line"}</b><p className="mt-1 text-[10px] text-white/35">Approximate additional wins needed to clear the projected cutoff.</p></div><div className="rounded-2xl bg-white/[0.025] p-3"><div className="text-[9px] uppercase text-white/30">Remaining seeds</div><b className="mt-1 block text-xl">#{scenarioData.focus.minSeed}–#{scenarioData.focus.maxSeed}</b><p className="mt-1 text-[10px] text-white/35">Observed across simulation branches.</p></div><div className="rounded-2xl bg-white/[0.025] p-3"><div className="text-[9px] uppercase text-white/30">Tiebreaker lens</div><p className="mt-1 text-[10px] leading-4 text-white/45">{tiebreak}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={save} className="rounded-xl bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">Save scenario</button><button onClick={share} className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/60">Copy share link</button><a href={`/lineup?league=${encodeURIComponent(activeLeague)}&strategy=${combinedPct<45?"aggressive":"safe"}`} className="rounded-xl bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100">Open {combinedPct<45?"aggressive":"safe"} lineup →</a><a href={`/trade?league=${encodeURIComponent(activeLeague)}&team=${encodeURIComponent(focusRosterId)}`} className="rounded-xl bg-violet-300/10 px-3 py-2 text-xs font-semibold text-violet-100">Import trade from Analyzer →</a>{notice?<span className="self-center text-xs text-white/40">{notice}</span>:null}</div>{Object.keys(saved).length?<div className="mt-3 flex flex-wrap gap-2">{Object.entries(saved).map(([name,row])=><button key={name} onClick={()=>setSelections(row.selections||{})} className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-white/45">{name} · {formatPct(row.combinedPct)}</button>)}</div>:null}</div>;
}

export default function PlayoffOddsPage() {
  const {
    username,
    leagues = [],
    activeLeague,
    setActiveLeague,
    fetchLeagueRostersSilent,
    players,
    format,
    qbType,
  } = useSleeper();
  const league = useMemo(
    () => leagues.find((item) => item.league_id === activeLeague) || null,
    [leagues, activeLeague]
  );

  const [sourceKey, setSourceKey] = useState("val:thefantasyarsenal");
  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);
  const [metricMode, setMetricMode] = useState("projections");
  const [projectionSource, setProjectionSource] = useState("CSV");
  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null, SLEEPER: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  const [stateWeek, setStateWeek] = useState(1);
  const [stateSeason, setStateSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState({ by_team: {} });
  const [runs, setRuns] = useState(2500);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [schedCache, setSchedCache] = useState({});
  const [playoffLensOpen, setPlayoffLensOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(true);
  const [focusRosterId, setFocusRosterId] = useState("");
  const [rivalRosterId, setRivalRosterId] = useState("");
  const [tradeGiveId, setTradeGiveId] = useState("");
  const [tradeReceiveId, setTradeReceiveId] = useState("");
  const debTimer = useRef(null);

  const leagueSeason = Number(league?.season || 0) || stateSeason || new Date().getFullYear();
  const regularSeasonEnd = useMemo(() => {
    const playoffStart = Number(league?.settings?.playoff_week_start || 0);
    return playoffStart > 1 ? clamp(playoffStart - 1, 1, 18) : 14;
  }, [league?.settings?.playoff_week_start]);
  const latestObservedWeek = useMemo(() => {
    if (Number(league?.season || 0) !== Number(stateSeason || 0)) return regularSeasonEnd;
    return clamp((stateWeek || 1) - 1, 0, regularSeasonEnd);
  }, [league?.season, regularSeasonEnd, stateSeason, stateWeek]);

  const handleSetFormat = (value) => {
    setUserTouchedFormat(true);
    setFormatLocal(value);
  };

  const handleSetQbType = (value) => {
    setUserTouchedQB(true);
    setQbLocal(value);
  };

  const handleLeagueChange = (leagueId) => {
    setActiveLeague(leagueId);
    if (leagueId) fetchLeagueRostersSilent(leagueId).catch(() => {});
    setUserTouchedFormat(false);
    setUserTouchedQB(false);
  };

  useEffect(() => {
    setMetricMode(metricModeFromSourceKey(sourceKey));
    setProjectionSource(projectionSourceFromKey(sourceKey));
  }, [sourceKey]);

  const [valueSource, setValueSource] = useState("TheFantasyArsenal");
  useEffect(() => {
    setValueSource(valueSourceFromKey(sourceKey));
  }, [sourceKey]);

  useEffect(() => {
    if (!league || metricMode !== "projections" || leagueSeason === PROJECTION_DATA_SEASON) return;
    setProjError(`Projection feeds cover ${PROJECTION_DATA_SEASON}; using current roster values for this ${leagueSeason} league.`);
    setSourceKey("val:thefantasyarsenal");
  }, [league, leagueSeason, metricMode]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjLoading(true);
      setProjError("");
      try {
        const [csv, espn, cbs, sleeper] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
          fetchProjectionMap(PROJ_SLEEPER_JSON_URL),
        ]);
        if (!mounted) return;
        const next = { CSV: null, ESPN: null, CBS: null, SLEEPER: null };
        if (csv.status === "fulfilled") next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled") next.CBS = cbs.value;
        if (sleeper.status === "fulfilled") next.SLEEPER = sleeper.value;
        setProjMaps(next);

        if (!next.CSV && !next.ESPN && !next.CBS && !next.SLEEPER) {
          setProjError("Projection feeds are unavailable, so the model is using values.");
          setSourceKey("val:thefantasyarsenal");
        } else if (projectionSource === "CBS" && !next.CBS) {
          setSourceKey(next.ESPN ? "proj:espn" : "proj:ffa");
        } else if (projectionSource === "ESPN" && !next.ESPN) {
          setSourceKey(next.CSV ? "proj:ffa" : "proj:cbs");
        } else if (projectionSource === "CSV" && !next.CSV) {
          setSourceKey(next.ESPN ? "proj:espn" : "proj:cbs");
        } else if (projectionSource === "SLEEPER" && !next.SLEEPER) {
          setSourceKey(next.ESPN ? "proj:espn" : next.CSV ? "proj:ffa" : "proj:cbs");
        }
      } catch {
        if (!mounted) return;
        setProjError("Projection feeds are unavailable, so the model is using values.");
        setSourceKey("val:thefantasyarsenal");
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectionSource]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/state/nfl", { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        if (!mounted || !data) return;
        setStateWeek(clamp(Number(data.week ?? data.leg ?? 1) || 1, 1, 18));
        setStateSeason(Number(data.season) || new Date().getFullYear());
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/byes/${leagueSeason}.json`, { cache: "no-store" });
        if (!mounted) return;
        if (res.ok) setByeMap(await res.json());
        else setByeMap({ by_team: {} });
      } catch {
        if (mounted) setByeMap({ by_team: {} });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueSeason]);

  useEffect(() => {
    if (!activeLeague) return;
    if (!league?.rosters || !league?.users) fetchLeagueRostersSilent(activeLeague).catch(() => {});
  }, [activeLeague, league?.rosters, league?.users, fetchLeagueRostersSilent]);

  useEffect(() => {
    if (!league) return;
    if (!userTouchedQB) setQbLocal(inferQbTypeFromLeague(league));
    if (!userTouchedFormat) setFormatLocal(inferFormatFromLeague(league));
  }, [league, userTouchedFormat, userTouchedQB]);

  useEffect(() => {
    setSchedCache({});
  }, [league?.league_id]);

  const allRosters = league?.rosters || [];
  const rosters = useMemo(
    () => allRosters.filter((roster) => (roster.players || []).length > 0),
    [allRosters]
  );
  const users = league?.users || [];
  const ridList = useMemo(() => rosters.map((roster) => roster.roster_id), [rosters]);
  const rosterById = useMemo(
    () => Object.fromEntries(rosters.map((roster) => [roster.roster_id, roster])),
    [rosters]
  );
  const slots = useMemo(() => parseLeagueSlots(league), [league]);

  useEffect(() => {
    if (!ridList.length) { setFocusRosterId(""); return; }
    if (!ridList.some((rid) => String(rid) === String(focusRosterId))) {
      const me = (league?.users || []).find((user) => String(user?.username || user?.display_name || "").toLowerCase() === String(username || "").toLowerCase());
      const myRoster = me ? rosters.find((roster) => String(roster.owner_id) === String(me.user_id)) : null;
      setFocusRosterId(String(myRoster?.roster_id || ridList[0]));
    }
  }, [focusRosterId, league?.users, ridList, rosters, username]);

  useEffect(() => {
    setTradeGiveId("");
    setTradeReceiveId("");
    const nextRival = ridList.find((rid) => String(rid) !== String(focusRosterId));
    setRivalRosterId(nextRival != null ? String(nextRival) : "");
  }, [focusRosterId]);

  const getRosterIdentity = (rid) => {
    const roster = rosterById[rid];
    const user = roster ? users.find((item) => item.user_id === roster.owner_id) : null;
    const teamName = String(user?.metadata?.team_name || "").trim();
    const managerName = String(user?.display_name || user?.username || "").trim();
    const fallback = roster ? `Roster ${roster.roster_id}` : String(rid);

    return {
      teamName: teamName || fallback,
      managerName: managerName || (teamName ? fallback : ""),
      primaryLabel: teamName || managerName || fallback,
      secondaryLabel: teamName && managerName ? managerName : "",
      summaryLabel: teamName && managerName ? `${teamName} (${managerName})` : teamName || managerName || fallback,
    };
  };

  const getValue = useMemo(
    () => makeGetPlayerValue(valueSource, formatLocal, qbLocal),
    [valueSource, formatLocal, qbLocal]
  );

  const getMetricWeekly = useMemo(() => {
    if (metricMode === "projections") {
      const chosen = projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projectionSource === "SLEEPER" ? projMaps.SLEEPER : projMaps.CSV;
      if (!chosen) return () => 0;
      return (player, currentWeek, currentByeMap) => {
        if (!player) return 0;
        const team = (player.team || "").toUpperCase();
        const byes = Array.isArray(currentByeMap?.by_team?.[team]) ? currentByeMap.by_team[team] : [];
        if (byes.includes(currentWeek)) return 0;
        const seasonPts = getSeasonPointsForPlayer(chosen, player);
        const games = Math.max(1, REG_SEASON_WEEKS - byes.length);
        return seasonPts / games;
      };
    }
    return (player, currentWeek, currentByeMap) => {
      if (!player) return 0;
      const team = (player.team || "").toUpperCase();
      const byes = Array.isArray(currentByeMap?.by_team?.[team]) ? currentByeMap.by_team[team] : [];
      if (byes.includes(currentWeek)) return 0;
      return getValue(player) || 0;
    };
  }, [getValue, metricMode, projMaps, projectionSource]);

  const loadWeek = async (currentWeek) => {
    if (!activeLeague) return { groups: [], hasRealMatchups: false };
    if (schedCache[currentWeek]) return schedCache[currentWeek];

    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague}/matchups/${currentWeek}`, { cache: "no-store" });
      const data = res.ok ? await res.json() : [];
      const byMatchupId = new Map();
      for (const row of data) {
        if (!row?.matchup_id) continue;
        if (!byMatchupId.has(row.matchup_id)) byMatchupId.set(row.matchup_id, []);
        byMatchupId.get(row.matchup_id).push(row);
      }
      const groups = Array.from(byMatchupId.values());
      const present = new Set(groups.flat().map((row) => row.roster_id));
      ridList.forEach((rid) => {
        if (!present.has(rid)) groups.push([{ roster_id: rid }]);
      });
      const payload = { groups, hasRealMatchups: groups.some((group) => group.length === 2) };
      setSchedCache((prev) => ({ ...prev, [currentWeek]: payload }));
      return payload;
    } catch {
      const fallback = { groups: ridList.map((rid) => [{ roster_id: rid }]), hasRealMatchups: false };
      setSchedCache((prev) => ({ ...prev, [currentWeek]: fallback }));
      return fallback;
    }
  };

  const simulate = async () => {
    if (!activeLeague || !rosters.length) {
      setResults(null);
      return;
    }

    setBusy(true);
    try {
      const observedEndWeek = latestObservedWeek;
      const observedStartWeek = observedEndWeek > 0 ? 1 : 0;
      const observedWeeks = [];
      for (let current = 1; current <= observedEndWeek; current += 1) observedWeeks.push(current);

      const futureWeeks = [];
      for (let current = observedEndWeek + 1; current <= regularSeasonEnd; current += 1) futureWeeks.push(current);

      const futureScheduleRows = await Promise.all(futureWeeks.map(loadWeek));
      const playoffSlots = Math.min(ridList.length, Math.max(2, Number(league?.settings?.playoff_teams || 6)));
      const byeSlots = getPlayoffByeCount(playoffSlots);
      const baseWins = Object.fromEntries(rosters.map((roster) => {
        const wins = Number(roster?.settings?.wins || 0);
        const ties = Number(roster?.settings?.ties || 0);
        return [roster.roster_id, wins + ties * 0.5];
      }));
      const basePointsFor = Object.fromEntries(rosters.map((roster) => {
        const whole = Number(roster?.settings?.fpts || 0);
        const decimal = Number(roster?.settings?.fpts_decimal || 0) / 100;
        return [roster.roster_id, whole + decimal];
      }));

      const strengthsByWeek = {};
      const strengthWeeks = futureWeeks.length
        ? futureWeeks
        : [Math.max(1, Math.min(observedEndWeek || 1, regularSeasonEnd))];
      strengthWeeks.forEach((currentWeek) => {
        strengthsByWeek[currentWeek] = Object.fromEntries(
          rosters.map((roster) => [
            roster.roster_id,
            teamStrength({ roster, players, getMetricWeekly, slots, week: currentWeek, byeMap }),
          ])
        );
      });

      const averageStrengthByRoster = Object.fromEntries(
        ridList.map((rid) => [
          rid,
          strengthWeeks.length
            ? strengthWeeks.reduce((sum, currentWeek) => sum + (strengthsByWeek[currentWeek][rid] || 0), 0) / strengthWeeks.length
            : teamStrength({ roster: rosterById[rid], players, getMetricWeekly, slots, week: Math.max(1, observedEndWeek), byeMap }),
        ])
      );

      const scheduleWeeksWithGames = futureScheduleRows.filter((row) => row.hasRealMatchups).length;
      const scheduleMode =
        futureWeeks.length === 0
          ? "complete"
          : scheduleWeeksWithGames === futureWeeks.length
          ? "league"
          : scheduleWeeksWithGames === 0
          ? "synthetic"
          : "hybrid";

      const makes = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const byes = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const champs = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const totalWins = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const totalSeeds = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const conditions = Object.fromEntries(ridList.map((rid) => [rid, { winRuns: 0, winMakes: 0, lossRuns: 0, lossMakes: 0, minSeed: ridList.length, maxSeed: 1 }]));
      const firstWeekGroups = futureWeeks.length
        ? ((futureScheduleRows[0]?.hasRealMatchups
          ? futureScheduleRows[0].groups.map((group) => group.map((team) => team.roster_id))
          : buildSyntheticMatchups(ridList, 0)).filter((group) => group.length === 2))
        : [];
      const matchupConditions = Object.fromEntries(firstWeekGroups.map(([a, b]) => [`${a}-${b}`, { a, b, aWinRuns: 0, aWinFocusMakes: 0, bWinRuns: 0, bWinFocusMakes: 0 }]));

      for (let run = 0; run < runs; run += 1) {
        const wins = { ...baseWins };
        const pointsFor = { ...basePointsFor };
        const firstWeekWinners = new Set();
        const firstWeekLosers = new Set();

        futureWeeks.forEach((currentWeek, index) => {
          const schedule = futureScheduleRows[index] || { groups: [], hasRealMatchups: false };
          const strengthMap = strengthsByWeek[currentWeek] || {};
          const groups = schedule.hasRealMatchups
            ? schedule.groups.map((group) => group.map((team) => team.roster_id))
            : buildSyntheticMatchups(ridList, index);
          const weeklyScores = {};

          groups.forEach((group) => {
            if (group.length === 2) {
              const [ridA, ridB] = group;
              const sim = simulateMatchup(ridA, ridB, strengthMap);
              wins[sim.winner] += 1;
              if (index === 0) {
                firstWeekWinners.add(sim.winner);
                firstWeekLosers.add(sim.winner === ridA ? ridB : ridA);
              }
              pointsFor[ridA] += sim.scoreA;
              pointsFor[ridB] += sim.scoreB;
              weeklyScores[ridA] = sim.scoreA;
              weeklyScores[ridB] = sim.scoreB;
            } else if (group.length === 1) {
              const rid = group[0];
              const score = samplePerformanceScore(strengthMap[rid] || 0);
              pointsFor[rid] += score;
              weeklyScores[rid] = score;
            }
          });

          if (Number(league?.settings?.league_average_match || 0) === 1) {
            addMedianWins(wins, weeklyScores);
          }
        });

        const ranked = [...ridList].sort((a, b) => {
          const winGap = (wins[b] || 0) - (wins[a] || 0);
          if (winGap !== 0) return winGap;
          const pointGap = (pointsFor[b] || 0) - (pointsFor[a] || 0);
          if (pointGap !== 0) return pointGap;
          return (averageStrengthByRoster[b] || 0) - (averageStrengthByRoster[a] || 0);
        });

        const playoffTeams = ranked.slice(0, playoffSlots);
        const playoffSet = new Set(playoffTeams);
        playoffTeams.forEach((rid, index) => {
          makes[rid] += 1;
          totalSeeds[rid] += index + 1;
        });
        ranked.slice(0, byeSlots).forEach((rid) => {
          byes[rid] += 1;
        });
        ridList.forEach((rid) => {
          totalWins[rid] += wins[rid] || 0;
          const seed = ranked.indexOf(rid) + 1;
          conditions[rid].minSeed = Math.min(conditions[rid].minSeed, seed);
          conditions[rid].maxSeed = Math.max(conditions[rid].maxSeed, seed);
          if (firstWeekWinners.has(rid)) {
            conditions[rid].winRuns += 1;
            if (playoffSet.has(rid)) conditions[rid].winMakes += 1;
          }
          if (firstWeekLosers.has(rid)) {
            conditions[rid].lossRuns += 1;
            if (playoffSet.has(rid)) conditions[rid].lossMakes += 1;
          }
        });

        if (focusRosterId) {
          Object.values(matchupConditions).forEach((condition) => {
            if (firstWeekWinners.has(condition.a)) {
              condition.aWinRuns += 1;
              if (playoffSet.has(Number(focusRosterId)) || playoffSet.has(String(focusRosterId))) condition.aWinFocusMakes += 1;
            } else if (firstWeekWinners.has(condition.b)) {
              condition.bWinRuns += 1;
              if (playoffSet.has(Number(focusRosterId)) || playoffSet.has(String(focusRosterId))) condition.bWinFocusMakes += 1;
            }
          });
        }

        const champion = runPlayoffBracket(ranked, playoffSlots, byeSlots, averageStrengthByRoster);
        if (champion) champs[champion] += 1;
      }

      const table = rosters
        .map((roster) => {
          const rid = roster.roster_id;
          const currentWins = baseWins[rid] || 0;
          const strength = averageStrengthByRoster[rid] || 0;
          const makePct = (100 * makes[rid]) / runs;
          const byePct = (100 * byes[rid]) / runs;
          const champPct = (100 * champs[rid]) / runs;
          const avgWins = totalWins[rid] / runs;
          const avgSeed = makes[rid] ? totalSeeds[rid] / makes[rid] : null;
          const condition = conditions[rid];
          const winMakePct = condition.winRuns ? (100 * condition.winMakes) / condition.winRuns : null;
          const lossMakePct = condition.lossRuns ? (100 * condition.lossMakes) / condition.lossRuns : null;

          return {
            rid,
            ...getRosterIdentity(rid),
            strength,
            currentWins,
            avgWins,
            winDelta: avgWins - currentWins,
            avgSeed,
            makePct,
            byePct,
            champPct,
            winMakePct,
            lossMakePct,
            minSeed: condition.minSeed,
            maxSeed: condition.maxSeed,
          };
        })
        .sort((a, b) => {
          if (b.makePct !== a.makePct) return b.makePct - a.makePct;
          if (b.byePct !== a.byePct) return b.byePct - a.byePct;
          if (b.champPct !== a.champPct) return b.champPct - a.champPct;
          return b.strength - a.strength;
        });

      setResults({
        totalRuns: runs,
        observedWeeks,
        futureWeeks,
        playoffSlots,
        byeSlots,
        scheduleMode,
        observedStartWeek,
        observedEndWeek,
        latestObservedWeek,
        table,
        matchupConditions: Object.values(matchupConditions).map((condition) => ({
          ...condition,
          aWinFocusPct: condition.aWinRuns ? (100 * condition.aWinFocusMakes) / condition.aWinRuns : null,
          bWinFocusPct: condition.bWinRuns ? (100 * condition.bWinFocusMakes) / condition.bWinRuns : null,
        })),
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!activeLeague) {
      setResults(null);
      return;
    }
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(() => {
      simulate();
    }, 350);
    return () => {
      if (debTimer.current) clearTimeout(debTimer.current);
    };
  }, [
    activeLeague,
    runs,
    metricMode,
    projectionSource,
    projMaps,
    projLoading,
    valueSource,
    formatLocal,
    qbLocal,
    players,
    rosters.length,
    byeMap,
    focusRosterId,
  ]);

  const currentSourceLabel = useMemo(() => {
    const found = DEFAULT_SOURCES.find((item) => item.key === sourceKey);
    return found?.label || "Selected Source";
  }, [sourceKey]);

  const sourceOptions = useMemo(
    () => DEFAULT_SOURCES.map((item) => ({ value: item.key, label: item.label })),
    []
  );

  const leagueOptions = useMemo(
    () => [
      { value: "", label: "Choose a League" },
      ...leagues.map((item) => ({ value: item.league_id, label: item.name })),
    ],
    [leagues]
  );

  const resultSummary = useMemo(() => {
    if (!results?.table?.length) return null;
    const favorite = [...results.table].sort((a, b) => b.champPct - a.champPct)[0];
    const surge = [...results.table].sort((a, b) => b.winDelta - a.winDelta)[0];
    const bubble = [...results.table]
      .filter((team) => team.makePct > 10 && team.makePct < 90)
      .sort((a, b) => Math.abs(a.makePct - 50) - Math.abs(b.makePct - 50))[0];
    return { favorite, surge, bubble };
  }, [results]);

  const scenarioData = useMemo(() => {
    if (!results?.table?.length || !focusRosterId) return null;
    const focus = results.table.find((team) => String(team.rid) === String(focusRosterId));
    if (!focus) return null;
    const rooting = (results.matchupConditions || []).map((condition) => {
      const a = results.table.find((team) => String(team.rid) === String(condition.a));
      const b = results.table.find((team) => String(team.rid) === String(condition.b));
      const aPct = condition.aWinFocusPct;
      const bPct = condition.bWinFocusPct;
      const preferred = aPct == null || bPct == null ? null : aPct >= bPct ? a : b;
      return { ...condition, aTeam: a, bTeam: b, preferred, leverage: aPct == null || bPct == null ? 0 : Math.abs(aPct - bPct) };
    }).sort((a, b) => b.leverage - a.leverage);
    const rivalMatchup = rooting.find((row) => String(row.a) === String(rivalRosterId) || String(row.b) === String(rivalRosterId));
    const rivalLossPct = !rivalMatchup ? null : String(rivalMatchup.a) === String(rivalRosterId) ? rivalMatchup.bWinFocusPct : rivalMatchup.aWinFocusPct;
    const clinchTeams = results.table.filter((team) => team.makePct >= 99.5 || (team.winMakePct != null && team.winMakePct >= 99 && (team.lossMakePct == null || team.lossMakePct < 99)));
    const eliminationTeams = results.table.filter((team) => team.makePct <= 0.5 || (team.lossMakePct != null && team.lossMakePct <= 1 && (team.winMakePct == null || team.winMakePct > 1)));
    return { focus, rooting, rivalMatchup, rivalLossPct, clinchTeams, eliminationTeams, highestLeverage: rooting[0] || null };
  }, [focusRosterId, results, rivalRosterId]);

  const focusRoster = rosterById[Number(focusRosterId)] || rosterById[focusRosterId];
  const focusTradeAssets = useMemo(() => (focusRoster?.players || []).map((id) => players?.[id]).filter((player) => player && String(player.position || "").toUpperCase() !== "PICK").sort((a, b) => (getMetricWeekly(b, Math.max(1, latestObservedWeek + 1), byeMap) || 0) - (getMetricWeekly(a, Math.max(1, latestObservedWeek + 1), byeMap) || 0)), [byeMap, focusRoster, getMetricWeekly, latestObservedWeek, players]);
  const receiveTradeAssets = useMemo(() => rosters.filter((roster) => String(roster.roster_id) !== String(focusRosterId)).flatMap((roster) => (roster.players || []).map((id) => players?.[id] ? { player: players[id], rosterId: roster.roster_id } : null).filter(Boolean)).filter((row) => String(row.player.position || "").toUpperCase() !== "PICK").sort((a, b) => (getMetricWeekly(b.player, Math.max(1, latestObservedWeek + 1), byeMap) || 0) - (getMetricWeekly(a.player, Math.max(1, latestObservedWeek + 1), byeMap) || 0)), [byeMap, focusRosterId, getMetricWeekly, latestObservedWeek, players, rosters]);

  const tradeImpact = useMemo(() => {
    if (!scenarioData?.focus || !focusRoster || !tradeGiveId || !tradeReceiveId) return null;
    const incomingRow = receiveTradeAssets.find((row) => String(row.player.player_id) === String(tradeReceiveId));
    if (!incomingRow) return null;
    const nextWeek = Math.max(1, Math.min(regularSeasonEnd, latestObservedWeek + 1));
    const swappedPlayers = (focusRoster.players || []).filter((id) => String(id) !== String(tradeGiveId)).concat(String(tradeReceiveId));
    const swappedRoster = { ...focusRoster, players: swappedPlayers };
    const before = teamStrength({ roster: focusRoster, players, getMetricWeekly, slots, week: nextWeek, byeMap });
    const after = teamStrength({ roster: swappedRoster, players, getMetricWeekly, slots, week: nextWeek, byeMap });
    const strengthDeltaPct = before ? (after - before) / before : 0;
    const remainingWeeks = Math.max(1, regularSeasonEnd - latestObservedWeek);
    const bubbleSensitivity = 0.45 + (1 - Math.abs(scenarioData.focus.makePct - 50) / 50) * 0.75;
    const oddsDelta = clamp(strengthDeltaPct * remainingWeeks * 18 * bubbleSensitivity, -30, 30);
    const partner = results.table.find((team) => String(team.rid) === String(incomingRow.rosterId));
    return { before, after, strengthDeltaPct, oddsDelta, estimatedOdds: clamp(scenarioData.focus.makePct + oddsDelta, 0, 100), partner };
  }, [byeMap, focusRoster, getMetricWeekly, latestObservedWeek, players, receiveTradeAssets, regularSeasonEnd, results, scenarioData, slots, tradeGiveId, tradeReceiveId]);

  const sidebarLeaders = useMemo(() => {
    if (!results?.table?.length) return { contenders: [], bubble: [] };
    return {
      contenders: [...results.table].sort((a, b) => b.champPct - a.champPct).slice(0, 4),
      bubble: [...results.table]
        .filter((team) => team.makePct < 85 && team.makePct > 15)
        .sort((a, b) => Math.abs(a.makePct - 50) - Math.abs(b.makePct - 50))
        .slice(0, 4),
    };
  }, [results]);

  const sourceHelperCopy =
    metricMode === "projections"
      ? "Projection mode leans into weekly lineup quality, bye pressure, and playoff path."
      : "Value mode shifts the model toward roster strength and market insulation across the stretch run.";

  const simulationModeLabel =
    results?.scheduleMode === "league"
      ? "Live league schedule"
      : results?.scheduleMode === "hybrid"
      ? "Some future Sleeper matchups missing"
      : results?.scheduleMode === "synthetic"
      ? "No future Sleeper matchups available yet"
      : "Regular season complete";

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Playoff Odds" />

      <div className="mx-auto max-w-7xl px-4 pb-12 pt-20">
        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/40">Playoff Lens</div>
              <div className="mt-2 text-2xl font-black tracking-tight text-white sm:text-[2rem]">
                See where every team stands
              </div>
              <div className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                Current Sleeper standings, remaining matchups, and roster strength combined into one playoff forecast.
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:flex xl:flex-wrap">
              <StatChip className="w-full sm:w-auto" label="Active Lens" value={metricMode === "projections" ? "Projections" : "Values"} tone={metricMode === "projections" ? "cyan" : "amber"} />
              <CompactSelect
                className="w-full md:min-w-[190px] xl:w-auto"
                label="Source"
                value={sourceKey}
                onChange={(e) => setSourceKey(e.target.value)}
                options={sourceOptions}
              />
              <CompactSelect
                className="w-full md:min-w-[220px] xl:w-auto"
                label="League"
                value={activeLeague || ""}
                onChange={(e) => handleLeagueChange(e.target.value)}
                options={leagueOptions}
              />
              <button
                type="button"
                onClick={() => setPlayoffLensOpen((open) => !open)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 md:col-span-2 xl:w-auto xl:justify-start"
                aria-expanded={playoffLensOpen}
                aria-controls="playoff-lens-panel"
              >
                {playoffLensOpen ? "Close Settings" : "Model Settings"}
                <svg
                  className={`h-4 w-4 transition-transform ${playoffLensOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          {playoffLensOpen ? (
            <div id="playoff-lens-panel">
              <SourceSelector
                sources={DEFAULT_SOURCES}
                value={sourceKey}
                onChange={setSourceKey}
                mode={formatLocal}
                qbType={qbLocal}
                onModeChange={handleSetFormat}
                onQbTypeChange={handleSetQbType}
                layout="inline"
                className="w-full"
              />

              <div className="mt-3 flex flex-col gap-2 text-xs text-white/50 sm:flex-row sm:flex-wrap sm:items-center">
                <span>{sourceHelperCopy}</span>
                {projError ? (
                  <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-amber-100">
                    {projError}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 rounded-[26px] border border-white/10 bg-gradient-to-br from-cyan-500/10 via-slate-950/90 to-slate-950 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">Simulation Window</div>
                    <div className="mt-1 text-sm text-white/60">
                      Completed results are locked in automatically; the model simulates every remaining regular-season week.
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 text-xs text-white/55 sm:flex-row sm:flex-wrap sm:items-center">
                    <span>
                      {busy
                        ? "Running the playoff sim..."
                        : results
                        ? `${results.totalRuns.toLocaleString()} runs across ${results.futureWeeks.length || 0} remaining weeks`
                        : "Choose a league to start the simulation"}
                    </span>
                    {results ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        {simulationModeLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 text-xs text-white/50">
                  {latestObservedWeek <= 0
                    ? "No completed NFL weeks are available yet, so the model uses a preseason baseline and simulates from Week 1."
                    : latestObservedWeek < regularSeasonEnd
                    ? `Official standings are the baseline through Week ${latestObservedWeek}. Weeks ${latestObservedWeek + 1}-${regularSeasonEnd} are simulated.`
                    : `The regular season is complete through Week ${regularSeasonEnd}; the odds now reflect the final standings.`}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <StatChip label="Baseline" value={latestObservedWeek > 0 ? `Through Week ${latestObservedWeek}` : "Preseason"} />
                  <StatChip label="Remaining" value={latestObservedWeek < regularSeasonEnd ? `W${latestObservedWeek + 1}-W${regularSeasonEnd}` : "Final"} />
                  <div>
                    <label className="mb-2 block text-xs text-white/50">Simulation Runs</label>
                    <select
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/30"
                      value={runs}
                      onChange={(e) => setRuns(Number(e.target.value) || 2500)}
                    >
                      {[1000, 2500, 5000, 7500, 10000].map((count) => (
                        <option key={count} value={count}>
                          {count.toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 rounded-[26px] border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">League Context</div>
                      <div className="mt-1 text-sm text-white/60">
                        Keep the active league and season framing attached to this playoff lens.
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                    <div>
                      <label className="mb-2 block text-xs text-white/50">League</label>
                      <select
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/30"
                        value={activeLeague || ""}
                        onChange={(e) => handleLeagueChange(e.target.value)}
                      >
                      <option value="">Choose a League</option>
                      {leagues.map((item) => (
                          <option key={item.league_id} value={item.league_id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <StatChip label="Season" value={league ? String(leagueSeason) : "Waiting"} />
                    <StatChip label="Playoff Teams" value={league ? String(Number(league?.settings?.playoff_teams || 6)) : "-"} />
                    <StatChip
                      label="Observed Window"
                      value={
                        !league
                          ? "-"
                          : latestObservedWeek <= 0
                          ? "Preseason"
                          : `Through W${latestObservedWeek}`
                      }
                    />
                    <StatChip
                      label="Schedule Mode"
                      value={results ? simulationModeLabel : "Waiting"}
                      tone={results?.scheduleMode === "synthetic" ? "amber" : results?.scheduleMode === "league" ? "cyan" : "default"}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </Card>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_340px]">
          <div className="space-y-6">

            <SectionTitle subtitle="A cleaner read on the race, with enough context to make the percentages feel trustworthy.">
              Outlook
            </SectionTitle>

            {!activeLeague ? (
              <Card className="p-8 text-center text-white/60">
                Pick a league above and the playoff board will build itself here.
              </Card>
            ) : !league?.rosters ? (
              <Card className="p-8 text-center text-white/60">
                Loading league rosters so the simulator has something real to chew on.
              </Card>
            ) : metricMode === "projections" && projLoading && !results ? (
              <Card className="p-8 text-center text-white/60">
                Loading projection feeds for the selected lens.
              </Card>
            ) : !results ? (
              <Card className="p-8 text-center text-white/60">
                The model will appear here once the current league context settles.
              </Card>
            ) : (
              <>
                <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:snap-none md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-3">
                  <div className="min-w-[86%] snap-start md:min-w-0">
                  <InsightCard
                    eyebrow="Title Favorite"
                    title={resultSummary?.favorite ? `${resultSummary.favorite.summaryLabel} | ${formatPct(resultSummary.favorite.champPct)}` : "Waiting for a favorite"}
                    body={
                      resultSummary?.favorite
                        ? `The strongest path to a championship right now, with ${formatPct(resultSummary.favorite.makePct)} playoff odds${results.byeSlots ? ` and ${formatPct(resultSummary.favorite.byePct)} bye odds` : "; this playoff format has no first-round byes"}.`
                        : "Once the sim finishes, the cleanest championship path lands here."
                    }
                    tone="cyan"
                  />
                  </div>

                  <div className="min-w-[86%] snap-start md:min-w-0">
                  <InsightCard
                    eyebrow="Bubble Watch"
                    title={resultSummary?.bubble ? `${resultSummary.bubble.summaryLabel} | ${formatPct(resultSummary.bubble.makePct)}` : "No bubble pressure"}
                    body={
                      resultSummary?.bubble
                        ? "This roster is sitting closest to the cut line, where one strong week can flip the season."
                        : "Either the field is wide open or the bracket is already close to decided."
                    }
                    tone="amber"
                  />
                  </div>

                  <div className="min-w-[86%] snap-start md:min-w-0">
                  <InsightCard
                    eyebrow="Best Surge"
                    title={resultSummary?.surge ? `${resultSummary.surge.summaryLabel} | ${formatSigned(resultSummary.surge.winDelta)} wins` : "No surge found"}
                    body={
                      resultSummary?.surge
                        ? "Compared to the observed baseline, this team gains the most expected wins from the remaining schedule and lineup profile."
                        : "Once enough context is loaded, the biggest mover will show here."
                    }
                    tone="rose"
                  />
                  </div>
                </div>

                <Card className="overflow-hidden border-violet-300/15">
                  <div className="bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.18),transparent_36%),linear-gradient(145deg,rgba(15,23,42,.96),rgba(2,6,23,.92))] p-5 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-violet-200/60">Playoff Scenario Explorer</div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight">What needs to happen next?</h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">Condition the simulation on this week’s results, see the seed paths still alive, and build a rooting guide around the games with real leverage.</p>
                      </div>
                      <button type="button" onClick={() => setScenarioOpen((open) => !open)} aria-expanded={scenarioOpen} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10">{scenarioOpen ? "Collapse Explorer" : "Open Scenario Explorer"}</button>
                    </div>

                    {scenarioOpen ? <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <label><span className="mb-1.5 block text-xs text-white/45">Team to explore</span><select value={focusRosterId} onChange={(event) => setFocusRosterId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 text-sm">{results.table.map((team) => <option key={team.rid} value={team.rid}>{team.summaryLabel}</option>)}</select></label>
                      <label><span className="mb-1.5 block text-xs text-white/45">Rival to monitor</span><select value={rivalRosterId} onChange={(event) => setRivalRosterId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 text-sm">{results.table.filter((team) => String(team.rid) !== String(focusRosterId)).map((team) => <option key={team.rid} value={team.rid}>{team.summaryLabel}</option>)}</select></label>
                    </div> : null}
                  </div>

                  {scenarioOpen && scenarioData ? <div className="border-t border-white/10 p-4 sm:p-6">
                    {results.futureWeeks.length ? <>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/[0.06] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-emerald-100/50">If you win this week</div><div className="mt-2 text-3xl font-black text-emerald-100">{scenarioData.focus.winMakePct == null ? "—" : formatPct(scenarioData.focus.winMakePct)}</div><div className="mt-1 text-xs text-white/45">playoff probability</div></div>
                        <div className="rounded-3xl border border-rose-300/15 bg-rose-400/[0.06] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-rose-100/50">If you lose this week</div><div className="mt-2 text-3xl font-black text-rose-100">{scenarioData.focus.lossMakePct == null ? "—" : formatPct(scenarioData.focus.lossMakePct)}</div><div className="mt-1 text-xs text-white/45">playoff probability</div></div>
                        <div className="rounded-3xl border border-violet-300/15 bg-violet-400/[0.06] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-100/50">If your rival loses</div><div className="mt-2 text-3xl font-black text-violet-100">{scenarioData.rivalLossPct == null ? "—" : formatPct(scenarioData.rivalLossPct)}</div><div className="mt-1 truncate text-xs text-white/45">{results.table.find((team) => String(team.rid) === String(rivalRosterId))?.primaryLabel || "Selected rival"} loses</div></div>
                        <div className="rounded-3xl border border-cyan-300/15 bg-cyan-400/[0.06] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-100/50">Possible finish</div><div className="mt-2 text-3xl font-black text-cyan-100">#{scenarioData.focus.minSeed}–#{scenarioData.focus.maxSeed}</div><div className="mt-1 text-xs text-white/45">seed range seen in simulations</div></div>
                      </div>

                      <ScenarioWorkbench scenarioData={scenarioData} results={results} league={league} activeLeague={activeLeague} focusRosterId={focusRosterId}/>

                      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
                        <div>
                          <div className="flex items-end justify-between gap-3"><div><div className="text-lg font-bold">Weekly rooting guide</div><div className="mt-1 text-xs text-white/45">Root for the outcome that most improves {scenarioData.focus.primaryLabel}’s odds.</div></div><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/45">Week {results.futureWeeks[0]}</span></div>
                          <div className="mt-3 space-y-2">{scenarioData.rooting.length ? scenarioData.rooting.map((row) => <div key={`${row.a}-${row.b}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{row.aTeam?.primaryLabel || `Roster ${row.a}`} <span className="text-white/25">vs</span> {row.bTeam?.primaryLabel || `Roster ${row.b}`}</div><div className="mt-1 text-xs text-white/42">{row.preferred ? <>Root for <span className="font-semibold text-cyan-100">{row.preferred.primaryLabel}</span></> : "No meaningful preference yet"}</div></div><div className="text-right"><div className="font-black text-violet-100">{row.leverage.toFixed(1)} pts</div><div className="text-[9px] uppercase tracking-wider text-white/30">leverage</div></div></div></div>) : <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">The next week’s matchups are not available yet.</div>}</div>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-3xl border border-amber-300/15 bg-amber-400/[0.05] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-100/50">Highest-leverage matchup</div>{scenarioData.highestLeverage ? <><div className="mt-2 font-bold">{scenarioData.highestLeverage.aTeam?.primaryLabel} vs {scenarioData.highestLeverage.bTeam?.primaryLabel}</div><div className="mt-1 text-xs leading-5 text-white/50">This result swings {scenarioData.focus.primaryLabel}’s playoff odds by approximately {scenarioData.highestLeverage.leverage.toFixed(1)} percentage points.</div></> : <div className="mt-2 text-sm text-white/50">No matchup leverage is available.</div>}</div>
                          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-white/40">Clinching watch</div><div className="mt-2 text-sm text-white/65">{scenarioData.clinchTeams.length ? scenarioData.clinchTeams.map((team) => team.primaryLabel).join(", ") : "No team can fully clinch in the modeled next-week branches."}</div></div>
                          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-white/40">Elimination watch</div><div className="mt-2 text-sm text-white/65">{scenarioData.eliminationTeams.length ? scenarioData.eliminationTeams.map((team) => team.primaryLabel).join(", ") : "No team faces modeled elimination this week."}</div></div>
                        </div>
                      </div>
                    </> : <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/[0.06] p-5 text-center"><div className="text-lg font-bold text-emerald-100">Regular season complete</div><div className="mt-1 text-sm text-white/50">Conditional weekly scenarios are closed; final seeds and bracket odds are shown below.</div></div>}

                    <div className="mt-5 rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-cyan-200/50">Proposed Trade Impact</div><div className="mt-1 text-lg font-bold">Test one player swap</div><div className="mt-1 text-xs text-white/45">Measures the lineup-strength change against the selected team’s current playoff sensitivity.</div></div>{tradeImpact ? <div className="text-right"><div className="text-2xl font-black text-cyan-100">{formatSigned(tradeImpact.oddsDelta)}%</div><div className="text-xs text-white/40">estimated playoff change</div></div> : null}</div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs text-white/45">You send</span><select value={tradeGiveId} onChange={(event) => setTradeGiveId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 text-sm"><option value="">Choose your player</option>{focusTradeAssets.map((player) => <option key={player.player_id} value={player.player_id}>{player.full_name || player.search_full_name || player.player_id}</option>)}</select></label><label><span className="mb-1.5 block text-xs text-white/45">You receive</span><select value={tradeReceiveId} onChange={(event) => setTradeReceiveId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 text-sm"><option value="">Choose another roster’s player</option>{receiveTradeAssets.map((row) => <option key={`${row.rosterId}-${row.player.player_id}`} value={row.player.player_id}>{row.player.full_name || row.player.search_full_name || row.player.player_id} · {getRosterIdentity(row.rosterId).primaryLabel}</option>)}</select></label></div>
                      {tradeImpact ? <div className="mt-4 grid gap-2 sm:grid-cols-3"><StatChip label="Current odds" value={formatPct(scenarioData.focus.makePct)} /><StatChip label="Estimated after trade" value={formatPct(tradeImpact.estimatedOdds)} tone={tradeImpact.oddsDelta >= 0 ? "cyan" : "rose"} /><StatChip label="Lineup strength" value={`${tradeImpact.strengthDeltaPct >= 0 ? "+" : ""}${(tradeImpact.strengthDeltaPct * 100).toFixed(1)}%`} /></div> : null}
                      <div className="mt-3 text-[11px] leading-5 text-white/35">Trade impact is a sensitivity estimate, not a second full Monte Carlo simulation. It accounts for the selected team’s optimized lineup change and remaining weeks; it does not model multi-player packages or the trade partner’s changed schedule.</div>
                    </div>
                  </div> : null}
                </Card>

                <Card className="overflow-hidden">
                  <div className="border-b border-white/10 px-5 py-4 sm:px-6">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">Odds Board</div>
                        <div className="mt-2 text-lg font-bold text-white">Premium view of the whole race</div>
                        <div className="mt-1 text-sm text-white/55">
                          Make odds, bye odds, championship equity, and expected finish in one table.
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        <StatChip className="min-w-0" label="Mode" value={simulationModeLabel} />
                        <StatChip className="min-w-0" label="Runs" value={results.totalRuns.toLocaleString()} />
                        <StatChip className="min-w-0" label="Bye Seeds" value={results.byeSlots ? String(results.byeSlots) : "None"} />
                        <StatChip
                          className="min-w-0"
                          label="Observed"
                          value={
                            results.observedWeeks.length
                              ? `W${results.observedWeeks[0]}-W${results.observedWeeks[results.observedWeeks.length - 1]}`
                              : "None"
                          }
                        />
                        <StatChip
                          className="min-w-0"
                          label="Simulated"
                          value={
                            results.futureWeeks.length
                              ? `W${results.futureWeeks[0]}-W${results.futureWeeks[results.futureWeeks.length - 1]}`
                              : "Final"
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {!results.byeSlots ? (
                    <div className="mx-3 mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-white/55 sm:mx-4">
                      This league sends {results.playoffSlots} teams to a complete bracket, so no seed receives a first-round bye.
                    </div>
                  ) : null}

                  <div className="space-y-3 px-3 pb-3 pt-3 md:hidden">
                    {results.table.map((row, index) => {
                      const barColor = row.champPct >= 30 ? "rose" : row.makePct >= 65 ? "cyan" : "amber";
                      return (
                        <div key={`mobile-${row.rid}`} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/70">
                                Rank {index + 1}
                              </div>
                              <div className="mt-1 truncate font-semibold text-white">{row.primaryLabel}</div>
                              {row.secondaryLabel ? (
                                <div className="mt-1 truncate text-xs text-white/45">{row.secondaryLabel}</div>
                              ) : null}
                            </div>
                            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.07] px-3 py-2 text-right">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Playoffs</div>
                              <div className="mt-1 text-lg font-black text-white">{formatPct(row.makePct)}</div>
                            </div>
                          </div>

                          <div className="mt-3">
                            <OddsBar value={clamp(row.makePct, 8, 100)} color={barColor} />
                          </div>

                          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                            <StatChip className="min-w-0" label="Champ" value={formatPct(row.champPct)} />
                            <StatChip className="min-w-0" label="Bye" value={results.byeSlots ? formatPct(row.byePct) : "No byes"} />
                            <StatChip className="min-w-0" label="Proj. Wins" value={row.avgWins.toFixed(1)} />
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/50">
                            <span>{formatSigned(row.winDelta)} from baseline</span>
                            <span>Avg seed {row.avgSeed ? row.avgSeed.toFixed(1) : "-"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden px-3 pb-3 pt-2 md:block sm:px-4">
                    <table className="w-full table-fixed text-xs lg:text-sm">
                      <thead>
                        <tr className="text-left text-white/45">
                          <th className="w-[34%] px-2 py-3 font-medium lg:px-3">Team</th>
                          <th className="w-[13%] px-2 py-3 font-medium lg:px-3">Wins</th>
                          <th className="w-[13%] px-2 py-3 font-medium lg:px-3">Playoffs</th>
                          <th className="w-[13%] px-2 py-3 font-medium lg:px-3">Bye</th>
                          <th className="w-[13%] px-2 py-3 font-medium lg:px-3">Champ</th>
                          <th className="w-[14%] px-2 py-3 font-medium lg:px-3">Avg Seed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.table.map((row, index) => {
                          const barColor = row.champPct >= 30 ? "rose" : row.makePct >= 65 ? "cyan" : "amber";
                          return (
                            <tr key={row.rid} className="border-t border-white/8 align-top transition hover:bg-white/[0.03]">
                              <td className="px-2 py-4 lg:px-3">
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 w-8 text-right text-lg font-black text-cyan-300/90">{index + 1}</div>
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-white">{row.primaryLabel}</div>
                                    {row.secondaryLabel ? (
                                      <div className="mt-1 truncate text-xs text-white/45">{row.secondaryLabel}</div>
                                    ) : null}
                                    <div className="mt-1 text-xs text-white/45">
                                      {row.makePct >= 80
                                        ? "Inside track"
                                        : row.makePct >= 50
                                        ? "Live in the race"
                                        : row.makePct >= 20
                                        ? "Needs a push"
                                        : "Long-shot lane"}
                                    </div>
                                    <div className="mt-2 text-xs text-white/55">
                                      Strength {Math.round(row.strength).toLocaleString()}
                                    </div>
                                    <div className="mt-2">
                                      <OddsBar value={clamp(row.makePct, 8, 100)} color={barColor} />
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-4 lg:px-3">
                                <div className="font-semibold text-white">{row.currentWins.toFixed(1)} observed</div>
                                <div className="mt-1 text-xs text-white/50">
                                  {row.avgWins.toFixed(1)} expected | {formatSigned(row.winDelta)}
                                </div>
                              </td>
                              <td className="px-2 py-4 lg:px-3">
                                <div className="font-semibold text-white">{formatPct(row.makePct)}</div>
                                <div className="mt-1 text-xs text-white/50">Make the bracket</div>
                              </td>
                              <td className="px-2 py-4 lg:px-3">
                                <div className="font-semibold text-white">{results.byeSlots ? formatPct(row.byePct) : "—"}</div>
                                <div className="mt-1 text-xs text-white/50">Skip round one</div>
                              </td>
                              <td className="px-2 py-4 lg:px-3">
                                <div className="font-semibold text-white">{formatPct(row.champPct)}</div>
                                <div className="mt-1 text-xs text-white/50">Win it all</div>
                              </td>
                              <td className="px-2 py-4 lg:px-3">
                                <div className="font-semibold text-white">{row.avgSeed ? row.avgSeed.toFixed(1) : "-"}</div>
                                <div className="mt-1 text-xs text-white/50">When they get in</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <SectionTitle subtitle="These teams have the cleanest championship paths right now.">
                Contender Ladder
              </SectionTitle>

              <div className="space-y-3">
                {sidebarLeaders.contenders.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/55">
                    Once the sim finishes, the title equity leaders will show up here.
                  </div>
                ) : (
                  sidebarLeaders.contenders.map((team, index) => (
                    <div key={`contender-${team.rid}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                            {index === 0 ? "Front-runner" : `Contender ${index + 1}`}
                          </div>
                          <div className="mt-1 font-semibold text-white">{team.primaryLabel}</div>
                          {team.secondaryLabel ? (
                            <div className="mt-1 text-xs text-white/45">{team.secondaryLabel}</div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-black text-cyan-200">{formatPct(team.champPct)}</div>
                          <div className="text-xs text-white/45">title equity</div>
                        </div>
                      </div>
                      <div className="mt-3">
                        <OddsBar value={team.champPct * 2.3} color="rose" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle subtitle="These are the teams living closest to the cutoff line.">
                Bubble Radar
              </SectionTitle>

              <div className="space-y-3">
                {sidebarLeaders.bubble.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/55">
                    If the race spreads out, there may not be a real bubble cluster to show.
                  </div>
                ) : (
                  sidebarLeaders.bubble.map((team) => (
                    <div key={`bubble-${team.rid}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{team.primaryLabel}</div>
                          {team.secondaryLabel ? (
                            <div className="mt-1 text-xs text-white/45">{team.secondaryLabel}</div>
                          ) : null}
                        </div>
                        <div className="text-sm font-semibold text-amber-100">{formatPct(team.makePct)}</div>
                      </div>
                      <div className="mt-3">
                        <OddsBar value={team.makePct} color="amber" />
                      </div>
                      <div className="mt-2 text-xs text-white/45">
                        Avg seed {team.avgSeed ? team.avgSeed.toFixed(1) : "-"} when they get in
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

