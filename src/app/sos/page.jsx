"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
import { useSleeper } from "../../context/SleeperContext";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";
import FormatQBToggles from "../../components/FormatQBToggles";
import { makeGetPlayerValue } from "../../lib/values";

/** Visual */
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

/** Parse slots */
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
      const set = Array.from(
        new Set(tok.split("/").map(mapToken).filter((p) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(p)))
      );
      if (set.length) flexGroups.push(set);
    }
  });

  return { strict, flexGroups };
}

/** Auto-guess scoring */
function guessQbType(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  const hasSF = rp.includes("SUPER_FLEX") || rp.includes("SUPERFLEX") || rp.includes("Q/W/R/T");
  return hasSF ? "sf" : "1qb";
}
function guessFormat(league) {
  const name = String(league?.name || "").toLowerCase();
  if (/dynasty|keeper/.test(name)) return "dynasty";
  // taxi is common in dynasty; use as a weak signal
  const hasTaxi = (league?.roster_positions || []).some((p) => String(p).toUpperCase() === "TAXI");
  if (hasTaxi) return "dynasty";
  return "redraft";
}

/** Team strength with bye filter */
function teamStrength({ roster, players, getValue, slots, week, byeMap }) {
  if (!roster) return 0;
  const ids = (roster.players || []).filter(Boolean);

  const pool = ids
    .map((pid) => {
      const p = players?.[pid];
      if (!p) return null;
      const pos = String(p?.position || "").toUpperCase();
      const team = (p?.team || "").toUpperCase();

      const byeWeeks = byeMap?.by_team?.[team] || [];
      const isOnBye = Array.isArray(byeWeeks) && byeWeeks.includes(week);

      const v = isOnBye ? 0 : getValue(p) || 0;
      return v > 0 ? { pos: pos === "DST" ? "DEF" : pos, val: v } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.val - a.val);

  const pick = (eligible, n) => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      let bestIdx = -1,
        bestVal = -1;
      for (let j = 0; j < pool.length; j++) {
        if (!pool[j]) continue;
        if (!eligible.includes(pool[j].pos)) continue;
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
  (slots.flexGroups || []).forEach((g) => (sum += pick(g, 1)));

  // bench feather
  sum += pool.slice(0, 5).reduce((s, x) => s + 0.2 * (x.val || 0), 0);
  return sum;
}

/** Robust per-week percentiles for better heatmap contrast */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
function heatColor(opp, wkStats) {
  if (typeof opp !== "number") return "transparent";
  const { p10, p50, p90 } = wkStats;
  // map to [-1, 1] around median, with p10/p90 as extremes
  let t;
  if (opp <= p50) t = (opp - p50) / Math.max(1, (p50 - p10) || 1); // negative
  else t = (opp - p50) / Math.max(1, (p90 - p50) || 1); // positive
  t = Math.max(-1, Math.min(1, t));
  // t=-1 (easiest) -> green (140), t=0 -> grayish (0 saturation), t=1 (hardest) -> red (0)
  const hue = 140 * (1 - Math.max(0, t)); // compress greens near easy; reds for hard
  const sat = Math.min(50, 15 + Math.abs(t) * 45);
  const light = 18 + (1 - Math.abs(t)) * 25; // keep readable
  return `hsl(${Math.max(0, hue)}, ${sat}%, ${light}%)`;
}

export default function SOSPage() {
  const { leagues = [], activeLeague, setActiveLeague, fetchLeagueRosters, players, format, qbType } = useSleeper();
  const league = useMemo(() => leagues.find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);

  // Auto-guess; users can override with toggles
  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");

  // Re-guess whenever league changes
  useEffect(() => {
    if (!league) return;
    setQbLocal(guessQbType(league));
    // keep user override sticky if they've changed it once; otherwise set from guess
    setFormatLocal((prev) => (prev === "dynasty" || prev === "redraft" ? prev : guessFormat(league)));
  }, [league]);

  // value source selection
  const [valueSource, setValueSource] = useState("FantasyCalc");
  const getValue = useMemo(() => makeGetPlayerValue(valueSource, formatLocal, qbLocal), [valueSource, formatLocal, qbLocal]);

  const [week, setWeek] = useState(1);
  const [toWeek, setToWeek] = useState(14);
  const [season, setSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [heatmapMode, setHeatmapMode] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/state/nfl");
        const data = await res.json();
        if (data?.week) {
          setWeek(data.week);
          setToWeek(Math.max(data.week, 14));
        }
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

  // --- Dynamic schedule cache (any league size; fills missing rosters as byes) ---
  const [schedCache, setSchedCache] = useState({});
  // Clear cache when league or roster set changes to avoid stale schedules
  useEffect(() => {
    setSchedCache({});
  }, [activeLeague, ridList.join(",")]);

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
    const matchups = Array.from(byMid.values()); // each entry is 1 or 2 rows

    // Ensure each roster appears exactly once — add solo entries for any missing (bye / odd count)
    const present = new Set(matchups.flat().map((m) => m.roster_id));
    ridList.forEach((rid) => {
      if (!present.has(rid)) matchups.push([{ roster_id: rid }]);
    });

    setSchedCache((s) => ({ ...s, [w]: matchups }));
    return matchups;
  };

  const [rows, setRows] = useState(null);
  const [heatData, setHeatData] = useState(null);

  const recompute = async () => {
    if (!activeLeague || !rosters.length || !byeMap) {
      setRows(null);
      setHeatData(null);
      return;
    }
    setBusy(true);
    try {
      const weeks = [];
      for (let w = week; w <= toWeek; w++) weeks.push(w);
      const byWeek = await Promise.all(weeks.map(loadWeek));

      // strength per team per week (bye-aware)
      const strengthsByWeek = {};
      weeks.forEach((w) => {
        strengthsByWeek[w] = Object.fromEntries(
          rosters.map((r) => [r.roster_id, teamStrength({ roster: r, players, getValue, slots, week: w, byeMap })])
        );
      });

      const oppSum = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const games = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const cells = new Map();

      weeks.forEach((w, idx) => {
        const matchups = byWeek[idx] || [];
        const seenThisWeek = new Set();

        matchups.forEach((match) => {
          if (match.length === 2) {
            const [a, b] = match;
            const sA = strengthsByWeek[w][a.roster_id] || 0;
            const sB = strengthsByWeek[w][b.roster_id] || 0;

            oppSum[a.roster_id] += sB; games[a.roster_id] += 1; cells.set(`${a.roster_id}|${w}`, sB);
            oppSum[b.roster_id] += sA; games[b.roster_id] += 1; cells.set(`${b.roster_id}|${w}`, sA);

            seenThisWeek.add(a.roster_id);
            seenThisWeek.add(b.roster_id);
          } else if (match.length === 1) {
            const solo = match[0];
            oppSum[solo.roster_id] += 0;
            games[solo.roster_id] += 1;
            cells.set(`${solo.roster_id}|${w}`, 0);
            seenThisWeek.add(solo.roster_id);
          }
        });

        // Safety: if any roster still didn't appear, give them an explicit bye for this week
        ridList.forEach((rid) => {
          if (!seenThisWeek.has(rid)) {
            oppSum[rid] += 0;
            games[rid] += 1;
            cells.set(`${rid}|${w}`, 0);
          }
        });
      });

      const entries = ridList.map((rid) => {
        const avgOpp = oppSum[rid] / Math.max(1, games[rid]);
        return { rid, team: teamName(rid), totalOpp: oppSum[rid], avgOpp, games: games[rid] };
      });

      // Rank by average opponent strength (lower = easier)
      entries.sort((a, b) => a.avgOpp - b.avgOpp);
      const min = entries[0]?.avgOpp ?? 0;
      const max = entries.at(-1)?.avgOpp ?? 1;
      const easePct = (x) => Math.round(100 * (1 - (x - min) / Math.max(1, max - min)));

      // Build per-week stats for better heatmap color scaling
      const weekStats = {};
      weeks.forEach((w) => {
        const vals = ridList
          .map((rid) => cells.get(`${rid}|${w}`))
          .filter((v) => typeof v === "number");
        weekStats[w] = {
          p10: percentile(vals, 10),
          p50: percentile(vals, 50),
          p90: percentile(vals, 90),
        };
      });

      setRows(
        entries.map((e, i) => ({
          rank: i + 1,
          rid: e.rid,
          team: e.team,
          easePct: easePct(e.avgOpp),
          oppStrengthAvg: Math.round(e.avgOpp),
          oppStrengthSum: Math.round(e.totalOpp),
          games: e.games,
        }))
      );

      setHeatData({
        weeks,
        teams: entries.map((e) => ({ rid: e.rid, name: e.team })),
        cells,
        statsByWeek: weekStats,
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, week, toWeek, valueSource, formatLocal, qbLocal, players, rosters.length, byeMap]);

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
              }}
            >
              <option value="">Choose a League</option>
              {leagues.map((lg) => (
                <option key={lg.league_id} value={lg.league_id}>
                  {lg.name}
                </option>
              ))}
            </select>

            <span className="font-semibold ml-2">Values:</span>
            <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />

            {/* Auto-guessed, but user can override */}
            <FormatQBToggles
              league={league}
              format={formatLocal}
              setFormat={setFormatLocal}
              qbType={qbLocal}
              setQbType={setQbLocal}
            />

            <span className="font-semibold ml-2">Weeks:</span>
            <input
              type="number"
              min={1}
              max={18}
              value={week}
              onChange={(e) => setWeek(parseInt(e.target.value || "1", 10))}
              className="bg-gray-800 text-white p-2 rounded w-20"
            />
            <span>to</span>
            <input
              type="number"
              min={week}
              max={18}
              value={toWeek}
              onChange={(e) => setToWeek(parseInt(e.target.value || "18", 10))} 
              className="bg-gray-800 text-white p-2 rounded w-20"
            />

            <span className="ml-auto text-sm opacity-80">{busy ? "Computing…" : null}</span>
          </div>
        </Card>

        <SectionTitle subtitle="Opponent strength is averaged per team so results are comparable across any league size or schedule length.">
          Results
        </SectionTitle>

        <Card className="p-4 mt-4">
          {!activeLeague ? (
            <div className="text-sm opacity-70">Choose a league above.</div>
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
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-max">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="py-2 px-3 text-left">Team</th>
                      {heatData?.weeks?.map((w) => (
                        <th key={w} className="py-2 px-3 text-center">
                          W{w}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      return (heatData?.teams || []).map((t) => (
                        <tr key={t.rid} className="border-t border-white/10">
                          <td className="py-2 px-3">{t.name}</td>
                          {heatData?.weeks?.map((w) => {
                            const opp = heatData?.cells?.get(`${t.rid}|${w}`);
                            const stats = heatData?.statsByWeek?.[w];
                            const bg = stats ? heatColor(opp, stats) : "transparent";
                            return (
                              <td key={w} className="py-1 px-2 text-center" style={{ backgroundColor: bg }}>
                                {typeof opp === "number" ? "" : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="text-xs opacity-70 mt-2">
                Color scaled per week using robust percentiles (P10/P50/P90). Green = easier opponent · Red = harder opponent.
              </div>
            </div>
          )}
        </Card>

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
      </div>
    </>
  );
}
