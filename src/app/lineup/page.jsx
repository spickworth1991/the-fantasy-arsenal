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

/* ---------- Slots from Sleeper roster_positions ---------- */
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

/* ---------- Simple auto-detect helpers (no buttons) ---------- */
function inferQbTypeFromLeague(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  const hasSF = rp.includes("SUPER_FLEX") || rp.includes("SUPERFLEX") || rp.includes("Q/W/R/T");
  return hasSF ? "sf" : "1qb";
}
function inferFormatFromLeague(league) {
  // Sleeper doesn't expose a hard "dynasty" flag. Heuristics:
  const name = String(league?.name || "").toLowerCase();
  const looksDynasty = name.includes("dynasty") || name.includes("keeper") || !!league?.previous_league_id;
  return looksDynasty ? "dynasty" : "redraft";
}

/* ---------- Greedy optimal lineup (bye-aware via byeMap) ---------- */
function solveOptimalLineup({ roster, players, getProjection, slots, week, byeMap }) {
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
        proj: isOnBye ? 0 : getProjection(p) || 0,
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

  takeBestFor(["QB"], slots.strict.QB);
  takeBestFor(["RB"], slots.strict.RB);
  takeBestFor(["WR"], slots.strict.WR);
  takeBestFor(["TE"], slots.strict.TE);
  takeBestFor(["K"], slots.strict.K);
  takeBestFor(["DEF"], slots.strict.DEF);
  (slots.flexGroups || []).forEach((g) => takeBestFor(g, 1));

  const bench = candidates.filter((c) => !used.has(c.pid));
  const score = starters.reduce((s, x) => s + (x.proj || 0), 0);
  return { starters, bench, score };
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

  /* Local overrides; auto-infer on league load, but user can change afterward */
  const [formatLocal, setFormatLocal] = useState(format || "dynasty");
  const [qbLocal, setQbLocal] = useState(qbType || "sf");
  const [userTouchedFormat, setUserTouchedFormat] = useState(false);
  const [userTouchedQB, setUserTouchedQB] = useState(false);

  const handleSetFormat = (v) => {
    setUserTouchedFormat(true);
    setFormatLocal(v);
  };
  const handleSetQbType = (v) => {
    setUserTouchedQB(true);
    setQbLocal(v);
  };

  /* Value source */
  const [valueSource, setValueSource] = useState("FantasyCalc");
  const getProjection = useMemo(
    () => makeGetPlayerValue(valueSource, formatLocal, qbLocal),
    [valueSource, formatLocal, qbLocal]
  );

  /* Week + byes */
  const [week, setWeek] = useState(1);
  const [season, setSeason] = useState(new Date().getFullYear());
  const [byeMap, setByeMap] = useState(null);
  const [stateLoading, setStateLoading] = useState(false);

  /* Owners */
  const [ownerA, setOwnerA] = useState("");
  const [ownerB, setOwnerB] = useState("");

  const league = useMemo(() => (leagues || []).find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);
  const allRosters = league?.rosters || [];
  const allUsers = league?.users || [];
  const rosters = useMemo(() => allRosters.filter((r) => (r.players || []).length > 0), [allRosters]);
  const users = useMemo(() => {
    const byOwner = new Set(rosters.map((r) => r.owner_id));
    return allUsers.filter((u) => byOwner.has(u.user_id));
  }, [allUsers, rosters]);

  /* Auto-infer scoring (no button). Only runs when league changes and
     only overwrites if the user hasn't touched the toggle yet. */
  useEffect(() => {
    if (!league) return;
    if (!userTouchedQB) setQbLocal(inferQbTypeFromLeague(league));
    if (!userTouchedFormat) setFormatLocal(inferFormatFromLeague(league));
  }, [league]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Load NFL state + bye map once */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStateLoading(true);
        const res = await fetch("https://api.sleeper.app/v1/state/nfl");
        const data = await res.json();
        if (mounted) {
          if (data?.week) setWeek(data.week);
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

  /* Ensure league data present */
  useEffect(() => {
    if (activeLeague && (!league?.rosters || !league?.users)) {
      fetchLeagueRosters(activeLeague).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague]);

  const rosterByOwnerId = useMemo(() => {
    const map = {};
    rosters.forEach((r) => { map[r.owner_id] = r; });
    return map;
  }, [rosters]);

  const slots = useMemo(() => parseLeagueSlots(league), [league]);

  const ownerLabel = (uid) => {
    const u = users.find((x) => x.user_id === uid);
    const r = rosterByOwnerId[uid];
    const tn = u?.metadata?.team_name;
    return tn || u?.display_name || u?.username || (r ? `Roster ${r.roster_id}` : uid);
  };

  const compute = (uid) =>
    solveOptimalLineup({ roster: rosterByOwnerId[uid], players, getProjection, slots, week, byeMap });

  const matchup = useMemo(() => {
    if (!ownerA || !ownerB) return null;
    const a = compute(ownerA);
    const b = compute(ownerB);
    return { a, b, delta: a.score - b.score };
  }, [ownerA, ownerB, players, valueSource, formatLocal, qbLocal, rosters, slots, week, byeMap]);

  return (
    <>
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
                    // Reset "auto" mode for new league, so it can re-infer
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

                {/* Value Source */}
                <span className="font-semibold ml-4">Values:</span>
                <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />

                {/* Scoring toggles (auto-inferred, but user can change) */}
                <span className="font-semibold ml-4">Scoring:</span>
                <FormatQBToggles
                  league={league}
                  format={formatLocal}
                  setFormat={handleSetFormat}
                  qbType={qbLocal}
                  setQbType={handleSetQbType}
                />

                <span className="font-semibold ml-4">NFL Week:</span>
                <input
                  type="number"
                  min={1}
                  max={18}
                  value={week}
                  onChange={(e) => setWeek(parseInt(e.target.value || "1", 10))}
                  className="bg-gray-800 text-white p-2 rounded w-24"
                />

                <div className="text-xs opacity-70">Bye weeks scored as 0.</div>
              </div>
            </Card>

            <SectionTitle subtitle="Pick two owners (only non-empty rosters are listed).">Matchup Preview</SectionTitle>

            {!activeLeague || !rosters.length ? (
              <Card className="p-6">
                <div className="text-sm opacity-70">Choose a league above to load rosters.</div>
              </Card>
            ) : (
              <Card className="p-4">
                <div className="grid sm:grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Owner A</label>
                    <select className="w-full rounded bg-gray-800 text-white p-2" value={ownerA} onChange={(e) => setOwnerA(e.target.value)}>
                      <option value="">Select owner…</option>
                      {users.map((u) => (
                        <option key={u.user_id} value={u.user_id}>
                          {ownerLabel(u.user_id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Owner B</label>
                    <select className="w-full rounded bg-gray-800 text-white p-2" value={ownerB} onChange={(e) => setOwnerB(e.target.value)}>
                      <option value="">Select owner…</option>
                      {users.map((u) => (
                        <option key={u.user_id} value={u.user_id}>
                          {ownerLabel(u.user_id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="self-end text-sm opacity-70">
                    Slots: {Object.entries(slots.strict).filter(([, v]) => v > 0).map(([k, v]) => `${k}×${v}`).join(" · ")}
                    {slots.flexGroups.length ? ` · FLEX×${slots.flexGroups.length}` : ""}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <TeamBox title={ownerA ? `${ownerLabel(ownerA)} — Optimal Starters` : "Owner A"} res={ownerA ? compute(ownerA) : null} />
                  <TeamBox title={ownerB ? `${ownerLabel(ownerB)} — Optimal Starters` : "Owner B"} res={ownerB ? compute(ownerB) : null} />
                </div>

                {matchup && (
                  <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
                    <div className="text-lg font-semibold">Edge: {matchup.delta >= 0 ? ownerLabel(ownerA) : ownerLabel(ownerB)}</div>
                    <div className="opacity-70">
                      {ownerLabel(ownerA)} {Math.round(matchup.a.score)} vs {ownerLabel(ownerB)} {Math.round(matchup.b.score)} (
                      {Math.round(Math.abs(matchup.delta))})
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

/* ---------- small display helpers ---------- */
function TeamBox({ title, res }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0c2035] p-3">
      <div className="font-semibold mb-2">{title}</div>
      {!res ? (
        <div className="text-sm opacity-70">Pick an owner.</div>
      ) : (
        <>
          <div className="text-sm mb-2">
            Total: <b>{Math.round(res.score)}</b>
          </div>
          <Section label="Starters" items={res.starters} />
          <Section label="Bench (top 10)" items={res.bench.slice(0, 10)} />
        </>
      )}
    </div>
  );
}
function Section({ label, items }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold mb-1">{label}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left opacity-70">
            <th className="py-1">Pos</th>
            <th className="py-1">Player</th>
            <th className="py-1 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.pid} className="border-t border-white/10">
              <td className="py-1">{x.pos}</td>
              <td className="py-1">
                {x.name} <span className="opacity-60 text-xs">({x.team})</span>
              </td>
              <td className="py-1 text-right">{Math.round(x.proj)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
