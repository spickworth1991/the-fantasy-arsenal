"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import LoadingScreen from "../../components/LoadingScreen";
import { useSleeper } from "../../context/SleeperContext";
import StatProjectionLab from "./StatProjectionLab";

const WORKSPACES = [
  {
    key: "players",
    label: "Player Lab",
    detail: "Research, careers, and comparisons",
    tabs: [
      ["overview", "Player Research", "Production, consistency, and weekly evidence"],
      ["history", "Career History", "Season-over-season trends and raw statistics"],
      ["compare", "Compare Players", "Direct scoring and statistical comparison"],
    ],
  },
  {
    key: "matchups",
    label: "Matchups",
    detail: "Offense, defense, and positional edges",
    tabs: [["matchups", "Matchup Lab", "Team, position, and player matchup evidence"]],
  },
  {
    key: "projections",
    label: "Projections",
    detail: "Safe and boom/bust weekly paths",
    tabs: [["projections", "Projection Center", "Weekly stat forecasts and model evidence"]],
  },
  {
    key: "rankings",
    label: "Rankings",
    detail: "Season production leaders",
    tabs: [["leaders", "Leaderboards", "Position ranks, archetypes, and consistency"]],
  },
  {
    key: "guide",
    label: "Data Guide",
    detail: "Sources and transparent calculations",
    tabs: [["method", "Methodology", "What is measured, modeled, and estimated"]],
  },
];
const STAT_GUIDES = {
  overview: {
    title: "What Player Research answers",
    summary:
      "How a player actually scored, how repeatable that production was, and which workload statistics produced it.",
    bullets: [
      "Weekly scoring and percentiles are observed results—not projections.",
      "Boom, bust, consistency, and volatility are measured against the player's own scoring profile.",
      "Underlying production separates volume from fantasy-point outcomes.",
    ],
  },
  history: {
    title: "What Career History answers",
    summary:
      "How a player's role, production, efficiency, and fantasy scoring changed from season to season.",
    bullets: [
      "Build Career History once to join every saved season by stable player identity.",
      "Switch between totals and per-game rates to separate longevity from weekly performance.",
      "Missing raw statistics are shown as unavailable rather than false zeroes.",
    ],
  },
  compare: {
    title: "What Compare Players answers",
    summary:
      "Which player produced more, which was steadier, and how often one actually outscored the other in comparable weeks.",
    bullets: [
      "Head-to-head weeks compare saved results in the same selected season and scoring format.",
      "Floor and ceiling describe historical distributions, not guaranteed future outcomes.",
      "Position rank is calculated within the current filtered player pool.",
    ],
  },
  matchups: {
    title: "How to use Matchup Lab",
    summary:
      "Choose a position, offense, and defense to connect team production with what that defense allowed to the position.",
    bullets: [
      "An allowance index of 100 is league average; higher is more favorable to the offense.",
      "Click a defensive bar or ranked defense to load its complete position profile.",
      "Player-v-defense history is sample-regressed and compared with that player's other opponents.",
    ],
  },
  projections: {
    title: "How to use Projection Center",
    summary:
      "Research one player across the schedule, rank a full weekly slate, or audit the model's frozen accuracy record.",
    bullets: [
      "Safe / Expected is the calibrated most-likely path; Risky redistributes the same season expectation into evidence-backed boom and bust weeks.",
      "Use the arrows, week chips, chart bars, or week dropdown to change weeks while keeping the player pinned.",
      "Weather is included only when a real kickoff forecast enters the 16-day window.",
    ],
  },
  leaders: {
    title: "What Leaderboards answer",
    summary:
      "Who led the selected season and scoring format after accounting for total production, weekly average, consistency, and archetype.",
    bullets: [
      "Use Position to compare like roles instead of mixing unlike scoring environments.",
      "Selecting a row opens that player's complete research profile.",
      "These ranks describe the selected historical season, not current market value.",
    ],
  },
  method: {
    title: "How Stat Central earns trust",
    summary:
      "Every section identifies whether its output is an observed fact, descriptive statistic, estimate, or forward simulation.",
    bullets: [
      "FantasyPros archives supply saved scoring history; Sleeper archives supply identities and raw weekly statistics.",
      "Small samples are shrunk toward neutral before they influence matchup conclusions.",
      "Projection builds are timestamped and evaluated without rewriting earlier forecasts.",
    ],
  },
};
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
function WorkspaceGuide({ tab }) {
  const guide = STAT_GUIDES[tab] || STAT_GUIDES.overview;
  return (
    <details className="mb-4 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-4" open={tab === "matchups" || tab === "projections"}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-100/45">
              Workspace guide
            </div>
            <h2 className="mt-1 text-base font-black text-cyan-50">{guide.title}</h2>
            <p className="mt-1 text-[11px] leading-5 text-white/40">{guide.summary}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-white/[0.05] px-2 py-1 text-[9px] text-white/40">
            Details
          </span>
        </div>
      </summary>
      <ul className="mt-3 space-y-2 border-t border-white/[0.06] pt-3 text-[10px] leading-5 text-white/38">
        {guide.bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span className="text-cyan-200/60">•</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </details>
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
    <div className="min-w-0 max-w-full rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 sm:p-4">
      <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/30">
        {label}
      </div>
      <div className={`mt-1 break-words text-xl font-black leading-tight sm:text-2xl ${tones[tone] || tones.cyan}`}>
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
  const aggregateWeeklyStats = (weeklyStats, includedWeeks) => {
    const rateFields = new Set([
      "cmp_pct",
      "pass_ypa",
      "pass_td_rate",
      "pass_int_rate",
      "rush_ypa",
      "catch_pct",
      "rec_ypr",
      "rec_ypt",
    ]);
    const totals = {};
    includedWeeks.forEach((week) => {
      Object.entries(weeklyStats?.[String(week)] || {}).forEach(
        ([key, value]) => {
          if (rateFields.has(key) || !Number.isFinite(Number(value))) return;
          totals[key] = num(totals[key]) + num(value);
        },
      );
    });
    return totals;
  };
  const byName = new Map();
  const byNameOnly = new Map();
  const sleeperById = new Map();
  Object.entries(playerDb || {}).forEach(([id, player]) => {
    const name =
      player?.full_name ||
      `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
    if (name) {
      byName.set(
        `${normalize(name)}|${String(player?.position || "").toUpperCase()}`,
        { ...player, sleeper_id: id, name },
      );
      if (!byNameOnly.has(normalize(name)))
        byNameOnly.set(normalize(name), {
          ...player,
          sleeper_id: id,
          name,
        });
    }
    sleeperById.set(String(id), { ...player, sleeper_id: id, name });
  });
  const sleeperRows = new Map(
    (payload?.sleeper?.players || []).map((row) => [
      String(row.player_id),
      row,
    ]),
  );
  const sleeperRowsByName = new Map(
    (payload?.sleeper?.players || [])
      .filter((row) => row?.name)
      .map((row) => [
        `${normalize(row.name)}|${String(row.position || "").toUpperCase()}`,
        row,
      ]),
  );
  const sleeperRowsByNameOnly = new Map();
  (payload?.sleeper?.players || []).forEach((row) => {
    if (row?.name && !sleeperRowsByNameOnly.has(normalize(row.name)))
      sleeperRowsByNameOnly.set(normalize(row.name), row);
  });
  const fantasyPros = (payload?.fantasypros?.players || []).map(
    (row, index) => {
      const context =
        byName.get(
          `${normalize(row.name)}|${String(row.position || "").toUpperCase()}`,
        ) || byNameOnly.get(normalize(row.name));
      const raw =
        (context?.sleeper_id
          ? sleeperRows.get(String(context.sleeper_id))
          : null) ||
        sleeperRowsByName.get(
          `${normalize(row.name)}|${String(row.position || "").toUpperCase()}`,
        ) ||
        sleeperRowsByNameOnly.get(normalize(row.name)) ||
        null;
      const includedWeeks = Object.keys(row.weeks || {});
      const weeklyStats = Object.fromEntries(
        includedWeeks
          .filter((week) => raw?.weekly_stats?.[String(week)])
          .map((week) => [week, raw.weekly_stats[String(week)]]),
      );
      return {
        ...row,
        key: `fp:${row.player_id || index}:${normalize(row.name)}`,
        sleeper_id: context?.sleeper_id || "",
        team: row.team || context?.team || "",
        position: row.position || context?.position || "",
        age: context?.age || null,
        years_exp: context?.years_exp || null,
        injury_status: context?.injury_status || null,
        // FantasyPros historical scoring generally ends with the fantasy
        // season. Aggregate raw box scores over those exact same weeks so a
        // Week 18 NFL total can never be paired with a Weeks 1-17 point total.
        stats: aggregateWeeklyStats(weeklyStats, includedWeeks),
        weekly_stats: weeklyStats,
        stat_period: includedWeeks.length
          ? `Fantasy scoring weeks ${includedWeeks[0]}-${includedWeeks.at(-1)}`
          : "No matched scoring weeks",
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
      name: context.name || row.name || row.player_id,
      team: context.team || row.team || "",
      position: context.position || row.position || "",
      age: context.age || null,
      years_exp: context.years_exp || null,
      injury_status: context.injury_status || null,
      source: "Sleeper",
    };
  });
}

function weeklySummary(stats, position) {
  if (
    !stats ||
    typeof stats !== "object" ||
    !Object.keys(stats).some((key) => !String(key).startsWith("pts_"))
  )
    return "Raw box score unavailable";
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
  return parts.slice(0, 5).join(" · ") || "Additional box-score stats saved";
}

const hasStat = (stats, key) =>
  !!stats &&
  Object.prototype.hasOwnProperty.call(stats, key) &&
  Number.isFinite(Number(stats[key]));
const statRatio = (stats, numerator, denominator, multiplier = 1) => {
  if (!hasStat(stats, denominator) || num(stats[denominator]) <= 0) return null;
  return (num(stats[numerator]) / num(stats[denominator])) * multiplier;
};
const statSum = (stats, keys) => {
  if (!keys.some((key) => hasStat(stats, key))) return null;
  return keys.reduce((sum, key) => sum + num(stats?.[key]), 0);
};
const passerRating = (stats) => {
  const attempts = num(stats?.pass_att);
  if (!hasStat(stats, "pass_att") || attempts <= 0) return null;
  const clamp = (value) => Math.max(0, Math.min(2.375, value));
  const completions = num(stats?.pass_cmp);
  const yards = num(stats?.pass_yd);
  const touchdowns = num(stats?.pass_td);
  const interceptions = num(stats?.pass_int);
  return (
    ((clamp((completions / attempts - 0.3) * 5) +
      clamp((yards / attempts - 3) * 0.25) +
      clamp((touchdowns / attempts) * 20) +
      clamp(2.375 - (interceptions / attempts) * 25)) /
      6) *
    100
  );
};
const statResult = (definition, stats) => {
  const value = definition.derive
    ? definition.derive(stats || {})
    : hasStat(stats, definition.key)
      ? num(stats[definition.key])
      : null;
  if (value == null || !Number.isFinite(Number(value))) return "—";
  if (definition.format === "percent") return `${num(value).toFixed(1)}%`;
  if (definition.format === "decimal") return num(value).toFixed(2);
  if (definition.format === "one") return num(value).toFixed(1);
  return Math.round(num(value)).toLocaleString();
};

function playerStatGroups(player) {
  const position = String(player?.position || "").toUpperCase();
  const passing = [
    { label: "Pass yards", key: "pass_yd" },
    { label: "Pass TD", key: "pass_td" },
    { label: "Interceptions", key: "pass_int" },
    { label: "Attempts", key: "pass_att" },
    { label: "Completions", key: "pass_cmp" },
  ];
  const rushing = [
    { label: "Carries", key: "rush_att" },
    { label: "Rush yards", key: "rush_yd" },
    { label: "Rush TD", key: "rush_td" },
    {
      label: "Yards / carry",
      format: "decimal",
      derive: (stats) => statRatio(stats, "rush_yd", "rush_att"),
    },
    { label: "Red-zone carries", key: "rush_rz_att" },
  ];
  const receiving = [
    { label: "Targets", key: "rec_tgt" },
    { label: "Receptions", key: "rec" },
    { label: "Receiving yards", key: "rec_yd" },
    { label: "Receiving TD", key: "rec_td" },
    { label: "Red-zone targets", key: "rec_rz_tgt" },
  ];
  const receivingEfficiency = [
    {
      label: "Catch rate",
      format: "percent",
      derive: (stats) => statRatio(stats, "rec", "rec_tgt", 100),
    },
    {
      label: "Yards / target",
      format: "decimal",
      derive: (stats) => statRatio(stats, "rec_yd", "rec_tgt"),
    },
    {
      label: "Yards / reception",
      format: "decimal",
      derive: (stats) => statRatio(stats, "rec_yd", "rec"),
    },
    { label: "Air yards", key: "rec_air_yd" },
    {
      label: "Snap share",
      format: "percent",
      derive: (stats) => statRatio(stats, "off_snp", "tm_off_snp", 100),
    },
  ];
  const role = [
    {
      label: "Touches",
      derive: (stats) => statSum(stats, ["rush_att", "rec"]),
    },
    {
      label: "Scrimmage yards",
      derive: (stats) => statSum(stats, ["rush_yd", "rec_yd"]),
    },
    { label: "Offensive snaps", key: "off_snp" },
    {
      label: "Snap share",
      format: "percent",
      derive: (stats) => statRatio(stats, "off_snp", "tm_off_snp", 100),
    },
    { label: "Games started", key: "gs" },
  ];

  if (position === "QB")
    return [
      ["Passing production", passing],
      [
        "Passing efficiency",
        [
          {
            label: "Completion rate",
            format: "percent",
            derive: (stats) => statRatio(stats, "pass_cmp", "pass_att", 100),
          },
          {
            label: "Yards / attempt",
            format: "decimal",
            derive: (stats) => statRatio(stats, "pass_yd", "pass_att"),
          },
          {
            label: "TD rate",
            format: "percent",
            derive: (stats) => statRatio(stats, "pass_td", "pass_att", 100),
          },
          {
            label: "INT rate",
            format: "percent",
            derive: (stats) => statRatio(stats, "pass_int", "pass_att", 100),
          },
          {
            label: "Passer rating",
            format: "one",
            derive: passerRating,
          },
        ],
      ],
      ["Rushing & role", [...rushing.slice(0, 3), ...role.slice(2)]],
    ];
  if (position === "RB")
    return [
      ["Rushing production", rushing],
      ["Receiving production", receiving],
      ["Workload & efficiency", [...role.slice(0, 4), receivingEfficiency[1]]],
    ];
  if (position === "WR" || position === "TE")
    return [
      ["Receiving production", receiving],
      ["Efficiency & usage", receivingEfficiency],
      [
        "Role profile",
        [...role.slice(1), { label: "Rush attempts", key: "rush_att" }],
      ],
    ];
  if (position === "K")
    return [
      [
        "Field goals",
        [
          { label: "Attempts", key: "fga" },
          { label: "Made", key: "fgm" },
          {
            label: "Accuracy",
            format: "percent",
            derive: (stats) => statRatio(stats, "fgm", "fga", 100),
          },
          { label: "Misses", key: "fgmiss" },
          { label: "Kicking points", key: "kick_pts" },
        ],
      ],
      [
        "Extra points",
        [
          { label: "Attempts", key: "xpa" },
          { label: "Made", key: "xpm" },
          {
            label: "Accuracy",
            format: "percent",
            derive: (stats) => statRatio(stats, "xpm", "xpa", 100),
          },
          { label: "Misses", key: "xpmiss" },
          { label: "Kicking points", key: "kick_pts" },
        ],
      ],
    ];
  return [
    [
      "Defensive production",
      [
        { label: "Sacks", key: "sack" },
        { label: "Interceptions", key: "int" },
        { label: "Fumble recoveries", key: "fum_rec" },
        { label: "Defensive TD", key: "def_td" },
        { label: "Points allowed", key: "pts_allow" },
      ],
    ],
  ];
}

async function loadSavedSeason(season, scoring, position, signal) {
  let fantasyPros = null;
  let sleeper = null;
  let schedule = null;
  const cacheMode =
    num(season) >= new Date().getUTCFullYear() ? "no-cache" : "force-cache";
  try {
    const requests = [
      fetch(`/stats/history/${season}/fantasypros.json`, {
        cache: cacheMode,
        signal,
      }),
    ];
    if (num(season) >= 2018)
      requests.push(
        fetch(`/stats/history/${season}/sleeper.json`, {
          cache: cacheMode,
          signal,
        }),
        fetch(`/stats/history/${season}/schedule.json`, {
          cache: cacheMode,
          signal,
        }),
      );
    const responses = await Promise.all(requests);
    if (responses[0]?.ok) fantasyPros = await responses[0].json();
    if (responses[1]?.ok) sleeper = await responses[1].json();
    if (responses[2]?.ok) schedule = await responses[2].json();
  } catch (failure) {
    if (failure?.name === "AbortError") throw failure;
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
      <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
        <div
          className="flex h-[180px] min-w-[540px] items-end gap-1.5 border-b border-white/10 pb-2 sm:h-[230px] sm:min-w-[680px] sm:gap-2"
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
          <div className="grid grid-cols-[52px_minmax(0,1fr)_64px] bg-white/[0.04] px-3 py-2 text-[8px] font-black uppercase tracking-wider text-white/35 sm:grid-cols-[70px_minmax(0,1fr)_100px] sm:px-4 sm:text-[9px]">
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
                  className="grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-1 px-3 py-3 text-[11px] sm:grid-cols-[70px_minmax(0,1fr)_100px] sm:px-4 sm:text-xs"
                >
                  <b>Week {week}</b>
                  <div className="min-w-0">
                    <div className="break-words leading-4 text-white/60">
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
  const position = String(player?.position || "").toUpperCase();
  const categoriesByPosition = {
    QB: [
      { key: "pass_yd", label: "Pass yards", tone: "bg-cyan-300/70" },
      { key: "pass_att", label: "Pass attempts", tone: "bg-violet-300/70" },
      { key: "pass_td", label: "Pass TD", tone: "bg-amber-300/70" },
      { key: "rush_yd", label: "Rush yards", tone: "bg-emerald-300/70" },
    ],
    RB: [
      { key: "rush_att", label: "Carries", tone: "bg-cyan-300/70" },
      { key: "rush_yd", label: "Rush yards", tone: "bg-emerald-300/70" },
      { key: "rec_tgt", label: "Targets", tone: "bg-amber-300/70" },
      { key: "rec_yd", label: "Receiving yards", tone: "bg-violet-300/70" },
    ],
    WR: [
      { key: "rec_tgt", label: "Targets", tone: "bg-amber-300/70" },
      { key: "rec", label: "Receptions", tone: "bg-cyan-300/70" },
      { key: "rec_yd", label: "Receiving yards", tone: "bg-violet-300/70" },
      { key: "rec_air_yd", label: "Air yards", tone: "bg-emerald-300/70" },
    ],
    TE: [
      { key: "rec_tgt", label: "Targets", tone: "bg-amber-300/70" },
      { key: "rec", label: "Receptions", tone: "bg-cyan-300/70" },
      { key: "rec_yd", label: "Receiving yards", tone: "bg-violet-300/70" },
      {
        key: "rec_rz_tgt",
        label: "Red-zone targets",
        tone: "bg-emerald-300/70",
      },
    ],
    K: [
      { key: "fga", label: "Field-goal attempts", tone: "bg-cyan-300/70" },
      { key: "fgm", label: "Field goals made", tone: "bg-emerald-300/70" },
      { key: "xpm", label: "Extra points made", tone: "bg-violet-300/70" },
      { key: "kick_pts", label: "Kicking points", tone: "bg-amber-300/70" },
    ],
  };
  const categories = (
    categoriesByPosition[position] || [
      { key: "sack", label: "Sacks", tone: "bg-cyan-300/70" },
      { key: "int", label: "Interceptions", tone: "bg-violet-300/70" },
      { key: "fum_rec", label: "Fumble recoveries", tone: "bg-emerald-300/70" },
      { key: "def_td", label: "Defensive TD", tone: "bg-amber-300/70" },
    ]
  ).filter((category) => rows.some((row) => hasStat(row.stats, category.key)));
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
                      title={`Week ${row.week}: ${hasStat(row.stats, category.key) ? num(row.stats?.[category.key]).toFixed(0) : "not recorded"}`}
                      className={`w-full min-w-[3px] rounded-t ${category.tone} ${hasStat(row.stats, category.key) ? "" : "opacity-10"}`}
                      style={{
                        height: `${Math.max(hasStat(row.stats, category.key) ? 3 : 0, (num(row.stats?.[category.key]) / max) * 88)}px`,
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
function MatchupLab({ players, schedule, season, scoring }) {
  const [position, setPosition] = useState("QB");
  const [offense, setOffense] = useState("");
  const [defense, setDefense] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");
  const [minimumPoints, setMinimumPoints] = useState(0);
  const [sortKey, setSortKey] = useState("points");
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
    const defenseRows = new Map(),
      attackRows = new Map(),
      games = [];
    players
      .filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position))
      .forEach((player) =>
        Object.entries(player.weeks || {}).forEach(([week, points]) => {
          const team = normalizeTeam(player.team),
            opponent = opponentByWeek[`${week}:${team}`];
          if (!team || !opponent) return;
          const dKey = `${opponent}:${player.position}`,
            oKey = `${team}:${player.position}`;
          const stats = player.weekly_stats?.[week] || {};
          const game = {
            key: `${player.key}:${week}`,
            player: player.name,
            playerKey: player.key,
            team,
            opponent,
            position: player.position,
            week: num(week),
            points: num(points),
            stats,
          };
          games.push(game);
          const d = defenseRows.get(dKey) || {
            team: opponent,
            position: player.position,
            points: 0,
            weeks: new Set(),
            stats: {},
            playerGames: 0,
            booms: 0,
            weekCoverage: new Map(),
            rawStatsByWeek: new Map(),
          };
          d.points += num(points);
          d.weeks.add(String(week));
          d.playerGames += 1;
          if (num(points) >= 20) d.booms += 1;
          const rawAvailable = Object.keys(stats).some(
            (key) => !String(key).startsWith("pts_"),
          );
          const weekCoverage = d.weekCoverage.get(String(week)) || {
            scoredPlayers: 0,
            rawPlayers: 0,
          };
          weekCoverage.scoredPlayers += 1;
          if (rawAvailable) weekCoverage.rawPlayers += 1;
          d.weekCoverage.set(String(week), weekCoverage);
          if (rawAvailable) {
            const weekStats = d.rawStatsByWeek.get(String(week)) || {};
            Object.entries(stats).forEach(([key, value]) => {
              if (Number.isFinite(Number(value)))
                weekStats[key] = num(weekStats[key]) + num(value);
            });
            d.rawStatsByWeek.set(String(week), weekStats);
          }
          defenseRows.set(dKey, d);
          const o = attackRows.get(oKey) || {
            team,
            position: player.position,
            points: 0,
            weeks: new Set(),
            stats: {},
          };
          o.points += num(points);
          o.weeks.add(String(week));
          Object.entries(stats).forEach(([key, value]) => {
            if (Number.isFinite(Number(value)))
              o.stats[key] = num(o.stats[key]) + num(value);
          });
          attackRows.set(oKey, o);
        }),
      );
    const finish = (map) =>
      [...map.values()].map((row) => {
        const completeRawWeeks = row.weekCoverage
          ? [...row.weekCoverage.entries()]
              .filter(
                ([, coverage]) =>
                  coverage.scoredPlayers > 0 &&
                  coverage.rawPlayers === coverage.scoredPlayers,
              )
              .map(([week]) => week)
          : [];
        const completeStats = row.rawStatsByWeek
          ? completeRawWeeks.reduce((totals, week) => {
              Object.entries(row.rawStatsByWeek.get(week) || {}).forEach(
                ([key, value]) => {
                  totals[key] = num(totals[key]) + num(value);
                },
              );
              return totals;
            }, {})
          : row.stats;
        return {
          ...row,
          stats: completeStats,
          games: row.weeks.size,
          rawGames: completeRawWeeks.length,
          rawCoverage: row.weeks.size
            ? completeRawWeeks.length / row.weeks.size
            : 0,
          average: row.points / Math.max(1, row.weeks.size),
          boomRate: row.playerGames ? (row.booms / row.playerGames) * 100 : 0,
        };
      });
    return { defense: finish(defenseRows), attack: finish(attackRows), games };
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
  const defenseTeams = [...new Set(rows.defense.map((row) => row.team))].sort();
  const selectedOffense = offense || teams[0] || "";
  const selectedDefense = defense || defenseTeams[0] || "";
  const offenseRow = rows.attack.find(
    (row) => row.team === selectedOffense && row.position === position,
  );
  const leagueOffense =
    offenses.reduce((sum, row) => sum + row.average, 0) /
    Math.max(1, offenses.length);
  const defenseRow = rows.defense.find(
    (row) => row.team === selectedDefense && row.position === position,
  );
  const defenseIndex = defenseRow
    ? defenseRow.average / Math.max(1, leagueOffense)
    : 1;
  const offenseIndex = offenseRow
    ? offenseRow.average / Math.max(1, leagueOffense)
    : 1;
  const modeledRoomPoints =
    leagueOffense * Math.sqrt(Math.max(0.01, offenseIndex * defenseIndex));
  const matchupEdge = modeledRoomPoints - num(offenseRow?.average);
  const matchupGrade =
    matchupEdge >= 4
      ? "Elite"
      : matchupEdge >= 1.5
        ? "Favorable"
        : matchupEdge <= -4
          ? "Avoid"
          : matchupEdge <= -1.5
            ? "Difficult"
            : "Neutral";
  const selectedGames = rows.games
    .filter(
      (game) => game.position === position && game.opponent === selectedDefense,
    )
    .filter((game) => game.points >= minimumPoints)
    .filter(
      (game) =>
        !playerQuery || normalize(game.player).includes(normalize(playerQuery)),
    )
    .sort((a, b) =>
      sortKey === "week"
        ? b.week - a.week
        : sortKey === "yards"
          ? num(b.stats.pass_yd) +
            num(b.stats.rush_yd) +
            num(b.stats.rec_yd) -
            (num(a.stats.pass_yd) + num(a.stats.rush_yd) + num(a.stats.rec_yd))
          : b.points - a.points,
    );
  const playerLeaders = new Map();
  selectedGames.forEach((game) => {
    const current = playerLeaders.get(game.player) || {
      player: game.player,
      team: game.team,
      games: 0,
      points: 0,
      best: 0,
      stats: {},
    };
    current.games += 1;
    current.points += game.points;
    current.best = Math.max(current.best, game.points);
    Object.entries(game.stats).forEach(([key, value]) => {
      if (Number.isFinite(Number(value)))
        current.stats[key] = num(current.stats[key]) + num(value);
    });
    playerLeaders.set(game.player, current);
  });
  const specialists = [...playerLeaders.values()]
    .map((row) => ({ ...row, average: row.points / row.games }))
    .filter((row) => row.games >= 2)
    .sort((a, b) => b.average - a.average);
  const defenseStatCards =
    position === "QB"
      ? [
          ["Pass yards allowed", "pass_yd"],
          ["Pass TD allowed", "pass_td"],
          ["Interceptions", "pass_int"],
          ["QB rush yards", "rush_yd"],
        ]
      : position === "RB"
        ? [
            ["Rush yards allowed", "rush_yd"],
            ["Rush TD allowed", "rush_td"],
            ["RB receptions", "rec"],
            ["RB receiving yards", "rec_yd"],
          ]
        : [
            ["Receiving yards allowed", "rec_yd"],
            ["Receiving TD allowed", "rec_td"],
            ["Targets allowed", "rec_tgt"],
            ["Receptions allowed", "rec"],
          ];
  const positionPlayers = players
    .filter(
      (player) =>
        player.position === position &&
        normalizeTeam(player.team) === selectedOffense,
    )
    .sort((a, b) => b.average - a.average);
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
            <Select
              label="Defense"
              value={selectedDefense}
              onChange={setDefense}
            >
              {defenseTeams.map((team) => (
                <option key={team}>{team}</option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Matchup grade"
          value={matchupGrade}
          detail={`${selectedOffense} ${position} vs ${selectedDefense}`}
          tone={
            matchupEdge > 1 ? "emerald" : matchupEdge < -1 ? "rose" : "amber"
          }
        />
        <Metric
          label="Modeled room output"
          value={`${modeledRoomPoints.toFixed(1)} pts`}
          detail={`Baseline ${num(offenseRow?.average).toFixed(1)} · change ${matchupEdge >= 0 ? "+" : ""}${matchupEdge.toFixed(1)}`}
          tone="cyan"
        />
        <Metric
          label="Defense allowed"
          value={defenseRow ? `${defenseRow.average.toFixed(1)} pts` : "—"}
          detail={`${position} fantasy points per team game`}
          tone="violet"
        />
        <Metric
          label="Evidence"
          value={defenseRow ? `${defenseRow.games} games` : "—"}
          detail={`${defenseRow?.playerGames || 0} player performances`}
          tone="amber"
        />
      </div>
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-xl font-black">
              {selectedDefense} defensive profile vs {position}
            </h3>
            <p className="mt-1 text-xs text-white/35">
              The production behind the fantasy-points-allowed ranking.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[10px] font-black ${defenseIndex <= 0.9 ? "bg-emerald-300/10 text-emerald-100" : defenseIndex >= 1.1 ? "bg-rose-300/10 text-rose-100" : "bg-white/5 text-white/50"}`}
          >
            {Math.round(defenseIndex * 100)} allowance index · 100 average
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {defenseStatCards.map(([label, key]) => (
            <Metric
              key={key}
              label={label}
              value={
                defenseRow?.rawGames && hasStat(defenseRow.stats, key)
                  ? (
                      num(defenseRow.stats?.[key]) /
                      Math.max(1, defenseRow.rawGames)
                    ).toFixed(1)
                  : "—"
              }
              detail={
                defenseRow
                  ? `Per complete raw-stat team game · ${defenseRow.rawGames}/${defenseRow.games} weeks (${Math.round(defenseRow.rawCoverage * 100)}%)`
                  : "Raw-stat coverage unavailable"
              }
            />
          ))}
        </div>
        <div className="mt-5 overflow-x-auto">
          <div
            className="flex min-w-[720px] items-end gap-1.5 border-b border-white/10 pb-2"
            style={{ height: 190 }}
          >
            {defenses.map((row) => {
              const max = Math.max(1, ...defenses.map((item) => item.average));
              const active = row.team === selectedDefense;
              return (
                <button
                  key={row.team}
                  onClick={() => setDefense(row.team)}
                  onPointerUp={() => setDefense(row.team)}
                  className="flex min-w-0 touch-manipulation flex-1 flex-col items-center justify-end gap-1"
                  title={`${row.team}: ${row.average.toFixed(1)} ${position} points allowed`}
                >
                  <div
                    className={`w-full rounded-t ${active ? "bg-amber-300" : "bg-gradient-to-t from-cyan-400/45 to-violet-300/70"}`}
                    style={{
                      height: `${Math.max(4, (row.average / max) * 145)}px`,
                    }}
                  />
                  <span
                    className={`text-[8px] ${active ? "font-black text-amber-100" : "text-white/30"}`}
                  >
                    {row.team}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[9px] text-white/30">
            <span>Shorter = tougher defense</span>
            <span>Taller = more points allowed</span>
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
                <button
                  type="button"
                  key={row.team}
                  onClick={() => setDefense(row.team)}
                  className={`mt-2 flex w-full touch-manipulation justify-between rounded-lg px-1 py-1 text-left text-xs hover:bg-white/[0.05] ${row.team === selectedDefense ? "bg-amber-300/10 ring-1 ring-amber-300/15" : ""}`}
                >
                  <span>
                    #{index + 1} {row.team}
                  </span>
                  <b className="text-emerald-100">{row.average.toFixed(1)}</b>
                </button>
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
                  <button
                    type="button"
                    key={row.team}
                    onClick={() => setDefense(row.team)}
                    className={`mt-2 flex w-full touch-manipulation justify-between rounded-lg px-1 py-1 text-left text-xs hover:bg-white/[0.05] ${row.team === selectedDefense ? "bg-amber-300/10 ring-1 ring-amber-300/15" : ""}`}
                  >
                    <span>
                      #{index + 1} {row.team}
                    </span>
                    <b className="text-rose-100">{row.average.toFixed(1)}</b>
                  </button>
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
      <Panel className="overflow-hidden">
        <div className="border-b border-white/10 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h3 className="text-xl font-black">
                Best {position} performances vs {selectedDefense}
              </h3>
              <p className="mt-1 text-xs text-white/35">
                Every saved player-game supplies the evidence. Filter and sort
                without changing the underlying sample.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input
                value={playerQuery}
                onChange={(event) => setPlayerQuery(event.target.value)}
                placeholder="Filter player…"
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              />
              <select
                value={minimumPoints}
                onChange={(event) => setMinimumPoints(num(event.target.value))}
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              >
                <option value="0">Any score</option>
                <option value="10">10+ points</option>
                <option value="15">15+ points</option>
                <option value="20">20+ points</option>
                <option value="25">25+ points</option>
              </select>
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              >
                <option value="points">Sort: points</option>
                <option value="yards">Sort: yards</option>
                <option value="week">Sort: recent week</option>
              </select>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/45">
                {selectedGames.length} games
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th>Team</th>
                <th>Week</th>
                <th>Fantasy</th>
                <th>Passing</th>
                <th>Rushing</th>
                <th>Receiving</th>
                <th>TD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {selectedGames.slice(0, 150).map((game) => (
                <tr key={game.key} className="hover:bg-white/[0.025]">
                  <td className="px-4 py-3 font-bold">{game.player}</td>
                  <td>{game.team}</td>
                  <td>W{game.week}</td>
                  <td className="font-black text-cyan-100">
                    {game.points.toFixed(1)}
                  </td>
                  <td>
                    {num(game.stats.pass_yd).toFixed(0)} yd ·{" "}
                    {num(game.stats.pass_td)} TD
                  </td>
                  <td>
                    {num(game.stats.rush_att)} car ·{" "}
                    {num(game.stats.rush_yd).toFixed(0)} yd
                  </td>
                  <td>
                    {num(game.stats.rec_tgt)} tgt · {num(game.stats.rec)} rec ·{" "}
                    {num(game.stats.rec_yd).toFixed(0)} yd
                  </td>
                  <td>
                    {num(game.stats.pass_td) +
                      num(game.stats.rush_td) +
                      num(game.stats.rec_td)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <HistoricalOpponentSplits
        position={position}
        defense={selectedDefense}
        scoring={String(scoring || "PPR").toLowerCase()}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h3 className="text-lg font-black">
            {position} specialists vs {selectedDefense}
          </h3>
          <p className="mt-1 text-xs text-white/35">
            Multi-game averages distinguish repeat success from one-week spikes.
          </p>
          <div className="mt-4 space-y-2">
            {specialists.slice(0, 12).map((row, index) => (
              <div
                key={row.player}
                className="grid grid-cols-[30px_minmax(0,1fr)_55px_55px] items-center gap-2 rounded-xl bg-black/15 px-3 py-2.5 text-xs"
              >
                <span className="text-white/25">#{index + 1}</span>
                <div className="min-w-0">
                  <b className="block truncate">{row.player}</b>
                  <small className="text-white/28">
                    {row.team} · {row.games} game{row.games === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="text-right">
                  <b>{row.average.toFixed(1)}</b>
                  <small className="block text-[8px] text-white/25">AVG</small>
                </div>
                <div className="text-right">
                  <b>{row.best.toFixed(1)}</b>
                  <small className="block text-[8px] text-white/25">BEST</small>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-5">
          <div className="text-[9px] font-black uppercase tracking-[.2em] text-cyan-100/45">
            Arsenal matchup model · v1.0
          </div>
          <h3 className="mt-1 text-lg font-black">
            Explainable player estimates
          </h3>
          <p className="mt-2 text-xs leading-5 text-white/38">
            The first model scales each player’s observed average by the square
            root of the selected defense’s positional allowance index. It avoids
            pretending that small samples are certainty.
          </p>
          <div className="mt-4 space-y-2">
            {positionPlayers.slice(0, 10).map((player) => {
              const estimate =
                player.average * Math.sqrt(Math.max(0.35, defenseIndex));
              return (
                <div
                  key={player.key}
                  className="grid grid-cols-[minmax(0,1fr)_65px_75px] items-center gap-2 rounded-xl border border-white/[0.06] p-3 text-xs"
                >
                  <b className="truncate">{player.name}</b>
                  <span className="text-right text-white/40">
                    {player.average.toFixed(1)} base
                  </span>
                  <b className="text-right text-emerald-100">
                    {estimate.toFixed(1)} proj
                  </b>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-3 text-[10px] leading-4 text-amber-100/60">
            For 2026, forecasts should be frozen before kickoff with model
            version, inputs, confidence, and source timestamp. Actual results
            can then be scored with MAE, RMSE, bias, and calibration in Trust &
            Accuracy. No retroactive edits should overwrite a published
            forecast.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function HistoricalOpponentSplits({ position, defense, scoring }) {
  const [payload, setPayload] = useState(null);
  const [loadingPosition, setLoadingPosition] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("defense");
  const [minimumGames, setMinimumGames] = useState(2);
  const [sort, setSort] = useState("edge");

  useEffect(() => {
    if (!position) return;
    const controller = new AbortController();
    let live = true;
    setPayload(null);
    setLoadingPosition(position);
    setError("");
    fetch(`/stats/derived/opponent-splits-${position.toLowerCase()}.json`, {
      cache: "no-cache",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Multi-season opponent splits are not available.");
        return response.json();
      })
      .then((result) => {
        if (live) setPayload(result);
      })
      .catch((failure) => {
        if (live && failure?.name !== "AbortError")
          setError(failure?.message || "Opponent history could not load.");
      })
      .finally(() => {
        if (live) setLoadingPosition("");
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [position]);

  const rows = useMemo(() => {
    if (!payload) return [];
    const overallByName = new Map(
      (payload.players || []).map((row) => [normalize(row.name), row]),
    );
    return (payload.splits || [])
      .filter((row) => scope === "all" || row.opponent === defense)
      .filter((row) => row.games >= minimumGames)
      .filter((row) => !query || normalize(row.name).includes(normalize(query)))
      .map((row) => {
        const overall = overallByName.get(normalize(row.name));
        const average = num(row.averages?.[scoring]);
        const adjustment = row.opponent_adjustment?.[scoring] || null;
        const careerBaseline = num(overall?.averages?.[scoring]);
        const baseline =
          adjustment?.same_season_baseline != null
            ? num(adjustment.same_season_baseline)
            : careerBaseline;
        const rawEdge = average - baseline;
        const edge =
          adjustment?.adjusted_edge != null
            ? num(adjustment.adjusted_edge)
            : rawEdge;
        return {
          ...row,
          average,
          baseline,
          careerBaseline,
          rawEdge,
          edge,
          adjustment,
        };
      })
      .sort((a, b) =>
        sort === "average"
          ? b.average - a.average
          : sort === "sample"
            ? b.games - a.games || b.edge - a.edge
            : b.edge - a.edge || b.games - a.games,
      );
  }, [defense, minimumGames, payload, query, scope, scoring]);

  if (loadingPosition === position && !payload)
    return <LoadingScreen text={`Loading ${position} opponent history…`} />;
  if (error && !payload)
    return <Panel className="p-5 text-sm text-rose-100">{error}</Panel>;
  if (!payload) return null;

  const statColumns =
    position === "QB"
      ? [
          ["Att", "pass_att"],
          ["Pass yd", "pass_yd"],
          ["Pass TD", "pass_td"],
          ["Rush yd", "rush_yd"],
        ]
      : position === "RB"
        ? [
            ["Carries", "rush_att"],
            ["Rush yd", "rush_yd"],
            ["Targets", "rec_tgt"],
            ["Rec yd", "rec_yd"],
          ]
        : [
            ["Targets", "rec_tgt"],
            ["Catches", "rec"],
            ["Rec yd", "rec_yd"],
            ["Air yd", "rec_air_yd"],
          ];
  const top = rows.slice(0, 10);
  const maxEdge = Math.max(1, ...top.map((row) => Math.abs(row.edge)));
  const rawCoverage = num(payload.coverage?.raw_stat_match_rate) * 100;

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_95%_0%,rgba(16,185,129,.12),transparent_38%)] p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-100/55">
              Multi-season matchup fingerprints
            </div>
            <h3 className="mt-1 text-xl font-black">
              Who repeatedly performs against{" "}
              {scope === "defense" ? defense : "each defense"}?
            </h3>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38">
              Each meeting is compared with that player&apos;s same-season
              output against every other opponent across {payload.seasons?.[0]}–
              {payload.seasons?.at(-1)}, recency weighted, and shrunk toward
              zero for small samples. Raw fantasy and box-score results remain
              visible beside the adjusted signal.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a player…"
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
            />
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
            >
              <option value="defense">Against {defense}</option>
              <option value="all">Every opponent</option>
            </select>
            <select
              value={minimumGames}
              onChange={(event) => setMinimumGames(num(event.target.value))}
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
            >
              <option value="2">2+ meetings</option>
              <option value="3">3+ meetings</option>
              <option value="4">4+ meetings</option>
              <option value="6">6+ meetings</option>
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
            >
              <option value="edge">Sort: adjusted edge</option>
              <option value="average">Sort: fantasy average</option>
              <option value="sample">Sort: evidence</option>
            </select>
          </div>
        </div>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-3">
        <div className="bg-slate-950/90 p-4">
          <div className="text-[9px] uppercase tracking-wider text-white/30">
            Qualified splits
          </div>
          <b className="mt-1 block text-2xl text-cyan-100">
            {rows.length.toLocaleString()}
          </b>
          <small className="text-white/30">Current filters</small>
        </div>
        <div className="bg-slate-950/90 p-4">
          <div className="text-[9px] uppercase tracking-wider text-white/30">
            Raw-stat coverage
          </div>
          <b className="mt-1 block text-2xl text-emerald-100">
            {rawCoverage.toFixed(1)}%
          </b>
          <small className="text-white/30">
            Matched historical player-games
          </small>
        </div>
        <div className="bg-slate-950/90 p-4">
          <div className="text-[9px] uppercase tracking-wider text-white/30">
            Scoring lens
          </div>
          <b className="mt-1 block text-2xl text-violet-100">
            {scoring.toUpperCase()}
          </b>
          <small className="text-white/30">
            Change it in the Stat Central header
          </small>
        </div>
      </div>
      {top.length ? (
        <div className="border-b border-white/10 p-5">
          <div className="mb-3 flex justify-between text-[9px] font-black uppercase tracking-wider text-white/30">
            <span>Best opponent-adjusted edges</span>
            <span>Same-season baseline + sample shrinkage</span>
          </div>
          <div className="space-y-2">
            {top.map((row) => (
              <div
                key={`${row.name}:${row.opponent}`}
                className="grid grid-cols-[minmax(0,1fr)_54px] items-center gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex justify-between gap-3">
                    <b className="truncate">
                      {row.name} vs {row.opponent}
                    </b>
                    <span className="shrink-0 text-white/35">
                      {row.games} games · {num(row.adjustment?.confidence)}%
                      confidence
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full ${row.edge >= 0 ? "bg-gradient-to-r from-cyan-300/70 to-emerald-300/80" : "bg-rose-300/70"}`}
                      style={{
                        width: `${Math.max(3, (Math.abs(row.edge) / maxEdge) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <b
                  className={
                    row.edge >= 0 ? "text-emerald-100" : "text-rose-100"
                  }
                >
                  {row.edge >= 0 ? "+" : ""}
                  {row.edge.toFixed(1)}
                </b>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">Player</th>
              <th>Opponent</th>
              <th>Meetings</th>
              <th>Fantasy / game</th>
              <th>Same-season baseline</th>
              <th>Adjusted edge</th>
              <th>Confidence</th>
              {statColumns.map(([label, key]) => (
                <th key={key}>{label} / game</th>
              ))}
              <th>Best game</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.slice(0, 250).map((row) => (
              <tr
                key={`${row.name}:${row.opponent}`}
                className="hover:bg-white/[0.025]"
              >
                <td className="px-4 py-3">
                  <b>{row.name}</b>
                  <small className="block text-white/28">
                    {row.team} · {row.position}
                  </small>
                </td>
                <td className="font-bold">{row.opponent}</td>
                <td>
                  {row.games}
                  <small className="block text-white/25">
                    {row.seasons?.length || 0} seasons · {num(row.raw_games)}{" "}
                    raw
                  </small>
                </td>
                <td className="font-black text-cyan-100">
                  {row.average.toFixed(1)}
                </td>
                <td>{row.baseline.toFixed(1)}</td>
                <td
                  className={
                    row.edge >= 0
                      ? "font-black text-emerald-100"
                      : "font-black text-rose-100"
                  }
                >
                  {row.edge >= 0 ? "+" : ""}
                  {row.edge.toFixed(1)}
                </td>
                <td>
                  <b>{num(row.adjustment?.confidence)}%</b>
                  <small className="block capitalize text-white/25">
                    {row.adjustment?.confidence_label || "historical"} ·{" "}
                    {num(row.adjustment?.comparison_games)} comparison games
                  </small>
                </td>
                {statColumns.map(([, key]) => (
                  <td key={key}>
                    {row.stats?.[key] == null || !num(row.raw_games)
                      ? "—"
                      : (
                          num(row.stats[key]) / Math.max(1, row.raw_games)
                        ).toFixed(1)}
                  </td>
                ))}
                <td>
                  {row.best?.[scoring] || row.best?.points != null
                    ? `${num(row.best?.[scoring]?.points ?? row.best?.points).toFixed(1)} · ${row.best?.[scoring]?.season ?? row.best?.season} W${row.best?.[scoring]?.week ?? row.best?.week}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? (
        <div className="p-6 text-sm text-white/38">
          No split meets these filters. Lower the meeting threshold or search
          another player.
        </div>
      ) : null}
      <div className="border-t border-white/10 p-4 text-[10px] leading-4 text-white/28">
        Historical splits describe observed outcomes; they do not prove a player
        intrinsically “owns” a defense. Adjusted edge removes that opponent from
        the same-season baseline, weights recent meetings more heavily, and
        shrinks small samples toward zero. Team-change attribution remains an
        estimate where only a season-level team was saved.
      </div>
    </Panel>
  );
}

function ProjectionLab({ model }) {
  const [week, setWeek] = useState(1);
  const [scoring, setScoring] = useState("ppr");
  const [position, setPosition] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("projection");
  const [selectedName, setSelectedName] = useState("");
  const teams = useMemo(
    () =>
      [
        ...new Set(
          (model?.players || []).map((player) => player.team).filter(Boolean),
        ),
      ].sort(),
    [model],
  );
  const rows = useMemo(
    () =>
      (model?.players || [])
        .map((player) => {
          const forecast = player.weeks?.find((row) => row.week === week);
          const variant = forecast?.variants?.[scoring] || {};
          const seasonPoints = num(player.season_points?.[scoring]);
          const baseline = seasonPoints / 17;
          return {
            ...player,
            forecast,
            variant,
            projection: num(variant.projection),
            baseline,
            change: num(variant.projection) - baseline,
            trend: player.trends?.[scoring] || {},
          };
        })
        .filter((player) => !player.forecast?.bye && player.projection > 0)
        .filter((player) => position === "ALL" || player.position === position)
        .filter((player) => team === "ALL" || player.team === team)
        .filter(
          (player) =>
            !query || normalize(player.name).includes(normalize(query)),
        )
        .sort((a, b) =>
          sort === "confidence"
            ? b.confidence - a.confidence
            : sort === "matchup"
              ? b.change - a.change
              : b.projection - a.projection,
        ),
    [model, week, scoring, position, team, query, sort],
  );
  const selected = rows.find((row) => row.name === selectedName) || rows[0];
  const seasonSeries = selected
    ? (selected.weeks || [])
        .filter((row) => !row.bye)
        .map((row) => ({
          ...row,
          projection: num(row.variants?.[scoring]?.projection),
          defenseIndex: num(row.variants?.[scoring]?.defense_index),
        }))
    : [];
  const maxProjection = Math.max(
    1,
    ...seasonSeries.map((row) => row.projection),
  );
  if (!model?.players?.length)
    return (
      <Panel className="p-8 text-center">
        <h2 className="text-xl font-black">Projection model unavailable</h2>
        <p className="mt-2 text-sm text-white/40">
          Run npm run update:stat-model after the current Arsenal season
          projections are generated.
        </p>
      </Panel>
    );
  return (
    <div className="space-y-4">
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-100/50">
              The Fantasy Arsenal · {model.model_version}
            </div>
            <h2 className="mt-1 text-2xl font-black">
              {model.season} Weekly Projection Lab
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/40">
              Season consensus redistributed across the real schedule using
              three years of defense-vs-position evidence, recent player trend,
              and matchup strength. Weekly totals always normalize back to the
              selected season baseline.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Select
              label="Week"
              value={week}
              onChange={(value) => setWeek(num(value))}
            >
              {Array.from({ length: 18 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  Week {index + 1}
                </option>
              ))}
            </Select>
            <Select label="Scoring" value={scoring} onChange={setScoring}>
              <option value="ppr">PPR</option>
              <option value="half">Half PPR</option>
              <option value="std">Standard</option>
            </Select>
            <Select label="Position" value={position} onChange={setPosition}>
              {["ALL", "QB", "RB", "WR", "TE", "K"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
            <Select label="Team" value={team} onChange={setTeam}>
              <option>ALL</option>
              {teams.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Model status"
          value="Experimental"
          detail="Versioned and auditable—not a black box"
          tone="amber"
        />
        <Metric
          label="Players modeled"
          value={model.count.toLocaleString()}
          detail={`${model.evidence_seasons.join(", ")} evidence seasons`}
          tone="cyan"
        />
        <Metric
          label="Current view"
          value={`${rows.length} players`}
          detail={`Week ${week} · ${scoring.toUpperCase()}`}
          tone="violet"
        />
        <Metric
          label="Snapshot"
          value={new Date(model.generated_at).toLocaleDateString()}
          detail="Dated before accuracy evaluation"
          tone="emerald"
        />
      </div>
      {selected ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-wider text-cyan-100/45">
                  Selected player
                </div>
                <h3 className="mt-1 text-2xl font-black">{selected.name}</h3>
                <p className="mt-1 text-xs text-white/35">
                  {selected.team} · {selected.position} ·{" "}
                  {selected.forecast?.opponent
                    ? `${selected.forecast.home ? "vs" : "at"} ${selected.forecast.opponent}`
                    : "Bye"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-4xl font-black text-emerald-100">
                  {selected.projection.toFixed(1)}
                </div>
                <div className="text-[9px] text-white/30">
                  WEEK {week} PROJECTION
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                label="Neutral baseline"
                value={selected.baseline.toFixed(1)}
                detail="Season projection ÷ 17"
              />
              <Metric
                label="Matchup change"
                value={`${selected.change >= 0 ? "+" : ""}${selected.change.toFixed(1)}`}
                detail={`${Math.round(num(selected.variant.defense_index) * 100)} defense index`}
                tone={selected.change >= 0 ? "emerald" : "rose"}
              />
              <Metric
                label="Confidence"
                value={`${selected.confidence}%`}
                detail={`${selected.source_count} projection sources`}
                tone="violet"
              />
              <Metric
                label="Recent trend"
                value={selected.trend.label || "No history"}
                detail={`${selected.trend.sample || 0} historical games`}
                tone="amber"
              />
            </div>
            <div className="mt-5 overflow-x-auto">
              <div
                className="flex min-w-[680px] items-end gap-1.5 border-b border-white/10 pb-2"
                style={{ height: 190 }}
              >
                {seasonSeries.map((row) => {
                  const active = row.week === week;
                  return (
                    <button
                      key={row.week}
                      onClick={() => setWeek(row.week)}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                      title={`Week ${row.week} ${row.opponent}: ${row.projection.toFixed(1)}`}
                    >
                      <div
                        className={`w-full rounded-t ${active ? "bg-amber-300" : "bg-gradient-to-t from-cyan-400/55 to-violet-300/70"}`}
                        style={{
                          height: `${Math.max(4, (row.projection / maxProjection) * 145)}px`,
                        }}
                      />
                      <span
                        className={`text-[8px] ${active ? "font-black text-amber-100" : "text-white/25"}`}
                      >
                        {row.week}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Panel>
          <Panel className="p-5">
            <h3 className="text-lg font-black">Why this projection moved</h3>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-black/15 p-4">
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">
                    Opponent allowance index
                  </span>
                  <b>{Math.round(num(selected.variant.defense_index) * 100)}</b>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-white/30">
                  100 is league average. Above 100 has historically allowed more{" "}
                  {selected.position} scoring; below 100 has allowed less.
                </p>
              </div>
              <div className="rounded-2xl bg-black/15 p-4">
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">Defensive evidence</span>
                  <b>{selected.variant.defense_sample || 0} games</b>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-white/30">
                  Weighted 15% / 30% / 55% toward the latest season, then
                  dampened to avoid overreacting.
                </p>
              </div>
              <div className="rounded-2xl bg-black/15 p-4">
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">Source disagreement</span>
                  <b>{(num(selected.disagreement) * 100).toFixed(1)}%</b>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-white/30">
                  Higher disagreement lowers confidence even when the point
                  estimate remains high.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}
      <Panel className="overflow-hidden">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-black">
                Week {week} player projections
              </h3>
              <p className="mt-1 text-xs text-white/35">
                Select any row for its full-season matchup curve and
                explanation.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player…"
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              >
                <option value="projection">Sort: projection</option>
                <option value="matchup">Sort: matchup boost</option>
                <option value="confidence">Sort: confidence</option>
              </select>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/45">
                {rows.length} active
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th>Matchup</th>
                <th>Projection</th>
                <th>Baseline</th>
                <th>Change</th>
                <th>Defense</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.slice(0, 250).map((player) => (
                <tr
                  key={player.name}
                  onClick={() => setSelectedName(player.name)}
                  className={`cursor-pointer hover:bg-white/[0.035] ${selected?.name === player.name ? "bg-cyan-300/[0.04]" : ""}`}
                >
                  <td className="px-4 py-3">
                    <b>{player.name}</b>
                    <small className="block text-white/28">
                      {player.team} · {player.position}
                    </small>
                  </td>
                  <td>
                    {player.forecast.home ? "vs" : "at"}{" "}
                    {player.forecast.opponent}
                  </td>
                  <td className="font-black text-emerald-100">
                    {player.projection.toFixed(1)}
                  </td>
                  <td>{player.baseline.toFixed(1)}</td>
                  <td
                    className={
                      player.change >= 0 ? "text-emerald-200" : "text-rose-200"
                    }
                  >
                    {player.change >= 0 ? "+" : ""}
                    {player.change.toFixed(1)}
                  </td>
                  <td>{Math.round(num(player.variant.defense_index) * 100)}</td>
                  <td>{player.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="p-5">
        <h3 className="font-black">Accuracy contract</h3>
        <p className="mt-2 text-xs leading-5 text-white/38">
          The daily updater saves a dated snapshot for the upcoming week. Trust
          & Accuracy should score the final snapshot created before kickoff
          against actual points using MAE, RMSE, rank correlation, positional
          bias, and coverage. Published snapshots are never rewritten after
          results are known.
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
  const statGroups = playerStatGroups(selected);
  const rawWeeks = Object.values(selected.weekly_stats || {}).filter(
    (stats) =>
      stats &&
      typeof stats === "object" &&
      Object.keys(stats).some((key) => !String(key).startsWith("pts_")),
  ).length;
  const rawAvailable =
    rawWeeks > 0 ||
    Object.keys(selected.stats || {}).some(
      (key) => !String(key).startsWith("pts_"),
    );
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
              Position-specific volume, efficiency, and season totals from
              Sleeper’s saved weekly stat feed.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[9px] ${rawAvailable ? "bg-emerald-300/10 text-emerald-100/70" : "bg-amber-300/10 text-amber-100/70"}`}
          >
            {rawAvailable
              ? `${rawWeeks} weekly box score${rawWeeks === 1 ? "" : "s"}`
              : "Raw stats unavailable"}
          </span>
        </div>
        {rawAvailable ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {statGroups.map(([title, stats]) => (
              <div
                key={title}
                className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"
              >
                <h3 className="font-black">{title}</h3>
                <div className="mt-3 space-y-2">
                  {stats.map((definition) => (
                    <div
                      key={`${title}:${definition.label}`}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-white/38">{definition.label}</span>
                      <b className="text-right">
                        {statResult(definition, selected.stats)}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-5">
            <div className="font-bold text-amber-100">
              Fantasy scoring is available; the raw box score is not.
            </div>
            <p className="mt-2 text-xs leading-5 text-white/40">
              Missing passing, rushing, receiving, or kicking fields are shown
              as unavailable instead of being reported as zero. This protects
              the research view from implying production the saved feed did not
              actually observe.
            </p>
          </div>
        )}
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
  const weeks = Object.keys(first.weeks || {}).filter((week) =>
    Object.prototype.hasOwnProperty.call(second.weeks || {}, week),
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

const CAREER_METRICS = {
  QB: [
    ["Fantasy points", "points"],
    ["Pass yards", "pass_yd"],
    ["Pass TD", "pass_td"],
    ["Attempts", "pass_att"],
    ["Rush yards", "rush_yd"],
  ],
  RB: [
    ["Fantasy points", "points"],
    ["Rush yards", "rush_yd"],
    ["Carries", "rush_att"],
    ["Targets", "rec_tgt"],
    ["Scrimmage yards", "scrimmage_yd"],
  ],
  WR: [
    ["Fantasy points", "points"],
    ["Targets", "rec_tgt"],
    ["Receptions", "rec"],
    ["Receiving yards", "rec_yd"],
    ["Receiving TD", "rec_td"],
  ],
  TE: [
    ["Fantasy points", "points"],
    ["Targets", "rec_tgt"],
    ["Receptions", "rec"],
    ["Receiving yards", "rec_yd"],
    ["Receiving TD", "rec_td"],
  ],
  K: [
    ["Fantasy points", "points"],
    ["Field goals", "fgm"],
    ["FG attempts", "fga"],
    ["Extra points", "xpm"],
    ["Kicking points", "kick_pts"],
  ],
};

function careerMetricValue(row, key) {
  if (key === "points") return num(row?.points);
  if (key === "scrimmage_yd")
    return hasStat(row?.stats, "rush_yd") || hasStat(row?.stats, "rec_yd")
      ? num(row?.stats?.rush_yd) + num(row?.stats?.rec_yd)
      : null;
  return hasStat(row?.stats, key) ? num(row.stats[key]) : null;
}

function CareerStatTrends({ rows, position }) {
  const metrics = CAREER_METRICS[position] || CAREER_METRICS.WR;
  const [metric, setMetric] = useState(metrics[0][1]);
  const [rate, setRate] = useState("total");
  useEffect(
    () => setMetric((CAREER_METRICS[position] || CAREER_METRICS.WR)[0][1]),
    [position],
  );
  const chartRows = rows.map((row) => {
    const raw = careerMetricValue(row, metric);
    const games = num(row?.stats?.gp) || num(row.games);
    return {
      ...row,
      metricValue:
        raw == null ? null : rate === "game" ? raw / Math.max(1, games) : raw,
    };
  });
  const usable = chartRows.filter((row) => row.metricValue != null);
  const peak = Math.max(1, ...usable.map((row) => num(row.metricValue)));
  const latest = usable.at(-1);
  const previous = usable.at(-2);
  const change =
    latest && previous ? latest.metricValue - previous.metricValue : null;
  const rawSeasons = rows.filter(
    (row) => Object.keys(row.stats || {}).length,
  ).length;

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-white/10 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-violet-100/55">
              Career production trend
            </div>
            <h3 className="mt-1 text-xl font-black">
              Stats across every saved season
            </h3>
            <p className="mt-1 text-xs text-white/38">
              Separate real volume and efficiency movement from changes in
              fantasy scoring.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select label="Metric" value={metric} onChange={setMetric}>
              {metrics.map(([label, key]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            <Select label="View" value={rate} onChange={setRate}>
              <option value="total">Season total</option>
              <option value="game">Per game</option>
            </Select>
          </div>
        </div>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-3">
        <div className="bg-slate-950/90 p-4">
          <div className="text-[9px] uppercase text-white/30">Peak</div>
          <b className="mt-1 block text-2xl text-cyan-100">
            {usable.length ? peak.toFixed(rate === "game" ? 1 : 0) : "—"}
          </b>
          <small className="text-white/30">Selected stat lens</small>
        </div>
        <div className="bg-slate-950/90 p-4">
          <div className="text-[9px] uppercase text-white/30">
            Latest change
          </div>
          <b
            className={`mt-1 block text-2xl ${change == null ? "text-white/45" : change >= 0 ? "text-emerald-100" : "text-rose-100"}`}
          >
            {change == null
              ? "—"
              : `${change >= 0 ? "+" : ""}${change.toFixed(rate === "game" ? 1 : 0)}`}
          </b>
          <small className="text-white/30">Versus prior saved season</small>
        </div>
        <div className="bg-slate-950/90 p-4">
          <div className="text-[9px] uppercase text-white/30">
            Raw-stat coverage
          </div>
          <b className="mt-1 block text-2xl text-violet-100">
            {rawSeasons}/{rows.length}
          </b>
          <small className="text-white/30">
            Career seasons with box scores
          </small>
        </div>
      </div>
      <div className="overflow-x-auto p-5">
        <div
          className="flex min-w-[620px] items-end gap-3 border-b border-white/10 pb-2"
          style={{ height: 220 }}
        >
          {chartRows.map((row) => (
            <div
              key={row.season}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[9px] font-bold text-white/45">
                {row.metricValue == null
                  ? "—"
                  : row.metricValue.toFixed(rate === "game" ? 1 : 0)}
              </span>
              <div
                className={`w-full rounded-t ${row.metricValue == null ? "bg-white/5" : "bg-gradient-to-t from-cyan-400/55 to-violet-300/75"}`}
                style={{
                  height: `${row.metricValue == null ? 3 : Math.max(5, (row.metricValue / peak) * 145)}px`,
                }}
              />
              <span className="text-[9px] text-white/30">{row.season}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-white/10">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">Season</th>
              <th>Games</th>
              <th>Fantasy</th>
              {metrics.slice(1).map(([label, key]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.map((row) => (
              <tr key={row.season}>
                <td className="px-4 py-3 font-black text-cyan-100">
                  {row.season}
                </td>
                <td>{num(row?.stats?.gp) || row.games}</td>
                <td>{row.points.toFixed(1)}</td>
                {metrics.slice(1).map(([, key]) => {
                  const value = careerMetricValue(row, key);
                  return (
                    <td key={key}>
                      {value == null
                        ? "—"
                        : value.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
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
  const [projectionModel, setProjectionModel] = useState(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState("");
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
    fetch("/stats/history/manifest.json", { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        const saved = (manifest?.seasons || [])
          .filter(
            (row) =>
              num(row.fantasypros_players) > 0 ||
              (num(row.sleeper_players) > 0 && num(row.completed_weeks) > 0),
          )
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
  useEffect(() => {
    if (tab !== "projections" || projectionModel) return;
    let live = true;
    const controller = new AbortController();
    setProjectionLoading(true);
    setProjectionError("");
    fetch("/stats/projections/manifest.json", {
      cache: "no-cache",
      signal: controller.signal,
    })
      .then(async (manifestResponse) => {
        const manifest = manifestResponse.ok
          ? await manifestResponse.json()
          : null;
        const modelPath =
          manifest?.model_path ||
          `/stats/projections/${new Date().getUTCFullYear()}/current.json`;
        const response = await fetch(modelPath, {
          cache: "no-cache",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            `The ${manifest?.current_season || "current-season"} stat projection model has not been generated yet.`,
          );
        return response.json();
      })
      .then((payload) => {
        if (live) setProjectionModel(payload);
      })
      .catch((failure) => {
        if (live && failure?.name !== "AbortError")
          setProjectionError(
            failure?.message || "Projection Lab could not load.",
          );
      })
      .finally(() => {
        if (live) setProjectionLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [tab, projectionModel]);
  const seasonPlayers = useMemo(
    () => mergeHistory(data, playerDb),
    [data, playerDb],
  );
  const allPlayers = useMemo(
    () =>
      seasonPlayers.filter(
        (player) => position === "ALL" || player.position === position,
      ),
    [position, seasonPlayers],
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
    const choices = filtered.length ? filtered : allPlayers;
    if (!choices.some((player) => player.key === selectedKey))
      setSelectedKey(choices[0].key);
    if (!choices.some((player) => player.key === compareKey))
      setCompareKey(choices[1]?.key || choices[0].key);
  }, [allPlayers, compareKey, filtered, selectedKey]);
  const selected = allPlayers.find((player) => player.key === selectedKey);
  const compared = allPlayers.find((player) => player.key === compareKey);
  const positionPlayers = allPlayers.filter(
    (player) => player.position === selected?.position,
  );
  const metrics = playerMetrics(selected, positionPlayers);
  const activeWorkspace =
    WORKSPACES.find((workspace) =>
      workspace.tabs.some(([key]) => key === tab),
    ) || WORKSPACES[0];
  const playerWorkspace = ["overview", "history", "compare"].includes(tab);
  const historicalWorkspace = !["projections", "method"].includes(tab);
  const showPositionAndSearch = playerWorkspace || tab === "leaders";

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
        const candidates = mergeHistory(payload, playerDb);
        const match =
          (selected.player_id
            ? candidates.find(
                (player) =>
                  String(player.player_id || "") ===
                  String(selected.player_id || ""),
              )
            : null) ||
          candidates.find(
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
    <main className="min-h-screen max-w-full overflow-x-clip text-white">
      <BackgroundParticles />
      <Navbar pageTitle="Stat Central" />
      <div className="mx-auto w-full min-w-0 max-w-7xl px-3 pb-24 pt-20 sm:px-5">
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
          {tab === "projections" ? (
            <div className="mt-5 rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4 text-xs leading-5 text-white/45">
              Projection Center has its own week, scoring, position, team, and
              player controls. Use Safe / Expected for the most likely path or
              Risky to expose data-supported boom and bust weeks.
            </div>
          ) : tab === "method" ? (
            <div className="mt-5 rounded-2xl border border-violet-300/10 bg-violet-300/[0.035] p-4 text-xs leading-5 text-white/45">
              Source definitions and calculation rules are separated from the
              research controls so facts, estimates, and modeled outputs remain
              easy to distinguish.
            </div>
          ) : historicalWorkspace ? (
            <>
              <div className={`mt-5 grid gap-3 sm:grid-cols-2 ${showPositionAndSearch ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
                <Select
                  label="Season"
                  value={season}
                  onChange={(value) => {
                    setSeason(num(value));
                    setCareer([]);
                  }}
                >
                  {availableSeasons.map((year) => (
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
                {showPositionAndSearch ? (
                  <>
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
                  </>
                ) : null}
              </div>
              {playerWorkspace ? (
                <div className={`mt-4 grid gap-2 ${tab === "compare" ? "md:grid-cols-2" : "grid-cols-1"}`}>
                  <Select
                    label={tab === "compare" ? "Primary player" : "Selected player"}
                    value={selectedKey}
                    onChange={setSelectedKey}
                  >
                    {filtered.slice(0, 500).map((player) => (
                      <option key={player.key} value={player.key}>
                        {player.name} · {player.position} · {player.points.toFixed(1)}
                      </option>
                    ))}
                  </Select>
                  {tab === "compare" ? (
                    <Select label="Comparison player" value={compareKey} onChange={setCompareKey}>
                      {filtered.slice(0, 500).map((player) => (
                        <option key={player.key} value={player.key}>
                          {player.name} · {player.position} · {player.points.toFixed(1)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </header>
        <div className="sticky top-14 z-30 -mx-3 mt-4 grid grid-cols-2 gap-2 border-y border-white/10 bg-slate-950/95 px-3 py-2 backdrop-blur-xl sm:static sm:mx-0 sm:flex sm:rounded-2xl sm:border">
          {WORKSPACES.map((workspace) => (
            <button
              key={workspace.key}
              onClick={() => {
                const nextTab = workspace.tabs[0][0];
                setTab(nextTab);
                if (nextTab === "matchups" && position !== "ALL")
                  setPosition("ALL");
              }}
              className={`min-w-0 rounded-xl px-3 py-2.5 text-left transition sm:flex-1 sm:px-4 ${activeWorkspace.key === workspace.key ? "bg-cyan-300/15 text-cyan-100 ring-1 ring-cyan-300/15" : "text-white/42 hover:bg-white/5 hover:text-white/75"}`}
            >
              <span className="block text-xs font-black">{workspace.label}</span>
              <span className="mt-0.5 hidden text-[9px] font-medium text-white/30 xl:block">
                {workspace.detail}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <div className={`grid grid-cols-1 gap-2 rounded-2xl border border-white/10 bg-slate-950/75 p-2 lg:flex lg:flex-col lg:p-3 ${activeWorkspace.tabs.length > 1 ? "min-[380px]:grid-cols-3" : ""}`}>
              <div className="hidden px-2 pb-1 lg:block">
                <div className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-200/40">
                  {activeWorkspace.label}
                </div>
                <p className="mt-1 text-[10px] leading-4 text-white/28">
                  {activeWorkspace.detail}
                </p>
              </div>
              {activeWorkspace.tabs.map(([key, label, detail]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`min-w-0 rounded-xl px-3 py-3 text-left transition ${tab === key ? "bg-white/[0.08] text-white ring-1 ring-white/10" : "text-white/42 hover:bg-white/[0.04] hover:text-white/72"}`}
                >
                  <span className="block text-xs font-black">{label}</span>
                  <span className="mt-1 hidden text-[9px] leading-4 text-white/28 lg:block">
                    {detail}
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <div className="min-w-0">
        <WorkspaceGuide tab={tab} />
        {loading && historicalWorkspace ? (
          <LoadingScreen
            progress={65}
            text={`Loading ${season} Stat Central…`}
          />
        ) : error && historicalWorkspace ? (
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
                players={seasonPlayers}
                schedule={data?.schedule}
                season={season}
                scoring={scoring}
              />
            ) : null}
            {tab === "projections" ? (
              projectionLoading ? (
                <LoadingScreen text="Loading the current projection model…" />
              ) : projectionError ? (
                <Panel className="p-6 text-rose-100">{projectionError}</Panel>
              ) : (
                <StatProjectionLab model={projectionModel} />
              )
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
                    <>
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
                                {row.games} games · {m.average.toFixed(1)}{" "}
                                average
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
                      <div className="mt-4">
                        <CareerStatTrends
                          rows={career}
                          position={selected?.position}
                        />
                      </div>
                    </>
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
        </div>
      </div>
    </main>
  );
}
