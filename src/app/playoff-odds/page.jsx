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

const PROJ_JSON_URL = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL = "/projections_cbs_2025.json";
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

function StatChip({ label, value, tone = "default" }) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-100"
      : tone === "amber"
      ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
      : tone === "rose"
      ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
      : "border-white/10 bg-white/5 text-white/80";

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
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

export default function PlayoffOddsPage() {
  const {
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

  const [sourceKey, setSourceKey] = useState("proj:ffa");
  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);
  const [metricMode, setMetricMode] = useState("projections");
  const [projectionSource, setProjectionSource] = useState("CSV");
  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  const [stateWeek, setStateWeek] = useState(1);
  const [stateSeason, setStateSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState({ by_team: {} });
  const [week, setWeek] = useState(1);
  const [toWeek, setToWeek] = useState(14);
  const [runs, setRuns] = useState(2500);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [schedCache, setSchedCache] = useState({});
  const [playoffLensOpen, setPlayoffLensOpen] = useState(true);
  const debTimer = useRef(null);
  const lastLeagueRef = useRef(null);

  const leagueSeason = Number(league?.season || 0) || stateSeason || new Date().getFullYear();
  const regularSeasonEnd = useMemo(() => {
    const playoffStart = Number(league?.settings?.playoff_week_start || 0);
    return playoffStart > 1 ? clamp(playoffStart - 1, 1, 18) : 14;
  }, [league?.settings?.playoff_week_start]);
  const latestObservedWeek = useMemo(() => {
    if (Number(league?.season || 0) !== Number(stateSeason || 0)) return regularSeasonEnd;
    return clamp((stateWeek || 1) - 1, 0, regularSeasonEnd);
  }, [league?.season, regularSeasonEnd, stateSeason, stateWeek]);
  const selectableObservedWeek = Math.max(1, latestObservedWeek);

  const handleSetFormat = (value) => {
    setUserTouchedFormat(true);
    setFormatLocal(value);
  };

  const handleSetQbType = (value) => {
    setUserTouchedQB(true);
    setQbLocal(value);
  };

  useEffect(() => {
    setMetricMode(metricModeFromSourceKey(sourceKey));
    setProjectionSource(projectionSourceFromKey(sourceKey));
  }, [sourceKey]);

  const [valueSource, setValueSource] = useState("FantasyCalc");
  useEffect(() => {
    setValueSource(valueSourceFromKey(sourceKey));
  }, [sourceKey]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjLoading(true);
      setProjError("");
      try {
        const [csv, espn, cbs] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
        ]);
        if (!mounted) return;
        const next = { CSV: null, ESPN: null, CBS: null };
        if (csv.status === "fulfilled") next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled") next.CBS = cbs.value;
        setProjMaps(next);

        if (!next.CSV && !next.ESPN && !next.CBS) {
          setProjError("Projection feeds are unavailable, so the model is using values.");
          setSourceKey("val:fantasycalc");
        } else if (projectionSource === "CBS" && !next.CBS) {
          setSourceKey(next.ESPN ? "proj:espn" : "proj:ffa");
        } else if (projectionSource === "ESPN" && !next.ESPN) {
          setSourceKey(next.CSV ? "proj:ffa" : "proj:cbs");
        } else if (projectionSource === "CSV" && !next.CSV) {
          setSourceKey(next.ESPN ? "proj:espn" : "proj:cbs");
        }
      } catch {
        if (!mounted) return;
        setProjError("Projection feeds are unavailable, so the model is using values.");
        setSourceKey("val:fantasycalc");
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
    if (!league?.league_id) return;
    const leagueChanged = lastLeagueRef.current !== league.league_id;
    lastLeagueRef.current = league.league_id;
    const observedThroughDefault = clamp(
      latestObservedWeek > 0 ? latestObservedWeek : 1,
      1,
      regularSeasonEnd
    );
    const start = leagueChanged ? 1 : clamp(week, 1, selectableObservedWeek);
    const end = leagueChanged
      ? Math.max(start, observedThroughDefault)
      : clamp(toWeek, start, selectableObservedWeek);

    setWeek(start);
    setToWeek(end);
    setSchedCache({});
  }, [league?.league_id, league?.settings?.leg, latestObservedWeek, regularSeasonEnd, selectableObservedWeek, toWeek, week]);

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
      const chosen = projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projMaps.CSV;
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
      const observedEndWeek = clamp(toWeek, 0, latestObservedWeek);
      const observedStartWeek =
        observedEndWeek > 0 ? clamp(week, 1, Math.max(1, observedEndWeek)) : 1;
      const observedWeeks = [];
      for (let current = observedStartWeek; current <= observedEndWeek; current += 1) observedWeeks.push(current);

      const futureWeeks = [];
      for (let current = observedEndWeek + 1; current <= regularSeasonEnd; current += 1) futureWeeks.push(current);

      const observedScheduleRows = await Promise.all(observedWeeks.map(loadWeek));
      const futureScheduleRows = await Promise.all(futureWeeks.map(loadWeek));
      const playoffSlots = Math.max(2, Number(league?.settings?.playoff_teams || 6));
      const byeSlots = playoffSlots >= 6 ? 2 : playoffSlots >= 4 ? 1 : 0;
      const baseWins = Object.fromEntries(rosters.map((roster) => [roster.roster_id, 0]));
      const basePointsFor = Object.fromEntries(rosters.map((roster) => [roster.roster_id, 0]));

      observedScheduleRows.forEach((schedule) => {
        schedule.groups.forEach((group) => {
          if (group.length === 2) {
            const [teamA, teamB] = group;
            if (!isObservedMatchupUsable(teamA, teamB)) return;
            const scoreA = getObservedScore(teamA);
            const scoreB = getObservedScore(teamB);
            basePointsFor[teamA.roster_id] += scoreA;
            basePointsFor[teamB.roster_id] += scoreB;
            if (scoreA > scoreB) baseWins[teamA.roster_id] += 1;
            else if (scoreB > scoreA) baseWins[teamB.roster_id] += 1;
            else {
              baseWins[teamA.roster_id] += 0.5;
              baseWins[teamB.roster_id] += 0.5;
            }
          } else if (group.length === 1) {
            const soloRid = group[0].roster_id;
            const score = getObservedScore(group[0]);
            if (score != null) basePointsFor[soloRid] += score;
          }
        });
      });

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
            : teamStrength({ roster: rosterById[rid], players, getMetricWeekly, slots, week, byeMap }),
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

      for (let run = 0; run < runs; run += 1) {
        const wins = { ...baseWins };
        const pointsFor = { ...basePointsFor };

        futureWeeks.forEach((currentWeek, index) => {
          const schedule = futureScheduleRows[index] || { groups: [], hasRealMatchups: false };
          const strengthMap = strengthsByWeek[currentWeek] || {};

          if (schedule.hasRealMatchups) {
            schedule.groups.forEach((group) => {
              if (group.length === 2) {
                const [teamA, teamB] = group;
                const sim = simulateMatchup(teamA.roster_id, teamB.roster_id, strengthMap);
                wins[sim.winner] += 1;
                pointsFor[teamA.roster_id] += sim.scoreA;
                pointsFor[teamB.roster_id] += sim.scoreB;
              } else if (group.length === 1) {
                const soloRid = group[0].roster_id;
                pointsFor[soloRid] += samplePerformanceScore(strengthMap[soloRid] || 0);
              }
            });
            return;
          }

          const leagueAverage =
            ridList.reduce((sum, rid) => sum + (strengthMap[rid] || 0), 0) / Math.max(1, ridList.length);
          ridList.forEach((rid) => {
            const score = samplePerformanceScore(strengthMap[rid] || 0);
            const oppScore = samplePerformanceScore(leagueAverage);
            pointsFor[rid] += score;
            if (score >= oppScore) wins[rid] += 1;
          });
        });

        const ranked = [...ridList].sort((a, b) => {
          const winGap = (wins[b] || 0) - (wins[a] || 0);
          if (winGap !== 0) return winGap;
          const pointGap = (pointsFor[b] || 0) - (pointsFor[a] || 0);
          if (pointGap !== 0) return pointGap;
          return (averageStrengthByRoster[b] || 0) - (averageStrengthByRoster[a] || 0);
        });

        const playoffTeams = ranked.slice(0, playoffSlots);
        playoffTeams.forEach((rid, index) => {
          makes[rid] += 1;
          totalSeeds[rid] += index + 1;
        });
        ranked.slice(0, byeSlots).forEach((rid) => {
          byes[rid] += 1;
        });
        ridList.forEach((rid) => {
          totalWins[rid] += wins[rid] || 0;
        });

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
    week,
    toWeek,
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
  ]);

  const weekOptions = useMemo(() => {
    const arr = [];
    for (let current = 1; current <= selectableObservedWeek; current += 1) arr.push(current);
    return arr;
  }, [selectableObservedWeek]);

  const currentSourceLabel = useMemo(() => {
    const found = DEFAULT_SOURCES.find((item) => item.key === sourceKey);
    return found?.label || "Selected Source";
  }, [sourceKey]);

  const resultSummary = useMemo(() => {
    if (!results?.table?.length) return null;
    const favorite = [...results.table].sort((a, b) => b.champPct - a.champPct)[0];
    const surge = [...results.table].sort((a, b) => b.winDelta - a.winDelta)[0];
    const bubble = [...results.table]
      .filter((team) => team.makePct > 10 && team.makePct < 90)
      .sort((a, b) => Math.abs(a.makePct - 50) - Math.abs(b.makePct - 50))[0];
    return { favorite, surge, bubble };
  }, [results]);

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
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_340px]">
          <div className="space-y-6">
            <Card className="p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/40">Playoff Lens</div>
                  <div className="mt-2 text-2xl font-black tracking-tight text-white sm:text-[2rem]">
                    Shape the model before you trust the odds
                  </div>
                  <div className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                    Same cleaner source selector pattern as the rest of the preview, but with a sturdier playoff engine underneath it.
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <StatChip label="Active Lens" value={metricMode === "projections" ? "Projections" : "Values"} tone={metricMode === "projections" ? "cyan" : "amber"} />
                  <StatChip label="Source" value={currentSourceLabel} tone="default" />
                  <button
                    type="button"
                    onClick={() => setPlayoffLensOpen((open) => !open)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10"
                    aria-expanded={playoffLensOpen}
                    aria-controls="playoff-lens-panel"
                  >
                    {playoffLensOpen ? "Collapse" : "Expand"}
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

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/50">
                    <span>{sourceHelperCopy}</span>
                    {projError ? (
                      <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-amber-100">
                        {projError}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-[26px] border border-white/10 bg-gradient-to-br from-cyan-500/10 via-slate-950/90 to-slate-950 p-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">Simulation Window</div>
                        <div className="mt-1 text-sm text-white/60">
                          Forecast the remaining stretch from the observed results window you choose.
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
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
                        ? `Observed results are available through Week ${latestObservedWeek}. Later weeks stay in the simulation bucket.`
                        : `This league season is complete through Week ${regularSeasonEnd}, so any observed window in the regular season is fair game.`}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-xs text-white/50">Observed From</label>
                        <select
                          className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/30"
                          value={week}
                          onChange={(e) => {
                            const next = clamp(Number(e.target.value) || 1, 1, selectableObservedWeek);
                            setWeek(next);
                            if (toWeek < next) setToWeek(next);
                          }}
                        >
                          {weekOptions.map((current) => (
                            <option key={`start-${current}`} value={current}>
                              Week {current}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs text-white/50">Observed Through</label>
                        <select
                          className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/30"
                          value={toWeek}
                          onChange={(e) => setToWeek(clamp(Number(e.target.value) || selectableObservedWeek, week, selectableObservedWeek))}
                        >
                          {weekOptions.filter((current) => current >= week).map((current) => (
                            <option key={`end-${current}`} value={current}>
                              Week {current}
                            </option>
                          ))}
                        </select>
                      </div>

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
                  </div>
                </div>
              ) : null}
            </Card>

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
                <div className="grid gap-4 lg:grid-cols-3">
                  <InsightCard
                    eyebrow="Title Favorite"
                    title={resultSummary?.favorite ? `${resultSummary.favorite.summaryLabel} | ${formatPct(resultSummary.favorite.champPct)}` : "Waiting for a favorite"}
                    body={
                      resultSummary?.favorite
                        ? `The strongest path to a championship right now, with ${formatPct(resultSummary.favorite.makePct)} playoff odds and ${formatPct(resultSummary.favorite.byePct)} bye odds.`
                        : "Once the sim finishes, the cleanest championship path lands here."
                    }
                    tone="cyan"
                  />

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
                      <div className="flex flex-wrap gap-2">
                        <StatChip label="Mode" value={simulationModeLabel} />
                        <StatChip label="Runs" value={results.totalRuns.toLocaleString()} />
                        <StatChip
                          label="Observed"
                          value={
                            results.observedWeeks.length
                              ? `W${results.observedWeeks[0]}-W${results.observedWeeks[results.observedWeeks.length - 1]}`
                              : "None"
                          }
                        />
                        <StatChip
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

                  <div className="overflow-x-auto px-3 pb-3 pt-2 sm:px-4">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="text-left text-white/45">
                          <th className="px-3 py-3 font-medium">Team</th>
                          <th className="px-3 py-3 font-medium">Strength</th>
                          <th className="px-3 py-3 font-medium">Wins</th>
                          <th className="px-3 py-3 font-medium">Playoffs</th>
                          <th className="px-3 py-3 font-medium">Bye</th>
                          <th className="px-3 py-3 font-medium">Champ</th>
                          <th className="px-3 py-3 font-medium">Avg Seed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.table.map((row, index) => {
                          const barColor = row.champPct >= 30 ? "rose" : row.makePct >= 65 ? "cyan" : "amber";
                          return (
                            <tr key={row.rid} className="border-t border-white/8 align-top transition hover:bg-white/[0.03]">
                              <td className="px-3 py-4">
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
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-4">
                                <div className="font-semibold text-white">{Math.round(row.strength).toLocaleString()}</div>
                                <div className="mt-2">
                                  <OddsBar value={clamp(row.makePct, 8, 100)} color={barColor} />
                                </div>
                              </td>
                              <td className="px-3 py-4">
                                <div className="font-semibold text-white">{row.currentWins.toFixed(1)} observed</div>
                                <div className="mt-1 text-xs text-white/50">
                                  {row.avgWins.toFixed(1)} expected | {formatSigned(row.winDelta)}
                                </div>
                              </td>
                              <td className="px-3 py-4">
                                <div className="font-semibold text-white">{formatPct(row.makePct)}</div>
                                <div className="mt-1 text-xs text-white/50">Make the bracket</div>
                              </td>
                              <td className="px-3 py-4">
                                <div className="font-semibold text-white">{formatPct(row.byePct)}</div>
                                <div className="mt-1 text-xs text-white/50">Skip round one</div>
                              </td>
                              <td className="px-3 py-4">
                                <div className="font-semibold text-white">{formatPct(row.champPct)}</div>
                                <div className="mt-1 text-xs text-white/50">Win it all</div>
                              </td>
                              <td className="px-3 py-4">
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
              <SectionTitle subtitle="Keep the active league and season framing pinned beside the race board.">
                League Context
              </SectionTitle>

              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">League</div>
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/30"
                    value={activeLeague || ""}
                    onChange={(e) => {
                      const leagueId = e.target.value;
                      setActiveLeague(leagueId);
                      if (leagueId) fetchLeagueRostersSilent(leagueId).catch(() => {});
                      setUserTouchedFormat(false);
                      setUserTouchedQB(false);
                    }}
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
                      : `W${week} to W${Math.min(toWeek, latestObservedWeek)}`
                  }
                />
                <StatChip
                  label="Schedule Mode"
                  value={results ? simulationModeLabel : "Waiting"}
                  tone={results?.scheduleMode === "synthetic" ? "amber" : results?.scheduleMode === "league" ? "cyan" : "default"}
                />
              </div>
            </Card>

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

