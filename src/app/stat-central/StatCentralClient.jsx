"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";

const TABS = [
  ["overview", "Player Research"],
  ["history", "Career History"],
  ["compare", "Compare Players"],
  ["matchups", "Matchup Lab"],
  ["leaders", "Leaderboards"],
  ["method", "Data Guide"],
];
const CORE_POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
const SCORING = [
  ["PPR", "PPR"],
  ["HALF", "Half PPR"],
  ["STD", "Standard"],
];
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const quantile = (values, percentile) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index),
    high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const round = (value, places = 1) => Number(num(value).toFixed(places));

function Panel({ children, className = "" }) {
  return (
    <section
      className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}
    >
      {children}
    </section>
  );
}
function Metric({ label, value, detail, tone = "cyan" }) {
  const tones = {
    cyan: "text-cyan-100",
    emerald: "text-emerald-100",
    amber: "text-amber-100",
    violet: "text-violet-100",
    rose: "text-rose-100",
  };
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/30">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-black ${tones[tone] || tones.cyan}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-white/35">{detail}</div>
    </div>
  );
}
function PlayerName({ player }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-black">
        {player?.name || "Unknown player"}
      </div>
      <div className="mt-0.5 text-[10px] text-white/35">
        {[player?.team, player?.position].filter(Boolean).join(" · ") ||
          "Player"}
      </div>
    </div>
  );
}
function Select({ label, value, onChange, children }) {
  const comparison = label === "Comparison player";
  return (
    <label
      data-stat-comparison={comparison ? "true" : undefined}
      className="min-w-0"
    >
      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.15em] text-white/30">
        {label}
      </span>
      <select
        data-stat-season={label === "Season" ? "true" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
function playerMetrics(player, positionPlayers = []) {
  const values = Object.values(player?.weeks || {})
    .map(num)
    .filter((value) => Number.isFinite(value));
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const variance = values.length
    ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) /
      values.length
    : 0;
  const ceiling = quantile(values, 0.9);
  const floor = quantile(values, 0.1);
  const boomLine = Math.max(15, average * 1.35);
  const bustLine = Math.max(3, average * 0.55);
  const boom = values.length
    ? (values.filter((value) => value >= boomLine).length / values.length) * 100
    : 0;
  const bust = values.length
    ? (values.filter((value) => value <= bustLine).length / values.length) * 100
    : 0;
  const consistency =
    average > 0 ? Math.max(0, 100 - (Math.sqrt(variance) / average) * 55) : 0;
  const ranked = [...positionPlayers].sort(
    (a, b) => num(b.points) - num(a.points),
  );
  const rank = ranked.findIndex((row) => row.key === player?.key) + 1;
  const archetype =
    consistency >= 78 && ceiling < average * 1.55
      ? "Stable floor"
      : boom >= 28 && consistency < 68
        ? "Volatile ceiling"
        : average >= 15 && consistency >= 68
          ? "Every-week anchor"
          : bust >= 38
            ? "Matchup dependent"
            : "Balanced producer";
  return {
    values,
    average,
    median: quantile(values, 0.5),
    floor,
    ceiling,
    volatility: Math.sqrt(variance),
    boom,
    bust,
    consistency,
    rank,
    archetype,
  };
}

function mergeHistory(payload, playerDb) {
  const byName = new Map();
  const sleeperById = new Map();
  Object.entries(playerDb || {}).forEach(([id, player]) => {
    const name =
      player?.full_name ||
      `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
    if (name)
      byName.set(
        `${normalize(name)}|${String(player?.position || "").toUpperCase()}`,
        { ...player, sleeper_id: id, name },
      );
    sleeperById.set(String(id), { ...player, sleeper_id: id, name });
  });
  const sleeperRows = new Map(
    (payload?.sleeper?.players || []).map((row) => [
      String(row.player_id),
      row,
    ]),
  );
  const fantasyPros = (payload?.fantasypros?.players || []).map(
    (row, index) => {
      const context =
        byName.get(
          `${normalize(row.name)}|${String(row.position || "").toUpperCase()}`,
        ) ||
        [...byName.values()].find(
          (player) => normalize(player.name) === normalize(row.name),
        );
      const raw = context?.sleeper_id
        ? sleeperRows.get(String(context.sleeper_id))
        : null;
      return {
        ...row,
        key: `fp:${row.player_id || index}:${normalize(row.name)}`,
        sleeper_id: context?.sleeper_id || "",
        team: row.team || context?.team || "",
        position: row.position || context?.position || "",
        age: context?.age || null,
        years_exp: context?.years_exp || null,
        injury_status: context?.injury_status || null,
        stats: raw?.stats || {},
        weekly_stats: raw?.weekly_stats || {},
        source: "FantasyPros",
      };
    },
  );
  if (fantasyPros.length) return fantasyPros;
  return (payload?.sleeper?.players || []).map((row) => {
    const context = sleeperById.get(String(row.player_id)) || {};
    return {
      ...row,
      key: `sl:${row.player_id}`,
      name: context.name || row.player_id,
      team: context.team || "",
      position: context.position || "",
      age: context.age || null,
      years_exp: context.years_exp || null,
      injury_status: context.injury_status || null,
      source: "Sleeper",
    };
  });
}

function weeklySummary(stats, position) {
  if (!stats || typeof stats !== "object") return "Fantasy scoring result";
  const parts = [];
  if (num(stats.pass_yd))
    parts.push(`${num(stats.pass_yd).toFixed(0)} pass yd`);
  if (num(stats.pass_td)) parts.push(`${num(stats.pass_td)} pass TD`);
  if (num(stats.pass_int)) parts.push(`${num(stats.pass_int)} INT`);
  if (num(stats.rush_att)) parts.push(`${num(stats.rush_att)} car`);
  if (num(stats.rush_yd))
    parts.push(`${num(stats.rush_yd).toFixed(0)} rush yd`);
  if (num(stats.rush_td)) parts.push(`${num(stats.rush_td)} rush TD`);
  if (num(stats.rec_tgt)) parts.push(`${num(stats.rec_tgt)} tgt`);
  if (num(stats.rec)) parts.push(`${num(stats.rec)} rec`);
  if (num(stats.rec_yd)) parts.push(`${num(stats.rec_yd).toFixed(0)} rec yd`);
  if (num(stats.rec_td)) parts.push(`${num(stats.rec_td)} rec TD`);
  if (String(position).toUpperCase() === "K" && num(stats.fgm))
    parts.push(`${num(stats.fgm)}/${num(stats.fga)} FG`);
  return parts.slice(0, 5).join(" · ") || "Fantasy scoring result";
}

async function loadSavedSeason(season, scoring, position, signal) {
  const fantasyProsResponse = await fetch(
    `/stats/history/${season}/fantasypros.json`,
    { cache: "force-cache", signal },
  );
  if (!fantasyProsResponse.ok)
    throw new Error(
      `The saved ${season} scoring file is not available on this deployment.`,
    );
  const fantasyPros = await fantasyProsResponse.json();
  let sleeper = null;
  let schedule = null;
  if (num(season) >= 2018) {
    try {
      const [sleeperResponse, scheduleResponse] = await Promise.all([
        fetch(`/stats/history/${season}/sleeper.json`, {
          cache: "force-cache",
          signal,
        }),
        fetch(`/stats/history/${season}/schedule.json`, {
          cache: "force-cache",
          signal,
        }),
      ]);
      if (sleeperResponse.ok) sleeper = await sleeperResponse.json();
      if (scheduleResponse.ok) schedule = await scheduleResponse.json();
    } catch (failure) {
      if (failure?.name === "AbortError") throw failure;
    }
  }
  const scoreKey = String(scoring || "PPR").toLowerCase();
  const fantasyProsPlayers = (
    Array.isArray(fantasyPros?.players) ? fantasyPros.players : []
  )
    .filter(
      (player) =>
        position === "ALL" ||
        String(player?.position || "").toUpperCase() === position,
    )
    .map((player) => {
      const values = player?.scoring?.[scoreKey] || {};
      return {
        player_id: player.player_id,
        name: player.name,
        position: player.position,
        team: player.team,
        games: num(values.games),
        points: num(values.points),
        average: num(values.average),
        weeks:
          values.weeks && typeof values.weeks === "object" ? values.weeks : {},
      };
    })
    .filter((player) => player.games > 0);
  const sleeperPlayers = (
    Array.isArray(sleeper?.players) ? sleeper.players : []
  ).map((player) => {
    const field =
      scoring === "STD" ? "std" : scoring === "HALF" ? "half" : "ppr";
    const weeks = Object.fromEntries(
      Object.entries(player?.weeks || {}).map(([week, points]) => [
        week,
        num(points?.[field]),
      ]),
    );
    const values = Object.values(weeks);
    const points = values.reduce((sum, value) => sum + value, 0);
    return {
      ...player,
      weeks,
      games: values.length,
      points: round(points, 3),
      average: values.length ? round(points / values.length, 3) : 0,
    };
  });
  if (!fantasyProsPlayers.length && !sleeperPlayers.length)
    throw new Error(
      `No scored ${position === "ALL" ? "players" : position + "s"} were found for ${season}.`,
    );
  return {
    ok: true,
    season: num(season),
    scoring,
    position,
    source: sleeperPlayers.length
      ? "Saved FantasyPros + Sleeper"
      : "Saved FantasyPros",
    fantasypros: {
      available: fantasyProsPlayers.length > 0,
      updated: fantasyPros?.updated || null,
      players: fantasyProsPlayers,
    },
    sleeper: {
      available: sleeperPlayers.length > 0,
      updated: sleeper?.updated || null,
      players: sleeperPlayers,
    },
    coverage: {
      fantasypros_players: fantasyProsPlayers.length,
      sleeper_records: sleeperPlayers.length,
      sleeper_raw_stats: sleeperPlayers.length > 0,
    },
    schedule,
  };
}

function WeeklyChart({ player, opponent }) {
  const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
  const max = Math.max(
    1,
    ...weeks.flatMap((week) => [
      num(player?.weeks?.[week]),
      num(opponent?.weeks?.[week]),
    ]),
  );
  const played = weeks.filter((week) =>
    Object.prototype.hasOwnProperty.call(player?.weeks || {}, week),
  );
  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="flex min-w-[680px] items-end gap-2 border-b border-white/10 pb-2"
          style={{ height: 230 }}
        >
          {weeks.map((week) => {
            const primary = num(player?.weeks?.[week]),
              secondary = num(opponent?.weeks?.[week]);
            return (
              <div
                key={week}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <div className="flex w-full items-end justify-center gap-0.5">
                  <div
                    className="w-1/2 rounded-t bg-cyan-300/65"
                    style={{
                      height: `${Math.max(primary ? 3 : 0, (primary / max) * 150)}px`,
                    }}
                    title={`${player?.name}: ${primary.toFixed(1)}`}
                  />
                  {opponent ? (
                    <div
                      className="w-1/2 rounded-t bg-violet-300/65"
                      style={{
                        height: `${Math.max(secondary ? 3 : 0, (secondary / max) * 150)}px`,
                      }}
                      title={`${opponent?.name}: ${secondary.toFixed(1)}`}
                    />
                  ) : null}
                </div>
                <span className="text-[8px] text-white/30">W{week}</span>
              </div>
            );
          })}
        </div>
      </div>
      {!opponent ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07]">
          <div className="grid grid-cols-[70px_1fr_100px] bg-white/[0.04] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-white/35">
            <span>Week</span>
            <span>Game production</span>
            <span className="text-right">Fantasy pts</span>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {played.map((week) => {
              const points = num(player?.weeks?.[week]);
              const average = num(player?.average);
              return (
                <div
                  key={week}
                  className="grid grid-cols-[70px_minmax(0,1fr)_70px] items-center px-4 py-3 text-xs sm:grid-cols-[70px_minmax(0,1fr)_100px]"
                >
                  <b>Week {week}</b>
                  <div className="min-w-0">
                    <div className="truncate text-white/60">
                      {weeklySummary(
                        player?.weekly_stats?.[week],
                        player?.position,
                      )}
                    </div>
                    <small
                      className={
                        points >= average
                          ? "text-emerald-200/70"
                          : "text-white/28"
                      }
                    >
                      {points >= average
                        ? "Above season average"
                        : "Below season average"}
                    </small>
                  </div>
                  <b className="text-right text-cyan-100">
                    {points.toFixed(1)}
                  </b>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrendChart({ player }) {
  const rows = Object.entries(player?.weeks || {})
    .map(([week, points]) => ({ week: num(week), points: num(points) }))
    .sort((a, b) => a.week - b.week);
  if (rows.length < 2) return null;
  const rolling = rows.map((row, index) => ({
    ...row,
    rolling:
      rows
        .slice(Math.max(0, index - 2), index + 1)
        .reduce((sum, item) => sum + item.points, 0) / Math.min(3, index + 1),
  }));
  const max = Math.max(
    1,
    ...rolling.flatMap((row) => [row.points, row.rolling]),
  );
  const point = (row, key, index) =>
    `${(index / Math.max(1, rolling.length - 1)) * 100},${100 - (num(row[key]) / max) * 88}`;
  const first =
    rolling
      .slice(0, Math.ceil(rolling.length / 2))
      .reduce((sum, row) => sum + row.points, 0) /
    Math.ceil(rolling.length / 2);
  const secondRows = rolling.slice(Math.ceil(rolling.length / 2));
  const second =
    secondRows.reduce((sum, row) => sum + row.points, 0) /
    Math.max(1, secondRows.length);
  return (
    <Panel className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Season trajectory</h2>
          <p className="mt-1 text-xs text-white/38">
            Weekly scoring and a three-game rolling trend.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[10px] font-black ${second >= first ? "bg-emerald-300/10 text-emerald-100" : "bg-amber-300/10 text-amber-100"}`}
        >
          {second >= first ? "Trending up" : "Cooling off"} ·{" "}
          {Math.abs(second - first).toFixed(1)} pts/game
        </span>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07] bg-black/15 p-3">
        <svg
          viewBox="0 0 100 108"
          className="h-56 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label="Weekly fantasy point trend"
        >
          <defs>
            <linearGradient id="statArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#67e8f9" stopOpacity=".28" />
              <stop offset="1" stopColor="#67e8f9" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,.07)"
              strokeWidth=".5"
            />
          ))}
          <polygon
            points={`0,100 ${rolling.map((row, index) => point(row, "points", index)).join(" ")} 100,100`}
            fill="url(#statArea)"
          />
          <polyline
            points={rolling
              .map((row, index) => point(row, "points", index))
              .join(" ")}
            fill="none"
            stroke="#67e8f9"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={rolling
              .map((row, index) => point(row, "rolling", index))
              .join(" ")}
            fill="none"
            stroke="#c4b5fd"
            strokeWidth="2.3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="mt-2 flex justify-between text-[9px] text-white/30">
          <span>Week {rows[0].week}</span>
          <span className="text-cyan-100/60">Weekly points</span>
          <span className="text-violet-100/60">3-game trend</span>
          <span>Week {rows.at(-1).week}</span>
        </div>
      </div>
    </Panel>
  );
}

function ProductionTrend({ player }) {
  const rows = Object.keys(player?.weeks || {})
    .map((week) => ({
      week: num(week),
      stats: player?.weekly_stats?.[week] || {},
    }))
    .sort((a, b) => a.week - b.week);
  const categories = [
    { key: "pass_yd", label: "Pass yards", tone: "bg-cyan-300/70" },
    { key: "rush_yd", label: "Rush yards", tone: "bg-emerald-300/70" },
    { key: "rec_yd", label: "Receiving yards", tone: "bg-violet-300/70" },
    { key: "rec_tgt", label: "Targets", tone: "bg-amber-300/70" },
  ].filter((category) =>
    rows.some((row) => num(row.stats?.[category.key]) > 0),
  );
  if (!categories.length) return null;
  return (
    <Panel className="p-5 sm:p-6">
      <h2 className="text-xl font-black">Production by week</h2>
      <p className="mt-1 text-xs text-white/38">
        Compare the underlying workload and yardage that created the fantasy
        results.
      </p>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {categories.map((category) => {
          const max = Math.max(
            1,
            ...rows.map((row) => num(row.stats?.[category.key])),
          );
          return (
            <div
              key={category.key}
              className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"
            >
              <div className="flex justify-between text-xs">
                <b>{category.label}</b>
                <span className="text-white/30">Peak {max.toFixed(0)}</span>
              </div>
              <div className="mt-3 flex h-28 items-end gap-1.5">
                {rows.map((row) => (
                  <div
                    key={row.week}
                    className="group flex min-w-0 flex-1 flex-col items-center justify-end"
                  >
                    <div
                      title={`Week ${row.week}: ${num(row.stats?.[category.key]).toFixed(0)}`}
                      className={`w-full min-w-[3px] rounded-t ${category.tone}`}
                      style={{
                        height: `${Math.max(num(row.stats?.[category.key]) ? 3 : 0, (num(row.stats?.[category.key]) / max) * 88)}px`,
                      }}
                    />
                    <span className="mt-1 text-[7px] text-white/25">
                      {row.week}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const normalizeTeam = (team) =>
  ({ OAK: "LV", SD: "LAC", STL: "LAR", JAX: "JAC", WSH: "WAS" })[
    String(team || "").toUpperCase()
  ] || String(team || "").toUpperCase();
function MatchupLab({ players, schedule, season }) {
  const [position, setPosition] = useState("QB");
  const [offense, setOffense] = useState("");
  const rows = useMemo(() => {
    const opponentByWeek = {};
    (schedule?.weeks || []).forEach(({ week, games }) =>
      (games || []).forEach((game) => {
        const home = normalizeTeam(game.home),
          away = normalizeTeam(game.away);
        opponentByWeek[`${week}:${home}`] = away;
        opponentByWeek[`${week}:${away}`] = home;
      }),
    );
    const defense = new Map(),
      attack = new Map();
    players
      .filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position))
      .forEach((player) =>
        Object.entries(player.weeks || {}).forEach(([week, points]) => {
          const team = normalizeTeam(player.team),
            opponent = opponentByWeek[`${week}:${team}`];
          if (!team || !opponent) return;
          const dKey = `${opponent}:${player.position}`,
            oKey = `${team}:${player.position}`;
          const d = defense.get(dKey) || {
            team: opponent,
            position: player.position,
            points: 0,
            weeks: new Set(),
          };
          d.points += num(points);
          d.weeks.add(String(week));
          defense.set(dKey, d);
          const o = attack.get(oKey) || {
            team,
            position: player.position,
            points: 0,
            weeks: new Set(),
          };
          o.points += num(points);
          o.weeks.add(String(week));
          attack.set(oKey, o);
        }),
      );
    const finish = (map) =>
      [...map.values()].map((row) => ({
        ...row,
        games: row.weeks.size,
        average: row.points / Math.max(1, row.weeks.size),
      }));
    return { defense: finish(defense), attack: finish(attack) };
  }, [players, schedule]);
  if (!(schedule?.weeks || []).some((row) => (row.games || []).length))
    return (
      <Panel className="p-8 text-center">
        <h2 className="text-xl font-black">Matchup schedule unavailable</h2>
        <p className="mt-2 text-sm text-white/40">
          Defense-vs-position analysis is available for enriched seasons from
          2018 onward.
        </p>
      </Panel>
    );
  const defenses = rows.defense
    .filter((row) => row.position === position)
    .sort((a, b) => a.average - b.average);
  const offenses = rows.attack
    .filter((row) => row.position === position)
    .sort((a, b) => b.average - a.average);
  const teams = [...new Set(rows.attack.map((row) => row.team))].sort();
  const selectedOffense = offense || teams[0] || "";
  const offenseRow = rows.attack.find(
    (row) => row.team === selectedOffense && row.position === position,
  );
  const leagueOffense =
    offenses.reduce((sum, row) => sum + row.average, 0) /
    Math.max(1, offenses.length);
  return (
    <div className="space-y-4">
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.2em] text-violet-100/50">
              Opponent-adjusted research
            </div>
            <h2 className="mt-1 text-2xl font-black">{season} Matchup Lab</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/40">
              Weekly player scoring is joined to the saved NFL schedule.
              “Allowed” means total fantasy points surrendered to that position
              per team game—not a defensive player grade.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select label="Position" value={position} onChange={setPosition}>
              {["QB", "RB", "WR", "TE"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
            <Select
              label="Offense"
              value={selectedOffense}
              onChange={setOffense}
            >
              {teams.map((team) => (
                <option key={team}>{team}</option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-white/10 p-5">
            <h3 className="text-lg font-black">Defenses vs {position}</h3>
            <p className="mt-1 text-xs text-white/35">
              Lowest allowed is toughest. Highest allowed is most favorable.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
            <div className="bg-slate-950/90 p-4">
              <div className="text-[9px] uppercase text-emerald-200/50">
                Toughest
              </div>
              {defenses.slice(0, 8).map((row, index) => (
                <div
                  key={row.team}
                  className="mt-2 flex justify-between text-xs"
                >
                  <span>
                    #{index + 1} {row.team}
                  </span>
                  <b className="text-emerald-100">{row.average.toFixed(1)}</b>
                </div>
              ))}
            </div>
            <div className="bg-slate-950/90 p-4">
              <div className="text-[9px] uppercase text-rose-200/50">
                Most favorable
              </div>
              {defenses
                .slice(-8)
                .reverse()
                .map((row, index) => (
                  <div
                    key={row.team}
                    className="mt-2 flex justify-between text-xs"
                  >
                    <span>
                      #{index + 1} {row.team}
                    </span>
                    <b className="text-rose-100">{row.average.toFixed(1)}</b>
                  </div>
                ))}
            </div>
          </div>
        </Panel>
        <Panel className="p-5">
          <h3 className="text-lg font-black">Offensive production</h3>
          <p className="mt-1 text-xs text-white/35">
            Team-level {position} fantasy output per game.
          </p>
          <div className="mt-4 space-y-2">
            {offenses.slice(0, 12).map((row, index) => (
              <div
                key={row.team}
                className="grid grid-cols-[36px_42px_1fr_50px] items-center gap-2 text-xs"
              >
                <span className="text-white/25">#{index + 1}</span>
                <b>{row.team}</b>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300/70 to-violet-300/70"
                    style={{
                      width: `${Math.min(100, (row.average / Math.max(1, offenses[0]?.average)) * 100)}%`,
                    }}
                  />
                </div>
                <b className="text-right">{row.average.toFixed(1)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel className="p-5 sm:p-6">
        <h3 className="text-lg font-black">
          {selectedOffense} {position} matchup profile
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Offense average"
            value={offenseRow ? offenseRow.average.toFixed(1) : "—"}
            detail="Fantasy points produced per game"
            tone="cyan"
          />
          <Metric
            label="NFL average"
            value={leagueOffense.toFixed(1)}
            detail={`${position} team production baseline`}
            tone="violet"
          />
          <Metric
            label="Offensive index"
            value={
              offenseRow
                ? `${Math.round((offenseRow.average / Math.max(1, leagueOffense)) * 100)}`
                : "—"
            }
            detail="100 is league average"
            tone={offenseRow?.average >= leagueOffense ? "emerald" : "amber"}
          />
        </div>
        <p className="mt-4 text-[10px] leading-4 text-white/28">
          Team attribution uses the season team supplied with the saved
          FantasyPros record. Players who changed NFL teams midseason may retain
          their final listed team, so matchup aggregates are directional
          evidence rather than official NFL splits.
        </p>
      </Panel>
    </div>
  );
}

function PerformanceLab({ selected, metrics, positionPlayers }) {
  if (!selected)
    return (
      <Panel className="p-8 text-center text-sm text-white/40">
        Choose a player to open the Performance Lab.
      </Panel>
    );
  const statGroups = [
    [
      "Passing",
      [
        ["Pass yards", "pass_yd"],
        ["Pass TD", "pass_td"],
        ["INT", "pass_int"],
        ["Attempts", "pass_att"],
        ["Completions", "pass_cmp"],
      ],
    ],
    [
      "Rushing",
      [
        ["Rush yards", "rush_yd"],
        ["Rush TD", "rush_td"],
        ["Carries", "rush_att"],
      ],
    ],
    [
      "Receiving",
      [
        ["Targets", "rec_tgt"],
        ["Receptions", "rec"],
        ["Rec yards", "rec_yd"],
        ["Rec TD", "rec_td"],
      ],
    ],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Season points"
          value={selected.points.toFixed(1)}
          detail={`${selected.games || metrics.values.length} scored games`}
          tone="emerald"
        />
        <Metric
          label="Median"
          value={metrics.median.toFixed(1)}
          detail={`Average ${metrics.average.toFixed(1)}`}
        />
        <Metric
          label="Floor · Ceiling"
          value={`${metrics.floor.toFixed(1)} · ${metrics.ceiling.toFixed(1)}`}
          detail="10th and 90th percentiles"
          tone="violet"
        />
        <Metric
          label="Position finish"
          value={metrics.rank ? `${selected.position}${metrics.rank}` : "—"}
          detail={`${positionPlayers.length} scored ${selected.position}s`}
          tone="amber"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-black">Weekly scoring profile</h2>
              <p className="mt-1 text-xs text-white/38">
                Every available regular-season scoring result.
              </p>
            </div>
            <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-[10px] font-black text-cyan-100">
              {metrics.archetype}
            </span>
          </div>
          <div className="mt-6">
            <WeeklyChart player={selected} />
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-lg font-black">Performance identity</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric
              label="Consistency"
              value={`${metrics.consistency.toFixed(0)}%`}
              detail="Lower weekly variance"
              tone="emerald"
            />
            <Metric
              label="Volatility"
              value={metrics.volatility.toFixed(1)}
              detail="Weekly standard deviation"
              tone="violet"
            />
            <Metric
              label="Boom rate"
              value={`${metrics.boom.toFixed(0)}%`}
              detail="At least 135% of average"
              tone="cyan"
            />
            <Metric
              label="Bust rate"
              value={`${metrics.bust.toFixed(0)}%`}
              detail="At most 55% of average"
              tone="rose"
            />
          </div>
        </Panel>
      </div>
      <TrendChart player={selected} />
      <ProductionTrend player={selected} />
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black">Underlying production</h2>
            <p className="mt-1 text-xs text-white/38">
              Season totals from Sleeper’s raw weekly stat feed.
            </p>
          </div>
          <span className="rounded-full bg-white/[0.05] px-3 py-1 text-[9px] text-white/40">
            Observed stats
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {statGroups.map(([title, stats]) => (
            <div
              key={title}
              className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"
            >
              <h3 className="font-black">{title}</h3>
              <div className="mt-3 space-y-2">
                {stats.map(([label, key]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-white/38">{label}</span>
                    <b>{num(selected.stats?.[key]).toLocaleString()}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Compare({ first, second, allPlayers }) {
  if (!first || !second)
    return (
      <Panel className="p-8 text-center text-white/40">
        Select two players to compare.
      </Panel>
    );
  const a = playerMetrics(
    first,
    allPlayers.filter((row) => row.position === first.position),
  );
  const b = playerMetrics(
    second,
    allPlayers.filter((row) => row.position === second.position),
  );
  const weeks = Array.from(
    new Set([
      ...Object.keys(first.weeks || {}),
      ...Object.keys(second.weeks || {}),
    ]),
  );
  let firstWins = 0,
    secondWins = 0,
    ties = 0;
  weeks.forEach((week) => {
    const x = num(first.weeks?.[week]),
      y = num(second.weeks?.[week]);
    if (x > y) firstWins++;
    else if (y > x) secondWins++;
    else ties++;
  });
  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="grid gap-px bg-white/[0.06] md:grid-cols-[1fr_180px_1fr]">
          <div className="bg-slate-950/90 p-5">
            <PlayerName player={first} />
            <div className="mt-4 text-4xl font-black text-cyan-100">
              {firstWins}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-white/30">
              Weeks outscored
            </div>
          </div>
          <div className="flex flex-col items-center justify-center bg-slate-950/90 p-5 text-center">
            <div className="text-[9px] font-black uppercase tracking-wider text-white/30">
              Head to head
            </div>
            <div className="mt-1 text-2xl font-black">{ties} ties</div>
            <div className="mt-1 text-[10px] text-white/35">
              {weeks.length} comparable weeks
            </div>
          </div>
          <div className="bg-slate-950/90 p-5 text-right">
            <PlayerName player={second} />
            <div className="mt-4 text-4xl font-black text-violet-100">
              {secondWins}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-white/30">
              Weeks outscored
            </div>
          </div>
        </div>
      </Panel>
      <Panel className="p-5">
        <WeeklyChart player={first} opponent={second} />
        <div className="mt-3 flex gap-4 text-[10px] text-white/40">
          <span>
            <i className="mr-1 inline-block h-2 w-2 bg-cyan-300/65" />{" "}
            {first.name}
          </span>
          <span>
            <i className="mr-1 inline-block h-2 w-2 bg-violet-300/65" />{" "}
            {second.name}
          </span>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={`${first.name} average`}
          value={a.average.toFixed(1)}
          detail={`Median ${a.median.toFixed(1)}`}
        />
        <Metric
          label={`${second.name} average`}
          value={b.average.toFixed(1)}
          detail={`Median ${b.median.toFixed(1)}`}
          tone="violet"
        />
        <Metric
          label="Safer profile"
          value={a.consistency >= b.consistency ? first.name : second.name}
          detail={`${Math.max(a.consistency, b.consistency).toFixed(0)}% consistency`}
          tone="emerald"
        />
        <Metric
          label="Higher ceiling"
          value={a.ceiling >= b.ceiling ? first.name : second.name}
          detail={`${Math.max(a.ceiling, b.ceiling).toFixed(1)} point P90`}
          tone="amber"
        />
      </div>
    </div>
  );
}

export default function StatCentralClient() {
  const { players: playerDb = {} } = useSleeper();
  const completedSeason = new Date().getFullYear() - 1;
  const [tab, setTab] = useState("overview");
  const [season, setSeason] = useState(completedSeason);
  const [scoring, setScoring] = useState("PPR");
  const [position, setPosition] = useState("ALL");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [compareKey, setCompareKey] = useState("");
  const [career, setCareer] = useState([]);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerProgress, setCareerProgress] = useState(0);
  const [availableSeasons, setAvailableSeasons] = useState([completedSeason]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.statTab = tab;
    return () => {
      delete document.documentElement.dataset.statTab;
    };
  }, [tab]);

  useEffect(() => {
    fetch("/stats/history/manifest.json", { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        const saved = (manifest?.seasons || [])
          .map((row) => num(row.season))
          .filter(Boolean)
          .sort((a, b) => b - a);
        if (saved.length) {
          setAvailableSeasons(saved);
          setSeason((current) =>
            saved.includes(current) ? current : saved[0],
          );
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    loadSavedSeason(season, scoring, position, controller.signal)
      .then((payload) => {
        if (live) setData(payload);
      })
      .catch((failure) => {
        if (live && failure?.name !== "AbortError")
          setError(
            failure?.message || "Stat Central could not load this season.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [season, scoring, position, reloadToken]);
  const allPlayers = useMemo(
    () =>
      mergeHistory(data, playerDb).filter(
        (player) => position === "ALL" || player.position === position,
      ),
    [data, playerDb, position],
  );
  const filtered = useMemo(
    () =>
      allPlayers
        .filter(
          (player) =>
            !query || normalize(player.name).includes(normalize(query)),
        )
        .sort((a, b) => b.points - a.points),
    [allPlayers, query],
  );
  useEffect(() => {
    if (!allPlayers.length) return;
    if (!allPlayers.some((player) => player.key === selectedKey))
      setSelectedKey(allPlayers[0].key);
    if (!allPlayers.some((player) => player.key === compareKey))
      setCompareKey(allPlayers[1]?.key || allPlayers[0].key);
  }, [allPlayers, selectedKey, compareKey]);
  const selected = allPlayers.find((player) => player.key === selectedKey);
  const compared = allPlayers.find((player) => player.key === compareKey);
  const positionPlayers = allPlayers.filter(
    (player) => player.position === selected?.position,
  );
  const metrics = playerMetrics(selected, positionPlayers);

  async function loadCareer() {
    if (!selected) return;
    setCareerLoading(true);
    setCareerProgress(2);
    const seasons = [...availableSeasons].sort((a, b) => a - b);
    const rows = [];
    for (const [index, year] of seasons.entries()) {
      try {
        const payload = await loadSavedSeason(
          year,
          scoring,
          selected.position || "ALL",
        );
        const match = mergeHistory(payload, playerDb).find(
          (player) => normalize(player.name) === normalize(selected.name),
        );
        if (match?.games) rows.push({ ...match, season: year });
      } catch {}
      setCareerProgress(Math.round(((index + 1) / seasons.length) * 100));
    }
    setCareer(rows);
    setCareerLoading(false);
  }

  return (
    <main className="min-h-screen text-white">
      <BackgroundParticles />
      <Navbar pageTitle="Stat Central" />
      <div className="mx-auto max-w-7xl px-3 pb-24 pt-20 sm:px-5">
        <header className="overflow-hidden rounded-[34px] border border-cyan-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(34,211,238,.2),transparent_38%),radial-gradient(circle_at_4%_100%,rgba(139,92,246,.16),transparent_35%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-8">
          <div className="text-[10px] font-black uppercase tracking-[.28em] text-cyan-200/60">
            Production · consistency · history
          </div>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">Stat Central</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/48">
            Research actual fantasy performance across seasons. Explore weekly
            results, career trends, positional finishes, floor and ceiling,
            volatility, player archetypes, raw production, and direct start/sit
            history.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Season"
              value={season}
              onChange={(value) => {
                setSeason(num(value));
                setCareer([]);
              }}
            >
              {Array.from(
                { length: completedSeason - 2012 + 1 },
                (_, index) => completedSeason - index,
              ).map((year) => (
                <option key={year}>{year}</option>
              ))}
            </Select>
            <Select
              label="Scoring"
              value={scoring}
              onChange={(value) => {
                setScoring(value);
                setCareer([]);
              }}
            >
              {SCORING.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select label="Position" value={position} onChange={setPosition}>
              {CORE_POSITIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
            <label>
              <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.15em] text-white/30">
                Find a player
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name…"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <Select
              label="Primary player"
              value={selectedKey}
              onChange={setSelectedKey}
            >
              {filtered.slice(0, 500).map((player) => (
                <option key={player.key} value={player.key}>
                  {player.name} · {player.position} · {player.points.toFixed(1)}
                </option>
              ))}
            </Select>
            <Select
              label="Comparison player"
              value={compareKey}
              onChange={setCompareKey}
            >
              {filtered.slice(0, 500).map((player) => (
                <option key={player.key} value={player.key}>
                  {player.name} · {player.position} · {player.points.toFixed(1)}
                </option>
              ))}
            </Select>
          </div>
        </header>
        <div className="mt-4 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/80 p-2">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                if (key === "matchups" && position !== "ALL")
                  setPosition("ALL");
              }}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black transition ${tab === key ? "bg-cyan-300/15 text-cyan-100" : "text-white/38 hover:bg-white/5 hover:text-white/70"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading ? (
          <LoadingScreen
            progress={65}
            text={`Loading ${season} Stat Central…`}
          />
        ) : error ? (
          <Panel className="mt-4 border-rose-300/15 p-6 text-rose-100">
            {error}
          </Panel>
        ) : (
          <div className="mt-4">
            {tab === "overview" ? (
              <PerformanceLab
                selected={selected}
                metrics={metrics}
                positionPlayers={positionPlayers}
              />
            ) : null}
            {tab === "compare" ? (
              <Compare
                first={selected}
                second={compared}
                allPlayers={allPlayers}
              />
            ) : null}
            {tab === "matchups" ? (
              <MatchupLab
                players={allPlayers}
                schedule={data?.schedule}
                season={season}
              />
            ) : null}
            {tab === "leaders" ? (
              <Panel className="overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <h2 className="text-xl font-black">
                    {season} scoring leaderboard
                  </h2>
                  <p className="mt-1 text-xs text-white/38">
                    Position rank, total, average, floor, ceiling, consistency
                    and archetype.
                  </p>
                </div>
                <div className="divide-y divide-white/[0.06]">
                  {filtered.slice(0, 100).map((player, index) => {
                    const m = playerMetrics(
                      player,
                      allPlayers.filter(
                        (row) => row.position === player.position,
                      ),
                    );
                    return (
                      <button
                        key={player.key}
                        onClick={() => {
                          setSelectedKey(player.key);
                          setTab("overview");
                        }}
                        className="grid w-full grid-cols-[32px_minmax(0,1fr)_60px_60px] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.035] sm:grid-cols-[42px_minmax(0,1fr)_80px_80px_100px]"
                      >
                        <b className="text-white/25">#{index + 1}</b>
                        <PlayerName player={player} />
                        <div className="text-right">
                          <b>{player.points.toFixed(1)}</b>
                          <div className="text-[8px] text-white/25">POINTS</div>
                        </div>
                        <div className="text-right">
                          <b>{m.average.toFixed(1)}</b>
                          <div className="text-[8px] text-white/25">AVG</div>
                        </div>
                        <div className="hidden text-right sm:block">
                          <b>{m.consistency.toFixed(0)}%</b>
                          <div className="text-[8px] text-white/25">
                            {m.archetype}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            ) : null}
            {tab === "history" ? (
              <div className="space-y-4">
                <Panel className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-xl font-black">
                        {selected?.name} career scoring
                      </h2>
                      <p className="mt-1 text-xs leading-5 text-white/38">
                        Loads every FantasyPros/Sleeper season in which this
                        player has recorded scoring.
                      </p>
                    </div>
                    <button
                      onClick={loadCareer}
                      disabled={!selected || careerLoading}
                      className="rounded-xl bg-cyan-300/12 px-5 py-3 text-xs font-black text-cyan-100 disabled:opacity-40"
                    >
                      {careerLoading
                        ? "Building career history…"
                        : career.length
                          ? "Refresh career"
                          : "Build complete career"}
                    </button>
                  </div>
                  {careerLoading ? (
                    <LoadingScreen
                      progress={careerProgress}
                      text={`Building ${selected?.name || "player"} career history…`}
                    />
                  ) : career.length ? (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {career.map((row) => {
                        const m = playerMetrics(row, []);
                        return (
                          <div
                            key={row.season}
                            className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"
                          >
                            <div className="text-[10px] font-black text-cyan-100">
                              {row.season}
                            </div>
                            <div className="mt-2 text-3xl font-black">
                              {row.points.toFixed(1)}
                            </div>
                            <div className="text-[9px] text-white/30">
                              {row.games} games · {m.average.toFixed(1)} average
                            </div>
                            <div className="mt-3 flex justify-between text-[10px] text-white/38">
                              <span>P90 {m.ceiling.toFixed(1)}</span>
                              <span>
                                {m.consistency.toFixed(0)}% consistent
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl bg-white/[0.03] p-5 text-sm text-white/38">
                      Build the career record when you need it. Historical
                      responses are cached, so subsequent player research does
                      not repeatedly consume the provider API.
                    </div>
                  )}
                </Panel>
              </div>
            ) : null}
            {tab === "method" ? (
              <div className="grid gap-4 lg:grid-cols-3">
                <Panel className="p-5">
                  <h2 className="text-lg font-black">FantasyPros history</h2>
                  <p className="mt-2 text-xs leading-5 text-white/42">
                    Official season points, games, average and weekly scoring
                    for Standard, Half PPR and PPR. The FantasyPros API key
                    stays server-side.
                  </p>
                </Panel>
                <Panel className="p-5">
                  <h2 className="text-lg font-black">Sleeper production</h2>
                  <p className="mt-2 text-xs leading-5 text-white/42">
                    Raw weekly passing, rushing, receiving, kicking and
                    defensive statistics. Sleeper identity powers links into
                    portfolio tools.
                  </p>
                </Panel>
                <Panel className="p-5">
                  <h2 className="text-lg font-black">
                    Transparent calculations
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-white/42">
                    Floor and ceiling are 10th/90th percentiles. Volatility is
                    weekly standard deviation. Boom/bust lines scale to the
                    player’s own average and are shown as descriptive
                    evidence—not predictions.
                  </p>
                </Panel>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
