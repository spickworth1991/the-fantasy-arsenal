"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { makeGetPlayerValue } from "../../lib/values";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-white/10 bg-gray-900 ${className}`}>{children}</div>;
}

const PROJ_JSON_URL = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL = "/projections_cbs_2025.json";

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

  rows.forEach((r) => {
    const pid = r.player_id != null ? String(r.player_id) : "";
    const name = r.name || r.player || r.full_name || "";
    const seasonPts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;
    const team = normalizeTeamAbbr(r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team);
    const pos = normalizePos(r.pos ?? r.position ?? r.player_position);

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

function getSeasonPointsForPlayer(map, p) {
  if (!map || !p) return 0;

  const hit = map.byId?.[String(p.player_id)];
  if (hit != null) return hit;

  const nn = normNameForMap(p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`);
  const team = normalizeTeamAbbr(p.team);
  const pos = normalizePos(p.position);

  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos && map.byNamePos?.[`${nn}|${pos}`] != null) return map.byNamePos[`${nn}|${pos}`];
  if (team || pos) return 0;
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const compact = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return compact && map.byName?.[compact] != null ? map.byName[compact] : 0;
}

export default function TradeFinder() {
  const {
    activeLeague,
    leagues,
    players,
    format,
    qbType,
    setFormat,
    setQbType,
    sourceKey,
    setSourceKey,
  } = useSleeper();

  const league = useMemo(() => (leagues || []).find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);
  const metricMode = metricModeFromSourceKey(sourceKey);
  const projectionSource = projectionSourceFromKey(sourceKey);
  const valueSource = valueSourceFromKey(sourceKey);

  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  const [nflWeek, setNflWeek] = useState(1);
  const [startWeek, setStartWeek] = useState(1);
  const [endWeek, setEndWeek] = useState(4);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [minDelta, setMinDelta] = useState(0);
  const [byeMap, setByeMap] = useState(null);

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
        if (csv.status === "fulfilled") next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled") next.CBS = cbs.value;
        setProjMaps(next);

        const fallbackKey = next.ESPN ? "proj:espn" : next.CBS ? "proj:cbs" : next.CSV ? "proj:ffa" : null;
        if (metricMode === "projections" && !fallbackKey) {
          setProjError("No projections found. Using values instead.");
          setSourceKey("val:fantasycalc");
          return;
        }
        if (String(sourceKey || "").startsWith("proj:")) {
          if (projectionSource === "CBS" && !next.CBS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ESPN" && !next.ESPN && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "CSV" && !next.CSV && fallbackKey) setSourceKey(fallbackKey);
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable. Using values.");
        setSourceKey("val:fantasycalc");
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPlayerValue = useMemo(() => makeGetPlayerValue(valueSource, format, qbType), [valueSource, format, qbType]);

  const getMetricRaw = useMemo(() => {
    if (metricMode === "projections") {
      const chosen =
        projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projMaps.CSV;
      if (chosen) return (p) => getSeasonPointsForPlayer(chosen, p) || 0;
      return () => 0;
    }
    return (p) => getPlayerValue(p) || 0;
  }, [metricMode, projectionSource, projMaps, getPlayerValue]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/state/nfl");
        const data = await res.json();
        if (!mounted) return;
        const w = data?.week || 1;
        setNflWeek(w);
        setStartWeek(Math.max(1, w - 1));
        setEndWeek(w);
        const season = data?.season || new Date().getFullYear();
        const byeRes = await fetch(`/byes/${season}.json`);
        if (byeRes.ok) setByeMap(await byeRes.json());
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const rosterName = useMemo(() => {
    const byRid = {};
    (league?.rosters || []).forEach((r) => {
      const u = (league?.users || []).find((x) => x.user_id === r.owner_id);
      byRid[r.roster_id] = u?.metadata?.team_name || u?.display_name || u?.username || `Roster ${r.roster_id}`;
    });
    return byRid;
  }, [league]);

  const valueWithBye = (p, week) => {
    const base = getMetricRaw(p) || 0;
    if (!p || !byeMap) return base;
    const team = (p.team || "").toUpperCase();
    const byeWeeks = byeMap.by_team?.[team] || [];
    return Array.isArray(byeWeeks) && byeWeeks.includes(week) ? 0 : base;
  };

  const loadTrades = async () => {
    if (!activeLeague) {
      setRows([]);
      return;
    }
    setBusy(true);
    try {
      const weeks = [];
      for (let w = startWeek; w <= endWeek; w++) weeks.push(w);

      const results = await Promise.all(
        weeks.map(async (w) => {
          const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague}/transactions/${w}`);
          if (!res.ok) return [];
          const data = await res.json();
          return data.filter((t) => t.type === "trade" && t.status === "complete").map((t) => ({ ...t, week: w }));
        })
      );

      const parsed = results
        .flat()
        .map((t) => {
          const teamIds = (t.roster_ids || []).filter((rid) => rosterName[rid]);
          const sent = {};
          const recv = {};
          teamIds.forEach((rid) => {
            sent[rid] = [];
            recv[rid] = [];
          });

          if (t.adds) {
            Object.entries(t.adds).forEach(([pid, rid]) => {
              if (!recv[rid]) return;
              const pobj = players?.[pid];
              recv[rid].push({
                kind: "player",
                id: pid,
                name: pobj?.full_name || pobj?.search_full_name || pid,
                pos: pobj?.position || "",
                team: pobj?.team || "",
                value: valueWithBye(pobj, t.week),
              });
            });
          }

          if (t.drops) {
            Object.entries(t.drops).forEach(([pid, rid]) => {
              if (!sent[rid]) return;
              const pobj = players?.[pid];
              sent[rid].push({
                kind: "player",
                id: pid,
                name: pobj?.full_name || pobj?.search_full_name || pid,
                pos: pobj?.position || "",
                team: pobj?.team || "",
                value: valueWithBye(pobj, t.week),
              });
            });
          }

          (t.draft_picks || []).forEach((pick) => {
            const fromRid = pick.previous_owner_id;
            const toRid = pick.owner_id;
            const label = `${pick.season} R${pick.round} (orig ${pick.roster_id})`;
            if (recv[toRid]) recv[toRid].push({ kind: "pick", id: `${pick.season}-${pick.round}-${pick.roster_id}`, name: label, value: 0 });
            if (sent[fromRid]) sent[fromRid].push({ kind: "pick", id: `${pick.season}-${pick.round}-${pick.roster_id}`, name: label, value: 0 });
          });

          const teams = teamIds.map((rid) => {
            const got = recv[rid] || [];
            const gave = sent[rid] || [];
            const gotVal = got.reduce((s, x) => s + (x.value || 0), 0);
            const gaveVal = gave.reduce((s, x) => s + (x.value || 0), 0);
            return {
              rid,
              name: rosterName[rid],
              got,
              gave,
              gotVal: Math.round(gotVal),
              gaveVal: Math.round(gaveVal),
              delta: Math.round(gotVal - gaveVal),
            };
          });

          const best = Math.max(...teams.map((x) => x.delta));
          return {
            id: t.transaction_id,
            leg: t.leg,
            when: new Date(t.created || t.status_updated || Date.now()).toLocaleString(),
            week: t.week,
            teams,
            winners: teams.filter((x) => x.delta === best).map((x) => x.name),
          };
        })
        .sort((a, b) => (b.leg || 0) - (a.leg || 0));

      setRows(parsed);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadTrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, startWeek, endWeek, valueSource, format, qbType, byeMap, metricMode, projectionSource, projLoading]);

  const filtered = rows.filter((r) => Math.max(...r.teams.map((t) => t.delta)) >= minDelta);

  const suggestions = useMemo(() => {
    if (!league?.rosters?.length || !byeMap) return [];
    const valued = [];
    (league.rosters || []).forEach((r) => {
      const owner = rosterName[r.roster_id];
      if (!owner) return;
      (r.players || []).forEach((pid) => {
        const p = players?.[pid];
        const v = valueWithBye(p, nflWeek);
        if (!p || !v) return;
        valued.push({
          pid,
          val: v,
          name: p.full_name || p.search_full_name || pid,
          pos: (p.position || "").toUpperCase(),
          team: (p.team || "").toUpperCase(),
          rid: r.roster_id,
          owner,
        });
      });
    });

    const out = [];
    for (let i = 0; i < valued.length; i++) {
      for (let j = i + 1; j < valued.length; j++) {
        const a = valued[i];
        const b = valued[j];
        if (a.rid === b.rid || a.pos === b.pos) continue;
        const diff = Math.abs(a.val - b.val);
        const thresh = Math.max(100, 0.04 * (a.val + b.val));
        if (diff <= thresh) {
          out.push({
            aOwner: a.owner,
            bOwner: b.owner,
            aGive: `${a.name} (${a.pos})`,
            bGive: `${b.name} (${b.pos})`,
            delta: Math.round(a.val - b.val),
          });
        }
      }
    }
    return out.sort((x, y) => Math.abs(x.delta) - Math.abs(y.delta)).slice(0, 10);
  }, [league, players, rosterName, nflWeek, byeMap, getMetricRaw]);

  return (
    <Card className="max-w-6xl mx-auto px-4 pt-20 p-4 mt-8">
      <div className="mb-4 flex flex-col gap-1 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Trade Review Window</div>
          <div className="mt-1 text-sm text-white/65">
            Scan completed league trades through one scoring lens and surface the most balanced swaps.
          </div>
        </div>
        <div className="text-xs text-white/45">
          {metricMode === "projections"
            ? "Reviewing deals with projected season totals"
            : "Reviewing deals with the selected trade market"}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div className="min-w-[280px] rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 p-3">
          <SourceSelector
            sources={DEFAULT_SOURCES}
            value={sourceKey}
            onChange={setSourceKey}
            className="w-full"
            mode={format}
            qbType={qbType}
            onModeChange={setFormat}
            onQbTypeChange={setQbType}
            layout="inline"
          />
          <div className="mt-2 text-xs text-white/60">
            {projError && metricMode === "projections"
              ? projError
              : metricMode === "projections"
              ? "Trade results are scored with projection totals."
              : "Trade results are scored with the selected value source."}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Start Week</label>
          <input
            type="number"
            className="w-28 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
            value={startWeek}
            min={1}
            max={18}
            onChange={(e) => setStartWeek(parseInt(e.target.value || "1", 10))}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">End Week</label>
          <input
            type="number"
            className="w-28 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
            value={endWeek}
            min={startWeek}
            max={18}
            onChange={(e) => setEndWeek(parseInt(e.target.value || String(startWeek), 10))}
          />
        </div>
        <div className="text-sm opacity-80 self-end mb-2">
          NFL Week now: <b>{nflWeek}</b>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Min Delta</label>
          <input
            type="number"
            className="w-32 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
            value={minDelta}
            min={0}
            step={50}
            onChange={(e) => setMinDelta(parseInt(e.target.value || "0", 10))}
          />
        </div>
        {busy ? <div className="text-sm opacity-70 self-end mb-2">Loading...</div> : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 mb-4">
        <div className="font-semibold mb-2">Suggested even swaps (1-for-1, bye adjusted)</div>
        {suggestions.length ? (
          <ul className="text-sm space-y-1">
            {suggestions.map((s, idx) => (
              <li key={idx} className="flex justify-between gap-3">
                <span>{s.aOwner} {"->"} {s.bGive}</span>
                <span className="opacity-70">&lt;-&gt;</span>
                <span>{s.bOwner} {"->"} {s.aGive}</span>
                <span className="opacity-60 text-xs">delta~{Math.abs(s.delta)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm opacity-70">No obvious even-value swaps right now.</div>
        )}
      </div>

      <div className="space-y-4">
        {filtered.map((row) => (
          <div key={row.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">Week {row.week}</div>
              <div className="text-xs opacity-70">{row.when}</div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {row.teams.map((team) => (
                <div key={team.rid} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{team.name}</div>
                    <div className="text-sm opacity-70">
                      Net {team.delta >= 0 ? "+" : ""}
                      {team.delta}
                    </div>
                  </div>
                  <div className="mt-3 text-sm">
                    <div className="font-medium opacity-80">Got</div>
                    <ul className="mt-1 space-y-1">
                      {team.got.map((item) => (
                        <li key={`got-${team.rid}-${item.id}`} className="flex justify-between gap-2">
                          <span>{item.name}</span>
                          <span className="opacity-70">{item.value || 0}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-3 text-sm">
                    <div className="font-medium opacity-80">Gave</div>
                    <ul className="mt-1 space-y-1">
                      {team.gave.map((item) => (
                        <li key={`gave-${team.rid}-${item.id}`} className="flex justify-between gap-2">
                          <span>{item.name}</span>
                          <span className="opacity-70">{item.value || 0}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
