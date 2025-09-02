"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
import { useSleeper } from "../../context/SleeperContext";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";
import FormatQBToggles from "../../components/FormatQBToggles";
import { makeGetPlayerValue } from "../../lib/values";

/** ===== Projections (JSON) ===== */
const PROJ_JSON_URL = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL = "/projections_cbs_2025.json";
const REG_SEASON_WEEKS = 17;

/** ===== Visual ===== */
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

/** ===== Slots ===== */
function parseLeagueSlots(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  const strict = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const flexGroups = [];
  const mapToken = (t) => (t === "W" ? "WR" : t === "R" ? "RB" : t === "T" ? "TE" : t === "Q" ? "QB" : t);
  rp.forEach((tok) => {
    if (["BN", "IR", "TAXI"].includes(tok)) return;
    if (["QB", "RB", "WR", "TE", "K", "DEF", "DST"].includes(tok)) { strict[tok === "DST" ? "DEF" : tok] += 1; return; }
    if (tok === "FLEX") flexGroups.push(["RB", "WR", "TE"]);
    else if (tok === "SUPER_FLEX" || tok === "SUPERFLEX" || tok === "Q/W/R/T") flexGroups.push(["QB", "RB", "WR", "TE"]);
    else if (tok.includes("/")) {
      const set = Array.from(new Set(tok.split("/").map(mapToken).filter((p) => ["QB","RB","WR","TE","K","DEF"].includes(p))));
      if (set.length) flexGroups.push(set);
    }
  });
  return { strict, flexGroups };
}

/** ===== Auto-guess scoring ===== */
function guessQbType(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  return (rp.includes("SUPER_FLEX") || rp.includes("SUPERFLEX") || rp.includes("Q/W/R/T")) ? "sf" : "1qb";
}
function guessFormat(league) {
  const name = String(league?.name || "").toLowerCase();
  if (/dynasty|keeper/.test(name)) return "dynasty";
  const hasTaxi = (league?.roster_positions || []).some((p) => String(p).toUpperCase() === "TAXI");
  if (hasTaxi) return "dynasty";
  return "redraft";
}

/** ===== Heatmap scaling ===== */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
// REPLACE your heatColor with this:
function heatColorMargin(margin, maxAbs) {
  if (typeof margin !== "number" || !isFinite(margin) || !maxAbs || maxAbs <= 0) {
    return "transparent";
  }
  // t in [-1,1]: -1 = very easy (you much stronger), 0 = even, 1 = very hard
  const t = Math.max(-1, Math.min(1, margin / maxAbs));
  // Hue: green(120) at -1 → yellow(60) at 0 → red(0) at +1
  const hue = 60 - 60 * t;    // -1→120, 0→60, +1→0
  const sat = 70;             // keep saturation stable for readability
  const light = 45 - 8 * Math.abs(t); // a touch darker as you move away from even
  return `hsl(${hue}, ${sat}%, ${light}%)`;
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
  // Common aliases → Sleeper-style
  const map = {
    JAX: "JAC", LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV",
    WAS: "WAS", WFT: "WAS", WSH: "WAS",
    NO: "NO", NOR: "NO",
    TB: "TB", TAM: "TB",
    NE: "NE", NWE: "NE",
    SF: "SF", SFO: "SF",
    KC: "KC", KCC: "KC",
    GB: "GB", GNB: "GB",
    // if the input is already standard, fall through
  };
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
  const byNameTeam = Object.create(null); // name + team
  const byNamePos  = Object.create(null); // name + pos

  rows.forEach((r) => {
    const pid = r.player_id != null ? String(r.player_id) : "";
    const name = r.name || r.player || r.full_name || "";
    const seasonPts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;

    // Try to read team & pos from a few common field names
    const rawTeam = r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team;
    const team = normalizeTeamAbbr(rawTeam);
    const rawPos = r.pos ?? r.position ?? r.player_position;
    const pos = normalizePos(rawPos);

    if (pid) byId[pid] = seasonPts;

    if (name) {
      const nn = normNameForMap(name);
      // plain name (last resort)
      byName[nn] = seasonPts;
      byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;

      // name + team (preferred fallback)
      if (team) {
        byNameTeam[`${nn}|${team}`] = seasonPts;
      }
      // name + pos (secondary fallback)
      if (pos) {
        byNamePos[`${nn}|${pos}`] = seasonPts;
      }
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

  // 1) Exact Sleeper ID
  const hit = map.byId[String(p.player_id)];
  if (hit != null) return hit;

  // Build keys for fallbacks
  const nn =
    normNameForMap(p.full_name || p.search_full_name || p.first_name + " " + p.last_name || "");
  const team = normalizeTeamAbbr(p.team);
  const pos  = normalizePos(p.position);

  // 2) Name + Team (disambiguates Josh Allen BUF vs JAX)
  if (nn && team) {
    const k = `${nn}|${team}`;
    if (map.byNameTeam[k] != null) return map.byNameTeam[k];
  }

  // 3) Name + Pos (helps if team missing in the projections feed)
  if (nn && pos) {
    const k = `${nn}|${pos}`;
    if (map.byNamePos[k] != null) return map.byNamePos[k];
  }

  // 4) Plain name (last resort)
  if (nn && map.byName[nn] != null) return map.byName[nn];

  const k2 = (p.search_full_name || "").toLowerCase();
  if (k2 && map.byName[k2] != null) return map.byName[k2];

  return 0;
}

/** Weekly projection: seasonPts / (17 - byeCountForTeam), but **0** on bye week(s). */
function makeWeeklyProjectionGetter(map) {
  if (!map) return () => 0;
  return (p, week, byeMap) => {
    if (!p) return 0;
    const team = (p.team || "").toUpperCase();
    const byes = Array.isArray(byeMap?.by_team?.[team]) ? byeMap.by_team[team] : [];
    if (byes.includes(week)) return 0;
    const seasonPts = getSeasonPointsForPlayer(map, p);
    const games = Math.max(1, REG_SEASON_WEEKS - byes.length);
    return seasonPts / games;
  };
}

/** Wrap a values getter to the same signature (p, week, byeMap) and zero out on bye. */
function wrapValuesAsWeekly(getValueRaw) {
  return (p, week, byeMap) => {
    if (!p) return 0;
    const team = (p.team || "").toUpperCase();
    const byes = Array.isArray(byeMap?.by_team?.[team]) ? byeMap.by_team[team] : [];
    if (byes.includes(week)) return 0;
    return getValueRaw(p) || 0;
  };
}
function HeatCell({ rid, week, margin, globalMaxAbs, onOpen }) {
  const bg = (typeof margin === "number") ? heatColorMargin(margin, globalMaxAbs) : "transparent";
  const showDot = margin != null;

  return (
    <td className="p-0 border-0">
      <button
        type="button"
        onClick={() => onOpen({ rid, week })}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen({ rid, week }); } }}
        tabIndex={0}
        aria-label={`Open matchup details for week ${week}`}
        title={`Week ${week} — tap to view matchup lineups`}
        className="
          block w-full h-full text-center outline-none focus:ring-2 focus:ring-white/40
          min-w-[34px] min-h-[34px] md:min-w-[42px] md:min-h-[42px] rounded-sm
        "
        style={{ backgroundColor: bg, cursor: "pointer" }}
      >
        <span className="inline-block opacity-70 md:opacity-60">{showDot ? "•" : "—"}</span>
      </button>
    </td>
  );
}




/** ===== Detailed lineup builder for a given week ===== */
function computeWeeklyLineup({ roster, players, getMetricWeekly, slots, week, byeMap }) {
  if (!roster) return { total: 0, starters: [], bench: [] };
  const ids = (roster.players || []).filter(Boolean);

  const pool = ids
    .map((pid) => {
      const p = players?.[pid];
      if (!p) return null;
      const pos = String(p?.position || "").toUpperCase();
      const val = getMetricWeekly(p, week, byeMap) || 0;
      return { pid, name: p.full_name || p.search_full_name || pid, team: (p.team || "").toUpperCase(), pos: pos === "DST" ? "DEF" : pos, val };
    })
    .filter(Boolean)
    .sort((a, b) => b.val - a.val);

  const starters = [];
  const take = (eligible, n) => {
    for (let i = 0; i < n; i++) {
      let idx = -1, best = -1;
      for (let j = 0; j < pool.length; j++) {
        const it = pool[j];
        if (!it) continue;
        if (!eligible.includes(it.pos)) continue;
        if (it.val > best) { best = it.val; idx = j; }
      }
      if (idx >= 0) { starters.push(pool[idx]); pool.splice(idx, 1); }
    }
  };

  take(["QB"],  slots.strict.QB);
  take(["RB"],  slots.strict.RB);
  take(["WR"],  slots.strict.WR);
  take(["TE"],  slots.strict.TE);
  take(["K"],   slots.strict.K);
  take(["DEF"], slots.strict.DEF);
  (slots.flexGroups || []).forEach((g) => take(g, 1));

  const bench = pool;
  const feather = bench.slice(0, 5).reduce((s, x) => s + 0.2 * (x.val || 0), 0);
  const total = starters.reduce((s, x) => s + (x.val || 0), 0) + feather;

  return { total, starters, bench };
}

export default function SOSPage() {
  const { leagues = [], activeLeague, setActiveLeague, fetchLeagueRosters, players, format, qbType } = useSleeper();
  const league = useMemo(() => leagues.find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);

  // Scoring auto-guess with sticky overrides
  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);
  const setFormatWrapped = (v) => { setUserTouchedFormat(true); setFormatLocal(v); };
  const setQbWrapped = (v) => { setUserTouchedQB(true); setQbLocal(v); };
  useEffect(() => {
    if (!league) return;
    if (!userTouchedQB)     setQbLocal(guessQbType(league));
    if (!userTouchedFormat) setFormatLocal(guessFormat(league));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);

  /** Metric: projections (default) with values fallback */
  const [metricMode, setMetricMode] = useState("projections"); 
  const [projectionSource, setProjectionSource] = useState("CSV"); // "CSV" | "ESPN"
  const [valueSource, setValueSource] = useState("FantasyCalc");

  const getValueRaw = useMemo(
    () => makeGetPlayerValue(valueSource, formatLocal, qbLocal),
    [valueSource, formatLocal, qbLocal]
  );

  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjError("");
      setProjLoading(true);
      try {
        const [csvMap, espnMap, cbsMap] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
        ]);

        const next = { CSV: null, ESPN: null, CBS: null };
        if (csvMap.status === "fulfilled") next.CSV = csvMap.value;
        if (espnMap.status === "fulfilled") next.ESPN = espnMap.value;
        if (cbsMap.status === "fulfilled") next.CBS = cbsMap.value;
        setProjMaps(next);
        if (mounted) {
                  setProjMaps(next);
        // fallback rules
        if (projectionSource === "CBS" && !next.CBS && (next.ESPN || next.CSV)) {
          setProjectionSource(next.ESPN ? "ESPN" : "CSV");
        }
        if (projectionSource === "CSV" && !next.CSV && (next.ESPN || next.CBS)) {
          setProjectionSource(next.ESPN ? "ESPN" : "CBS");
        }
        if (projectionSource === "ESPN" && !next.ESPN && (next.CSV || next.CBS)) {
          setProjectionSource(next.CSV ? "CSV" : "CBS");
        }
        if (!next.CSV && !next.ESPN && !next.CBS) {
          setProjError("No projections available — falling back to Values.");
          setMetricMode("values");
        }

        }
      } catch (e) {
        if (mounted) {
          setProjMaps({ CSV: null, ESPN: null });
          setProjError("Projections unavailable — falling back to Values.");
          setMetricMode("values");
        }
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const getMetricWeekly = useMemo(() => {
    if (metricMode === "projections") {
      const chosen =
        projectionSource === "ESPN" ? projMaps.ESPN :
        projectionSource === "CBS"  ? projMaps.CBS  :
        projMaps.CSV;
      if (chosen) return makeWeeklyProjectionGetter(chosen);
    }
    return wrapValuesAsWeekly(getValueRaw);
  }, [metricMode, projectionSource, projMaps, getValueRaw]);



  /** SOS state */
  const [week, setWeek] = useState(1);
  const [toWeek, setToWeek] = useState(14);
  const [season, setSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [heatmapMode, setHeatmapMode] = useState(true);

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalWeek, setModalWeek] = useState(null);
  const [modalRid, setModalRid] = useState(null);

  // storage for per-week lineups & who plays who (for modal)
  const [lineups, setLineups] = useState({});     // { [week]: { [rid]: lineup } }
  const [matchupMeta, setMatchupMeta] = useState({}); // { [week]: { [rid]: { oppRid?: number, bye?: boolean } } }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/state/nfl");
        const data = await res.json();
        if (data?.week) { setWeek(data.week); setToWeek(Math.max(data.week, 14)); }
        if (data?.season) setSeason(Number(data.season));
        const byeRes = await fetch(`/byes/${data?.season || new Date().getFullYear()}.json`);
        if (byeRes.ok) setByeMap(await byeRes.json());
      } catch {}
    })();
  }, []);

  const allRosters = league?.rosters || [];
  const rosters = useMemo(() => allRosters.filter((r) => (r.players || []).length > 0), [allRosters]);
  const allUsers = league?.users || [];
  const ridList = useMemo(() => rosters.map((r) => r.roster_id), [rosters]);

  const rosterById = useMemo(() => Object.fromEntries(rosters.map((r) => [r.roster_id, r])), [rosters]);
  const userOfRoster = (rid) => allUsers.find((u) => u.user_id === rosterById[rid]?.owner_id);
  const teamName = (rid) => {
    const u = userOfRoster(rid);
    return u?.metadata?.team_name || u?.display_name || u?.username || `Team ${rid}`;
  };

  const slots = useMemo(() => parseLeagueSlots(league), [league]);

  // schedule cache
  const [schedCache, setSchedCache] = useState({});
  useEffect(() => { setSchedCache({}); }, [activeLeague, ridList.join(",")]);

  const loadWeek = async (w) => {
    if (!activeLeague) return [];
    if (schedCache[w]) return schedCache[w];
    const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague}/matchups/${w}`);
    const data = res.ok ? await res.json() : [];
    const byMid = new Map();
    for (const row of data) {
      if (!row.matchup_id) continue;
      if (!byMid.has(row.matchup_id)) byMid.set(row.matchup_id, []);
      byMid.get(row.matchup_id).push(row);
    }
    const matchups = Array.from(byMid.values());
    const present = new Set(matchups.flat().map((m) => m.roster_id));
    ridList.forEach((rid) => { if (!present.has(rid)) matchups.push([{ roster_id: rid }]); });
    setSchedCache((s) => ({ ...s, [w]: matchups }));
    return matchups;
  };

  const [rows, setRows] = useState(null);
  const [heatData, setHeatData] = useState(null);

  const recompute = async () => {
    if (!activeLeague || !rosters.length || !byeMap) { setRows(null); setHeatData(null); return; }
    if (metricMode === "projections") {
      const chosen = projectionSource === "ESPN" ? projMaps.ESPN : projMaps.CSV;
      if (projLoading || !chosen) { setRows(null); setHeatData(null); return; }
    }


    setBusy(true);
    try {
      const weeks = []; for (let w = week; w <= toWeek; w++) weeks.push(w);
      const byWeek = await Promise.all(weeks.map(loadWeek));

      // per-week lineups and strength totals
      const nextLineups = {};
      const strengthsByWeek = {};
      weeks.forEach((w) => {
        nextLineups[w] = {};
        strengthsByWeek[w] = Object.fromEntries(
          rosters.map((r) => {
            const L = computeWeeklyLineup({
              roster: r,
              players,
              getMetricWeekly,
              slots,
              week: w,
              byeMap
            });
            nextLineups[w][r.roster_id] = L;
            return [r.roster_id, L.total];
          })
        );
      });

      // map who plays who each week
      const nextMatchups = {};
      weeks.forEach((w, idx) => {
        nextMatchups[w] = {};
        const matchups = byWeek[idx] || [];
        const seen = new Set();
        matchups.forEach((pair) => {
          if (pair.length === 2) {
            const [a, b] = pair;
            nextMatchups[w][a.roster_id] = { oppRid: b.roster_id };
            nextMatchups[w][b.roster_id] = { oppRid: a.roster_id };
            seen.add(a.roster_id); seen.add(b.roster_id);
          } else if (pair.length === 1) {
            const solo = pair[0];
            nextMatchups[w][solo.roster_id] = { bye: true };
            seen.add(solo.roster_id);
          }
        });
        ridList.forEach((rid) => { if (!seen.has(rid)) nextMatchups[w][rid] = { bye: true }; });
      });

      // per-week stats (min/max + percentiles) AND per-team weekly ease (weekPct)
      // --- per-week stats & margins for coloring ---
      const weekStats = {};            // { [w]: { min, max } } on margins
      const cells = new Map();         // key: `${rid}|${w}` -> margin
      let globalMaxAbs = 0;            // symmetric global scale around 0

      weeks.forEach((w) => {
        const marginsThisWeek = [];

        ridList.forEach((rid) => {
          const self = strengthsByWeek[w][rid] || 0;
          const oppRid = nextMatchups[w][rid]?.oppRid;
          const opp = oppRid ? (strengthsByWeek[w][oppRid] || 0) : 0;

          const margin = opp - self;           // **THIS is the key change**
          cells.set(`${rid}|${w}`, margin);
          marginsThisWeek.push(margin);

          globalMaxAbs = Math.max(globalMaxAbs, Math.abs(margin));
        });

        // per-week min/max of margins (useful for debugging / optional legend)
        if (marginsThisWeek.length) {
          const sorted = marginsThisWeek.sort((a,b) => a - b);
          weekStats[w] = { min: sorted[0], max: sorted[sorted.length - 1] };
        } else {
          weekStats[w] = { min: 0, max: 0 };
        }
      });


      // Compute avgEase from margins using per-week min/max (0 = hardest, 1 = easiest)
      const easeSum = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const easeCnt = Object.fromEntries(ridList.map((rid) => [rid, 0]));

      weeks.forEach((w) => {
        const { min, max } = weekStats[w] || { min: 0, max: 0 };
        const span = Math.max(1, (max - min) || 1);
        ridList.forEach((rid) => {
          const m = cells.get(`${rid}|${w}`);
          if (typeof m === "number" && isFinite(m)) {
            const t = (m - min) / span; // 0 .. 1 (hard .. easy is inverted next)
            const ease = 1 - t;         // 1 = easiest of the week, 0 = hardest
            easeSum[rid] += ease;
            easeCnt[rid] += 1;
          }
        });
      });

      // Build table entries
      const entries = ridList.map((rid) => {
        const avgEase = easeSum[rid] / Math.max(1, easeCnt[rid]);

        // numeric refs (opponent strength aggregates still useful)
        let sumOpp = 0, count = 0;
        weeks.forEach((w) => {
          const oppRid = nextMatchups[w][rid]?.oppRid;
          const v = oppRid ? (strengthsByWeek[w][oppRid] || 0) : 0;
          sumOpp += v; count += 1;
        });
        const avgOpp = sumOpp / Math.max(1, count);

        return { rid, team: teamName(rid), avgEase, totalOpp: sumOpp, avgOpp, games: count };
      });


      entries.sort((a, b) => b.avgEase - a.avgEase); // higher avgEase = easier

      setRows(entries.map((e, i) => ({
        rank: i + 1,
        rid: e.rid, team: e.team,
        easePct: Math.round(100 * e.avgEase),
        oppStrengthAvg: Math.round(e.avgOpp),
        oppStrengthSum: Math.round(e.totalOpp),
        games: e.games,
      })));

      setHeatData({
        weeks,
        teams: entries.map((e) => ({ rid: e.rid, name: e.team })),
        cells,                // margins
        statsByWeek: weekStats,
        globalMaxAbs,         // <— add this
      });


      setLineups(nextLineups);
      setMatchupMeta(nextMatchups);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, week, toWeek, metricMode, projectionSource, projMaps, valueSource, formatLocal, qbLocal, players, rosters.length, byeMap, projLoading]);

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="SOS — Rest of Season" />
      <div className="max-w-7xl mx-auto px-4 pt-20 pb-10">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">League:</span>
            <select
              className="bg-gray-800 text-white p-2 rounded"
              value={activeLeague || ""}
              onChange={(e) => {
                const id = e.target.value;
                setActiveLeague(id);
                if (id) fetchLeagueRosters(id).catch(() => {});
                setUserTouchedFormat(false);
                setUserTouchedQB(false);
              }}
            >
              <option value="">Choose a League</option>
              {leagues.map((lg) => (
                <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>
              ))}
            </select>

            {/* Metric switch */}
            <span className="font-semibold ml-4">Metric:</span>
            <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
              <button
                className={`px-3 py-1 ${metricMode === "projections" ? "bg-white/10" : "hover:bg-white/5"}`}
                onClick={() => setMetricMode("projections")}
                disabled={!!projError || projLoading}
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

            {/* When using projections, let user pick source */}
            {metricMode === "projections" && (
              <>
                <span className="font-semibold ml-2">Projection Source:</span>
                <select
                  className="bg-gray-800 text-white p-2 rounded"
                  value={projectionSource}
                  onChange={(e) => setProjectionSource(e.target.value)}
                  disabled={projLoading}
                >
                  {/* Hide options that failed to load */}
                  {projMaps.CSV && <option value="CSV">Fantasy Football Analytics</option>}
                  {projMaps.ESPN && <option value="ESPN">ESPN</option>}
                  {projMaps.CBS && <option value="CBS">CBS Sports</option>}
                </select>
              </>
            )}


            {/* Only show value source when on Values */}
            {metricMode === "values" && (
              <>
                <span className="font-semibold ml-2">Source:</span>
                <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
              </>
            )}

            <FormatQBToggles
              league={league}
              format={formatLocal}
              setFormat={setFormatWrapped}
              qbType={qbLocal}
              setQbType={setQbWrapped}
            />

            <span className="font-semibold ml-2">Weeks:</span>
            <input
              type="number" min={1} max={18} value={week}
              onChange={(e) => setWeek(parseInt(e.target.value || "1", 10))}
              className="bg-gray-800 text-white p-2 rounded w-20"
            />
            <span>to</span>
            <input
              type="number" min={week} max={18} value={toWeek}
              onChange={(e) => setToWeek(parseInt(e.target.value || "18", 10))}
              className="bg-gray-800 text-white p-2 rounded w-20"
            />

            <span className="ml-auto text-sm opacity-80">
              {busy ? "Computing…" : projError ? "Projection file missing — using Values." : null}
            </span>
          </div>
        </Card>

        <SectionTitle subtitle={
          metricMode === "projections"
          ? "Weekly strengths from season projections, normalized by bye count (0 on bye). Best starters chosen each week."
          : "Opponent strength from player values (0 on bye). Best starters chosen each week."
        }>
          Results
        </SectionTitle>

        <div className="flex items-center gap-3 mt-4">
          <button
            className={`px-3 py-1 rounded border ${!heatmapMode ? "bg-white/10 border-white/20" : "border-white/10 hover:bg-white/5"}`}
            onClick={() => setHeatmapMode(false)}
          >
            Table
          </button>
          <button
            className={`px-3 py-1 rounded border ${heatmapMode ? "bg-white/10 border-white/20" : "border-white/10 hover:bg-white/5"}`}
            onClick={() => setHeatmapMode(true)}
          >
            Heatmap
          </button>
        </div>

        <Card className="p-4 mt-4">
          {!activeLeague ? (
            <div className="text-sm opacity-70">Choose a league above.</div>
          ) : projLoading && metricMode === "projections" ? (
            <div className="text-sm opacity-70">Loading projections…</div>
          ) : !rows ? (
            <div className="text-sm opacity-70">Loading…</div>
          ) : !heatmapMode ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Team</th>
                    <th className="py-2 px-3">Ease %</th>
                    <th className="py-2 px-3">Opp Str (avg)</th>
                    <th className="py-2 px-3">Opp Str (sum)</th>
                    <th className="py-2 px-3">Games</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rid} className="border-t border-white/10">
                      <td className="py-2 px-3">{r.rank}</td>
                      <td className="py-2 px-3">{r.team}</td>
                      <td className="py-2 px-3">{r.easePct}%</td>
                      <td className="py-2 px-3">{r.oppStrengthAvg.toLocaleString()}</td>
                      <td className="py-2 px-3">{r.oppStrengthSum.toLocaleString()}</td>
                      <td className="py-2 px-3">{r.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 overflow-auto max-h-[70vh] touch-pan-x">
              <div className="min-w-max relative">
                <table
                  className="text-[11px] sm:text-sm table-fixed"
                  style={{ borderCollapse: "separate", borderSpacing: 2 }}
                >
                  <thead className="sticky top-0 z-20 bg-gray-900">
                    <tr>
                      <th className="py-2 px-3 text-left sticky left-0 bg-gray-900 z-30">Team</th>
                      {heatData?.weeks?.map((w) => (
                        <th key={w} className="py-2 px-3 text-center">{`W${w}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(heatData?.teams || []).map((t) => (
                      <tr key={t.rid} className="border-t border-white/10">
                        <td className="py-2 px-3 sticky left-0 bg-gray-900 z-10 whitespace-nowrap">
                          {t.name}
                        </td>
                        {heatData?.weeks?.map((w) => {
                          const margin = heatData?.cells?.get(`${t.rid}|${w}`);
                          return (
                            <HeatCell
                              key={w}
                              rid={t.rid}
                              week={w}
                              margin={typeof margin === "number" ? margin : null}
                              globalMaxAbs={heatData?.globalMaxAbs || 0}
                              onOpen={({ rid, week }) => { setModalWeek(week); setModalRid(rid); setModalOpen(true); }}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tips & legend (mobile-friendly) */}
              <div className="text-[11px] sm:text-xs opacity-80 mt-3 space-y-1">
                <div><b>Tip:</b> Tap any week cell to open that matchup’s projected lineups.</div>
                <div>Colors compare <b>your weekly lineup vs opponent’s</b> (byes included). Green = you stronger · Yellow = even · Red = opponent stronger.</div>
              </div>
            </div>
          )
          }
        </Card>

        {/* Matchup Modal */}
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={modalWeek ? `Week ${modalWeek} Matchup` : "Matchup"}
        >
          {(() => {
            if (!modalOpen || !modalWeek || !modalRid) return null;
            const w = modalWeek;
            const ridA = modalRid;
            const opp = matchupMeta?.[w]?.[ridA];
            const ridB = opp?.oppRid ?? null;

            const nameA = teamName(ridA);
            const nameB = ridB ? teamName(ridB) : "BYE";
            const LA = lineups?.[w]?.[ridA];
            const LB = ridB ? lineups?.[w]?.[ridB] : null;

            return (
              <div className="grid md:grid-cols-2 gap-4">
                <LineupTable title={nameA} lineup={LA} />
                <LineupTable title={nameB} lineup={LB || { total: 0, starters: [], bench: [] }} />
              </div>
            );
          })()}
        </Modal>
      </div>
    </>
  );
}

/** ===== Modal & Lineup tables ===== */
function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="
          relative w-[98%] sm:w-[95%] max-w-4xl
          h-[92vh] sm:h-auto overflow-y-auto
          rounded-xl border border-white/10 bg-gray-900 p-4 sm:p-5 shadow-xl
        "
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-base sm:text-lg font-semibold">{title}</div>
          <button className="px-3 py-1 rounded hover:bg-white/5 text-sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}



function LineupTable({ title, lineup }) {
  if (!lineup) return <div className="text-sm opacity-70">{title}: (no data)</div>;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0c2035] p-3">
      <div className="font-semibold mb-2">{title}</div>
      <div className="text-sm mb-2">Total: <b>{Math.round(lineup.total)}</b></div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left opacity-70">
            <th className="py-1">Pos</th>
            <th className="py-1">Player</th>
            <th className="py-1 text-right">Proj/Val</th>
          </tr>
        </thead>
        <tbody>
          {(lineup.starters || []).map((x) => (
            <tr key={`${x.pid}-${x.pos}`} className="border-t border-white/10">
              <td className="py-1">{x.pos}</td>
              <td className="py-1">{x.name} <span className="opacity-60 text-xs">({x.team})</span></td>
              <td className="py-1 text-right">{Math.round(x.val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lineup.bench?.length ? (
        <>
          <div className="text-xs font-semibold mt-3 mb-1">Bench (top 6)</div>
          <table className="w-full text-xs">
            <tbody>
              {lineup.bench.slice(0,6).map((x) => (
                <tr key={`${x.pid}-b`} className="border-t border-white/10">
                  <td className="py-1">{x.pos}</td>
                  <td className="py-1">{x.name} <span className="opacity-60">({x.team})</span></td>
                  <td className="py-1 text-right">{Math.round(x.val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
