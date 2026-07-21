"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";
import FormatQBToggles from "../../components/FormatQBToggles";
import { makeGetPlayerValue } from "../../lib/values";
import { PROJ_CBS_JSON_URL, PROJ_ESPN_JSON_URL, PROJ_JSON_URL } from "../../lib/projectionSeason";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

/* ---------- Projections setup ---------- */
const REG_SEASON_WEEKS   = 17;

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
  const map = { JAX:"JAC", LA:"LAR", STL:"LAR", SD:"LAC", OAK:"LV", WFT:"WAS", WSH:"WAS" };
  return map[s] || s;
}
function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}
function buildProjectionMapFromJSON(json) {
  const rows = Array.isArray(json) ? json : (json?.rows || []);
  const byId = Object.create(null);
  const byName = Object.create(null);
  const byNameTeam = Object.create(null);
  const byNamePos = Object.create(null);

  rows.forEach((r) => {
    const pid = r.player_id != null ? String(r.player_id) : "";
    const name = r.name || r.player || r.full_name || "";
    const seasonPts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;

    const rawTeam = r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team;
    const team = normalizeTeamAbbr(rawTeam);
    const rawPos = r.pos ?? r.position ?? r.player_position;
    const pos = normalizePos(rawPos);

    if (pid) byId[pid] = seasonPts;
    if (name) {
      const nn = normNameForMap(name);
      byName[nn] = seasonPts;
      byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;
      if (team) byNameTeam[`${nn}|${team}`] = seasonPts;
      if (pos)  byNamePos[`${nn}|${pos}`]   = seasonPts;
    }
  });

  return { byId, byName, byNameTeam, byNamePos };
}
async function fetchProjectionMap(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  return buildProjectionMapFromJSON(json);
}
function getSeasonPointsForPlayer(map, p) {
  if (!map || !p) return 0;
  const hit = map.byId?.[String(p.player_id)];
  if (hit != null) return hit;

  const nn   = normNameForMap(p.full_name || p.search_full_name || `${p.first_name||""} ${p.last_name||""}`);
  const team = normalizeTeamAbbr(p.team);
  const pos  = normalizePos(p.position);

  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos  && map.byNamePos?.[`${nn}|${pos}`]   != null) return map.byNamePos[`${nn}|${pos}`];
  if (team || pos) return 0;
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const k2 = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return (k2 && map.byName?.[k2] != null) ? map.byName[k2] : 0;
}

/* ---------- UI bits ---------- */
function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-white/10 bg-gray-900 ${className}`}>{children}</div>;
}
function SectionTitle({ children, subtitle }) {
  return (
    <div className="mt-8 mb-3">
      <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight">{children}</h2>
      {subtitle ? <div className="text-xs sm:text-sm opacity-70 mt-1">{subtitle}</div> : null}
    </div>
  );
}

/* ---------- Roster slots ---------- */
function parseLeagueSlots(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  const strict = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const flexGroups = [];
  const mapToken = (t) => (t === "W" ? "WR" : t === "R" ? "RB" : t === "T" ? "TE" : t === "Q" ? "QB" : t);

  rp.forEach((tok) => {
    if (["BN", "IR", "TAXI"].includes(tok)) return;
    if (["QB", "RB", "WR", "TE", "K", "DEF", "DST"].includes(tok)) {
      strict[tok === "DST" ? "DEF" : tok] += 1;
      return;
    }
    if (tok === "FLEX") flexGroups.push(["RB", "WR", "TE"]);
    else if (tok === "SUPER_FLEX" || tok === "SUPERFLEX" || tok === "Q/W/R/T") flexGroups.push(["QB", "RB", "WR", "TE"]);
    else if (tok.includes("/")) {
      const set = Array.from(new Set(tok.split("/").map(mapToken).filter((p) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(p))));
      if (set.length) flexGroups.push(set);
    }
  });

  return { strict, flexGroups };
}

/* ---------- Helpers ---------- */
function inferQbTypeFromLeague(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  return rp.includes("SUPER_FLEX") || rp.includes("SUPERFLEX") || rp.includes("Q/W/R/T") ? "sf" : "1qb";
}
function inferFormatFromLeague(league) {
  const name = String(league?.name || "").toLowerCase();
  return name.includes("dynasty") || name.includes("keeper") || !!league?.previous_league_id ? "dynasty" : "redraft";
}

/* ---------- Optimal lineup (bye-aware) ---------- */
function solveOptimalLineup({ roster, players, getWeeklyMetric, getMarketValue, slots, week, byeMap, weatherMap = {}, strategy = "median" }) {
  if (!roster) return { starters: [], bench: [], score: 0, floorScore: 0, ceilingScore: 0 };
  const ids = [...new Set([...(roster.starters || []), ...(roster.players || [])].filter(Boolean))];
  const qbTeams = new Set(ids.map((pid) => players?.[pid]).filter((p) => normalizePos(p?.position) === "QB" && p?.team).map((p) => normalizeTeamAbbr(p.team)));
  const volatilityByPos = { QB: 0.17, RB: 0.27, WR: 0.31, TE: 0.3, K: 0.34, DEF: 0.34 };

  const candidates = ids
    .map((pid) => {
      const p = players?.[pid];
      if (!p) return null;
      const pos = String(p?.position || "").toUpperCase();
      const team = (p?.team || "").toUpperCase();
      const byeWeeks = byeMap?.by_team?.[team] || [];
      const isOnBye = Array.isArray(byeWeeks) && byeWeeks.includes(week);
      const median = isOnBye ? 0 : (getWeeklyMetric(p) || 0);
      const injury = String(p?.injury_status || "").toUpperCase();
      const injuryPenalty = injury === "OUT" || injury === "IR" ? 0.55 : injury === "DOUBTFUL" ? 0.3 : injury === "QUESTIONABLE" ? 0.14 : 0;
      const weather = weatherMap?.[team] || null;
      const weatherText = String(weather?.summary || "").toLowerCase();
      const weatherPenalty = /snow|rain|storm|wind/.test(weatherText) ? 0.08 : 0;
      const volatility = Math.min(0.65, (volatilityByPos[pos === "DST" ? "DEF" : pos] || 0.25) + injuryPenalty + weatherPenalty);
      const floor = Math.max(0, median * (1 - volatility));
      const ceiling = median * (1 + volatility);
      const stackBonus = strategy === "aggressive" && ["WR", "TE", "RB"].includes(pos) && qbTeams.has(team) ? median * 0.05 : 0;
      const selectionScore = strategy === "safe" ? floor : strategy === "aggressive" ? ceiling + stackBonus : median;
      return {
        pid,
        name: p?.full_name || p?.search_full_name || pid,
        pos: pos === "DST" ? "DEF" : pos,
        team,
        proj: median,
        floor,
        ceiling,
        selectionScore,
        marketValue: getMarketValue?.(p) || 0,
        injury,
        isOnBye,
        stackBonus,
        weather,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.selectionScore || 0) - (a.selectionScore || 0));

  const starters = [];
  const used = new Set();
  const takeBestFor = (eligible, count) => {
    let taken = 0;
    for (const c of candidates) {
      if (taken >= count) break;
      if (used.has(c.pid)) continue;
      if (eligible.includes(c.pos)) {
        used.add(c.pid);
        starters.push(c);
        taken++;
      }
    }
  };

  takeBestFor(["QB"],  slots.strict.QB);
  takeBestFor(["RB"],  slots.strict.RB);
  takeBestFor(["WR"],  slots.strict.WR);
  takeBestFor(["TE"],  slots.strict.TE);
  takeBestFor(["K"],   slots.strict.K);
  takeBestFor(["DEF"], slots.strict.DEF);
  (slots.flexGroups || []).forEach((g) => takeBestFor(g, 1));

  const bench = candidates.filter((c) => !used.has(c.pid));
  const score = starters.reduce((s, x) => s + (x.proj || 0), 0);
  const floorScore = starters.reduce((s, x) => s + (x.floor || 0), 0);
  const ceilingScore = starters.reduce((s, x) => s + (x.ceiling || 0) + (strategy === "aggressive" ? x.stackBonus || 0 : 0), 0);
  return { starters, bench, score, floorScore, ceilingScore, strategy };
}

function winProbability(scoreA, scoreB) {
  return 100 / (1 + Math.exp(-(Number(scoreA || 0) - Number(scoreB || 0)) / 12));
}

function buildDecisionRows(result, opponentScore, metricMode) {
  if (!result) return [];
  return result.starters.map((starter) => {
    const alternative = result.bench.filter((player) => player.pos === starter.pos && player.proj > 0).sort((a, b) => b.selectionScore - a.selectionScore)[0];
    if (!alternative) return null;
    const projectionGap = starter.proj - alternative.proj;
    const currentWin = winProbability(result.score, opponentScore);
    const swappedWin = winProbability(result.score - starter.proj + alternative.proj, opponentScore);
    const winImpact = metricMode === "projections" ? currentWin - swappedWin : null;
    const reasons = [];
    if (result.strategy === "safe") reasons.push(`${starter.name} has the stronger modeled floor (${starter.floor.toFixed(1)} vs ${alternative.floor.toFixed(1)}).`);
    else if (result.strategy === "aggressive") reasons.push(`${starter.name} offers the higher modeled ceiling (${starter.ceiling.toFixed(1)} vs ${alternative.ceiling.toFixed(1)}).`);
    else reasons.push(`${starter.name} leads the median projection by ${Math.abs(projectionGap).toFixed(1)}.`);
    if (starter.stackBonus > 0) reasons.push(`The ${starter.team} pairing adds quarterback/pass-catcher correlation for an aggressive build.`);
    if (starter.injury) reasons.push(`${starter.name} carries a ${starter.injury} tag, widening the uncertainty range.`);
    else if (alternative.injury) reasons.push(`${alternative.name} is discounted by a ${alternative.injury} tag.`);
    if (starter.weather?.summary) reasons.push(`${starter.team} weather: ${starter.weather.summary}${starter.weather.temperature != null ? `, ${starter.weather.temperature}°` : ""}.`);
    const marketGap = starter.marketValue - alternative.marketValue;
    if (Math.abs(marketGap) > Math.max(100, Math.abs(starter.marketValue + alternative.marketValue) * 0.05)) {
      reasons.push(marketGap >= 0 ? `Market value also prefers ${starter.name}.` : `Market value prefers ${alternative.name}, but this week’s lineup model prefers ${starter.name}.`);
    }
    return { starter, alternative, projectionGap, winImpact, reasons: reasons.slice(0, 3) };
  }).filter(Boolean).sort((a, b) => Math.abs(a.projectionGap) - Math.abs(b.projectionGap)).slice(0, 8);
}

/* ---------- Close-alternative suggestions (projections only) ---------- */
function findCloseAlternatives(starters, bench, { windowAbs = 2.0, max = 2 } = {}) {
  // Only suggest same-position bench players with >0 and within ±2.0 of the starter.
  const out = {};
  starters.forEach((s) => {
    if (!s || s.proj <= 0) return; // never suggest against a zero/negative base
    const cands = bench
      .filter((b) => b.pos === s.pos && b.proj > 0)
      .map((b) => ({ ...b, delta: b.proj - s.proj }))
      .filter((x) => Math.abs(x.delta) <= windowAbs)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))
      .slice(0, max);
    if (cands.length) out[s.pid] = cands;
  });
  return out;
}

/* ---------- Find opponent & H2H week ---------- */
async function findOpponentForWeek(leagueId, week, myRosterId) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
  if (!res.ok) return null;
  const data = await res.json();
  const myRow = data.find((r) => r.roster_id === myRosterId);
  if (!myRow || !myRow.matchup_id) return null;
  const opp = data.find((r) => r.matchup_id === myRow.matchup_id && r.roster_id !== myRosterId);
  return opp?.roster_id ?? null;
}
async function findWeekForHeadToHead(leagueId, myRosterId, oppRosterId, weekMin = 1, weekMax = 18) {
  const weeks = Array.from({ length: Math.max(0, weekMax - weekMin + 1) }, (_, i) => weekMin + i);
  const matches = await Promise.all(weeks.map(async (w) => {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`);
      if (!res.ok) return null;
      const data = await res.json();
      const mine = data.find((r) => r.roster_id === myRosterId);
      if (!mine?.matchup_id) return null;
      const hit = data.find((r) => r.matchup_id === mine.matchup_id && r.roster_id === oppRosterId);
      return hit ? w : null;
    } catch {
      return null;
    }
  }));
  return matches.find((w) => w != null) ?? null;
}

/* ===================== PAGE ===================== */
export default function LineupTool() {
  const {
    username,
    players,
    leagues,
    activeLeague,
    setActiveLeague,
    format,
    qbType,
    fetchLeagueRostersSilent,
  } = useSleeper();

  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);
  const [sourceKey, setSourceKey] = useState("val:thefantasyarsenal");

  const [metricMode, setMetricMode] = useState("projections"); // projections | values
  const [projectionSource, setProjectionSource] = useState("CSV"); // CSV | ESPN | CBS
  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");

  const [valueSource, setValueSource] = useState("TheFantasyArsenal");

  useEffect(() => {
    setMetricMode(metricModeFromSourceKey(sourceKey));
    setProjectionSource(projectionSourceFromKey(sourceKey));
    setValueSource(valueSourceFromKey(sourceKey));
  }, [sourceKey]);

  const [week, setWeek] = useState(1);
  const [season, setSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState({ by_team: {} });
  const [byeDataAvailable, setByeDataAvailable] = useState(false);
  const [stateLoading, setStateLoading] = useState(false);
  const [lineupStrategy, setLineupStrategy] = useState("median");
  const [weatherMap, setWeatherMap] = useState({});

  const [ownerA, setOwnerA] = useState("");
  const [ownerB, setOwnerB] = useState("");
  const [myUserId, setMyUserId] = useState(null);

  // load my Sleeper user_id for auto Owner A
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!username) return;
      try {
        const res = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!res.ok) return;
        const u = await res.json();
        if (mounted) setMyUserId(u?.user_id || null);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [username]);

  const league = useMemo(() => (leagues || []).find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);
  const allRosters = league?.rosters || [];
  const allUsers = league?.users || [];
  const rosters = useMemo(() => allRosters.filter((r) => (r.players || []).length > 0), [allRosters]);
  const users = useMemo(() => {
    const byOwner = new Set(rosters.map((r) => r.owner_id));
    return (allUsers || []).filter((u) => byOwner.has(u.user_id));
  }, [allUsers, rosters]);

  // roster lookups
  const rosterByOwnerId = useMemo(() => {
    const map = {};
    rosters.forEach((r) => { map[r.owner_id] = r; });
    return map;
  }, [rosters]);
  const rosterByRosterId = useMemo(() => {
    const map = {};
    rosters.forEach((r) => { map[r.roster_id] = r; });
    return map;
  }, [rosters]);

  const slots = useMemo(() => parseLeagueSlots(league), [league]);

  const ownerLabel = (uid) => {
    const u = users.find((x) => x.user_id === uid);
    const r = rosterByOwnerId[uid];
    const tn = u?.metadata?.team_name;
    return tn || u?.display_name || u?.username || (r ? `Roster ${r.roster_id}` : uid);
  };

  // projections load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjError("");
      setProjLoading(true);
      try {
        const [csv, espn, cbs] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
        ]);
        if (!mounted) return;
        const next = { CSV: null, ESPN: null, CBS: null };
        if (csv.status === "fulfilled")  next.CSV  = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled")  next.CBS  = cbs.value;
        setProjMaps(next);

        if (metricMode === "projections" && !next.CSV && !next.ESPN && !next.CBS) {
          setProjError("No projections available — using Values.");
          setSourceKey("val:thefantasyarsenal");
        } else {
          if (projectionSource === "CBS"  && !next.CBS)  setSourceKey(next.ESPN ? "proj:espn" : "proj:ffa");
          if (projectionSource === "ESPN" && !next.ESPN) setSourceKey(next.CSV ? "proj:ffa" : "proj:cbs");
          if (projectionSource === "CSV"  && !next.CSV)  setSourceKey(next.ESPN ? "proj:espn" : "proj:cbs");
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable — using Values.");
        setSourceKey("val:thefantasyarsenal");
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&year=${season}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        const next = {};
        (data.events || []).forEach((event) => {
          const competition = event?.competitions?.[0];
          const weather = competition?.weather;
          if (!weather) return;
          const payload = { summary: weather.displayValue || weather.conditionId || "Weather watch", temperature: weather.temperature ?? null };
          (competition.competitors || []).forEach((competitor) => {
            const team = normalizeTeamAbbr(competitor?.team?.abbreviation);
            if (team) next[team] = payload;
          });
        });
        setWeatherMap(next);
      })
      .catch(() => { if (mounted) setWeatherMap({}); });
    return () => { mounted = false; };
  }, [season, week]);

  // auto-infer scoring on league change
  useEffect(() => {
    if (!league) return;
    setOwnerB(""); // reset opponent when switching leagues
    if (!myUserId) return;
    if (rosterByOwnerId[myUserId]) setOwnerA(myUserId);
    if (!formatLocal || !qbLocal) {
      setFormatLocal(inferFormatFromLeague(league));
      setQbLocal(inferQbTypeFromLeague(league));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, myUserId]);

  // NFL state + bye map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStateLoading(true);
        const res = await fetch("https://api.sleeper.app/v1/state/nfl");
        const data = await res.json();
        if (mounted) {
          if (data?.week)   setWeek(data.week);
          if (data?.season) setSeason(Number(data.season));
        }
        const byeRes = await fetch(`/byes/${data?.season || new Date().getFullYear()}.json`);
        if (mounted) {
          if (byeRes.ok) {
            setByeMap(await byeRes.json());
            setByeDataAvailable(true);
          } else {
            setByeMap({ by_team: {} });
            setByeDataAvailable(false);
          }
        }
      } catch {
        if (mounted) {
          setByeMap({ by_team: {} });
          setByeDataAvailable(false);
        }
      } finally {
        if (mounted) setStateLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ensure league data
  useEffect(() => {
    if (activeLeague && (!league?.rosters || !league?.users)) {
      fetchLeagueRostersSilent(activeLeague).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague]);

  /* ----- Metric functions ----- */
  const getValueMetric = useMemo(
    () => makeGetPlayerValue(valueSource, formatLocal, qbLocal),
    [valueSource, formatLocal, qbLocal]
  );

  const getWeeklyProj = useMemo(() => {
    if (metricMode !== "projections") return null;
    const chosen =
      projectionSource === "ESPN" ? projMaps.ESPN :
      projectionSource === "CBS"  ? projMaps.CBS  :
      projMaps.CSV;
    if (!chosen) return null;

    return (p) => {
      const seasonPts = getSeasonPointsForPlayer(chosen, p);
      const team = (p?.team || "").toUpperCase();
      const byeWeeks = Array.isArray(byeMap?.by_team?.[team]) ? byeMap.by_team[team] : [];
      const games = Math.max(1, REG_SEASON_WEEKS - byeWeeks.length);
      return seasonPts / games;
    };
  }, [metricMode, projectionSource, projMaps, byeMap]);

  const getWeeklyMetric = useMemo(() => {
    if (metricMode === "projections") return getWeeklyProj ? getWeeklyProj : (() => 0);
    return (p) => getValueMetric(p) || 0;
  }, [metricMode, getWeeklyProj, getValueMetric]);

  const compute = (uid) =>
    solveOptimalLineup({
      roster: rosterByOwnerId[uid],
      players,
      getWeeklyMetric,
      getMarketValue: getValueMetric,
      slots,
      week,
      byeMap,
      weatherMap,
      strategy: lineupStrategy,
    });

  /* ----- Auto-select opponent when week changes (and on init) ----- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeLeague || !ownerA || !rosterByOwnerId[ownerA]) return;
      const myRid = rosterByOwnerId[ownerA].roster_id;
      try {
        const oppRid = await findOpponentForWeek(activeLeague, week, myRid);
        if (cancelled) return;
        if (oppRid) {
          const oppOwner = rosterByRosterId[oppRid]?.owner_id || "";
          if (oppOwner) setOwnerB(oppOwner);
          else setOwnerB("");
        } else {
          // fallback: strongest other team this week
          const others = users.map((u) => u.user_id).filter((uid) => uid !== ownerA);
          let best = null;
          others.forEach((uid) => {
            const s = compute(uid)?.score || 0;
            if (!best || s > best.score) best = { uid, score: s };
          });
          setOwnerB(best?.uid || "");
        }
      } catch {
        setOwnerB("");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, ownerA, week, users, metricMode, projectionSource, valueSource, formatLocal, qbLocal, byeMap]);

  /* ----- If user manually picks Owner B, jump to their H2H week (if exists) ----- */
  const onChangeOwnerB = async (uid) => {
    setOwnerB(uid);
    if (!activeLeague || !ownerA || !uid) return;
    const myRid = rosterByOwnerId[ownerA]?.roster_id;
    const oppRid = rosterByOwnerId[uid]?.roster_id;
    if (!myRid || !oppRid) return;
    const w = await findWeekForHeadToHead(activeLeague, myRid, oppRid, 1, 18);
    if (w) setWeek(w);
  };

  const matchup = useMemo(() => {
    if (!ownerA || !ownerB) return null;
    const a = compute(ownerA);
    const b = compute(ownerB);
    return { a, b, delta: a.score - b.score };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerA, ownerB, players, valueSource, formatLocal, qbLocal, rosters, slots, week, byeMap, weatherMap, metricMode, projectionSource, projLoading, lineupStrategy]);

  const decisionRows = useMemo(
    () => buildDecisionRows(matchup?.a, matchup?.b?.score || 0, metricMode),
    [matchup, metricMode]
  );

  const metricLabel = metricMode === "projections" ? "Proj" : "Value";

  return (
    <>
      <div aria-hidden className="h-[35px]" />
      <Navbar pageTitle="Lineup — Start/Sit + Matchup" />
      <BackgroundParticles />
      {stateLoading && <LoadingScreen text="Loading league & NFL week…" />}

      <div aria-hidden className="h-[50px]" />
      <div className="max-w-7xl mx-auto px-4 pb-10">
        {!username ? (
          <div className="text-center text-gray-400 mt-10">
            Please log in on the <a className="text-blue-400 underline" href="/">homepage</a>.
          </div>
        ) : (
          <>
            <Card className="p-4">
              <div className="mb-4 flex flex-col gap-1 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Weekly Setup</div>
                  <div className="mt-1 text-sm text-white/65">
                    Lock the league, choose the scoring lens, and preview the best lineup for that week.
                  </div>
                </div>
                <div className="text-xs text-white/45">
                  {metricMode === "projections"
                    ? `Projection-based lineup strength ${byeDataAvailable ? "with bye adjustments" : "without bye adjustments yet"}`
                    : `${byeDataAvailable ? "Value-based lineup strength using your selected market with bye adjustments" : "Value-based lineup strength using your selected market, without bye adjustments yet"}`}
                </div>
              </div>

              <details className="premium-disclosure mb-4">
                <summary>Model Settings <span className="ml-auto text-xs font-normal text-white/45">{metricMode === "projections" ? "Projections" : "Values"}</span></summary>
              <div className="mt-3 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-950 p-3">
                <SourceSelector
                  sources={DEFAULT_SOURCES}
                  value={sourceKey}
                  onChange={setSourceKey}
                  className="w-full"
                  mode={formatLocal}
                  qbType={qbLocal}
                  onModeChange={(v) => { setUserTouchedFormat(true); setFormatLocal(v); }}
                  onQbTypeChange={(v) => { setUserTouchedQB(true); setQbLocal(v); }}
                  layout="inline"
                />
                {!byeDataAvailable ? (
                  <div className="mt-2 text-xs text-amber-200/80">
                    Bye weeks are not available yet for this season, so the lineup tool is running without bye penalties for now.
                  </div>
                ) : null}
              </div>
              </details>

              <div className="flex flex-wrap items-end gap-4">
                <span className="font-semibold">League:</span>
                <select
                  className="rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
                  value={activeLeague || ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    setActiveLeague(id);
                    if (id) fetchLeagueRostersSilent(id).catch(() => {});
                    setOwnerA("");
                    setOwnerB("");
                    setUserTouchedFormat(false);
                    setUserTouchedQB(false);
                  }}
                >
                  <option value="">Choose a League</option>
                  {(leagues || []).map((lg) => (
                    <option key={lg.league_id} value={lg.league_id}>
                      {lg.name}
                    </option>
                  ))}
                </select>

                {false && (
                  <>
                {/* Metric switch */}
                  <span className="font-semibold ml-4">Metric:</span>
                  <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
                    <button
                      className={`px-3 py-1 ${metricMode === "projections" ? "bg-white/10" : "hover:bg-white/5"}`}
                      onClick={() => setMetricMode("projections")}
                      disabled={!!projError || projLoading || (!projMaps.CSV && !projMaps.ESPN && !projMaps.CBS)}
                      title={projError || ""}
                    >
                      Projections{projLoading ? "…" : ""}
                    </button>
                    <button
                      className={`px-3 py-1 ${metricMode === "values" ? "bg-white/10" : "hover:bg-white/5"}`}
                      onClick={() => setMetricMode("values")}
                    >
                      Values
                    </button>
                  </div>

                  {/* --- SHOW ONLY WHEN IN PROJECTIONS MODE --- */}
                  {metricMode === "projections" && (
                    <>
                      <span className="font-semibold ml-2">Proj Source:</span>
                      <select
                        className="bg-gray-800 text-white p-2 rounded"
                        value={projectionSource}
                        onChange={(e) => setProjectionSource(e.target.value)}
                        disabled={projLoading}
                      >
                        {projMaps.CSV  && <option value="CSV">Fantasy Football Analytics</option>}
                        {projMaps.ESPN && <option value="ESPN">ESPN</option>}
                        {projMaps.CBS  && <option value="CBS">CBS Sports</option>}
                      </select>
                    </>
                  )}

                  {/* --- SHOW ONLY WHEN IN VALUES MODE --- */}
                  {metricMode === "values" && (
                    <>
                      <span className="font-semibold ml-4">Values:</span>
                      <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />

                      <FormatQBToggles
                        league={league}
                        format={formatLocal}
                        setFormat={(v) => { setUserTouchedFormat(true); setFormatLocal(v); }}
                        qbType={qbLocal}
                        setQbType={(v) => { setUserTouchedQB(true); setQbLocal(v); }}
                      />
                    </>
                  )}
                  </>
                )}

                  <span className="font-semibold ml-4">NFL Week:</span>
                  <input
                    type="number"
                    min={1}
                    max={18}
                    value={week}
                    onChange={(e) => setWeek(parseInt(e.target.value || "1", 10))}
                    className="w-24 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
                    title="Changing the week auto-follows your scheduled opponent"
                  />

                  <span className="ml-auto text-sm opacity-80">
                    {projError && metricMode === "projections" ? "Projection file missing - using values." : null}
                  </span>


                
              </div>
            </Card>

            <SectionTitle subtitle="Left = you (locked). Right = your opponent for the selected week.">
              Matchup Preview
            </SectionTitle>

            {!activeLeague || !rosters.length ? (
              <Card className="p-6">
                <div className="text-sm opacity-70">Choose a league above to load rosters.</div>
              </Card>
            ) : (
              <Card className="p-4">
                <div className="grid sm:grid-cols-3 gap-3 mb-4">
                  {/* Owner A locked */}
                  <div>
                    <div className="block text-sm font-medium mb-1">Owner A (you)</div>
                    <div className="w-full rounded bg-gray-800 text-white p-2">
                      {ownerA ? ownerLabel(ownerA) : "—"}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">Auto-selected from your Sleeper account.</div>
                  </div>

                  {/* Owner B selectable; changing it will jump to the week you face them (if scheduled) */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Owner B (opponent)</label>
                    <select
                      className="w-full rounded bg-gray-800 text-white p-2"
                      value={ownerB}
                      onChange={(e) => onChangeOwnerB(e.target.value)}
                    >
                      <option value="">Select opponent…</option>
                      {users
                        .filter((u) => u.user_id !== ownerA)
                        .map((u) => (
                          <option key={u.user_id} value={u.user_id}>
                            {ownerLabel(u.user_id)}
                          </option>
                        ))}
                    </select>
                    <div className="text-[11px] text-gray-400 mt-1">Auto-follows your opponent when week changes.</div>
                  </div>

                  <div className="self-end text-sm opacity-70">
                    Slots: {Object.entries(slots.strict).filter(([, v]) => v > 0).map(([k, v]) => `${k}×${v}`).join(" · ")}
                    {slots.flexGroups.length ? ` · FLEX×${slots.flexGroups.length}` : ""}
                  </div>
                </div>

                <div className="mb-4 rounded-3xl border border-emerald-300/15 bg-gradient-to-br from-emerald-400/[0.08] via-slate-950/40 to-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200/60">Lineup strategy</div>
                      <div className="mt-1 text-sm text-white/55">Choose whether the solver protects your floor or embraces volatility and correlation.</div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
                      {[
                        ["safe", "Safe", "Higher floor"],
                        ["median", "Median", "Best projection"],
                        ["aggressive", "Aggressive", "Ceiling + stacks"],
                      ].map(([key, label, hint]) => (
                        <button key={key} type="button" onClick={() => setLineupStrategy(key)} title={hint} className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${lineupStrategy === key ? "bg-emerald-300/15 text-emerald-50 shadow-inner" : "text-white/45 hover:bg-white/5 hover:text-white/75"}`}>
                          <span className="block">{label}</span><span className="mt-0.5 hidden text-[9px] font-normal opacity-60 sm:block">{hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <TeamBox
                    title={ownerA ? `${ownerLabel(ownerA)} — ${lineupStrategy === "safe" ? "Safe" : lineupStrategy === "aggressive" ? "Aggressive" : "Median"} Lineup` : "Owner A"}
                    res={ownerA ? compute(ownerA) : null}
                    metricLabel={metricLabel}
                    // show suggestions ONLY in projections mode
                    enableSuggestions={metricMode === "projections"}
                  />
                  <TeamBox
                    title={ownerB ? `${ownerLabel(ownerB)} — ${lineupStrategy === "safe" ? "Safe" : lineupStrategy === "aggressive" ? "Aggressive" : "Median"} Lineup` : "Owner B"}
                    res={ownerB ? compute(ownerB) : null}
                    metricLabel={metricLabel}
                    enableSuggestions={false}
                  />
                </div>

                {ownerA && ownerB && (
                  <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div><div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Projected edge</div><div className="mt-1 font-bold">{matchup?.delta >= 0 ? ownerLabel(ownerA) : ownerLabel(ownerB)}</div><div className="text-xs text-white/45">by {Math.abs(matchup?.delta || 0).toFixed(1)}</div></div>
                      <div><div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Your win chance</div><div className="mt-1 text-2xl font-black text-emerald-200">{metricMode === "projections" ? `${Math.round(winProbability(matchup?.a.score, matchup?.b.score))}%` : "—"}</div><div className="text-xs text-white/45">{metricMode === "projections" ? "Modeled from lineup totals" : "Requires projection mode"}</div></div>
                      <div><div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Your range</div><div className="mt-1 font-bold">{matchup?.a.floorScore.toFixed(1)}–{matchup?.a.ceilingScore.toFixed(1)}</div><div className="text-xs text-white/45">Floor to ceiling</div></div>
                      <div><div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Opponent range</div><div className="mt-1 font-bold">{matchup?.b.floorScore.toFixed(1)}–{matchup?.b.ceilingScore.toFixed(1)}</div><div className="text-xs text-white/45">Floor to ceiling</div></div>
                    </div>
                  </div>
                )}

                {ownerA && ownerB ? (
                  <div className="mt-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div><div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/55">Decision Explainer</div><h3 className="mt-1 text-xl font-black">Why these players start</h3><p className="mt-1 text-xs text-white/45">The closest start/sit decisions, ordered from hardest call to easiest.</p></div>
                      <div className="text-xs text-white/40">Weather loaded for {Object.keys(weatherMap).length} NFL teams · injury status from Sleeper</div>
                    </div>
                    {decisionRows.length ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{decisionRows.map((decision) => (
                      <article key={decision.starter.pid} className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-400/[0.06] to-white/[0.02] p-4">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Start {decision.starter.name}</div><div className="mt-1 text-sm font-semibold text-white/60">over {decision.alternative.name}</div></div><div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-right"><div className="text-[9px] uppercase tracking-wider text-white/35">Win impact</div><div className="mt-0.5 font-black text-cyan-100">{decision.winImpact == null ? "—" : `${decision.winImpact >= 0 ? "+" : ""}${decision.winImpact.toFixed(1)}%`}</div></div></div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-black/15 p-2"><div className="text-[9px] uppercase text-white/30">Floor</div><div className="text-xs font-bold">{decision.starter.floor.toFixed(1)}</div></div><div className="rounded-xl bg-black/15 p-2"><div className="text-[9px] uppercase text-white/30">Median</div><div className="text-xs font-bold">{decision.starter.proj.toFixed(1)}</div></div><div className="rounded-xl bg-black/15 p-2"><div className="text-[9px] uppercase text-white/30">Ceiling</div><div className="text-xs font-bold">{decision.starter.ceiling.toFixed(1)}</div></div></div>
                        <ul className="mt-3 space-y-1.5 text-xs leading-5 text-white/55">{decision.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="text-cyan-200/60">◆</span><span>{reason}</span></li>)}</ul>
                      </article>
                    ))}</div> : <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">There are no close same-position start/sit decisions on this roster for Week {week}.</div>}
                    <div className="mt-3 text-[11px] leading-5 text-white/35">Floor and ceiling are modeled ranges derived from projection volatility, position, injury status, and available weather—not guarantees. Win probability is an estimate from the two optimized projection totals.</div>
                  </div>
                ) : null}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- display helpers ---------- */
function TeamBox({ title, res, metricLabel, enableSuggestions }) {
  const suggestions = useMemo(() => {
    if (!enableSuggestions || !res) return {};
    return findCloseAlternatives(res.starters, res.bench, { windowAbs: 2.0, max: 2 });
  }, [enableSuggestions, res]);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0c2035] p-3">
      <div className="font-semibold mb-2">{title}</div>
      {!res ? (
        <div className="text-sm opacity-70">Pick an owner.</div>
      ) : (
        <>
          <div className="text-sm mb-2">
            Total {metricLabel}: <b>{Math.round(res.score)}</b>
          </div>

          <Section label="Starters" items={res.starters} metricLabel={metricLabel} suggestions={suggestions} />
          <Section label="Bench (top 10)" items={res.bench.slice(0, 10)} metricLabel={metricLabel} />
        </>
      )}
    </div>
  );
}
function Section({ label, items, metricLabel, suggestions = {} }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold mb-1">{label}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left opacity-70">
            <th className="py-1">Pos</th>
            <th className="py-1">Player</th>
            <th className="py-1 text-right">{metricLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => {
            const alts = suggestions[x.pid] || [];
            return (
              <tr key={x.pid} className="border-t border-white/10 align-top">
                <td className="py-1">{x.pos}</td>
                <td className="py-1">
                  {x.name} <span className="opacity-60 text-xs">({x.team})</span>
                  {alts.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-amber-300">
                      Close call:&nbsp;
                      {alts.map((a, i) => (
                        <span key={a.pid}>
                          {i > 0 ? ", " : ""}
                          {a.name} {a.delta >= 0 ? `(+${Math.round(a.delta)})` : `(${Math.round(a.delta)})`}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-1 text-right">{Math.round(x.proj)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
