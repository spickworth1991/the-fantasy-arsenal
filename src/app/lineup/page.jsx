"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";
import FormatQBToggles from "../../components/FormatQBToggles";
import { makeGetPlayerValue } from "../../lib/values";

/* ---------- Projections setup ---------- */
const PROJ_JSON_URL      = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL  = "/projections_cbs_2025.json";
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
function solveOptimalLineup({ roster, players, getWeeklyMetric, slots, week, byeMap }) {
  if (!roster) return { starters: [], bench: [], score: 0 };
  const ids = [...new Set([...(roster.starters || []), ...(roster.players || [])].filter(Boolean))];

  const candidates = ids
    .map((pid) => {
      const p = players?.[pid];
      if (!p) return null;
      const pos = String(p?.position || "").toUpperCase();
      const team = (p?.team || "").toUpperCase();
      const byeWeeks = byeMap?.by_team?.[team] || [];
      const isOnBye = Array.isArray(byeWeeks) && byeWeeks.includes(week);
      return {
        pid,
        name: p?.full_name || p?.search_full_name || pid,
        pos: pos === "DST" ? "DEF" : pos,
        team,
        proj: isOnBye ? 0 : (getWeeklyMetric(p) || 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.proj || 0) - (a.proj || 0));

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
  return { starters, bench, score };
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
  for (let w = weekMin; w <= weekMax; w++) {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`);
      if (!res.ok) continue;
      const data = await res.json();
      const mine = data.find((r) => r.roster_id === myRosterId);
      if (!mine?.matchup_id) continue;
      const hit = data.find((r) => r.matchup_id === mine.matchup_id && r.roster_id === oppRosterId);
      if (hit) return w;
    } catch {}
  }
  return null;
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
    fetchLeagueRosters,
    loading,
  } = useSleeper();

  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);

  const [metricMode, setMetricMode] = useState("projections"); // projections | values
  const [projectionSource, setProjectionSource] = useState("CSV"); // CSV | ESPN | CBS
  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");

  const [valueSource, setValueSource] = useState("FantasyCalc");

  const [week, setWeek] = useState(1);
  const [season, setSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState(null);
  const [stateLoading, setStateLoading] = useState(false);

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
          setMetricMode("values");
        } else {
          if (projectionSource === "CBS"  && !next.CBS)  setProjectionSource(next.ESPN ? "ESPN" : "CSV");
          if (projectionSource === "ESPN" && !next.ESPN) setProjectionSource(next.CSV ? "CSV" : "CBS");
          if (projectionSource === "CSV"  && !next.CSV)  setProjectionSource(next.ESPN ? "ESPN" : "CBS");
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable — using Values.");
        setMetricMode("values");
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (mounted && byeRes.ok) setByeMap(await byeRes.json());
      } finally {
        if (mounted) setStateLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ensure league data
  useEffect(() => {
    if (activeLeague && (!league?.rosters || !league?.users)) {
      fetchLeagueRosters(activeLeague).catch(() => {});
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
      slots,
      week,
      byeMap,
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
  }, [ownerA, ownerB, players, valueSource, formatLocal, qbLocal, rosters, slots, week, byeMap, metricMode, projectionSource, projLoading]);

  const metricLabel = metricMode === "projections" ? "Proj" : "Value";

  return (
    <>
      <div aria-hidden className="h-[35px]" />
      <Navbar pageTitle="Lineup — Start/Sit + Matchup" />
      <BackgroundParticles />
      {(loading || stateLoading) && <LoadingScreen text="Loading league & NFL week…" />}

      <div aria-hidden className="h-[50px]" />
      <div className="max-w-7xl mx-auto px-4 pb-10">
        {!username ? (
          <div className="text-center text-gray-400 mt-10">
            Please log in on the <a className="text-blue-400 underline" href="/">homepage</a>.
          </div>
        ) : (
          <>
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

                  <span className="font-semibold ml-4">NFL Week:</span>
                  <input
                    type="number"
                    min={1}
                    max={18}
                    value={week}
                    onChange={(e) => setWeek(parseInt(e.target.value || "1", 10))}
                    className="bg-gray-800 text-white p-2 rounded w-24"
                    title="Changing the week auto-follows your scheduled opponent"
                  />

                  <span className="ml-auto text-sm opacity-80">
                    {projError && metricMode === "projections" ? "Projection file missing — using Values." : null}
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

                <div className="grid md:grid-cols-2 gap-4">
                  <TeamBox
                    title={ownerA ? `${ownerLabel(ownerA)} — Optimal Starters` : "Owner A"}
                    res={ownerA ? compute(ownerA) : null}
                    metricLabel={metricLabel}
                    // show suggestions ONLY in projections mode
                    enableSuggestions={metricMode === "projections"}
                  />
                  <TeamBox
                    title={ownerB ? `${ownerLabel(ownerB)} — Optimal Starters` : "Owner B"}
                    res={ownerB ? compute(ownerB) : null}
                    metricLabel={metricLabel}
                    enableSuggestions={false}
                  />
                </div>

                {ownerA && ownerB && (
                  <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
                    <div className="text-lg font-semibold">
                      Edge: {matchup?.delta >= 0 ? ownerLabel(ownerA) : ownerLabel(ownerB)}
                    </div>
                    <div className="opacity-70">
                      {ownerLabel(ownerA)} {Math.round(matchup?.a.score || 0)} vs {ownerLabel(ownerB)} {Math.round(matchup?.b.score || 0)} (
                      {Math.round(Math.abs(matchup?.delta || 0))})
                    </div>
                  </div>
                )}
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
