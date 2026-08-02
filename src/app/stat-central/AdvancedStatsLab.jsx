"use client";

import { useEffect, useMemo, useState } from "react";
import LoadingScreen from "../../components/LoadingScreen";

const archiveCache = new Map();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const present = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
  .replace(/\s+/g, "")
  .trim();
const average = (rows, accessor) => {
  const values = rows.map(accessor).filter(present).map(Number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const sum = (rows, accessor) => rows.reduce((total, row) => total + num(accessor(row)), 0);
const pct = (value, digits = 1) => present(value) ? `${(Number(value) * 100).toFixed(digits)}%` : "—";
const fixed = (value, digits = 1) => present(value) ? Number(value).toFixed(digits) : "—";

function Panel({ children, className = "" }) {
  return <section className={`min-w-0 rounded-[24px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</section>;
}

function Metric({ label, value, detail, tone = "cyan" }) {
  const tones = { cyan: "text-cyan-100", emerald: "text-emerald-100", amber: "text-amber-100", violet: "text-violet-100", rose: "text-rose-100" };
  return <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 sm:p-4">
    <div className="text-[9px] font-black uppercase tracking-[.15em] text-white/30">{label}</div>
    <div className={`mt-1 break-words text-xl font-black sm:text-2xl ${tones[tone] || tones.cyan}`}>{value}</div>
    <div className="mt-1 text-[10px] leading-4 text-white/35">{detail}</div>
  </div>;
}

const ROLE_METRICS = {
  snap: { label: "Snap share", value: (row) => row.offense_pct, format: pct, tone: "cyan" },
  target: { label: "Target share", value: (row) => row.target_share, format: pct, tone: "violet" },
  carry: { label: "Carry share", value: (row) => row.carry_share, format: pct, tone: "emerald" },
  air: { label: "Air-yard share", value: (row) => row.air_yard_share, format: pct, tone: "amber" },
  opportunity: { label: "Opportunity share", value: (row) => row.opportunity_share, format: pct, tone: "cyan" },
};

const NGS_LABELS = {
  time_to_throw: ["Time to throw", "s"],
  intended_air_yards: ["Intended air yards", "yd"],
  aggressiveness: ["Aggressive throw rate", "%"],
  cpoe: ["Completion over expected", "%"],
  rush_efficiency: ["Rush efficiency", ""],
  box_eight_rate: ["Eight-man box rate", "%"],
  time_to_line: ["Time to line", "s"],
  ryoe_per_carry: ["Rush yards over expected", "yd/carry"],
  rush_over_expected_rate: ["Rush over expected rate", "%"],
  cushion: ["Defender cushion", "yd"],
  separation: ["Receiver separation", "yd"],
  yac_over_expected: ["YAC over expected", "yd"],
};

function ngsFormat(key, value) {
  if (!present(value)) return "—";
  if (["aggressiveness", "cpoe", "box_eight_rate", "rush_over_expected_rate"].includes(key)) return pct(value);
  return fixed(value, 2);
}

async function loadArchive(season, signal) {
  if (archiveCache.has(season)) return archiveCache.get(season);
  const isCompletedSeason = Number(season) < new Date().getUTCFullYear();
  const response = await fetch(`/stats/advanced/${season}/context.json`, {
    cache: isCompletedSeason ? "force-cache" : "no-cache",
    signal,
  });
  if (!response.ok)
    throw new Error(`Advanced statistics are not available for ${season}.`);
  const payload = await response.json();
  archiveCache.set(season, payload);
  return payload;
}

function playerMatch(row, selected) {
  if (!row || !selected) return false;
  if (row.gsis_id && selected.gsis_id && String(row.gsis_id) === String(selected.gsis_id)) return true;
  const sameName = normalize(row.name) === normalize(selected.name);
  return sameName && (!selected.position || row.position === selected.position);
}

function metricPercentile(value, values) {
  if (!present(value) || !values.length) return null;
  const below = values.filter((candidate) => candidate <= value).length;
  return Math.round((below / values.length) * 100);
}

export default function AdvancedStatsLab({ selected, season, onSelectPlayer }) {
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("role");
  const [metricKey, setMetricKey] = useState("snap");
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [explorerPosition, setExplorerPosition] = useState(
    selected?.position && ["QB", "RB", "WR", "TE"].includes(selected.position)
      ? selected.position
      : "ALL",
  );
  const [explorerTeam, setExplorerTeam] = useState("ALL");
  const [explorerQuery, setExplorerQuery] = useState("");
  const [minimumGames, setMinimumGames] = useState(3);
  const [sortKey, setSortKey] = useState("snap");
  const [sortDirection, setSortDirection] = useState("desc");

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    loadArchive(season, controller.signal)
      .then((payload) => { if (live) setArchive(payload); })
      .catch((failure) => { if (live && failure?.name !== "AbortError") setError(failure?.message || "Advanced statistics could not load."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [season]);

  const teamWeeks = useMemo(() => new Map((archive?.team_weeks || []).map((row) => [`${row.week}|${row.team}`, row])), [archive]);
  const rows = useMemo(() => (archive?.player_weeks || [])
    .filter((row) => playerMatch(row, selected))
    .map((row) => {
      const team = teamWeeks.get(`${row.week}|${row.team}`);
      return {
        ...row,
        team_context: team,
        estimated_route_opportunities: present(row.offense_snaps) && present(team?.offense?.pass_rate)
          ? row.offense_snaps * team.offense.pass_rate
          : null,
      };
    })
    .sort((left, right) => left.week - right.week), [archive, selected, teamWeeks]);

  useEffect(() => {
    setSelectedWeek(rows.at(-1)?.week || null);
  }, [selected?.name, season, rows]);

  const selectedRow = rows.find((row) => row.week === selectedWeek) || rows.at(-1) || null;
  const positionPeers = useMemo(() => {
    if (!archive || !selected?.position) return [];
    const grouped = new Map();
    for (const row of archive.player_weeks || []) {
      if (row.position !== selected.position) continue;
      const key = `${normalize(row.name)}|${row.position}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return [...grouped.entries()].map(([key, games]) => ({
      key,
      name: games[0]?.name,
      team: games.at(-1)?.team,
      position: games[0]?.position,
      games: games.length,
      snap: average(games, (row) => row.offense_pct),
      target: average(games, (row) => row.target_share),
      carry: average(games, (row) => row.carry_share),
      air: average(games, (row) => row.air_yard_share),
      opportunity: average(games, (row) => row.opportunity_share),
    })).filter((row) => row.games >= 3);
  }, [archive, selected?.position]);

  const explorerRows = useMemo(() => {
    if (!archive) return [];
    const grouped = new Map();
    for (const row of archive.player_weeks || []) {
      if (!["QB", "RB", "WR", "TE"].includes(row.position)) continue;
      const key = `${normalize(row.name)}|${row.position}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const rows = [...grouped.entries()].map(([key, games]) => {
      const latest = [...games].sort((a, b) => a.week - b.week).at(-1);
      const routes = games.map((game) => {
        const context = teamWeeks.get(`${game.week}|${game.team}`);
        return present(game.offense_snaps) && present(context?.offense?.pass_rate)
          ? game.offense_snaps * context.offense.pass_rate
          : null;
      });
      const targets = sum(games, (game) => game.targets);
      const carries = sum(games, (game) => game.carries);
      const receivingYards = sum(games, (game) => game.receiving_yards);
      const rushingYards = sum(games, (game) => game.rushing_yards);
      const receivingEpa = sum(games, (game) => game.receiving_epa);
      const rushingEpa = sum(games, (game) => game.rushing_epa);
      const opportunities = targets + carries + sum(games, (game) => game.pass_attempts);
      return {
        key,
        name: latest?.name,
        team: latest?.team,
        position: latest?.position,
        games: games.length,
        snap: average(games, (game) => game.offense_pct),
        opportunity: average(games, (game) => game.opportunity_share),
        target: average(games, (game) => game.target_share),
        carry: average(games, (game) => game.carry_share),
        air: average(games, (game) => game.air_yard_share),
        red_zone: average(games, (game) => game.red_zone_share),
        targets_pg: targets / games.length,
        carries_pg: carries / games.length,
        high_value_pg: sum(games, (game) => game.high_value_touches) / games.length,
        red_zone_pg: sum(games, (game) => num(game.red_zone_targets) + num(game.red_zone_carries)) / games.length,
        route_opportunities_pg: routes.filter(present).length
          ? routes.filter(present).reduce((total, value) => total + value, 0) / routes.filter(present).length
          : null,
        yards_per_target: targets > 0 ? receivingYards / targets : null,
        yards_per_carry: carries > 0 ? rushingYards / carries : null,
        epa_per_opportunity: targets + carries > 0 ? (receivingEpa + rushingEpa) / (targets + carries) : null,
        cpoe: average(games, (game) => game.ngs?.cpoe),
        separation: average(games, (game) => game.ngs?.separation),
        yac_over_expected: average(games, (game) => game.ngs?.yac_over_expected),
        ryoe_per_carry: average(games, (game) => game.ngs?.ryoe_per_carry),
      };
    });
    return rows;
  }, [archive, teamWeeks]);

  const explorerTeams = useMemo(() => [...new Set(explorerRows.map((row) => row.team).filter(Boolean))].sort(), [explorerRows]);
  const filteredExplorerRows = useMemo(() => explorerRows
    .filter((row) => explorerPosition === "ALL" || row.position === explorerPosition)
    .filter((row) => explorerTeam === "ALL" || row.team === explorerTeam)
    .filter((row) => row.games >= minimumGames)
    .filter((row) => !explorerQuery || normalize(row.name).includes(normalize(explorerQuery)))
    .filter((row) => present(row[sortKey]))
    .sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      const difference = num(left[sortKey]) - num(right[sortKey]);
      return difference ? difference * direction : left.name.localeCompare(right.name);
    }), [explorerPosition, explorerQuery, explorerRows, explorerTeam, minimumGames, sortDirection, sortKey]);

  const changeSort = (key) => {
    if (sortKey === key) setSortDirection((current) => current === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDirection("desc"); }
  };
  const openPlayer = (row) => {
    onSelectPlayer?.(row);
    setView("role");
  };

  const metric = ROLE_METRICS[metricKey];
  const metricAverage = average(rows, metric.value);
  const peerValues = positionPeers.map((row) => row[metricKey]).filter(present);
  const percentile = metricPercentile(metricAverage, peerValues);
  const positionRank = present(metricAverage)
    ? peerValues.filter((value) => Number(value) > Number(metricAverage)).length + 1
    : null;
  const ngsKeys = [...new Set(rows.flatMap((row) => Object.keys(row.ngs || {})))];
  const peak = Math.max(0.01, ...rows.map((row) => num(metric.value(row))));
  const aggregates = {
    snap: average(rows, (row) => row.offense_pct),
    opportunities: sum(rows, (row) => row.targets + row.carries + row.pass_attempts),
    highValue: sum(rows, (row) => row.high_value_touches),
    redZone: sum(rows, (row) => row.red_zone_targets + row.red_zone_carries),
    estimatedRoutes: sum(rows, (row) => row.estimated_route_opportunities),
  };

  if (loading) return <LoadingScreen progress={62} text={`Loading ${season} advanced role data…`} />;
  if (error) return <Panel className="border-rose-300/15 p-6 text-rose-100">{error}</Panel>;
  if (!selected) return <Panel className="p-6 text-white/45">Select a player to open Advanced Stats.</Panel>;
  if (!rows.length) return <Panel className="p-6"><h2 className="text-lg font-black">No advanced sample for {selected.name}</h2><p className="mt-2 text-xs leading-5 text-white/40">The saved {season} archive has no matched offensive snap or play-level rows for this player. Missing measurements are not converted into zeroes.</p></Panel>;

  return <div className="min-w-0 space-y-4">
    <Panel className="overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-100/45">Observed advanced evidence · {season}</div>
          <h2 className="mt-1 text-2xl font-black">{selected.name} role laboratory</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">Weekly participation, opportunity ownership, high-leverage touches, efficiency, and official NFL Next Gen measurements. These describe what happened; they are not fantasy projections.</p>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/[0.07] bg-black/15 p-1.5">
          {[["role", "Role"], ["weeks", "Weekly"], ["explorer", "Explorer"], ["dictionary", "Guide"]].map(([key, label]) => <button key={key} type="button" onClick={() => setView(key)} className={`rounded-xl px-2 py-2 text-[9px] font-black transition sm:px-3 sm:text-[10px] ${view === key ? "bg-cyan-300/12 text-cyan-100 ring-1 ring-cyan-300/15" : "text-white/40 hover:bg-white/[0.04]"}`}>{label}</button>)}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Metric label="Average snap share" value={pct(aggregates.snap)} detail={`${rows.length} measured games`} tone="cyan" />
        <Metric label="Opportunities" value={aggregates.opportunities.toFixed(0)} detail="Attempts + carries + targets" tone="violet" />
        <Metric label="High-value touches" value={aggregates.highValue.toFixed(0)} detail="Deep, red-zone or inside-10 work" tone="amber" />
        <Metric label="Red-zone work" value={aggregates.redZone.toFixed(0)} detail="Targets plus carries" tone="rose" />
        <Metric label="Route opportunities" value={aggregates.estimatedRoutes.toFixed(0)} detail="Estimated—not measured routes" tone="emerald" />
      </div>
    </Panel>

    {view === "role" ? <>
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h3 className="text-xl font-black">Role ownership trend</h3><p className="mt-1 text-xs text-white/38">Select a metric and click any week for the underlying evidence.</p></div>
          <label className="min-w-0 sm:w-52"><span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-white/30">Chart metric</span><select value={metricKey} onChange={(event) => setMetricKey(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs">{Object.entries(ROLE_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label={`Average ${metric.label}`} value={metric.format(metricAverage)} detail={`${rows.length} games measured`} tone={metric.tone} />
          <Metric label="Position rank" value={positionRank == null ? "—" : `#${positionRank} of ${peerValues.length}`} detail={percentile == null ? "No qualified comparison" : `${percentile}th percentile · ${selected.position}s with 3+ games`} tone="violet" />
          <Metric label="Latest week" value={metric.format(metric.value(selectedRow))} detail={`Week ${selectedRow.week} vs ${selectedRow.opponent}`} tone="amber" />
        </div>
        <div className="mt-5 max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]"><div className="flex h-[210px] min-w-[620px] items-end gap-2 border-b border-white/10 pb-2">{rows.map((row) => {
          const value = num(metric.value(row));
          const active = row.week === selectedRow.week;
          return <button type="button" key={`${row.week}-${row.team}`} onClick={() => setSelectedWeek(row.week)} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Week ${row.week}: ${metric.format(value)}`}><span className="text-[8px] font-bold text-white/40">{metric.format(value)}</span><div className={`w-full rounded-t ${active ? "bg-amber-300" : "bg-gradient-to-t from-cyan-400/55 to-violet-300/75"}`} style={{ height: `${Math.max(4, value / peak * 145)}px` }} /><span className={`text-[8px] ${active ? "font-black text-amber-100" : "text-white/28"}`}>W{row.week}</span></button>;
        })}</div></div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <Panel className="p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><div className="text-[9px] font-black uppercase tracking-wider text-cyan-100/45">Selected evidence</div><h3 className="mt-1 text-xl font-black">Week {selectedRow.week} vs {selectedRow.opponent}</h3></div><div className="text-right"><div className="text-3xl font-black text-cyan-100">{pct(selectedRow.offense_pct)}</div><div className="text-[8px] text-white/30">SNAP SHARE</div></div></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{[
            ["Targets", selectedRow.targets, `${pct(selectedRow.target_share)} share`],
            ["Carries", selectedRow.carries, `${pct(selectedRow.carry_share)} share`],
            ["Air yards", selectedRow.air_yards, `${pct(selectedRow.air_yard_share)} share`],
            ["Red-zone work", num(selectedRow.red_zone_targets) + num(selectedRow.red_zone_carries), `${pct(selectedRow.red_zone_share)} share`],
            ["Third-down work", selectedRow.third_down_opportunities, "High-leverage usage"],
            ["Two-minute work", selectedRow.two_minute_opportunities, "Hurry-up usage"],
          ].map(([label, value, detail]) => <Metric key={label} label={label} value={fixed(value, 0)} detail={detail} />)}</div>
        </Panel>
        <Panel className="p-5 sm:p-6"><h3 className="text-xl font-black">Efficiency and context</h3><div className="mt-4 grid grid-cols-2 gap-2">{[
          ["Yards / target", selectedRow.yards_per_target], ["Receiving EPA / target", selectedRow.receiving_epa_per_target], ["Yards / carry", selectedRow.yards_per_carry], ["Rushing EPA / carry", selectedRow.rushing_epa_per_carry],
        ].map(([label, value]) => <Metric key={label} label={label} value={fixed(value, 2)} detail="Observed efficiency" tone={present(value) && Number(value) >= 0 ? "emerald" : "amber"} />)}</div>
          <div className="mt-3 rounded-2xl border border-white/[0.06] bg-black/15 p-4 text-[10px] leading-5 text-white/38">Estimated route opportunities: <b className="text-white/70">{fixed(selectedRow.estimated_route_opportunities, 1)}</b>. This equals offensive snaps multiplied by the team’s pass rate. It is useful context, but it is not labeled as routes run because the public archive does not observe every player’s route on every dropback.</div>
        </Panel>
      </div>

      {ngsKeys.length ? <Panel className="p-5 sm:p-6"><div><div className="text-[9px] font-black uppercase tracking-[.18em] text-violet-100/45">NFL Next Gen Stats</div><h3 className="mt-1 text-xl font-black">Tracking-derived measurements</h3><p className="mt-1 text-xs leading-5 text-white/38">Season averages across weeks where the official metric was available. Coverage varies by position and qualifying volume.</p></div><div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{ngsKeys.map((key) => {
        const value = average(rows, (row) => row.ngs?.[key]);
        const [label, unit] = NGS_LABELS[key] || [key.replaceAll("_", " "), ""];
        return <Metric key={key} label={label} value={ngsFormat(key, value)} detail={unit || "Next Gen measurement"} tone="violet" />;
      })}</div></Panel> : null}
    </> : null}

    {view === "weeks" ? <Panel className="overflow-hidden"><div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Complete weekly ledger</h3><p className="mt-1 text-xs text-white/38">Every saved role, opportunity, leverage, and efficiency measurement for {selected.name}.</p></div>
      <div className="divide-y divide-white/[0.06] md:hidden">{rows.map((row) => <button type="button" key={`${row.week}-${row.team}`} onClick={() => { setSelectedWeek(row.week); setView("role"); }} className="w-full p-4 text-left"><div className="flex justify-between gap-3"><div><b>Week {row.week} · {row.team}</b><div className="text-[10px] text-white/32">vs {row.opponent}</div></div><b className="text-cyan-100">{pct(row.offense_pct)} snaps</b></div><div className="mt-3 grid grid-cols-3 gap-2 text-[9px] text-white/42"><span>{row.targets} targets</span><span>{row.carries} carries</span><span>{pct(row.opportunity_share)} opp share</span></div></button>)}</div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35"><tr><th className="px-4 py-3">Week</th><th>Matchup</th><th>Snaps</th><th>Snap %</th><th>Targets</th><th>Target %</th><th>Carries</th><th>Carry %</th><th>Air-yard %</th><th>RZ work</th><th>High-value</th><th>EPA / opp</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{rows.map((row) => <tr key={`${row.week}-${row.team}`} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => { setSelectedWeek(row.week); setView("role"); }}><td className="px-4 py-3 font-black text-cyan-100">{row.week}</td><td>{row.team} vs {row.opponent}</td><td>{fixed(row.offense_snaps, 0)}</td><td>{pct(row.offense_pct)}</td><td>{row.targets}</td><td>{pct(row.target_share)}</td><td>{row.carries}</td><td>{pct(row.carry_share)}</td><td>{pct(row.air_yard_share)}</td><td>{num(row.red_zone_targets) + num(row.red_zone_carries)}</td><td>{row.high_value_touches}</td><td>{fixed(num(row.receiving_epa_per_target) || num(row.rushing_epa_per_carry), 2)}</td></tr>)}</tbody></table></div>
    </Panel> : null}

    {view === "explorer" ? <Panel className="overflow-hidden">
      <div className="border-b border-white/10 p-5 sm:p-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-[9px] font-black uppercase tracking-[.18em] text-emerald-100/45">League-wide advanced database</div><h3 className="mt-1 text-xl font-black">Advanced Stats Explorer</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-white/38">See the complete list behind every percentile. Filter the qualified population, choose a metric, and click its header again to reverse the ranking.</p></div><div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-2 text-xs text-white/42"><b className="text-white/75">{filteredExplorerRows.length}</b> qualified players</div></div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <label className="col-span-2 min-w-0 lg:col-span-1"><span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-white/30">Find player</span><input value={explorerQuery} onChange={(event) => setExplorerQuery(event.target.value)} placeholder="Search name…" className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs" /></label>
          <label><span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-white/30">Position</span><select value={explorerPosition} onChange={(event) => setExplorerPosition(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs">{["ALL", "QB", "RB", "WR", "TE"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-white/30">Team</span><select value={explorerTeam} onChange={(event) => setExplorerTeam(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"><option>ALL</option>{explorerTeams.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-white/30">Minimum games</span><select value={minimumGames} onChange={(event) => setMinimumGames(Number(event.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs">{[1, 3, 6, 10, 14].map((value) => <option key={value} value={value}>{value}+ games</option>)}</select></label>
          <label><span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-white/30">Rank metric</span><select value={sortKey} onChange={(event) => { setSortKey(event.target.value); setSortDirection("desc"); }} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs">{[
            ["snap", "Snap share"], ["opportunity", "Opportunity share"], ["target", "Target share"], ["carry", "Carry share"], ["air", "Air-yard share"], ["targets_pg", "Targets per game"], ["carries_pg", "Carries per game"], ["high_value_pg", "High-value touches/game"], ["red_zone_pg", "Red-zone work/game"], ["route_opportunities_pg", "Route opportunities/game"], ["yards_per_target", "Yards per target"], ["yards_per_carry", "Yards per carry"], ["epa_per_opportunity", "EPA per opportunity"], ["cpoe", "CPOE"], ["separation", "Separation"], ["yac_over_expected", "YAC over expected"], ["ryoe_per_carry", "RYOE per carry"],
          ].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
      </div>
      <div className="divide-y divide-white/[0.06] md:hidden">{filteredExplorerRows.slice(0, 250).map((row, index) => <button type="button" key={row.key} onClick={() => openPlayer(row)} className="w-full p-4 text-left hover:bg-white/[0.03]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-black text-white/25">#{index + 1}</span><b className="truncate">{row.name}</b></div><div className="mt-0.5 text-[9px] text-white/30">{row.team} · {row.position} · {row.games} games</div></div><div className="shrink-0 text-right"><b className="text-lg text-emerald-100">{["snap", "opportunity", "target", "carry", "air", "red_zone", "cpoe"].includes(sortKey) ? pct(row[sortKey]) : fixed(row[sortKey], 2)}</b><div className="text-[8px] uppercase text-white/25">{sortKey.replaceAll("_", " ")}</div></div></div><div className="mt-3 grid grid-cols-3 gap-2 text-[9px] text-white/38"><span>{pct(row.snap)} snaps</span><span>{pct(row.opportunity)} opp share</span><span>{fixed(row.high_value_pg, 1)} HVT/G</span></div></button>)}</div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1120px] text-left text-xs"><thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35"><tr><th className="px-4 py-3">Rank</th><th>Player</th>{[
        ["games", "Games"], ["snap", "Snap %"], ["opportunity", "Opp %"], ["target", "Target %"], ["carry", "Carry %"], ["air", "Air-yard %"], ["high_value_pg", "HVT/G"], ["red_zone_pg", "RZ/G"], ["epa_per_opportunity", "EPA/Opp"],
      ].map(([key, label]) => <th key={key}><button type="button" onClick={() => changeSort(key)} className={sortKey === key ? "text-cyan-100" : "hover:text-white"}>{label}{sortKey === key ? sortDirection === "desc" ? " ↓" : " ↑" : ""}</button></th>)}</tr></thead><tbody className="divide-y divide-white/[0.06]">{filteredExplorerRows.slice(0, 500).map((row, index) => <tr key={row.key} onClick={() => openPlayer(row)} className="cursor-pointer hover:bg-white/[0.035]"><td className="px-4 py-3 font-black text-white/30">#{index + 1}</td><td><b>{row.name}</b><small className="block text-white/28">{row.team} · {row.position}</small></td><td>{row.games}</td><td>{pct(row.snap)}</td><td>{pct(row.opportunity)}</td><td>{pct(row.target)}</td><td>{pct(row.carry)}</td><td>{pct(row.air)}</td><td>{fixed(row.high_value_pg, 1)}</td><td>{fixed(row.red_zone_pg, 1)}</td><td>{fixed(row.epa_per_opportunity, 3)}</td></tr>)}</tbody></table></div>
      <div className="border-t border-white/[0.06] p-4 text-[10px] leading-5 text-white/32">Ranks always reflect the visible filtered population. Metrics with no real observations are excluded rather than ranked as zero. The selected rank metric controls ordering even when it is not one of the compact table columns.</div>
    </Panel> : null}

    {view === "dictionary" ? <div className="grid gap-4 lg:grid-cols-2"><Panel className="p-5 sm:p-6"><h3 className="text-xl font-black">Role and opportunity</h3><div className="mt-4 space-y-2">{[
      ["Snap share", "Percentage of the team’s offensive snaps on which the player participated."], ["Opportunity share", "Player carries plus targets relative to the team’s combined carries and targets."], ["Target share", "Percentage of team pass targets directed to the player."], ["Air-yard share", "Percentage of the team’s intended receiving air yards assigned to the player."], ["High-value touches", "Deep targets, red-zone targets, or carries inside the opponent’s 10-yard line."], ["Route opportunities", "An estimate from player snaps and team pass rate—not measured routes run."],
    ].map(([name, detail]) => <div key={name} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"><b className="text-sm">{name}</b><p className="mt-1 text-[10px] leading-4 text-white/38">{detail}</p></div>)}</div></Panel>
      <Panel className="p-5 sm:p-6"><h3 className="text-xl font-black">Efficiency and tracking</h3><div className="mt-4 space-y-2">{[
        ["EPA", "Expected Points Added measures how much an opportunity changed the offense’s expected scoring outcome."], ["CPOE", "Completion Percentage Over Expected separates quarterback completion performance from throw difficulty."], ["RYOE", "Rushing Yards Over Expected compares actual rushing output with the tracking-based expectation."], ["Separation and cushion", "Tracking measurements describing receiver-defender spacing around routes and targets."], ["Evidence status", "Missing values remain unavailable. They are never converted into a fake zero or silently estimated."],
      ].map(([name, detail]) => <div key={name} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"><b className="text-sm">{name}</b><p className="mt-1 text-[10px] leading-4 text-white/38">{detail}</p></div>)}</div></Panel></div> : null}
  </div>;
}
