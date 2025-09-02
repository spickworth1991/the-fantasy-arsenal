"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../../components/Navbar";
import dynamic from "next/dynamic";
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });
import { useSleeper } from "../../context/SleeperContext";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";
import FormatQBToggles from "../../components/FormatQBToggles";
import { makeGetPlayerValue } from "../../lib/values";

/* === Visual === */
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

/* === Slots: strict + flex groups === */
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
    if (tok === "FLEX") { flexGroups.push(["RB", "WR", "TE"]); return; }
    if (tok === "SUPER_FLEX" || tok === "SUPERFLEX" || tok === "Q/W/R/T") { flexGroups.push(["QB", "RB", "WR", "TE"]); return; }
    if (tok.includes("/")) {
      const set = Array.from(new Set(tok.split("/").map(mapToken).filter((p) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(p))));
      if (set.length) flexGroups.push(set);
    }
  });

  return { strict, flexGroups };
}

/* === Auto-detect helpers (no buttons) === */
function inferQbTypeFromLeague(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  return rp.includes("SUPER_FLEX") || rp.includes("SUPERFLEX") || rp.includes("Q/W/R/T") ? "sf" : "1qb";
}
function inferFormatFromLeague(league) {
  const name = String(league?.name || "").toLowerCase();
  return name.includes("dynasty") || name.includes("keeper") || !!league?.previous_league_id ? "dynasty" : "redraft";
}

/* === Greedy starters from slots, zero if bye === */
function teamStrength({ roster, players, getValue, slots, week, byeMap }) {
  if (!roster) return 0;
  const ids = (roster.players || []).filter(Boolean);

  const pool = ids
    .map((pid) => {
      const p = players?.[pid];
      if (!p) return null;
      const pos = String(p.position || "").toUpperCase();
      const team = (p.team || "").toUpperCase();

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
      let bestIdx = -1, bestVal = -1;
      for (let j = 0; j < pool.length; j++) {
        if (!pool[j]) continue;
        if (!eligible.includes(pool[j].pos)) continue;
        if (pool[j].val > bestVal) { bestVal = pool[j].val; bestIdx = j; }
      }
      if (bestIdx >= 0) { total += pool[bestIdx].val; pool.splice(bestIdx, 1); }
    }
    return total;
  };

  let sum = 0;
  sum += pick(["QB"],  slots.strict.QB);
  sum += pick(["RB"],  slots.strict.RB);
  sum += pick(["WR"],  slots.strict.WR);
  sum += pick(["TE"],  slots.strict.TE);
  sum += pick(["K"],   slots.strict.K);
  sum += pick(["DEF"], slots.strict.DEF);
  (slots.flexGroups || []).forEach((g) => { sum += pick(g, 1); });

  // small bench feather
  sum += pool.slice(0, 5).reduce((s, x) => s + 0.2 * (x.val || 0), 0);
  return sum;
}

export default function PlayoffOddsPage() {
  const { leagues = [], activeLeague, setActiveLeague, fetchLeagueRosters, players, format, qbType } = useSleeper();
  const league = useMemo(() => leagues.find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);

  /* Local overrides — auto first, user can change */
  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);

  const handleSetFormat = (v) => { setUserTouchedFormat(true); setFormatLocal(v); };
  const handleSetQbType = (v) => { setUserTouchedQB(true); setQbLocal(v); };

  /* Value source */
  const [valueSource, setValueSource] = useState("FantasyCalc");
  const getValue = useMemo(() => makeGetPlayerValue(valueSource, formatLocal, qbLocal), [valueSource, formatLocal, qbLocal]);

  const [week, setWeek] = useState(1);
  const [toWeek, setToWeek] = useState(14);
  const [runs, setRuns] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const [season, setSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState(null);

  useEffect(() => {
    if (activeLeague) fetchLeagueRosters(activeLeague).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague]);

  // load week + season + bye map
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

  // auto-detect format/qb from league when it changes (unless user has overridden)
  useEffect(() => {
    if (!league) return;
    if (!userTouchedQB) setQbLocal(inferQbTypeFromLeague(league));
    if (!userTouchedFormat) setFormatLocal(inferFormatFromLeague(league));
  }, [league]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRosters = league?.rosters || [];
  const rosters = useMemo(() => allRosters.filter((r) => (r.players || []).length > 0), [allRosters]);
  const users = league?.users || [];

  const ridList = useMemo(() => rosters.map((r) => r.roster_id), [rosters]);
  const rosterById = useMemo(() => Object.fromEntries(rosters.map((r) => [r.roster_id, r])), [rosters]);

  const ownerName = (rid) => {
    const r = rosterById[rid];
    const u = r ? users.find((x) => x.user_id === r.owner_id) : null;
    return u?.metadata?.team_name || u?.display_name || u?.username || (r ? `Roster ${r.roster_id}` : String(rid));
  };

  const slots = useMemo(() => parseLeagueSlots(league), [league]);

  /* ---- Dynamic schedule cache (supports any league size; fills missing rosters with bye rows) ---- */
  const [schedCache, setSchedCache] = useState({});
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
    const groups = Array.from(byMid.values()); // each group has 1 or 2 rows in practice

    // Ensure every roster appears once: add solo entries for any missing (bye/odd count or missing rows)
    const present = new Set(groups.flat().map((r) => r.roster_id));
    ridList.forEach((rid) => {
      if (!present.has(rid)) groups.push([{ roster_id: rid }]); // explicit bye placeholder
    });

    setSchedCache((s) => ({ ...s, [w]: groups }));
    return groups;
  };

  /* ---- Simulation ---- */
  const simulate = async () => {
    if (!activeLeague || !rosters.length || !byeMap) { setResults(null); return; }
    setBusy(true);
    try {
      const weeks = []; for (let w = week; w <= toWeek; w++) weeks.push(w);
      const groupsByWeek = await Promise.all(weeks.map(loadWeek));

      const playoffSlots = Number(league?.settings?.playoff_teams || 6);
      const byeSlots = playoffSlots >= 6 ? 2 : playoffSlots >= 4 ? 1 : 0;

      const baseWins = Object.fromEntries(rosters.map((r) => [r.roster_id, Number(r.settings?.wins || 0)]));

      // strength map per week (bye-aware)
      const strengthsByWeek = {};
      weeks.forEach((w) => {
        strengthsByWeek[w] = Object.fromEntries(
          rosters.map((r) => [r.roster_id, teamStrength({ roster: r, players, getValue, slots, week: w, byeMap })])
        );
      });

      const makes  = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const byes   = Object.fromEntries(ridList.map((rid) => [rid, 0]));
      const champs = Object.fromEntries(ridList.map((rid) => [rid, 0]));

      for (let run = 0; run < runs; run++) {
        const wins = { ...baseWins };

        weeks.forEach((w, idx) => {
          const groups = groupsByWeek[idx] || [];
          const seen = new Set();

          groups.forEach((g) => {
            if (g.length === 2) {
              const [a, b] = g;
              const sA = strengthsByWeek[w][a.roster_id] || 1;
              const sB = strengthsByWeek[w][b.roster_id] || 1;
              // logistic win prob, scale keeps outcomes reasonable across league sizes
              const scale = Math.max(50, (sA + sB) / 10);
              const pA = 1 / (1 + Math.exp(-(sA - sB) / scale));
              (Math.random() < pA) ? (wins[a.roster_id] += 1) : (wins[b.roster_id] += 1);
              seen.add(a.roster_id); seen.add(b.roster_id);
            } else if (g.length === 1) {
              // solo = bye; no change to wins
              seen.add(g[0].roster_id);
            }
          });

          // safety: ensure everyone appears once
          ridList.forEach((rid) => { if (!seen.has(rid)) { /* implicit bye */ } });
        });

        // rank by wins, then current-week strength as crude tiebreaker
        const ranked = [...ridList].sort((a, b) => {
          const dw = (wins[b] || 0) - (wins[a] || 0);
          if (dw !== 0) return dw;
          return (strengthsByWeek[week][b] || 0) - (strengthsByWeek[week][a] || 0);
        });

        const playoffRids = ranked.slice(0, playoffSlots);
        playoffRids.forEach((rid) => { makes[rid] += 1; });
        ranked.slice(0, byeSlots).forEach((rid) => { byes[rid] += 1; });

        // crude champ pick among qualifiers weighted by strength + randomness
        const champ = playoffRids.reduce((best, rid) => {
          const score = (strengthsByWeek[week][rid] || 0) * (0.8 + Math.random() * 0.4);
          return !best || score > best.score ? { rid, score } : best;
        }, null);
        if (champ) champs[champ.rid] += 1;
      }

      setResults({
        totalRuns: runs,
        table: rosters
          .map((r) => ({
            rid: r.roster_id,
            name: ownerName(r.roster_id),
            strength: Math.round(strengthsByWeek[week][r.roster_id] || 0),
            currentWins: Number(r.settings?.wins || 0),
            makePct: Math.round((100 * makes[r.roster_id]) / runs),
            byePct: Math.round((100 * byes[r.roster_id]) / runs),
            champPct: Math.round((100 * champs[r.roster_id]) / runs),
          }))
          .sort((a, b) => b.makePct - a.makePct),
      });
    } finally {
      setBusy(false);
    }
  };

  // auto-run simulation (debounced) on relevant changes
  const debTimer = useRef(null);
  useEffect(() => {
    if (!activeLeague) { setResults(null); return; }
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(() => { simulate(); }, 350);
    return () => debTimer.current && clearTimeout(debTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, week, toWeek, runs, valueSource, formatLocal, qbLocal, players, rosters.length, byeMap]);

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Playoff Odds" />
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
                // reset auto-infer for a new league
                setUserTouchedFormat(false);
                setUserTouchedQB(false);
              }}
            >
              <option value="">Choose a League</option>
              {leagues.map((lg) => (
                <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>
              ))}
            </select>

            <span className="font-semibold ml-2">Values:</span>
            <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />

            {/* Scoring toggles (auto first, user override) */}
            <span className="font-semibold ml-2">Scoring:</span>
            <FormatQBToggles
              league={league}
              format={formatLocal}
              setFormat={handleSetFormat}
              qbType={qbLocal}
              setQbType={handleSetQbType}
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

            <span className="font-semibold ml-2">Runs:</span>
            <input
              type="number"
              min={200}
              max={10000}
              step={100}
              value={runs}
              onChange={(e) => setRuns(parseInt(e.target.value || "2000", 10))}
              className="bg-gray-800 text-white p-2 rounded w-24"
            />

            <span className="ml-auto text-sm opacity-80">{busy ? "Simulating…" : null}</span>
          </div>
        </Card>

        <SectionTitle subtitle="Monte Carlo of the remaining schedule (bye weeks applied per week).">
          Results
        </SectionTitle>

        <Card className="p-4">
          {!activeLeague ? (
            <div className="text-sm opacity-70">Choose a league above.</div>
          ) : !results ? (
            <div className="text-sm opacity-70">Adjust settings above — simulation runs automatically.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left">
                    <th className="py-2 px-3">Team</th>
                    <th className="py-2 px-3">Strength</th>
                    <th className="py-2 px-3">Curr W</th>
                    <th className="py-2 px-3">% Playoffs</th>
                    <th className="py-2 px-3">% Bye</th>
                    <th className="py-2 px-3">% Champ</th>
                  </tr>
                </thead>
                <tbody>
                  {results.table.map((r) => (
                    <tr key={r.rid} className="border-t border-white/10">
                      <td className="py-2 px-3">{r.name}</td>
                      <td className="py-2 px-3">{r.strength.toLocaleString()}</td>
                      <td className="py-2 px-3">{r.currentWins}</td>
                      <td className="py-2 px-3">{r.makePct}%</td>
                      <td className="py-2 px-3">{r.byePct}%</td>
                      <td className="py-2 px-3">{r.champPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs opacity-70 mt-2">Runs: {results.totalRuns.toLocaleString()}</div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
